/** AI needs a bounded sample of the exact commit scope, not a rendered diff. */
import { copyFile, lstat, mkdtemp, rm } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { changelistDiff } from './scopedCommit.js'
import { readChangelistCommitPolicy } from './changelists.js'
import { retryFileOperation } from './fileRetry.js'
import { redact } from './commandLog.js'
import { DEFAULT_AI_EXCLUDE_PATTERNS } from '../shared/aiContextPolicy.js'

export const AI_CONTEXT_LIMITS = Object.freeze({ patch: 24000, file: 2000, files: 24, manifest: 6000, blob: 128 * 1024 })

const indexLocations = new WeakMap()

/** Git resolves linked worktrees and index overrides; the location itself is stable. */
export async function commitContextIndexPath(repo, options = {}) {
  options.signal?.throwIfAborted()
  const environment = JSON.stringify(['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE'].map(key => options.env?.[key] ?? process.env[key]))
  const previous = indexLocations.get(repo)
  if (previous?.environment === environment) return previous.path
  const result = await repo.run(['rev-parse', '--git-path', 'index'], { signal: options.signal, env: options.env })
  if (result.code !== 0) throw new Error(result.stderr.trim() || '无法定位暂存区')
  const path = resolve(repo.root, result.stdout.trim())
  indexLocations.set(repo, { environment, path })
  return path
}

function rawFiles(text) {
  const tokens = text.split('\0'), files = []
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const fields = tokens[i].split(' ')
    files.push({ path: tokens[i + 1], status: fields[4], oldMode: fields[0]?.slice(1), mode: fields[1], old: fields[2], oid: fields[3] })
  }
  return files
}

/** Ordered glob rules; ! restores detail eligibility without bypassing size caps. */
export function aiExcludeRules(text = DEFAULT_AI_EXCLUDE_PATTERNS) {
  return String(text || DEFAULT_AI_EXCLUDE_PATTERNS).slice(0, 8000).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).slice(0, 100).map(line => {
    const exclude = !line.startsWith('!')
    let pattern = (exclude ? line : line.slice(1)).replace(/\\/g, '/').replace(/^\//, '')
    if (pattern.endsWith('/')) pattern += '**'
    let source = pattern.includes('/') ? '^' : '(?:^|/)'
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i]
      if (char === '*' && pattern[i + 1] === '*') {
        i++
        if (pattern[i + 1] === '/') { source += '(?:.*/)?'; i++ } else source += '.*'
      } else if (char === '*') source += '[^/]*'
      else if (char === '?') source += '[^/]'
      else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    return { exclude, match: new RegExp(source + '$') }
  })
}

function priority(file) {
  return /\.(?:[cm]?[jt]sx?|vue|svelte|py|go|rs|java|kt|c|cc|cpp|h|cs|rb|php|sh|ps1)$/i.test(file.path) ? 0 : 1
}

/** Retain complete lines per file; a long generated line cannot fill the budget. */
async function patchSample(repo, env, head, paths, options) {
  const count = new Set(paths).size
  const perFile = Math.min(AI_CONTEXT_LIMITS.file, Math.floor(AI_CONTEXT_LIMITS.patch / Math.max(1, count)) - 64)
  let pending = '', dropping = false, section = null, total = 0, privateKey = false
  const sections = []
  const line = value => {
    if (value.startsWith('diff --git ')) {
      section = { text: '', truncated: false }; sections.push(section); privateKey = false
    }
    if (!section) return
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
      privateKey = !/-----END [A-Z ]*PRIVATE KEY-----/.test(value)
      value = '[private key redacted]'
    } else if (privateKey) {
      if (/-----END [A-Z ]*PRIVATE KEY-----/.test(value)) privateKey = false
      return
    }
    value = redact(value)
    if (section.text.length + value.length + 1 > perFile || total + value.length + 1 > AI_CONTEXT_LIMITS.patch - count * 32) {
      section.truncated = true; return
    }
    section.text += value + '\n'; total += value.length + 1
  }
  const accept = chunk => {
    for (const part of chunk.split(/(?<=\n)/)) {
      if (dropping) { if (part.endsWith('\n')) dropping = false; continue }
      pending += part
      if (pending.endsWith('\n')) { line(pending.slice(0, -1)); pending = '' }
      else if (pending.length > AI_CONTEXT_LIMITS.file) { pending = ''; dropping = true; if (section) section.truncated = true }
    }
    return true
  }
  const result = await repo.run(['diff', '--cached', ...(head ? [head] : []), '--no-renames', '--no-ext-diff', '--no-textconv', '-U1', '--', ...paths], {
    ...options, env, onStdout: accept, timeoutMs: 30000,
  })
  if (result.code !== 0) throw new Error(result.stderr.trim() || '无法读取 AI 提交差异')
  if (result.stdout) accept(result.stdout)
  if (pending) line(pending)
  options.signal?.throwIfAborted()
  return sections.map(section => section.text + (section.truncated ? '[此文件差异仅摘录部分]\n' : '')).join('').slice(0, AI_CONTEXT_LIMITS.patch)
}

export async function commitMessageContext(repo, request = {}, options = {}, prepared = {}) {
  const run = async (args, extra = {}) => {
    const result = await repo.run(args, { ...options, ...extra })
    if (result.code !== 0) throw new Error(result.stderr.trim() || '无法读取 AI 提交范围')
    return result.stdout
  }
  const location = prepared.indexPath || await commitContextIndexPath(repo, options)
  const directory = await mkdtemp(join(dirname(resolve(repo.root, location)), 'dsh-ai-'))
  try {
    const env = { GIT_INDEX_FILE: join(directory, 'index'), GIT_LITERAL_PATHSPECS: '1' }
    let head = prepared.status?.branch?.oid
    if (!(repo.supports('git:status:porcelain-v2') && prepared.status && (head === null || /^[a-f0-9]{40,64}$/.test(head || '')))) {
      const headResult = await repo.run(['rev-parse', '--verify', 'HEAD'], options)
      head = headResult.code === 0 ? headResult.stdout.trim() : null
    }
    let workspace = Array.isArray(request.paths), files = [], status
    // Even a raw workspace diff can refresh index stat data. Read it through a
    // private copy; this also freezes staged input against later editor saves.
    try { await copyFile(location, env.GIT_INDEX_FILE) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      const empty = await repo.runWrite(['read-tree', '--empty'], { ...options, env })
      if (empty.code !== 0) throw new Error(empty.stderr.trim())
    }
    if (!workspace) {
      files = rawFiles(await run(['diff', '--cached', ...(head ? [head] : []), '--raw', '--no-abbrev', '--no-renames', '-z'], { env }))
      workspace = !files.length
    }
    let policy = null
    if (workspace) {
      status = prepared.status || await repo.status({ ...options, force: true, details: false })
      const byPath = new Map(status.files.map(file => [file.path, file]))
      const paths = Array.isArray(request.paths) ? [...new Set(request.paths)] : status.files.map(file => file.path)
      policy = request.changelistVersion === undefined ? null : await readChangelistCommitPolicy(repo, options)
      if (request.changelistVersion !== undefined && policy?.version !== request.changelistVersion) throw new Error('提交范围已变化，请重新生成提交信息')
      const raw = new Map((head ? rawFiles(await run(['diff', head, '--raw', '--no-abbrev', '--no-renames', '-z'], { env })) : []).map(file => [file.path, file]))
      files = paths.map(path => {
        const file = byPath.get(path)
        if (!file) throw new Error('文件状态已变化，请刷新后重试')
        if (file.kind === 'unmerged') throw new Error('请先解决文件冲突')
        const chunks = policy?.chunks?.[path]
        if (chunks && (chunks.invalid || chunks.parts.some(part => part.selected && !part.list))) throw new Error('所选代码块需要重新分配：' + path)
        return { ...raw.get(path), ...file, status: file.kind === 'untracked' ? 'A' : file.kind === 'renamed' ? 'R'
          : file.worktree === 'D' ? 'D' : file.index !== '.' && file.index !== ' ' ? file.index : file.worktree }
      })
    }
    if (!files.length) return { empty: true, diff: '', files: [] }
    if (files.some(file => file.status === 'U')) throw new Error('请先解决文件冲突')

    const attributes = workspace && prepared.attributes !== undefined ? prepared.attributes : await run(['check-attr', ...(workspace ? [] : ['--cached']), '-z', '--stdin', 'linguist-generated', 'filter'], {
      ...(workspace ? {} : { env }), input: files.map(file => file.path).join('\0') + '\0',
    })
    const attrs = new Map(), fields = attributes.split('\0')
    for (let i = 0; i + 2 < fields.length; i += 3) {
      if (!attrs.has(fields[i])) attrs.set(fields[i], {})
      attrs.get(fields[i])[fields[i + 1]] = fields[i + 2]
    }
    const oids = [...new Set(files.flatMap(file => [file.old, ...(workspace ? [] : [file.oid])]).filter(oid => oid && !/^0+$/.test(oid)))]
    const sizes = new Map()
    if (oids.length) {
      const entries = await run(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { input: oids.join('\n') + '\n' })
      for (const entry of entries.trim().split('\n')) { const [oid, type, size] = entry.split(' '); sizes.set(oid, type === 'blob' ? Number(size) : Infinity) }
    }
    // Metadata only, bounded concurrency. Generated files never reach git add.
    const rules = aiExcludeRules(options.excludePatterns)
    const defaultRules = !options.excludePatterns || options.excludePatterns === DEFAULT_AI_EXCLUDE_PATTERNS
    for (let offset = 0; offset < files.length; offset += 32) await Promise.all(files.slice(offset, offset + 32).map(async file => {
      const attr = attrs.get(file.path) || {}
      let excluded
      for (const rule of rules) if (rule.match.test(file.path)) excluded = rule.exclude
      const markedGenerated = ['true', 'set'].includes(attr['linguist-generated'])
      file.reason = attr.filter === 'lfs' ? 'LFS 文件' : markedGenerated ? '生成产物/依赖锁文件' : ''
      if (attr.filter !== 'lfs' && excluded !== undefined && !(defaultRules && ['false', 'unset'].includes(attr['linguist-generated']))) file.reason = excluded ? 'AI 排除规则' : ''
      let size = sizes.get(file.old) || 0
      if (workspace) {
        try { const info = await lstat(resolve(repo.root, file.path)); size = Math.max(size, info.isFile() ? info.size : Infinity) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      } else size = Math.max(size, sizes.get(file.oid) || 0)
      if (!file.reason && (size > AI_CONTEXT_LIMITS.blob || ['120000', '160000'].includes(file.mode))) file.reason = '大文件/非普通文件'
    }))
    const candidates = files.filter(file => !file.reason).sort((a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path)).slice(0, AI_CONTEXT_LIMITS.files)
    const detailed = new Set(candidates.map(file => file.path))
    // A rename's original entry is removed in the temporary index, but its
    // potentially huge old body need not be sampled as a separate deletion.
    const paths = candidates.map(file => file.path)
    let patch = ''
    if (paths.length) {
      if (workspace) patch = (await changelistDiff(repo, { paths: candidates.map(file => file.path), changelistVersion: request.changelistVersion }, {
        ...options, status, lightweight: true, readDiff: (indexEnv, base) => patchSample(repo, indexEnv, base, paths, options),
      }, { indexPath: location, head })).text
      else patch = await patchSample(repo, env, head, paths, options)
    }
    if (request.changelistVersion !== undefined && (await readChangelistCommitPolicy(repo, options))?.version !== request.changelistVersion) throw new Error('提交范围已变化，请重新生成提交信息')
    const summaryOnly = files.length - candidates.length
    const manifest = [`提交范围共 ${files.length} 个文件；${candidates.length} 个文件提供差异摘录，${summaryOnly} 个仅提供文件信息。`]
    let manifestSize = manifest[0].length
    for (const file of [...candidates, ...files.filter(file => !detailed.has(file.path))]) {
      const entry = `${file.status} ${JSON.stringify(file.path)}${file.originalPath ? ' ← ' + JSON.stringify(file.originalPath) : ''}${detailed.has(file.path) ? '' : '（仅文件信息：' + (file.reason || '超出正文文件预算') + '）'}`
      if (manifestSize + entry.length + 1 > AI_CONTEXT_LIMITS.manifest - 80) { manifest.push('其余文件已省略文件名，计入上述总数。'); break }
      manifest.push(entry); manifestSize += entry.length + 1
    }
    return { empty: !patch.trim() && !summaryOnly, files: manifest, diff: patch,
      summary: { totalFiles: files.length, detailedFiles: candidates.length, summaryOnlyFiles: summaryOnly } }
  } finally { await retryFileOperation(() => rm(directory, { recursive: true, force: true })) }
}

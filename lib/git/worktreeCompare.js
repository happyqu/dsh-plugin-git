import { lstat, readFile, readlink, realpath, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { openWorktree, commonDirectory, normalizedPath } from './worktrees.js'
import { diffResult } from './diff.js'
import { git } from './exec.js'

export const WORKTREE_COMPARE_LIMITS = { files: 5000, bytes: 32 * 1024 * 1024, fileBytes: 4 * 1024 * 1024, ttl: 5 * 60 * 1000 }
function safePath(path) {
  return typeof path === 'string' && path && !isAbsolute(path) && !path.includes('\0') && !path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git')
}
async function inventory(target, options) {
  const staged = await target.runOrThrow(['ls-files', '--stage', '-z'], options)
  const untracked = await target.runOrThrow(['ls-files', '--others', '--exclude-standard', '-z'], options)
  const head = await target.run(['rev-parse', '--verify', 'HEAD'], options)
  const committed = head.code === 0 ? await target.runOrThrow(['ls-tree', '-r', '-z', head.stdout.trim()], options) : ''
  const paths = new Set(), submodules = new Set()
  for (const record of (staged + committed).split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t'), path = record.slice(tab + 1)
    if (tab < 0 || !safePath(path)) throw new Error('工作树包含无法安全比较的路径')
    if (record.startsWith('160000 ')) submodules.add(path)
    else paths.add(path)
  }
  for (const path of untracked.split('\0').filter(Boolean)) {
    if (!safePath(path)) throw new Error('工作树包含无法安全比较的路径')
    paths.add(path)
  }
  for (const path of submodules) paths.delete(path)
  return { paths, submodules }
}
async function diskFile(root, path, budget, options) {
  const absolute = resolve(root, path), local = relative(root, absolute)
  if (!local || local.startsWith('..' + sep) || isAbsolute(local)) throw new Error('比较路径超出工作树')
  let info
  try { info = await lstat(absolute, { bigint: true }) } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error }
  // HEAD/index may still name a file that was replaced with a directory.
  // Its former file is absent; children are compared via their own entries.
  if (info.isDirectory()) return null
  // A symlink is compared as link text, never as its external target.
  if (info.isSymbolicLink()) {
    const data = Buffer.from(await readlink(absolute))
    budget.bytes += data.length
    if (budget.bytes > WORKTREE_COMPARE_LIMITS.bytes) throw new Error('工作树对比总量超过 32 MiB，请缩小目录规模后重试')
    return { data, mode: '120000' }
  }
  if (!info.isFile()) throw new Error('工作树中存在不支持比较的文件类型：' + path)
  const physical = relative(await realpath(root), await realpath(absolute))
  if (physical.startsWith('..' + sep) || isAbsolute(physical)) throw new Error('比较路径指向工作树之外：' + path)
  if (info.size > BigInt(WORKTREE_COMPARE_LIMITS.fileBytes)) throw new Error('文件超过 4 MiB，无法生成完整工作树对比：' + path)
  budget.bytes += Number(info.size)
  if (budget.bytes > WORKTREE_COMPARE_LIMITS.bytes) throw new Error('工作树对比总量超过 32 MiB，请缩小目录规模后重试')
  const data = await readFile(absolute, { signal: options.signal })
  const after = await lstat(absolute, { bigint: true })
  if (after.size !== info.size || after.mtimeNs !== info.mtimeNs || after.ino !== info.ino || !after.isFile() || data.length !== Number(info.size)) throw new Error('文件在读取期间发生变化，请重新对比：' + path)
  return { data, mode: info.mode & 0o111n ? '100755' : '100644' }
}

/** Bounded, expiring in-memory snapshots; no repository index or objects are written. */
export function createWorktreeComparisonStore() {
  const snapshots = new Map()
  function expire() { for (const [key, value] of snapshots) if (Date.now() - value.createdAt > WORKTREE_COMPARE_LIMITS.ttl) snapshots.delete(key) }
  return {
    async compare(repo, request, options = {}) {
      expire()
      if (normalizedPath(request.from || repo.root) === normalizedPath(request.to || repo.root)) throw new Error('请选择两个不同的工作树')
      const left = (await openWorktree(repo, request.from, options)).target
      const right = (await openWorktree(repo, request.to, options)).target
      const a = await inventory(left, options), b = await inventory(right, options)
      const skipped = new Set([...a.submodules, ...b.submodules])
      const paths = [...new Set([...a.paths, ...b.paths])].filter(path => ![...skipped].some(prefix => path === prefix || path.startsWith(prefix + '/'))).sort()
      if (paths.length > WORKTREE_COMPARE_LIMITS.files) throw new Error('工作树对比超过 5000 个文件，请缩小目录规模后重试')
      const entries = new Map(), files = [], budget = { bytes: 0 }
      for (const path of paths) {
        options.signal?.throwIfAborted()
        const before = a.paths.has(path) ? await diskFile(left.root, path, budget, options) : null
        const after = b.paths.has(path) ? await diskFile(right.root, path, budget, options) : null
        if (!before && !after || before && after && before.mode === after.mode && before.data.equals(after.data)) continue
        const file = { path, status: !before ? 'A' : !after ? 'D' : 'M', from: null,
          binary: !!(before?.data.includes(0) || after?.data.includes(0)), modeChanged: !!(before && after && before.mode !== after.mode), added: null, deleted: null }
        files.push(file); entries.set(path, { before, after, file })
      }
      options.signal?.throwIfAborted()
      const token = randomUUID(), createdAt = Date.now()
      // Two retained snapshots bound idle memory to 64 MiB.
      while (snapshots.size >= 2) snapshots.delete(snapshots.keys().next().value)
      snapshots.set(token, { common: commonDirectory(repo), entries, createdAt })
      return { token, from: left.root, to: right.root, createdAt, files, skippedSubmodules: [...skipped], bytes: budget.bytes }
    },
    async file(repo, request, options = {}) {
      expire()
      const snapshot = snapshots.get(request.token)
      if (!snapshot || snapshot.common !== commonDirectory(repo)) throw Object.assign(new Error('工作树对比快照已失效，请重新对比'), { code: 'git/worktree-snapshot-expired' })
      const entry = snapshot.entries.get(request.path)
      if (!entry) throw new Error('文件不在此工作树对比中')
      if (!['diff', 'before', 'after', 'content'].includes(request.mode)) throw new Error('不支持的预览模式')
      if (request.mode !== 'diff') {
        const side = request.mode === 'before' ? entry.before : entry.after, binary = !!side?.data.includes(0)
        return { exists: !!side, text: side && !binary ? side.data.toString('utf8') : '', binary, truncated: false }
      }
      if (entry.file.binary) return { text: '', hunks: [], files: [{ ...entry.file, hunks: [] }], truncated: false }
      const temp = await mkdtemp(join(tmpdir(), 'dsh-worktree-diff-'))
      try {
        const before = join(temp, 'before'), after = join(temp, 'after')
        await writeFile(before, entry.before?.data || Buffer.alloc(0)); await writeFile(after, entry.after?.data || Buffer.alloc(0))
        // Diff the captured bytes outside the repo, without attributes, filters
        // or autocrlf converting them back into repository-normalized content.
        const result = await git({ gitPath: repo.gitPath, cwd: temp, signal: options.signal, timeoutMs: 30000,
          args: ['--no-optional-locks', '-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--', before, after],
          env: { GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined, GIT_INDEX_FILE: undefined,
            GIT_CONFIG: undefined, GIT_CONFIG_PARAMETERS: undefined, GIT_CONFIG_COUNT: '0', GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_ATTR_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: tmpdir() } })
        if (![0, 1].includes(result.code)) throw new Error(result.stderr || '无法生成工作树文件差异')
        const parsed = diffResult(result.stdout)
        return { ...parsed, files: [{ ...entry.file, hunks: parsed.hunks }] }
      } finally {
        const local = relative(tmpdir(), temp)
        if (!local || local.startsWith('..') || isAbsolute(local)) throw new Error('临时目录校验失败')
        await rm(temp, { recursive: true, force: true })
      }
    },
  }
}

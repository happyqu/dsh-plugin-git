import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, readdir, link, copyFile, lstat, rename } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { constants } from 'node:fs'
import { reportGitProgress } from './exec.js'
import { LruTtlCache } from './cache.js'

const LONG = 30 * 60_000
const versions = new LruTtlCache({ capacity: 4, ttlMs: 300_000 })
const outcome = r => ({ ...r, ok: r.code === 0, message: r.code === 0 ? '完成' : r.stderr.trim() || r.stdout.trim() || 'Git LFS 操作失败' })
async function saveManifest(directory, record) {
  const temporary = join(directory, 'manifest-' + randomUUID() + '.tmp')
  await writeFile(temporary, JSON.stringify(record, null, 2), { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, join(directory, 'manifest.json'))
}
async function required(repo, args, options = {}) {
  const result = await repo.run(args, options)
  if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'Git LFS 操作失败')
  return result.stdout
}
function pattern(value, requiredValue = false) {
  const text = typeof value === 'string' ? value.trim() : ''
  if ((requiredValue && !text) || text.length > 4096 || /[\0\r\n]/.test(text)) throw new Error('请输入有效的文件匹配规则')
  return text
}
async function remoteOf(repo, name, options) {
  const remotes = await repo.remotes(options)
  const selected = name || (remotes.length === 1 ? remotes[0].name : '')
  if (!selected || !remotes.some(r => r.name === selected)) throw new Error('请选择已配置的远端')
  return selected
}
/**
 * Read the `filter.lfs.*` configuration without ever failing the status call.
 *
 * Whether LFS is *installed* is answered by `git lfs version` alone. This probe
 * only refines *how* it is wired up, so a git that cannot answer it must degrade
 * to "filters not configured" instead of taking the whole panel down with it:
 * reporting "LFS is missing" because an auxiliary config read failed is exactly
 * backwards.
 *
 * Two shapes are tried. The NUL-delimited `--get-regexp` form is preferred
 * because LFS values contain spaces (`git-lfs clean -- %f`), which the plain
 * space-separated form cannot round-trip unambiguously. `--null` is not
 * available on every git, though, so when the command itself fails (an unknown
 * option, an unreadable config, a repository git refuses to touch) three plain
 * `--get` lookups are used — every git supports those, and "unset" is just
 * exit code 1.
 *
 * @param repo - the repository session.
 * @param options - cancellation.
 * @returns `{ process, clean, smudge }`, each an empty string when unset.
 */
async function readLfsFilters(repo, options) {
  const keys = ['filter.lfs.process', 'filter.lfs.clean', 'filter.lfs.smudge']
  const found = { process: '', clean: '', smudge: '' }
  try {
    const result = await repo.run(['config', '--null', '--get-regexp', '^filter\\.lfs\\.(process|clean|smudge)$'], options)
    if (result.code === 0) {
      for (const record of result.stdout.split('\0')) {
        const split = record.indexOf('\n')
        if (split < 0) continue
        const key = record.slice(0, split)
        if (keys.includes(key)) found[key.slice('filter.lfs.'.length)] = record.slice(split + 1).trim()
      }
      return found
    }
    // Exit 1 is the documented "no match", which is a real answer.
    if (result.code === 1) return found
  } catch (error) {
    // Cancellation is the caller's decision, not an environment failure.
    if (options.signal?.aborted) throw error
  }
  const probes = await Promise.all(keys.map(key => repo.run(['config', '--get', key], options).catch(() => null)))
  probes.forEach((result, index) => {
    if (result?.code === 0) found[keys[index].slice('filter.lfs.'.length)] = result.stdout.trim()
  })
  return found
}
export async function lfsStatus(repo, request = {}, options = {}) {
  const summary = await repo.cache.lfsInfo.through('summary', async () => {
    const [version, filters] = await Promise.all([
      versions.through(repo.gitPath, async () => {
        const result = await repo.run(['lfs', 'version'], { ...options, timeoutMs: 8000 })
        if (options.signal?.aborted) throw new Error('LFS 检测已取消')
        return result
      }, { force: request.force === true, signal: options.signal }),
      readLfsFilters(repo, options),
    ])
    if (version.code !== 0) return { installed: false, version: '', error: version.stderr.trim() || version.stdout.trim() }
    // Include effective system/global/worktree filters, not only local config.
    const initialized = !!(filters.process || (filters.clean && filters.smudge))
    return { installed: true, initialized, version: version.stdout.trim() }
  }, { force: request.force === true, signal: options.signal })
  // A failed detail read (rules, backups) must not discard the summary that
  // already answered the important question.
  let details = { rules: '', backups: [] }
  if (summary.installed && request.summaryOnly !== true) {
    try { details = await lfsDetails(repo, request, options) }
    catch (error) { if (options.signal?.aborted) throw error }
  }
  return { ...summary, ...details, files: [] }
}
export async function lfsDetails(repo, request = {}, options = {}) {
  // The two halves are independent: unreadable tracking rules must not hide the
  // migration backups, and vice versa. Callers get whatever could be read.
  const [rules, backups] = await Promise.all([
    repo.cache.lfsInfo.through('rules', async () => {
      const result = await repo.run(['lfs', 'track'], { ...options, timeoutMs: 30_000 })
      // `git lfs track` with no rules prints nothing and exits 0; a git-lfs too
      // old to know the subcommand is not a reason to fail the whole panel.
      if (result.code !== 0) return ''
      return result.stdout.trim()
    }, { force: request.force === true, signal: options.signal }),
    lfsBackups(repo, options).catch(error => {
      if (options.signal?.aborted) throw error
      return []
    }),
  ])
  return { rules, backups }
}
export async function lfsBranches(repo, request = {}, options = {}) {
  // LFS only needs local names and HEAD, not tracking counts or merged history.
  const text = await required(repo, ['for-each-ref', '--format=%(refname)%00%(HEAD)', 'refs/heads'], { ...options, timeoutMs: 15_000 })
  return text.trimEnd().split('\n').filter(Boolean).map(line => { const [ref, head] = line.split('\0'); return { ref, name: ref.slice('refs/heads/'.length), head: head === '*' } })
}
async function readLfsPage(repo, query, requestedPage, options) {
  const pageSize = 50, offset = (requestedPage - 1) * pageSize
  let pending = '', total = 0, matched = 0, files = [], lastPage = [], invalid = false
  const consume = line => {
    if (!line) return true
    const match = /^([a-f0-9]{64}) ([*-]) (.*)$/.exec(line.replace(/\r$/, ''))
    if (!match) { invalid = true; return false }
    total++
    const file = { name: match[3], checkout: match[2] === '*' }
    if (query && !file.name.toLowerCase().includes(query)) return true
    const index = matched++
    if (index % pageSize === 0) lastPage = []
    lastPage.push(file)
    if (index >= offset && index < offset + pageSize) files.push(file)
    return matched <= offset + pageSize
  }
  const onStdout = text => {
    pending += text
    if (pending.length > 1024 * 1024) { invalid = true; return false }
    let end
    while ((end = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1)
      if (!consume(line)) return false
    }
    return true
  }
  const result = await repo.run(['lfs', 'ls-files', '--long'], { ...options, timeoutMs: 60_000, onStdout })
  // Also tolerate runners that return buffered output (older embedded adapters).
  if (result.stdout) onStdout(result.stdout)
  if (!result.stopped && pending) consume(pending)
  if (options.signal?.aborted) throw new Error('LFS 文件读取已取消')
  if (result.code !== 0) throw new Error(result.stderr.trim() || '无法读取 LFS 文件')
  if (invalid) {
    // JSON keeps unusual names containing newlines unambiguous. Normal paths
    // use the streaming fast path, which never holds the complete catalogue.
    const fallback = await repo.run(['lfs', 'ls-files', '--json'], { ...options, timeoutMs: 60_000, maxBuffer: 32 * 1024 * 1024 })
    if (fallback.code !== 0) throw new Error(fallback.stderr.trim() || '无法读取 LFS 文件名')
    const value = JSON.parse(fallback.stdout)
    const entries = (Array.isArray(value) ? value : value.files).filter(file => typeof file.name === 'string')
    const filtered = query ? entries.filter(file => file.name.toLowerCase().includes(query)) : entries
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(filtered.length / pageSize)))
    return { files: filtered.slice((page - 1) * pageSize, page * pageSize).map(file => ({ name: file.name, checkout: !!file.checkout })),
      total: entries.length, matched: filtered.length, page, pageSize, hasNext: page * pageSize < filtered.length }
  }
  const hasNext = matched > offset + pageSize
  const page = hasNext ? requestedPage : Math.min(requestedPage, Math.max(1, Math.ceil(matched / pageSize)))
  return { files: page === requestedPage ? files : lastPage, total: hasNext ? null : total,
    matched: hasNext ? null : matched, page, pageSize, hasNext }
}
export async function lfsFiles(repo, request = {}, options = {}) {
  const query = typeof request.query === 'string' ? request.query.trim().toLowerCase().slice(0, 300) : ''
  const page = Number.isInteger(request.page) ? Math.max(1, Math.min(request.page, 100000)) : 1
  if (request.force === true) repo.cache.lfs.clear()
  return repo.cache.lfs.through(JSON.stringify([query, page]), () => readLfsPage(repo, query, page, options), { signal: options.signal })
}
async function refsSnapshot(repo, options) {
  const text = await required(repo, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags', 'refs/remotes'], options)
  return Object.fromEntries(text.trim().split('\n').filter(Boolean).map(line => line.split(' ')))
}
async function cleanState(repo, options) {
  const status = await repo.status({ ...options, force: true })
  if (status.files.length || status.operation) throw new Error('请先提交或储藏改动，并完成正在进行的 Git 操作')
  const branch = (await required(repo, ['symbolic-ref', '--quiet', 'HEAD'], options)).trim()
  const head = (await required(repo, ['rev-parse', '--verify', 'HEAD'], options)).trim()
  return { branch, head, refs: await refsSnapshot(repo, options) }
}
async function migrationOptions(repo, request, options) {
  if (!['import', 'export'].includes(request.mode)) throw new Error('请选择迁入或迁出 LFS')
  const refs = [...new Set(request.refs || [])]
  if (!refs.length || refs.length > 100 || refs.some(ref => typeof ref !== 'string' || !ref.startsWith('refs/heads/') || /[\0\r\n]/.test(ref))) throw new Error('请选择要迁移的本地分支')
  const existing = await refsSnapshot(repo, options)
  if (refs.some(ref => !existing[ref])) throw new Error('分支已变化，请重新扫描')
  const trees = await repo.worktrees(options)
  const normalize = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
  if (trees.some(tree => refs.includes(tree.branch) && normalize(tree.path) !== normalize(repo.root))) throw new Error('迁移分支被其他工作树占用，请先在该工作树切换分支')
  const include = pattern(request.include), exclude = pattern(request.exclude)
  const above = typeof request.above === 'string' ? request.above.trim() : ''
  if (above && !/^\d+(?:\.\d+)?\s*(?:[KMGT]i?B|B)?$/i.test(above)) throw new Error('大小阈值格式示例：50 MB')
  if (above && (include || exclude || request.mode === 'export')) throw new Error('按大小迁入不能与文件规则组合；迁出请指定文件规则')
  if (!above && !include) throw new Error('请填写文件匹配规则，或选择按大小迁入')
  const args = ['--skip-fetch', ...refs.map(ref => '--include-ref=' + ref)]
  if (include) args.push('--include=' + include)
  if (exclude) args.push('--exclude=' + exclude)
  if (above) args.push('--above=' + above)
  if (request.mode === 'export' && request.remote) args.push('--remote=' + await remoteOf(repo, request.remote, options))
  return { mode: request.mode, refs, include, exclude, above, remote: request.remote || '', args }
}
export async function lfsMigrationPreview(repo, request, options = {}) {
  const config = await migrationOptions(repo, request, options)
  const before = await cleanState(repo, options)
  const args = ['lfs', 'migrate', 'info', ...config.args.filter(arg => !arg.startsWith('--remote=')), '--top=50']
  const report = await required(repo, args, { ...options, timeoutMs: LONG })
  const after = await cleanState(repo, options)
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('扫描期间仓库已变化，请重新扫描')
  const [total, unpublished] = await Promise.all([
    required(repo, ['rev-list', '--count', ...config.refs], options),
    required(repo, ['rev-list', '--count', ...config.refs, '--not', '--remotes'], options),
  ])
  const affected = config.refs.map(ref => ({ ref, sha: before.refs[ref] }))
  return { report: report.trim(), refs: affected, commitCount: Number(total.trim()), publishedCount: Number(total.trim()) - Number(unpublished.trim()), config, snapshot: before, command: ['git', 'lfs', 'migrate', config.mode, ...config.args] }
}
async function backupDirectory(repo) {
  if (repo.identity?.commonDir) return join(resolve(repo.root, repo.identity.commonDir), 'dsh-lfs-migrations')
  const result = await required(repo, ['rev-parse', '--git-common-dir'])
  return join(resolve(repo.root, result.trim()), 'dsh-lfs-migrations')
}
async function mediaDirectory(repo, options) {
  const text = await required(repo, ['lfs', 'env'], options)
  const match = /^LocalMediaDir=(.+)$/m.exec(text)
  if (!match) throw new Error('无法定位本机 LFS 对象目录')
  return resolve(repo.root, match[1].trim())
}
async function preserveObjects(source, destination, signal) {
  let first; try { first = await readdir(source, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return 0; throw error }
  let count = 0
  for (const a of first.filter(entry => entry.isDirectory() && /^[a-f0-9]{2}$/.test(entry.name))) {
    for (const b of (await readdir(join(source, a.name), { withFileTypes: true })).filter(entry => entry.isDirectory() && /^[a-f0-9]{2}$/.test(entry.name))) {
      for (const file of (await readdir(join(source, a.name, b.name), { withFileTypes: true })).filter(entry => entry.isFile() && /^[a-f0-9]{64}$/.test(entry.name))) {
        const directory = join(destination, a.name, b.name), target = join(directory, file.name)
        await mkdir(directory, { recursive: true })
        try { await link(join(source, a.name, b.name, file.name), target) } catch (error) {
          if (error.code !== 'EEXIST') { try { await copyFile(join(source, a.name, b.name, file.name), target, constants.COPYFILE_EXCL) } catch (copyError) { if (copyError.code !== 'EEXIST') throw copyError } }
          else if (!(await lstat(target)).isFile() || (await lstat(target)).isSymbolicLink()) throw new Error('LFS 对象目标不是普通文件')
        }
        reportGitProgress(signal, 'Preserving local LFS objects: ' + (++count))
      }
    }
  }
  return count
}
async function lfsBackups(repo, options = {}) {
  const directory = await backupDirectory(repo)
  let names; try { names = await readdir(directory) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const records = await Promise.all(names.filter(name => /^[a-f0-9-]{36}$/.test(name)).map(async name => {
    try { const record = JSON.parse(await readFile(join(directory, name, 'manifest.json'), 'utf8')); return { id: name, createdAt: record.createdAt, mode: record.mode, state: record.state === 'running' && !options.activeMigration ? 'interrupted' : record.state, refs: record.refs } } catch { return null }
  }))
  return records.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
}
export async function lfsInitialize(repo, request, options = {}) {
  return outcome(await repo.runWrite(['lfs', 'install', '--local'], options))
}
export async function lfsTrack(repo, request, options = {}) {
  const value = pattern(request.pattern, true)
  if (value.startsWith('-')) throw new Error('文件规则不能以 - 开头')
  const args = ['lfs', request.untrack ? 'untrack' : 'track']
  if (request.literal && !request.untrack) args.push('--filename')
  args.push(value)
  return outcome(await repo.runWrite(args, { ...options, timeoutMs: 30_000 }))
}
export async function lfsTransfer(repo, request, options = {}) {
  if (!['pull', 'push', 'fsck'].includes(request.action)) throw new Error('不支持的 LFS 操作')
  const args = ['lfs', request.action]
  if (request.action !== 'fsck') {
    const remote = await remoteOf(repo, request.remote, options)
    if (request.action === 'pull' && request.path !== undefined) {
      const path = request.path
      if (typeof path !== 'string' || !path || /^[-/\\]|^[A-Za-z]:/.test(path) || /[\0\r\n]/.test(path) || path.split(/[\\/]/).includes('..')) throw new Error('文件路径不安全')
      if (path.includes(',')) throw new Error('文件名包含逗号，请在 LFS 设置中下载当前分支内容')
      args.push('--include=/' + path.replace(/[\\?*\[\]]/g, character => '\\' + character), '--exclude=')
    } else if (request.action === 'pull' && request.include) args.push('--include=' + pattern(request.include, true), '--exclude=')
    args.push(remote)
    if (request.action === 'push') {
      const ref = request.ref || (await required(repo, ['symbolic-ref', '--quiet', 'HEAD'], options)).trim()
      if (!ref.startsWith('refs/heads/') || !(await refsSnapshot(repo, options))[ref]) throw new Error('请选择本地分支')
      args.push('--all', ref)
    }
  }
  return outcome(await repo.runWrite(args, { ...options, timeoutMs: LONG, env: { GIT_LFS_FORCE_PROGRESS: '1' } }))
}
export async function lfsMigrate(repo, request, options = {}) {
  const config = await migrationOptions(repo, request, options)
  const before = await cleanState(repo, options)
  if (!request.snapshot || JSON.stringify(request.snapshot) !== JSON.stringify(before)) throw new Error('扫描结果已过期，请重新扫描')
  if (JSON.stringify(request.config) !== JSON.stringify(config)) throw new Error('迁移配置已变化，请重新扫描')
  const id = randomUUID(), directory = join(await backupDirectory(repo), id)
  await mkdir(directory, { recursive: true })
  const bundle = join(directory, 'before.bundle')
  await required(repo, ['bundle', 'create', bundle, ...new Set([...config.refs, before.branch])], { ...options, timeoutMs: LONG })
  await required(repo, ['bundle', 'verify', bundle], options)
  const localObjects = await preserveObjects(await mediaDirectory(repo, options), join(directory, 'objects'), options.signal)
  const verified = await cleanState(repo, options)
  if (JSON.stringify(verified) !== JSON.stringify(before)) throw new Error('备份期间仓库已变化，请重新扫描')
  const record = { id, createdAt: Date.now(), mode: config.mode, state: 'running', refs: config.refs, before, after: null, localObjects }
  const save = () => saveManifest(directory, record)
  await save()
  // --yes is deliberately omitted: a concurrent dirty worktree must never be discarded.
  let result
  try {
    result = await repo.runWrite(['lfs', 'migrate', config.mode, ...config.args, '--object-map=' + join(directory, 'object-map.csv')], { ...options, timeoutMs: LONG, env: { GIT_LFS_FORCE_PROGRESS: '1' } })
    record.state = result.code === 0 ? 'complete' : 'failed'
  } catch (error) { record.state = 'failed'; throw Object.assign(error, { recovery: { kind: 'lfsMigrate', id, backup: directory } }) }
  finally {
    record.after = await refsSnapshot(repo, {}).catch(() => null)
    await save()
  }
  return { ...outcome(result), recovery: { kind: 'lfsMigrate', id, backup: directory }, message: result.code === 0 ? '历史迁移完成，备份已保留；请检查结果后手动上传对象和推送分支' : result.stderr.trim() + '；迁移备份已保留' }
}
export async function lfsRestore(repo, request, options = {}) {
  if (!/^[a-f0-9-]{36}$/.test(request.id || '')) throw new Error('备份标识不合法')
  const directory = join(await backupDirectory(repo), request.id)
  const record = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  const now = await cleanState(repo, options)
  if (!record.after && record.state === 'running') {
    // After a Host restart, accept only original tips or tips explicitly produced
    // by this migration. Never assume that later commits belong to the migration.
    const text = await readFile(join(directory, 'object-map.csv'), 'utf8').catch(() => '')
    const mapped = new Map(text.split(/\r?\n/).flatMap(line => { const pair = line.split(','); return pair.length === 2 && pair.every(sha => /^[a-f0-9]{40,64}$/.test(sha)) ? [pair] : [] }))
    if (record.refs.some(ref => now.refs[ref] !== record.before.refs[ref] && now.refs[ref] !== mapped.get(record.before.refs[ref]))) throw new Error('中断后分支已变化，无法安全恢复；请使用备份交由外部 Git 工具处理')
    record.after = now.refs
  }
  if (!record.after || record.state === 'restored') throw new Error('此备份无法直接恢复')
  const affected = record.refs.filter(ref => record.before.refs[ref] !== record.after[ref])
  if (affected.some(ref => now.refs[ref] !== record.after[ref])) throw new Error('迁移后分支已发生变化，停止恢复以保留新提交')
  const trees = await repo.worktrees(options)
  if (trees.some(tree => affected.includes(tree.branch) && resolve(tree.path).toLowerCase() !== resolve(repo.root).toLowerCase())) throw new Error('待恢复分支被其他工作树占用')
  await required(repo, ['bundle', 'verify', join(directory, 'before.bundle')], options)
  const objects = await repo.runWrite(['bundle', 'unbundle', join(directory, 'before.bundle')], options)
  if (objects.code !== 0) return outcome(objects)
  await preserveObjects(join(directory, 'objects'), await mediaDirectory(repo, options), options.signal)
  const verified = await cleanState(repo, options)
  if (JSON.stringify(verified) !== JSON.stringify(now)) throw new Error('恢复准备期间仓库已变化，已停止恢复')
  const transaction = ['start', ...affected.map(ref => `update ${ref} ${record.before.refs[ref]} ${record.after[ref]}`), 'prepare', 'commit', ''].join('\n')
  const updated = await repo.runWrite(['update-ref', '--stdin'], { ...options, input: transaction })
  if (updated.code !== 0) return outcome(updated)
  if (affected.includes(now.branch)) {
    const reset = await repo.runWrite(['reset', '--hard', record.before.refs[now.branch]], { ...options, env: { GIT_LFS_SKIP_SMUDGE: '1' } })
    if (reset.code !== 0) return { ...outcome(reset), message: '分支引用已恢复，但工作区恢复失败：' + reset.stderr }
    // Checkout uses only cached objects, and never downloads from a remote.
    await repo.runWrite(['lfs', 'checkout'], { ...options, timeoutMs: LONG })
  }
  record.state = 'restored'; await saveManifest(directory, record)
  return { ok: true, message: '已恢复迁移前的本地历史；远端未修改' }
}

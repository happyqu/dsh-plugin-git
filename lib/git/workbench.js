import { createHash } from 'node:crypto'
import { lstat, readFile, readlink } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { diffstat } from './diff.js'

export async function resolveCommit(repo, ref, options = {}) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || /[\0\r\n]/.test(ref)) throw new Error('无效的引用')
  const result = await repo.run(['rev-parse', '--verify', `${ref}^{commit}`], options)
  if (result.code !== 0) throw new Error(result.stderr.trim() || '提交不存在')
  return result.stdout.trim()
}

/** Preview and execution use the same content fingerprint, including untracked files. */
export async function workbenchState(repo, options = {}) {
  const status = await repo.status({ force: true, signal: options.signal })
  const head = await repo.run(['rev-parse', '--verify', 'HEAD'], options)
  const branch = await repo.run(['symbolic-ref', '--quiet', 'HEAD'], options)
  const results = await Promise.all([
    repo.run(['status', '--porcelain=v2', '-z', '--untracked-files=all'], options),
    repo.run(['diff', '--binary', '--no-ext-diff'], options),
    repo.run(['diff', '--cached', '--binary', '--no-ext-diff'], options),
  ])
  const hash = createHash('sha256')
  for (const result of results) {
    if (result.code !== 0) throw new Error(result.stderr.trim())
    hash.update(result.stdout).update('\0')
  }
  for (const file of status.files.filter(file => file.kind === 'untracked')) {
    const absolute = resolve(repo.root, file.path), root = resolve(repo.root)
    if (!absolute.startsWith(root + sep)) throw new Error('路径超出仓库')
    const info = await lstat(absolute)
    hash.update(file.path).update('\0')
    if (info.isSymbolicLink()) hash.update(await readlink(absolute))
    else if (info.isFile()) hash.update(await readFile(absolute))
  }
  return { head: head.code === 0 ? head.stdout.trim() : null,
    branch: branch.code === 0 ? branch.stdout.trim() : null, state: hash.digest('hex'),
    files: status.files, operation: status.operation, dirty: status.files.length > 0 }
}

export async function workbenchPreview(repo, request, options = {}) {
  const state = await workbenchState(repo, options), references = Object.create(null)
  for (const ref of request.refs || []) references[ref] = await resolveCommit(repo, ref, options)
  const target = request.target ? await resolveCommit(repo, request.target, options) : null
  if (request.target) references[request.target] = target
  // Creating a branch needs a verified starting ref and workspace guard, not
  // commit details, historical comparisons, publication checks or diff stats.
  if (request.action === 'createBranch') return { ...state, target, commit: null,
    lost: [], lostCount: 0, incoming: [], incomingCount: 0, coordinates: null, diffFiles: [], publishedRefs: [],
    guard: { head: state.head, branch: state.branch, state: state.state, references } }
  const commit = target ? await repo.commit(target, options) : null
  const lost = target && state.head ? await repo.commits({ ref: `${target}..${state.head}`, limit: 100, signal: options.signal }) : []
  const count = target && state.head ? await repo.run(['rev-list', '--count', `${target}..${state.head}`], options) : null
  const published = state.head ? await repo.run(['for-each-ref', `--contains=${state.head}`, '--format=%(refname)', 'refs/remotes'], options) : null
  let coordinates = null, diffFiles = [], incoming = [], incomingCount = 0
  if (target && state.head) {
    if (['merge', 'rebase', 'deleteBranch'].includes(request.action)) {
      incoming = await repo.commits({ ref: `${state.head}..${target}`, limit: 100, signal: options.signal })
      const count = await repo.run(['rev-list', '--count', `${state.head}..${target}`], options)
      incomingCount = count.code === 0 ? Number(count.stdout.trim()) : incoming.length
    }
    coordinates = { from: state.head, to: target }
    if (['merge', 'rebase'].includes(request.action)) {
      const base = await repo.run(['merge-base', state.head, target], options)
      if (base.code === 0) coordinates = { from: base.stdout.trim(), to: request.action === 'merge' ? target : state.head }
    }
    if (['revert', 'cherryPick'].includes(request.action)) {
      let parent = commit.parents[Math.max(0, (request.mainline || 1) - 1)]
      if (!parent) parent = (await repo.run(['hash-object', '-t', 'tree', '--stdin'], { ...options, input: '' })).stdout.trim()
      coordinates = request.action === 'revert' ? { from: target, to: parent } : { from: parent, to: target }
    }
    if (request.action === 'restoreRevision') coordinates = { from: target, reverse: true, path: request.path }
    if (request.action === 'commit') coordinates = { from: state.head, staged: true }
    const args = [coordinates.from]
    if (coordinates.to) args.push(coordinates.to)
    if (coordinates.reverse) args.unshift('-R')
    if (coordinates.staged) args.unshift('--cached')
    if (request.path) args.push('--', request.path)
    diffFiles = await diffstat(repo, args, options)
  }
  return { ...state, target, commit, lost, lostCount: count?.code === 0 ? Number(count.stdout.trim()) : 0,
    incoming, incomingCount, coordinates, diffFiles,
    publishedRefs: published?.code === 0 ? published.stdout.trim().split('\n').filter(Boolean) : [],
    guard: { head: state.head, branch: state.branch, state: state.state, references } }
}

export async function checkWorkbenchIdentity(repo, guard, options = {}) {
  if (!guard) return
  const current = await workbenchState(repo, options)
  if (current.head !== guard.head || current.branch !== guard.branch || current.state !== guard.state) {
    throw new Error('仓库或本地改动已变化，请重新预览并确认')
  }
  for (const [ref, sha] of Object.entries(guard.references || {})) {
    if (await resolveCommit(repo, ref, options) !== sha) throw new Error('分支位置已变化，请重新预览并确认')
  }
}

export async function reflog(repo, request, options = {}) {
  const limit = Number.isInteger(request.limit) ? Math.min(Math.max(request.limit, 1), 500) : 100
  const result = await repo.run(['reflog', 'show', '--format=%H%x00%gd%x00%gs%x00%ct', `-n${limit}`, 'HEAD'], options)
  if (result.code !== 0) {
    if ((await repo.run(['rev-parse', '--verify', 'HEAD'], options)).code !== 0) return []
    throw new Error(result.stderr.trim() || '加载恢复记录失败')
  }
  return result.stdout.trim().split('\n').filter(Boolean).map(line => {
    const [sha, ref, message, date] = line.split('\0')
    return { sha, ref, message, date: Number(date) }
  })
}

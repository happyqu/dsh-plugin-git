/**
 * dsh-plugin-git — write operations.
 *
 * Every mutation of the working tree, the index, or the refs lives here, and
 * only here. That is a safety property, not tidiness: DSH's file sandbox
 * governs its *own* file tools and cannot constrain a git process we spawn, so
 * `git checkout` run from this plugin would rewrite the user's files no matter
 * what the session's file policy says. The defence has to be architectural:
 *
 *   1. one module owns every write, so an audit has one place to look;
 *   2. every operation declares whether it is destructive, so the UI can
 *      confirm the ones that are;
 *   3. nothing here is reachable from a read-only tool.
 *
 * Each function returns `{ ok, code, stdout, stderr, message }` rather than
 * throwing, because a failed `git push` is a normal user-facing outcome
 * (rejected non-fast-forward, auth refused, nothing to commit) and must reach
 * the UI as a message, not as a 500.
 */
import { git, meaningfulStderr } from './exec.js'
export { commitPaths } from './scopedCommit.js'
export { stashChangelist } from './changelistStash.js'
export { resolveConflict, setIdentity } from './conflicts.js'
export { lfsInitialize, lfsTrack, lfsTransfer, lfsMigrate, lfsRestore } from './lfs.js'
import { applyChangelistStash } from './changelistStash.js'
import { changelists, captureChangelistSnapshots } from './changelists.js'
import { resolveRepoRoot } from './capability.js'
import { isAbsolute, resolve, sep } from 'node:path'
import { lstat, readdir } from 'node:fs/promises'
import { workbenchState, checkWorkbenchIdentity, resolveCommit } from './workbench.js'
export { createHostingRepository } from './hosting.js'
import { hostingPushArgs } from './hosting.js'

/**
 * Risk levels a caller can use to decide how much confirmation to demand.
 * `safe` still mutates something, but nothing is lost.
 */
export const Risk = {
  /** Changes index or refs without discarding any content. */
  SAFE: 'safe',
  /** Can discard uncommitted work. */
  DESTRUCTIVE: 'destructive',
  /** Can rewrite published history. */
  HISTORY_REWRITE: 'history-rewrite',
}

/** Operations that discard uncommitted content, by method name. */
const DESTRUCTIVE_METHODS = new Set([
  'resolveConflict',
  'discardPath',
  'discardAll',
  'checkout',
  'stashDrop',
  'clean',
  // `reset --hard` throws away every uncommitted change.
  'resetTo',
  // Aborting a merge/rebase/cherry-pick discards every conflict resolution made
  // so far. The commits themselves survive, but the user's work on the conflict
  // does not — that is worth a confirmation.
  'abortOperation',
  'workbenchAction',
  'restoreRevision',
  'rebase',
])

/**
 * Classify a write method's risk, so the UI can pick its confirmation level.
 *
 * The risk depends on the ARGUMENTS, not just the method name, wherever the
 * method is only *capable* of harm in some of its modes:
 *
 * - `push` rewrites published history ONLY when forced. A plain `git push` is
 *   fast-forward-only — git itself rejects a non-fast-forward update — so it
 *   cannot discard anyone's commits. Demanding a "will rewrite published
 *   history" confirmation for every ordinary push trains the user to click
 *   through the dialog, which is exactly what makes the real force-push warning
 *   worthless. Only `--force-with-lease` is classified as a history rewrite.
 * - `resetTo` is treated as destructive in EVERY mode, even though `--soft` and
 *   `--mixed` keep the working tree: the caller can ask for `hard`, and erring
 *   toward an extra confirmation on a destructive-capable operation is the only
 *   safe direction to be wrong in.
 *
 * @param method - the write method name.
 * @param request - the write payload, when the caller has one. Callers that only
 *   know the method name (e.g. a tool listing) may omit it and get the
 *   conservative answer.
 * @returns a {@link Risk} value.
 */
export function riskOf(method, request) {
  if (method === 'lfsMigrate' || method === 'lfsRestore') return Risk.HISTORY_REWRITE
  if (method === 'commit' && request?.amend === true) return Risk.HISTORY_REWRITE
  if (DESTRUCTIVE_METHODS.has(method)) return Risk.DESTRUCTIVE
  if (method === 'push') {
    return request?.forceWithLease === true ? Risk.HISTORY_REWRITE : Risk.SAFE
  }
  // Deleting a REMOTE branch or tag is a push of a deletion, so it removes a ref
  // other people may already have — the same class of harm as a force push, and
  // it must not be reachable without a confirmation token. Deleting a LOCAL ref
  // only touches this checkout, so it stays safe.
  if ((method === 'deleteBranch' || method === 'deleteTag') && request?.remote === true) {
    return Risk.HISTORY_REWRITE
  }
  return Risk.SAFE
}

/**
 * Normalize a git write outcome into a UI-friendly result.
 * @param result - raw exit facts.
 * @returns `{ ok, code, stdout, stderr, message }`.
 */
export function writeResult(result) {
  const stderr = meaningfulStderr(result.stderr)
  return {
    ok: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    message: result.code === 0 ? (result.stdout.trim() || stderr || '完成') : (stderr || `退出码 ${result.code}`),
  }
}

/**
 * Stage paths, or everything.
 * @param repo - the repository session.
 * @param request - `{ paths }`; empty means `add -A`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function stage(repo, request, options = {}) {
  const paths = Array.isArray(request.paths) ? request.paths.filter(isSafePath) : []
  const args = paths.length === 0 ? ['add', '-A'] : ['add', '--', ...paths]
  return writeResult(await repo.runWrite(args, { timeoutMs: 60_000, signal: options.signal }))
}

/**
 * Unstage paths, or everything.
 *
 * `git restore --staged` needs git 2.23; `reset HEAD --` is the form that works
 * everywhere and means the same thing for this purpose.
 *
 * @param repo - the repository session.
 * @param request - `{ paths }`; empty means everything.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function unstage(repo, request, options = {}) {
  const paths = Array.isArray(request.paths) ? request.paths.filter(isSafePath) : []
  const args = paths.length === 0 ? ['reset', '-q', 'HEAD'] : ['reset', '-q', 'HEAD', '--', ...paths]
  return writeResult(await repo.runWrite(args, { timeoutMs: 60_000, signal: options.signal }))
}

/**
 * Discard working-tree changes in one path.
 *
 * Tracked files are restored from the index; untracked files are removed. Those
 * are different git operations and conflating them either silently deletes an
 * untracked file the user wanted or leaves a modified one behind.
 *
 * @param repo - the repository session.
 * @param request - `{ path, untracked }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function discardPath(repo, request, options = {}) {
  if (!isSafePath(request.path)) {
    return { ok: false, code: null, message: '不安全的路径', stdout: '', stderr: '' }
  }
  const args = request.untracked === true
    ? ['clean', '-f', '--', request.path]
    : ['restore', '--worktree', '--', request.path]
  return writeResult(await repo.runWrite(args, { timeoutMs: 60_000, signal: options.signal }))
}

/**
 * Discard every change, tracked and untracked.
 *
 * Deliberately does NOT touch ignored files: `git clean -fdx` would delete
 * build output and local configuration the user never asked us to remove.
 *
 * @param repo - the repository session.
 * @param request - unused.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function discardAll(repo, request, options = {}) {
  const restore = await repo.runWrite(['restore', '--worktree', '--', '.'], {
    timeoutMs: 120_000,
    signal: options.signal,
  })
  if (restore.code !== 0) return writeResult(restore)
  return writeResult(await repo.runWrite(['clean', '-f', '-d'], {
    timeoutMs: 120_000,
    signal: options.signal,
  }))
}

/**
 * Remove untracked files only.
 * @param repo - the repository session.
 * @param request - `{ directories, dryRun }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function clean(repo, request, options = {}) {
  const args = ['clean', '-f']
  if (request.directories === true) args.push('-d')
  if (request.dryRun === true) args.push('-n')
  return writeResult(await repo.runWrite(args, { timeoutMs: 120_000, signal: options.signal }))
}

/**
 * Create a commit.
 *
 * @param repo - the repository session.
 * @param request - `{ message, signoff, noVerify, allowEmpty, paths }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function commit(repo, request, options = {}) {
  const message = typeof request.message === 'string' ? request.message : ''
  if (message.trim() === '') {
    return { ok: false, code: null, message: '提交信息不能为空', stdout: '', stderr: '' }
  }
  const args = ['commit']
  if (request.amend === true) args.push('--amend')
  if (request.signoff === true) args.push('--signoff')
  if (request.noVerify === true) args.push('--no-verify')
  if (request.allowEmpty === true) args.push('--allow-empty')
  if (message.trim() !== '') args.push('-m', message)
  else args.push('--no-edit')
  const paths = Array.isArray(request.paths) ? request.paths.filter(isSafePath) : []
  if (paths.length > 0) args.push('--', ...paths)
  return writeResult(await repo.runWrite(args, {
    timeoutMs: 180_000,
    signal: options.signal,
    // A commit can legitimately open an editor when neither -m nor --no-edit is
    // given; we always pass one of them, and this keeps a stray hook from
    // blocking forever.
    input: undefined,
  }))
}

/**
 * Create a branch.
 * @param repo - the repository session.
 * @param request - `{ name, startPoint, checkout, force }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function createBranch(repo, request, options = {}) {
  const name = typeof request.name === 'string' ? request.name.trim() : ''
  if (name === '') return { ok: false, code: null, message: '分支名不能为空', stdout: '', stderr: '' }
  await validateBranchName(repo, name, options)
  if (request.startPoint) await resolveCommit(repo, request.startPoint, options)
  const args = request.checkout === true ? ['checkout', '-b', name] : ['branch', name]
  if (request.force === true && request.checkout !== true) args.splice(1, 0, '-f')
  if (typeof request.startPoint === 'string' && request.startPoint !== '') args.push(request.startPoint)
  if (request.track === true) args.splice(1, 0, '--track')
  else if (request.track === false) args.splice(1, 0, '--no-track')
  return writeResult(await repo.runWrite(args, { timeoutMs: 120_000, signal: options.signal }))
}

/**
 * Check out a ref. Destructive: uncommitted work can be lost.
 * @param repo - the repository session.
 * @param request - `{ ref, detached, force }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function checkout(repo, request, options = {}) {
  const ref = typeof request.ref === 'string' ? request.ref.trim().replace(/^refs\/heads\//, '') : ''
  if (ref === '') return { ok: false, code: null, message: '缺少目标分支或提交', stdout: '', stderr: '' }
  if (ref.startsWith('-') || /[\0\r\n]/.test(ref)) throw new Error('无效的引用')
  if (request.localBranch === true) {
    if (request.force === true || request.detached === true) throw new Error('直接切换本地分支不支持强制或游离检出')
    await validateBranchName(repo, ref, options)
    const exists = await repo.run(['show-ref', '--verify', '--quiet', `refs/heads/${ref}`], options)
    if (exists.code !== 0) throw new Error('本地分支不存在，请刷新分支列表')
    return writeResult(await repo.runWrite(['checkout', '--no-guess', ref, '--'], { timeoutMs: 180_000, signal: options.signal }))
  }
  const args = ['checkout']
  if (request.force === true) args.push('--force')
  args.push(request.detached === true ? '--detach' : ref)
  if (request.detached === true) args.push(ref)
  return writeResult(await repo.runWrite(args, { timeoutMs: 180_000, signal: options.signal }))
}

/**
 * Delete a branch.
 * @param repo - the repository session.
 * @param request - `{ name, force, remote }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function deleteBranch(repo, request, options = {}) {
  const name = typeof request.name === 'string' ? request.name.trim() : ''
  if (name === '') return { ok: false, code: null, message: '分支名不能为空', stdout: '', stderr: '' }
  await validateBranchName(repo, name, options)
  if (request.remote === true) await validateRemote(repo, request.remoteName || 'origin', options)
  const args = request.remote === true
    ? ['push', request.remoteName ?? 'origin', '--delete', name]
    : ['branch', request.force === true ? '-D' : '-d', name]
  return writeResult(await repo.runWrite(args, { timeoutMs: 180_000, signal: options.signal }))
}

/**
 * Create a tag.
 * @param repo - the repository session.
 * @param request - `{ name, ref, message, force }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function createTag(repo, request, options = {}) {
  const name = typeof request.name === 'string' ? request.name.trim() : ''
  if (name === '') return { ok: false, code: null, message: '标签名不能为空', stdout: '', stderr: '' }
  if (name.startsWith('-') || /[\0\r\n]/.test(name)) throw new Error('标签名称不合法')
  const valid = await repo.run(['check-ref-format', `refs/tags/${name}`], options)
  if (valid.code !== 0) throw new Error('标签名称不合法')
  const target = request.ref ? await resolveCommit(repo, request.ref, options) : null
  const args = ['tag']
  if (request.force === true) args.push('-f')
  if (typeof request.message === 'string' && request.message.trim() !== '') args.push('-a', name, '-m', request.message)
  else args.push(name)
  if (target) args.push(target)
  return writeResult(await repo.runWrite(args, { timeoutMs: 120_000, signal: options.signal }))
}

/**
 * Delete a tag.
 * @param repo - the repository session.
 * @param request - `{ name, remote }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function deleteTag(repo, request, options = {}) {
  const name = typeof request.name === 'string' ? request.name.trim() : ''
  if (name === '') return { ok: false, code: null, message: '标签名不能为空', stdout: '', stderr: '' }
  const args = request.remote === true
    ? ['push', request.remoteName ?? 'origin', '--delete', name]
    : ['tag', '-d', name]
  return writeResult(await repo.runWrite(args, { timeoutMs: 120_000, signal: options.signal }))
}

/**
 * Stash the working tree.
 * @param repo - the repository session.
 * @param request - `{ message, includeUntracked, stagedOnly, keepIndex }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function stashPush(repo, request, options = {}) {
  const state = await changelists(repo, {}, options)
  const before = await repo.run(['rev-parse', '--verify', 'refs/stash'], options)
  const args = ['stash', 'push']
  if (request.includeUntracked === true) args.push('-u')
  if (request.stagedOnly === true) args.push('--staged')
  if (request.keepIndex === true) args.push('--keep-index')
  if (typeof request.message === 'string' && request.message.trim() !== '') {
    args.push('-m', request.message)
  }
  if (Array.isArray(request.paths) && request.paths.length > 0) {
    if (!request.paths.every(isSafePath)) return { ok: false, message: '路径不安全' }
    args.push('--', ...request.paths)
  }
  const result = writeResult(await repo.runWrite(args, { timeoutMs: 120_000, signal: options.signal }))
  if (result.ok) {
    const after = await repo.run(['rev-parse', '--verify', 'refs/stash'], options)
    if (after.code === 0 && after.stdout.trim() !== before.stdout.trim()) {
      repo.cache.invalidate()
      try { await changelists(repo, { action: 'stashImport', internal: true, sha: after.stdout.trim(), snapshots: captureChangelistSnapshots(state, request.paths) }, options) }
      catch (error) { result.message += '；列表归属保存失败：' + error.message }
    }
  }
  return result
}

/** Add one untracked path to the root .gitignore. */
export async function ignorePath(repo, request) {
  if (!isSafePath(request.path)) return { ok: false, message: '路径不安全' }
  const { readFile, appendFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const target = join(repo.root, '.gitignore')
  const pattern = '/' + request.path.replace(/\\/g, '/').replace(/[\*?\[\]#! ]/g, '\\$&')
  let current = ''
  try { current = await readFile(target, 'utf8') } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (current.split(/\r?\n/).includes(pattern)) {
    return { ok: true, code: 0, message: '已在 .gitignore 中', stdout: '', stderr: '' }
  }
  await appendFile(target, (current !== '' && !current.endsWith('\n') ? '\n' : '') + pattern + '\n', 'utf8')
  return { ok: true, code: 0, message: '已添加到 .gitignore', stdout: '', stderr: '' }
}

/** Verify a selected stash still has the identity the UI reviewed. */
async function checkStashIdentity(repo, request, options) {
  if (typeof request.expectedSha !== 'string' || request.expectedSha === '') return null
  const result = await repo.run(['rev-parse', '--verify', request.ref], { signal: options.signal, timeoutMs: 15_000 })
  if (result.code === 0 && result.stdout.trim() === request.expectedSha) return null
  return { ok: false, code: 1, stdout: '', stderr: '', message: '储藏列表已变化，请刷新后重试' }
}

/**
 * Apply or pop a stash.
 * @param repo - the repository session.
 * @param request - `{ ref, pop, expectedSha? }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function stashApply(repo, request, options = {}) {
  const changed = await checkStashIdentity(repo, request, options)
  if (changed) return changed
  const identity = await repo.run(['rev-parse', '--verify', request.ref || 'refs/stash'], options)
  const state = await changelists(repo, {}, options)
  const restoreIndex = typeof request.restoreIndex === 'boolean' ? request.restoreIndex : state.stashLists?.[identity.stdout.trim()]?.kind === 'changelist'
  const args = ['stash', request.pop === true ? 'pop' : 'apply']
  if (restoreIndex) args.push('--index')
  if (typeof request.ref === 'string' && request.ref !== '') args.push(request.ref)
  const result = restoreIndex && state.stashLists?.[identity.stdout.trim()]?.kind === 'changelist'
    ? await applyChangelistStash(repo, request, identity.stdout.trim(), options)
    : writeResult(await repo.runWrite(args, { timeoutMs: 120_000, signal: options.signal }))
  if (identity.code === 0) {
    repo.cache.invalidate()
    try { await changelists(repo, { action: 'stashRestore', sha: identity.stdout.trim(), internal: true }, options) }
    catch (error) { result.message += '；改动列表归属恢复失败：' + error.message }
    if (result.ok && request.pop && result.dropped !== false) await changelists(repo, { action: 'stashForget', sha: identity.stdout.trim(), internal: true }, options).catch(() => {})
  }
  return result
}

/**
 * Drop a stash entry. Destructive.
 * @param repo - the repository session.
 * @param request - `{ ref, expectedSha? }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function stashDrop(repo, request, options = {}) {
  const changed = await checkStashIdentity(repo, request, options)
  if (changed) return changed
  const args = ['stash', 'drop']
  if (typeof request.ref === 'string' && request.ref !== '') args.push(request.ref)
  const identity = await repo.run(['rev-parse', '--verify', request.ref || 'refs/stash'], options)
  const result = writeResult(await repo.runWrite(args, { timeoutMs: 60_000, signal: options.signal }))
  if (result.ok && identity.code === 0) await changelists(repo, { action: 'stashForget', sha: identity.stdout.trim(), internal: true }, options).catch(() => {})
  return result
}

/**
 * Fetch from a remote.
 * @param repo - the repository session.
 * @param request - `{ remote, branch, prune, all, tags }`, or `{ name, upstream }`
 *   to fetch a local branch's configured upstream without changing its checkout.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function fetch(repo, request, options = {}) {
  let destination = null
  if (request.name) {
    await validateBranchName(repo, request.name, options)
    if (request.updateLocal === true) {
      const trees = await repo.worktrees(options)
      if (trees.some(tree => tree.branch === `refs/heads/${request.name}`)) throw new Error('此分支已被工作树检出，请在对应工作树中拉取')
    }
    const [refs, remote, mergeRef] = await Promise.all([
      repo.run(['for-each-ref', '--format=%(refname)%00%(upstream)', `refs/heads/${request.name}`], options),
      repo.run(['config', '--get', `branch.${request.name}.remote`], options),
      repo.run(['config', '--get', `branch.${request.name}.merge`], options),
    ])
    const record = refs.stdout.split('\n').map(line => line.split('\0')).find(row => row[0] === `refs/heads/${request.name}`)
    const upstream = record?.[1]?.trim(), remoteName = remote.stdout.trim(), merge = mergeRef.stdout.trim()
    if (!upstream?.startsWith('refs/remotes/') || remote.code !== 0 || mergeRef.code !== 0 || !merge.startsWith('refs/heads/')) throw new Error('请先设置远程上游分支')
    if (request.upstream && request.upstream !== upstream) throw new Error('上游分支已变化，请刷新后重试')
    destination = upstream
    request = { ...request, remote: remoteName, branch: merge.slice(11), all: false }
  }
  const args = ['fetch']
  if (request.updateLocal === true) args.push('--refmap=')
  if (request.all === true) args.push('--all')
  if (request.prune === true) args.push('--prune')
  if (request.tags === true) args.push('--tags')
  if (typeof request.remote === 'string' && request.remote !== '') args.push(request.remote)
  if (request.branch) {
    if (request.all || !request.remote) throw new Error('获取分支时必须指定远端')
    await validateRemote(repo, request.remote, options)
    await validateBranchName(repo, request.branch, options)
    args.push(`+refs/heads/${request.branch}:${destination || `refs/remotes/${request.remote}/${request.branch}`}`)
    // No '+' on the local destination: Git must refuse non-fast-forward updates.
    if (request.updateLocal === true && request.name) args.push(`refs/heads/${request.branch}:refs/heads/${request.name}`)
  }
  // Never block on a credential prompt: this runs inside a GUI request, and a
  // hung git would hold the RPC open forever. The user is told to use a
  // terminal when authentication is required.
  return writeResult(await repo.runWrite(args, { timeoutMs: 300_000, signal: options.signal }))
}

/**
 * Pull.
 * @param repo - the repository session.
 * @param request - `{ remote, branch, rebase, ffOnly }`, or `{ name, upstream,
 *   ffOnly }` to pull a selected local branch; an unchecked branch only fast-forwards.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function pull(repo, request, options = {}) {
  if (request.name) {
    await validateBranchName(repo, request.name, options)
    const ref = `refs/heads/${request.name}`
    const refs = await repo.run(['for-each-ref', '--format=%(refname)%00%(upstream)', ref], options)
    const record = refs.stdout.split('\n').map(line => line.split('\0')).find(row => row[0] === ref)
    if (!request.upstream || record?.[1]?.trim() !== request.upstream) throw new Error('上游分支已变化，请重新预览并设置上游')
    const head = await repo.run(['symbolic-ref', '--quiet', 'HEAD'], options)
    if (head.code !== 0 || head.stdout.trim() !== ref) {
      if (request.ffOnly !== true || request.rebase === true || request.merge === true) throw new Error('其他分支仅支持快进拉取；需要合并或变基时请先切换到该分支')
      const result = await fetch(repo, { name: request.name, upstream: request.upstream, updateLocal: true }, options)
      if (!result.ok && /non.fast.forward/i.test(result.stderr || '')) return { ...result, message: '此分支与上游已分叉，请先切换到该分支，再选择合并或变基拉取' }
      return result
    }
    request = { ...request, remote: undefined, branch: undefined }
  }
  const args = ['pull']
  if (request.rebase === true) args.push('--rebase')
  if (request.rebase === true && request.ffOnly === false) args.push('--ff')
  if (request.ffOnly === true) args.push('--ff-only')
  if (request.merge === true) args.push('--no-rebase', '--ff')
  if (typeof request.remote === 'string' && request.remote !== '') args.push(request.remote)
  if (typeof request.branch === 'string' && request.branch !== '') args.push(request.branch)
  return writeResult(await repo.runWrite(args, { timeoutMs: 300_000, signal: options.signal }))
}

/**
 * Push.
 *
 * Force pushing is expressed as `--force-with-lease` and there is no way to ask
 * for a bare `--force` from this API. A plain force push can silently discard a
 * colleague's commits that the user never saw; lease refuses instead. Making the
 * dangerous form unreachable is cheaper than remembering not to use it.
 *
 * @param repo - the repository session.
 * @param request - `{ remote, branch, setUpstream, forceWithLease, tags }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function push(repo, request, options = {}) {
  if (request.sourceBranch) {
    await validateBranchName(repo, request.sourceBranch, options)
    await validateBranchName(repo, request.targetBranch || request.sourceBranch, options)
    await validateRemote(repo, request.remote, options)
    request = { ...request, branch: `refs/heads/${request.sourceBranch}:refs/heads/${request.targetBranch || request.sourceBranch}` }
  }
  if (request.setUpstream === true) {
    let remote = request.remote
    if (typeof remote !== 'string' || remote === '') {
      const remotes = await repo.remotes(options)
      if (remotes.length !== 1) {
        return { ok: false, code: null, stdout: '', stderr: '', message: remotes.length === 0
          ? '尚未配置远端，请先添加远端再发布分支'
          : '有多个远端，请选择发布到的远端' }
      }
      remote = remotes[0].name
    }
    let branch = request.branch
    if (typeof branch !== 'string' || branch === '') {
      const head = await repo.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { signal: options.signal })
      branch = head.code === 0 ? head.stdout.trim() : ''
      if (branch === '') return { ok: false, code: null, stdout: '', stderr: '', message: '游离 HEAD 无法发布，请先创建或切换到本地分支' }
    }
    request = { ...request, remote, branch }
  }
  const args = ['push']
  if (request.setUpstream === true) args.push('--set-upstream')
  if (request.forceWithLease === true) args.push('--force-with-lease')
  if (request.tags === true) args.push('--tags')
  if (typeof request.remote === 'string' && request.remote !== '') args.push(request.remote)
  if (typeof request.branch === 'string' && request.branch !== '') args.push(request.branch)
  return writeResult(await repo.runWrite(await hostingPushArgs(repo, request, args, options), { timeoutMs: 300_000, signal: options.signal }))
}

/**
 * Apply a cherry-pick.
 * @param repo - the repository session.
 * @param request - `{ sha, noCommit }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function cherryPick(repo, request, options = {}) {
  if (typeof request.sha !== 'string' || request.sha.trim() === '') {
    return { ok: false, code: null, message: '缺少提交', stdout: '', stderr: '' }
  }
  const sha = await resolveCommit(repo, request.sha.trim(), options)
  const detail = await repo.commit(sha, options)
  if (detail.parents.length > 1) throw new Error('合并提交不支持直接挑选，请选择普通提交')
  const args = ['cherry-pick']
  if (request.noCommit === true) args.push('--no-commit')
  // A range keeps Git's sequencer options, including no-commit, after conflict.
  args.push(request.noCommit === true ? `${sha}^!` : sha)
  return writeResult(await repo.runWrite(args, { timeoutMs: 180_000, signal: options.signal }))
}

/**
 * Continue an in-progress multi-step operation.
 *
 * Only the commands that can actually finish the job are reachable: a rebase is
 * continued with `rebase --continue`, a merge/cherry-pick/revert with `commit`
 * (git uses the prepared message), and `git am` with `am --continue`. Mapping
 * each kind to its own command is the whole point — `git rebase --continue` in a
 * conflicted `git am` fails with a message about a missing rebase.
 *
 * A conflicted `--continue` legitimately exits non-zero (the user has not
 * resolved everything yet), so the outcome is passed through rather than thrown:
 * the UI shows git's own words, which name the still-unmerged paths.
 *
 * @param repo - the repository session.
 * @param request - `{ kind, message }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function continueOperation(repo, request, options = {}) {
  const kind = typeof request.kind === 'string' ? request.kind : ''
  let args
  if (kind === 'rebase') {
    args = ['rebase', '--continue']
  } else if (kind === 'am') {
    args = ['am', '--continue']
  } else if (kind === 'cherry-pick' || kind === 'revert') {
    const operation = await repo.operation(options)
    if (operation?.kind === kind && operation.noCommit === true) {
      const unmerged = await repo.run(['ls-files', '--unmerged'], options)
      if (unmerged.code !== 0 || unmerged.stdout.trim()) return { ok: false, code: 1, message: '请先解决并暂存全部冲突文件', stdout: '', stderr: '' }
      const result = writeResult(await repo.runWrite([kind, '--quit'], options))
      return result.ok ? { ...result, message: '改动已应用到暂存区，尚未提交' } : result
    }
    args = [kind, '--continue']
  } else if (kind === 'merge') {
    // The operation already wrote the message into `.git/*_MSG`; `--no-edit`
    // accepts it, and an explicit message overrides it when the user typed one.
    args = ['commit', '--no-edit']
    if (typeof request.message === 'string' && request.message.trim() !== '') {
      args = ['commit', '-m', request.message]
    }
  } else {
    return { ok: false, code: null, message: '没有正在进行的操作可以继续', stdout: '', stderr: '' }
  }
  // The exec layer forces `GIT_EDITOR=true`, so the `--continue` forms accept the
  // prepared message instead of opening an editor (which would hang a GUI).
  return writeResult(await repo.runWrite(args, { timeoutMs: 180_000, signal: options.signal }))
}

/**
 * Abort an in-progress multi-step operation, restoring the pre-operation state.
 *
 * Destructive by nature: an aborted merge discards nothing that was committed,
 * but it does throw away conflict resolutions made so far. The RPC layer marks
 * this DESTRUCTIVE so the UI asks first.
 *
 * @param repo - the repository session.
 * @param request - `{ kind }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function abortOperation(repo, request, options = {}) {
  const kind = typeof request.kind === 'string' ? request.kind : ''
  let args
  if (kind === 'rebase') {
    args = ['rebase', '--abort']
  } else if (kind === 'am') {
    args = ['am', '--abort']
  } else if (kind === 'merge') {
    args = ['merge', '--abort']
  } else if (kind === 'cherry-pick') {
    args = ['cherry-pick', '--abort']
  } else if (kind === 'revert') {
    args = ['revert', '--abort']
  } else {
    return { ok: false, code: null, message: '没有正在进行的操作可以中止', stdout: '', stderr: '' }
  }
  return writeResult(await repo.runWrite(args, { timeoutMs: 120_000, signal: options.signal }))
}

/**
 * Add or update a remote.
 * @param repo - the repository session.
 * @param request - `{ name, url, push }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function addRemote(repo, request, options = {}) {
  const name = typeof request.name === 'string' ? request.name.trim() : ''
  const url = typeof request.url === 'string' ? request.url.trim() : ''
  if (name === '' || url === '') {
    return { ok: false, code: null, message: '需要 remote 名称与地址', stdout: '', stderr: '' }
  }
  if (name.startsWith('-') || /[\s\0]/.test(name) || url.startsWith('-') || /[\0\r\n]/.test(url)) throw new Error('远端名称或地址不合法')
  const validName = await repo.run(['check-ref-format', `refs/remotes/${name}/validation`], options)
  if (validName.code !== 0) throw new Error('远端名称不合法')
  validateRemoteAddress(url)
  // `set-url` when it exists, `add` when it does not — using `set-url` blindly
  // fails on a fresh clone and using `add` blindly fails on a rename.
  const existing = await repo.run(['remote'], { timeoutMs: 15_000, signal: options.signal })
  const names = existing.stdout.split('\n').map((line) => line.trim())
  if (request.addOnly === true && names.includes(name)) throw new Error('该远端名称已存在，请换一个名称')
  const args = names.includes(name)
    ? ['remote', 'set-url', name, url]
    : ['remote', 'add', name, url]
  return writeResult(await repo.runWrite(args, { timeoutMs: 60_000, signal: options.signal }))
}

/**
 * Remove a remote.
 * @param repo - the repository session.
 * @param request - `{ name }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function removeRemote(repo, request, options = {}) {
  const name = typeof request.name === 'string' ? request.name.trim() : ''
  if (name === '') return { ok: false, code: null, message: '需要 remote 名称', stdout: '', stderr: '' }
  return writeResult(await repo.runWrite(['remote', 'remove', name], {
    timeoutMs: 60_000,
    signal: options.signal,
  }))
}

/**
 * Rename the current branch.
 * @param repo - the repository session.
 * @param request - `{ from, to, force }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function renameBranch(repo, request, options = {}) {
  const to = typeof request.to === 'string' ? request.to.trim() : ''
  if (to === '') return { ok: false, code: null, message: '需要新的分支名', stdout: '', stderr: '' }
  await validateBranchName(repo, to, options)
  if (request.from) await validateBranchName(repo, request.from, options)
  const args = ['branch', '-m']
  if (request.force === true) args.push('-M')
  if (typeof request.from === 'string' && request.from !== '') args.push(request.from)
  args.push(to)
  return writeResult(await repo.runWrite(args, { timeoutMs: 60_000, signal: options.signal }))
}

/**
 * Undo the most recent commit, keeping its changes.
 *
 * `--soft` is the only mode offered: `--hard` would discard the work the user
 * is asking to un-commit, which is never what "undo the commit" means.
 *
 * @param repo - the repository session.
 * @param request - unused.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function undoCommit(repo, request, options = {}) {
  // Refuse on the root commit: `reset --soft HEAD~` has no parent to move to,
  // and failing with git's own cryptic message is worse than saying so.
  const count = await repo.run(['rev-list', '--count', 'HEAD'], {
    timeoutMs: 20_000,
    signal: options.signal,
  })
  if (count.code === 0 && Number(count.stdout.trim()) <= 1) {
    return { ok: false, code: null, message: '这是第一个提交，无法撤销', stdout: '', stderr: '' }
  }
  return writeResult(await repo.runWrite(['reset', '--soft', 'HEAD~1'], {
    timeoutMs: 60_000,
    signal: options.signal,
  }))
}

/**
 * Move the current branch to a ref, in one of git's reset modes.
 *
 * `hard` is classified as destructive by {@link riskOf}, so it can never run
 * without an explicit confirmation token.
 *
 * @param repo - the repository session.
 * @param request - `{ ref, mode }` where mode is `soft|mixed|hard`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function resetTo(repo, request, options = {}) {
  const ref = await resolveCommit(repo, typeof request.ref === 'string' && request.ref !== '' ? request.ref : 'HEAD', options)
  const mode = ['soft', 'mixed', 'hard'].includes(request.mode) ? request.mode : 'mixed'
  return writeResult(await repo.runWrite(['reset', `--${mode}`, ref], {
    timeoutMs: 120_000,
    signal: options.signal,
  }))
}

/**
 * Merge a ref into the current branch.
 * @param repo - the repository session.
 * @param request - `{ ref, noFf, message, abort }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function merge(repo, request, options = {}) {
  if (request.abort === true) {
    return writeResult(await repo.runWrite(['merge', '--abort'], {
      timeoutMs: 120_000,
      signal: options.signal,
    }))
  }
  const ref = typeof request.ref === 'string' ? request.ref.trim() : ''
  if (ref === '') return { ok: false, code: null, message: '缺少要合并的分支', stdout: '', stderr: '' }
  const args = ['merge']
  if (request.noFf === true) args.push('--no-ff')
  if (typeof request.message === 'string' && request.message.trim() !== '') {
    args.push('-m', request.message)
  }
  args.push(ref)
  return writeResult(await repo.runWrite(args, { timeoutMs: 180_000, signal: options.signal }))
}

function validateRemoteAddress(url) {
  if (url.startsWith('-') || /[\0\r\n]/.test(url)) throw new Error('Invalid repository address')
  if (/^[a-z][a-z\d+.-]*::/i.test(url)) throw new Error('请使用 HTTPS、SSH 或本地仓库地址')
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(url)) {
    const parsed = new URL(url)
    if (!['http:', 'https:', 'ssh:', 'git:', 'file:'].includes(parsed.protocol) || parsed.password || [...parsed.searchParams.keys()].some((key) => /^(token|access_token|api_key|password|secret)$/i.test(key))) throw new Error('请使用不包含密码或令牌的仓库地址')
  }
}

/**
 * Clone a repository into a directory.
 *
 * This is the one operation that cannot be a method on a repository session —
 * there is no repository yet — so it takes a bare git path and destinations
 * instead. It lives in the write module because it creates files on disk.
 *
 * @param options - `{ gitPath, url, directory, depth, branch, recursive, signal }`.
 * @returns the write outcome plus the created path.
 */
export async function clone(options) {
  const url = typeof options.url === 'string' ? options.url.trim() : ''
  const directory = typeof options.directory === 'string' ? options.directory.trim() : ''
  if (url === '' || directory === '') {
    return { ok: false, code: null, message: '需要仓库地址与目标目录', stdout: '', stderr: '' }
  }
  if (typeof options.gitPath !== 'string' || options.gitPath === '') {
    return { ok: false, code: null, message: '未找到 git，无法克隆', stdout: '', stderr: '' }
  }
  validateRemoteAddress(url)
  const args = ['clone', '--progress']
  if (Number.isInteger(options.depth) && options.depth > 0) args.push('--depth', String(options.depth))
  if (typeof options.branch === 'string' && options.branch !== '') args.push('--branch', options.branch)
  if (options.recursive === true) args.push('--recurse-submodules')
  args.push('--', url, directory)
  const result = await git({
    gitPath: options.gitPath,
    // Clone must run OUTSIDE the target, which does not exist yet.
    cwd: options.cwd ?? process.cwd(),
    args,
    timeoutMs: 900_000,
    signal: options.signal,
    maxBuffer: 8 * 1024 * 1024,
  })
  const outcome = writeResult(result)
  return { ...outcome, directory }
}

/** Every write method name this module exposes, for the RPC dispatcher. */
async function validateBranchName(repo, name, options) {
  if (typeof name !== 'string' || !name || name.startsWith('-') || name.startsWith('@{-') || /[\0\r\n]/.test(name)) throw new Error('无效的分支名')
  const result = await repo.run(['check-ref-format', '--branch', name], options)
  if (result.code !== 0) throw new Error('分支名称不合法')
}

async function validateRemote(repo, name, options) {
  if (!(await repo.remotes(options)).some(remote => remote.name === name)) throw new Error('远端不存在，请重新选择')
}

export async function setUpstream(repo, request, options = {}) {
  await validateBranchName(repo, request.name, options)
  if (request.upstream) await resolveCommit(repo, request.upstream, options)
  return writeResult(await repo.runWrite(request.upstream
    ? ['branch', `--set-upstream-to=${request.upstream}`, request.name]
    : ['branch', '--unset-upstream', request.name], options))
}

export async function revert(repo, request, options = {}) {
  const sha = await resolveCommit(repo, request.sha, options)
  const detail = await repo.commit(sha, options)
  const args = ['revert', '--no-edit']
  if (detail.parents.length > 1) {
    if (!Number.isInteger(request.mainline) || request.mainline < 1 || request.mainline > detail.parents.length) throw new Error('请选择合并提交的基准父提交')
    args.push('-m', String(request.mainline))
  }
  if (request.noCommit) args.push('--no-commit')
  args.push(request.noCommit === true ? `${sha}^!` : sha)
  const result = writeResult(await repo.runWrite(args, { ...options, timeoutMs: 180_000 }))
  if (result.ok && !request.noCommit && request.message?.trim()) {
    const amended = await commit(repo, { amend: true, message: request.message }, options)
    return amended.ok ? amended : { ...amended, message: `反向提交已生成，但修改提交说明失败：${amended.message}` }
  }
  return result
}

export async function rebase(repo, request, options = {}) {
  const sha = await resolveCommit(repo, request.ref, options)
  return writeResult(await repo.runWrite(['rebase', sha], { ...options, timeoutMs: 180_000 }))
}

export async function restoreRevision(repo, request, options = {}) {
  if (!isSafePath(request.path)) throw new Error('文件路径不安全')
  const sha = await resolveCommit(repo, request.ref, options)
  return writeResult(await repo.runWrite(['restore', `--source=${sha}`, '--worktree', '--', request.path], options))
}

/** A reviewed write with optional content protection and commit backup. */
/** Add a worktree without forcing an occupied branch or overwriting files. */
export async function addWorktree(repo, request, options = {}) {
  if (!repo.supports('git:worktrees')) throw new Error('当前 Git 不支持工作树')
  const directory = typeof request.directory === 'string' ? request.directory.trim() : ''
  if (!directory || !isAbsolute(directory) || /[\0\r\n]/.test(directory)) throw new Error('请输入工作树的绝对路径')
  const destination = resolve(directory)
  const trees = await repo.worktrees(options)
  const normalize = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
  if (trees.some(tree => normalize(destination) === normalize(tree.path) || normalize(destination).startsWith(normalize(tree.path) + sep))) throw new Error('请选择现有工作树之外的目录')
  try {
    const info = await lstat(destination)
    if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(destination)).length) throw new Error('工作树目录必须不存在或为空目录')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const sha = await resolveCommit(repo, request.ref, options)
  const args = ['worktree', 'add']
  if (request.name) {
    await validateBranchName(repo, request.name, options)
    args.push('--no-track', '-b', request.name)
  } else {
    if (!request.ref.startsWith('refs/heads/')) throw new Error('请为新工作树指定本地分支名称')
    if (trees.some(tree => tree.branch === request.ref)) throw new Error('分支已被工作树占用，请创建新分支')
  }
  args.push('--', destination, request.name ? sha : request.ref.replace(/^refs\/heads\//, ''))
  const result = writeResult(await repo.runWrite(args, { timeoutMs: 120_000, signal: options.signal }))
  if (result.ok && request.name && request.track && request.ref.startsWith('refs/remotes/')) {
    const tracking = await setUpstream(repo, { name: request.name, upstream: request.ref }, options)
    if (!tracking.ok) return { ...tracking, message: '工作树已创建，但设置上游失败：' + tracking.message }
  }
  return result
}

export async function workbenchAction(repo, request, options = {}) {
  const handlers = { checkout, createBranch, createTag, addWorktree, merge, renameBranch, deleteBranch, push, pull, setUpstream, fetch,
    cherryPick, undoCommit, resetTo, revert, rebase, commit, restoreRevision }
  const handler = handlers[request.action]
  if (!handler) throw new Error('不支持的分支操作')
  if (!request.guard) throw new Error('请先加载操作预览并确认')
  await checkWorkbenchIdentity(repo, request.guard, options)
  const before = await workbenchState(repo, options)
  if (request.guard && (before.head !== request.guard.head || before.branch !== request.guard.branch || before.state !== request.guard.state)) throw new Error('仓库已变化，请重新预览')
  if (before.operation && !['push', 'setUpstream', 'fetch'].includes(request.action)) throw new Error('请先继续或中止正在进行的操作')
  if (!before.branch && ['resetTo', 'undoCommit', 'merge', 'rebase', 'revert', 'commit'].includes(request.action)) throw new Error('请先创建或切换到本地分支')
  const recovery = { root: repo.root, kind: request.action, mode: request.parameters?.mode || null,
    head: before.head, branch: before.branch, backup: null, stash: null }
  try {
    const otherBranchPull = request.action === 'pull' && before.branch !== `refs/heads/${request.parameters?.name}`
    if (otherBranchPull && (request.stashFirst || request.backup)) throw new Error('更新其他分支无需储藏或备份当前分支，请重新预览')
    const cleanRequired = ['merge', 'rebase', 'cherryPick', 'revert'].includes(request.action) || (request.action === 'pull' && !otherBranchPull)
    if (cleanRequired && before.dirty && !request.stashFirst) throw new Error('请先提交或储藏本地改动')
    const args = { ...(request.parameters || {}) }
    if (['undoCommit', 'commit'].includes(request.action) && args.expectedHead && args.expectedHead !== before.head) throw new Error('只能操作当前分支最新提交，请重新选择')
    const currentName = before.branch?.replace(/^refs\/heads\//, '')
    if (request.action === 'pull') {
      if (!args.name) throw new Error('请选择要拉取的本地分支')
      // Use the selected branch's configured upstream, never an arbitrary remote/ref.
      delete args.remote; delete args.branch
    }
    if (['deleteBranch', 'renameBranch', 'checkout'].includes(request.action) && !args.remote) {
      const name = args.from || args.name || args.ref?.replace(/^refs\/heads\//, '')
      const trees = await repo.worktrees(options)
      const normalize = value => {
        const normalized = value.replace(/\\/g, '/').replace(/\/$/, '')
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized
      }
      if (trees.some(tree => tree.branch === `refs/heads/${name}` && normalize(tree.path) !== normalize(repo.root))) throw new Error('分支已被其他工作树占用')
      if (request.action === 'deleteBranch' && name === currentName) throw new Error('不能删除当前分支')
    }
    if (request.backup && before.head) {
      const name = `backup/${request.action}-${Date.now()}`
      const result = await createBranch(repo, { name, startPoint: before.head }, options)
      if (!result.ok) return result
      recovery.backup = `refs/heads/${name}`
    }
    if (request.stashFirst && before.dirty) {
      const result = await stashPush(repo, { message: `Before ${request.action}`, includeUntracked: true }, options)
      if (!result.ok) return { ...result, recovery }
      const stash = await repo.run(['rev-parse', '--verify', 'refs/stash'], options)
      recovery.stash = stash.code === 0 ? stash.stdout.trim() : null
    }
    const now = await workbenchState(repo, options)
    if (now.head !== before.head || now.branch !== before.branch) throw new Error('保护改动期间分支已变化，请重新预览；已创建的备份和储藏会保留')
    const protectedChanges = request.stashFirst && before.dirty
    if (protectedChanges && now.dirty) throw new Error('储藏后仍有本地改动，请重新预览；已有储藏会保留')
    await checkWorkbenchIdentity(repo, { ...request.guard, head: before.head, branch: before.branch,
      state: protectedChanges ? now.state : before.state }, options)
    const result = await handler(repo, args, options)
    if (result.ok && request.action === 'createBranch' && request.upstream) {
      const tracking = await setUpstream(repo, { name: args.name, upstream: request.upstream }, options)
      if (!tracking.ok) return { ...tracking, message: `分支已创建，但设置上游失败：${tracking.message}`, recovery }
    }
    const after = await repo.run(['rev-parse', '--verify', 'HEAD'], options)
    recovery.after = after.code === 0 ? after.stdout.trim() : null
    return { ...result, recovery }
  } catch (error) { error.recovery = recovery; throw error }
}

export const WRITE_METHODS = [
  'resolveConflict', 'setIdentity',
  'lfsInitialize', 'lfsTrack', 'lfsTransfer', 'lfsMigrate', 'lfsRestore',
  'workbenchAction',
  'setUpstream',
  'revert',
  'rebase',
  'restoreRevision',
  'stage',
  'unstage',
  'discardPath',
  'discardAll',
  'clean',
  'commit',
  'commitPaths',
  'createBranch',
  'checkout',
  'deleteBranch',
  'renameBranch',
  'createTag',
  'deleteTag',
  'stashPush',
  'stashChangelist',
  'ignorePath',
  'stashApply',
  'stashDrop',
  'fetch',
  'pull',
  'push',
  'cherryPick',
  'merge',
  'continueOperation',
  'abortOperation',
  'resetTo',
  'undoCommit',
  'addRemote',
  'createHostingRepository',
  'removeRemote',
]

/**
 * Reject a path that could escape the repository or be read as a git option.
 *
 * A leading `-` would be parsed as a flag by the `--`-terminated commands that
 * forget the separator, and `..` segments could address files outside the repo
 * in the `restore`/`clean` paths. Both are cheap to reject here.
 *
 * @param path - a candidate path.
 * @returns true when the path is safe to pass to git.
 */
export function isSafePath(path) {
  if (typeof path !== 'string' || path === '') return false
  if (path.startsWith('-')) return false
  if (/[\0\r\n]/.test(path) || isAbsolute(path) || /^[A-Za-z]:/.test(path) || /^[\\/]/.test(path)) return false
  const segments = path.split(/[\\/]/)
  return !segments.includes('..')
}

/**
 * Repository roots for a set of directories, used by the multi-repo switcher.
 * @param directories - candidate directories.
 * @param options - cancellation.
 * @returns unique repository roots, in input order.
 */
export async function discoverRoots(directories, options = {}) {
  const out = []
  for (const directory of directories) {
    const root = await resolveRepoRoot({ ...options, cwd: directory })
    if (root !== null && !out.includes(root)) out.push(root)
  }
  return out
}

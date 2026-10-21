import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, rename, rm, rmdir, access, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import { git, resolveGitPath } from '../lib/git/exec.js'
import { RepoRegistry } from '../lib/git/repo.js'
import { parseWorktrees } from '../lib/git/parse.js'
import { worktreeDetails, commonDirectory, worktreeManagementPreview } from '../lib/git/worktrees.js'
import { addWorktree, removeWorktree, manageWorktree } from '../lib/git/write.js'
import { createRpc } from '../lib/rpc.js'
import { DEFAULT_CONFIG } from '../lib/config.js'
import { createWorktreeComparisonStore, WORKTREE_COMPARE_LIMITS } from '../lib/git/worktreeCompare.js'

for (const key of ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete process.env[key]
process.env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CONFIG_COUNT = '0'
const temp = await mkdtemp(join(tmpdir(), 'dsh-worktrees-check-')), root = join(temp, 'main'), other = join(temp, '任务 空格')
const gitPath = await resolveGitPath()
assert(gitPath)
await mkdir(root)
const run = async (args, cwd = root) => {
  const result = await git({ gitPath, cwd, args, timeoutMs: 60000 })
  assert.equal(result.code, 0, result.stderr)
  return result.stdout.trim()
}
try {
  await run(['init', '-b', 'main'])
  for (const [key, value] of Object.entries({ 'user.name': 'Worktree check', 'user.email': 'check@example.invalid',
    'core.autocrlf': 'false', 'commit.gpgsign': 'false', 'core.hooksPath': join(temp, 'no-hooks') })) await run(['config', key, value])
  await writeFile(join(root, 'tracked.txt'), 'base\n')
  await writeFile(join(root, '.gitignore'), 'ignored/\n')
  await run(['add', '.'])
  await run(['commit', '-m', 'initial'])
  const registry = new RepoRegistry({ gitPath }), { session: repo } = await registry.open(root)
  assert.equal((await addWorktree(repo, { ref: 'HEAD', name: 'task', directory: other })).ok, true)
  let trees = await repo.worktrees(), tree = trees.find(item => item.branch === 'refs/heads/task')
  assert(tree && tree.path.includes('任务 空格'))
  assert.equal(trees.length, 2)
  const { session: linked } = await registry.open(other)
  assert.equal(commonDirectory(repo), commonDirectory(linked))
  assert.notEqual(repo.identity.gitDir, linked.identity.gitDir)
  assert.equal((await worktreeDetails(repo, { directory: other })).counts.total, 0)
  console.log('PASS creation, Unicode paths, shared identity and independent Git directories')

  const guard = () => ({ directory: tree.path, expectedHead: tree.head, expectedBranch: tree.branch })
  await assert.rejects(addWorktree(repo, { ref: 'refs/heads/task', directory: join(temp, 'occupied') }), /占用/)
  await assert.rejects(addWorktree(repo, { ref: 'HEAD', name: 'nested', directory: join(root, 'nested') }), /之外/)
  await assert.rejects(removeWorktree(repo, { directory: root }), /主工作树/)
  await assert.rejects(removeWorktree(linked, guard()), /当前工作树/)
  await assert.rejects(removeWorktree(repo, { ...guard(), expectedHead: '0'.repeat(40) }), /变化/)
  await assert.rejects(worktreeDetails(repo, { directory: temp }), /不存在/)
  console.log('PASS occupied branches, nested destinations, main/current targets and stale previews are protected')

  await writeFile(join(other, 'tracked.txt'), 'changed\n')
  await writeFile(join(other, 'untracked.txt'), 'keep\n')
  let detail = await worktreeDetails(repo, { directory: other })
  assert.equal(detail.counts.unstaged, 1)
  assert.equal(detail.counts.untracked, 1)
  await assert.rejects(removeWorktree(repo, guard()), /本地改动/)
  assert.equal(await readFile(join(other, 'untracked.txt'), 'utf8'), 'keep\n')
  await run(['add', 'tracked.txt'], other)
  assert.equal((await worktreeDetails(repo, { directory: other })).counts.staged, 1)
  await run(['reset', '--hard', 'HEAD'], other)
  await rm(join(other, 'untracked.txt'))
  await mkdir(join(other, 'ignored'))
  await writeFile(join(other, 'ignored', 'secret'), 'keep ignored\n')
  assert.equal((await worktreeDetails(repo, { directory: other })).counts.ignored, 1)
  await assert.rejects(removeWorktree(repo, guard()), /忽略/)
  await rm(join(other, 'ignored', 'secret'))
  await rmdir(join(other, 'ignored'))
  console.log('PASS staged, unstaged, untracked and ignored contents are counted and protected')

  await run(['worktree', 'lock', '--reason', 'offline disk', other])
  trees = await repo.worktrees()
  assert.equal(trees[1].locked, true)
  assert.equal(trees[1].lockReason, 'offline disk')
  await assert.rejects(removeWorktree(repo, guard()), /锁定/)
  await run(['worktree', 'unlock', other])
  const mergeHead = join(linked.identity.gitDir, 'MERGE_HEAD')
  await writeFile(mergeHead, tree.head + '\n')
  assert.equal((await worktreeDetails(repo, { directory: other })).operation.kind, 'merge')
  await assert.rejects(removeWorktree(repo, guard()), /未完成/)
  await rm(mergeHead)
  console.log('PASS lock reasons and unfinished operations prevent removal')

  const parsed = parseWorktrees('worktree /tmp/a\nline\0HEAD abc\0detached\0locked multi\nline\0\0worktree /tmp/missing\0prunable gitdir missing\0\0')
  assert.equal(parsed[0].path, '/tmp/a\nline')
  assert.equal(parsed[0].lockReason, 'multi\nline')
  assert.equal(parsed[0].detached, true)
  assert.equal(parsed[1].prunable, true)
  console.log('PASS NUL porcelain preserves newline paths and metadata')

  const rpc = createRpc({ registry, config: { get: () => ({ ...DEFAULT_CONFIG }) } })
  assert.equal((await rpc.call('repos', { path: root })).value.repos[0].commonDir,
    (await rpc.call('repos', { path: other })).value.repos[0].commonDir)
  let response = await rpc.call('write.removeWorktree', { root, ...guard() })
  assert.equal(response.error.code, 'git/needs-confirmation')
  // The lock covers sibling worktrees, not only the caller's root.
  let release, entered
  const waiting = new Promise(resolve => { entered = resolve })
  const original = repo.runWrite.bind(repo)
  repo.runWrite = async (...args) => { entered(); await new Promise(resolve => { release = resolve }); return original(...args) }
  const first = rpc.call('write.createBranch', { root, name: 'parallel-check' })
  await waiting
  response = await rpc.call('write.createBranch', { root: linked.root, name: 'must-not-run' })
  assert.equal(response.error.code, 'git/busy')
  release()
  assert.equal((await first).ok, true)
  repo.runWrite = original
  assert.equal((await rpc.call('write.removeWorktree', { root, ...guard(), confirm: true })).ok, true)
  await assert.rejects(access(other))
  assert.equal(await run(['rev-parse', '--verify', 'refs/heads/task']), tree.head)
  assert.equal((await repo.worktrees()).length, 1)
  console.log('PASS RPC confirmation, shared write exclusion and clean removal preserving the branch')

  const managed = join(temp, 'managed'), moved = join(temp, 'moved 空格'), repaired = join(temp, 'repaired')
  await addWorktree(repo, { ref: 'HEAD', name: 'managed', directory: managed })
  const preview = parameters => worktreeManagementPreview(repo, parameters)
  const execute = async parameters => {
    const reviewed = await preview(parameters)
    const response = await rpc.call('write.manageWorktree', { root, ...parameters, token: reviewed.token, confirm: true })
    assert.equal(response.ok, true, JSON.stringify(response)); return reviewed
  }
  let parameters = { action: 'lock', directory: managed, reason: 'offline disk' }
  let reviewed = await preview(parameters)
  await assert.rejects(manageWorktree(repo, parameters), /重新预览/)
  await assert.rejects(manageWorktree(repo, { ...parameters, reason: 'changed', token: reviewed.token }), /重新预览/)
  await execute(parameters)
  assert.equal((await repo.worktrees()).find(item => item.branch === 'refs/heads/managed').lockReason, 'offline disk')
  await assert.rejects(preview({ action: 'move', directory: managed, destination: moved }), /锁定/)
  await execute({ action: 'unlock', directory: managed })
  console.log('PASS lock/unlock management requires a matching preview and preserves the lock reason')

  await writeFile(join(managed, 'tracked.txt'), 'dirty move\n')
  await mkdir(join(managed, 'ignored'))
  await writeFile(join(managed, 'ignored', 'keep'), 'ignored move\n')
  await registry.open(managed)
  parameters = { action: 'move', directory: managed, destination: moved }
  await assert.rejects(preview({ ...parameters, destination: root }), /互不包含/)
  await assert.rejects(preview({ ...parameters, destination: join(root, 'inside') }), /互不包含/)
  await assert.rejects(preview({ ...parameters, destination: temp }), /互不包含/)
  reviewed = await preview(parameters)
  assert.equal(reviewed.changes, 1)
  await execute(parameters)
  await assert.rejects(access(managed))
  assert.equal(await readFile(join(moved, 'tracked.txt'), 'utf8'), 'dirty move\n')
  assert.equal(await readFile(join(moved, 'ignored', 'keep'), 'utf8'), 'ignored move\n')
  assert(!registry.list().some(session => session.root.replace(/\\/g, '/') === managed.replace(/\\/g, '/')))
  assert.equal((await worktreeDetails(repo, { directory: moved })).counts.unstaged, 1)
  console.log('PASS move preserves dirty and ignored files, rejects overlapping paths and evicts stale sessions')

  for (const path of [moved, repaired]) {
    const local = relative(temp, path)
    assert(local && !local.startsWith('..') && !isAbsolute(local))
  }
  await rename(moved, repaired)
  await execute({ action: 'lock', directory: moved, reason: 'offline after move' })
  await execute({ action: 'unlock', directory: moved })
  await assert.rejects(preview({ action: 'repair', directory: moved, destination: root }), /互不包含/)
  const foreign = join(temp, 'foreign')
  await mkdir(foreign)
  await run(['init'], foreign)
  await assert.rejects(preview({ action: 'repair', directory: moved, destination: foreign }), /原工作树/)
  await execute({ action: 'repair', directory: moved, destination: repaired })
  assert.equal((await worktreeDetails(repo, { directory: repaired })).counts.unstaged, 1)
  assert.equal(await readFile(join(repaired, 'ignored', 'keep'), 'utf8'), 'ignored move\n')
  console.log('PASS repair reconnects a manually moved worktree, protects unrelated repos and works after offline unlock')

  const stale = join(temp, 'stale'), offline = join(temp, 'offline')
  await addWorktree(repo, { ref: 'HEAD', name: 'stale', directory: stale })
  await addWorktree(repo, { ref: 'HEAD', name: 'offline', directory: offline })
  await execute({ action: 'lock', directory: offline, reason: 'keep offline' })
  for (const path of [stale, offline]) {
    const local = relative(temp, path)
    assert(local && !local.startsWith('..') && !isAbsolute(local))
    await rm(path, { recursive: true, force: true })
  }
  parameters = { action: 'prune' }
  reviewed = await preview(parameters)
  assert.equal(reviewed.empty, false)
  assert(reviewed.candidates.some(item => item.branch === 'refs/heads/stale'))
  assert(!reviewed.candidates.some(item => item.branch === 'refs/heads/offline'))
  assert((await repo.worktrees()).some(item => item.branch === 'refs/heads/stale'), 'Preview must not prune records')
  await execute({ action: 'lock', directory: stale, reason: 'changed after preview' })
  await assert.rejects(manageWorktree(repo, { ...parameters, token: reviewed.token }), /重新预览/)
  await execute({ action: 'unlock', directory: stale })
  await execute(parameters)
  const remaining = await repo.worktrees()
  assert(!remaining.some(item => item.branch === 'refs/heads/stale'))
  assert(remaining.some(item => item.branch === 'refs/heads/offline' && item.locked))
  assert(remaining.some(item => item.branch === 'refs/heads/managed'))
  assert(await run(['rev-parse', '--verify', 'refs/heads/stale']))
  assert.equal((await preview(parameters)).empty, true)
  console.log('PASS prune preview is read-only, rejects stale tokens and keeps locked offline worktrees and branches')

  await writeFile(join(root, 'deleted.txt'), 'delete me\n')
  await writeFile(join(root, 'file-to-dir'), 'former file\n')
  await mkdir(join(root, 'dir-to-file')); await writeFile(join(root, 'dir-to-file', 'child.txt'), 'former child\n')
  await run(['add', 'deleted.txt', 'file-to-dir', 'dir-to-file']); await run(['commit', '-m', 'comparison baseline'])
  const comparisonRoot = join(temp, 'comparison')
  await addWorktree(repo, { ref: 'HEAD', name: 'comparison', directory: comparisonRoot })
  await writeFile(join(comparisonRoot, 'tracked.txt'), 'staged intermediate\n')
  await run(['add', 'tracked.txt'], comparisonRoot)
  await writeFile(join(comparisonRoot, 'tracked.txt'), 'disk final\n')
  await writeFile(join(comparisonRoot, '新增 空格.txt'), 'untracked text\n')
  await writeFile(join(comparisonRoot, 'binary.bin'), Buffer.from([0, 1, 2]))
  await rm(join(comparisonRoot, 'deleted.txt'))
  await rm(join(comparisonRoot, 'file-to-dir')); await mkdir(join(comparisonRoot, 'file-to-dir'))
  await writeFile(join(comparisonRoot, 'file-to-dir', 'child.txt'), 'new child\n')
  await rm(join(comparisonRoot, 'dir-to-file', 'child.txt')); await rmdir(join(comparisonRoot, 'dir-to-file'))
  await writeFile(join(comparisonRoot, 'dir-to-file'), 'new file\n')
  await mkdir(join(comparisonRoot, 'ignored'))
  await writeFile(join(comparisonRoot, 'ignored', 'excluded'), 'never read\n')
  const linkedComparison = (await registry.open(comparisonRoot)).session
  const indexBefore = await readFile(join(root, '.git', 'index'))
  const linkedIndexBefore = await readFile(join(linkedComparison.identity.gitDir, 'index'))
  const store = createWorktreeComparisonStore()
  const comparison = await store.compare(repo, { from: root, to: comparisonRoot })
  assert.equal(comparison.files.find(file => file.path === 'deleted.txt').status, 'D')
  assert.equal(comparison.files.find(file => file.path === '新增 空格.txt').status, 'A')
  assert.equal(comparison.files.find(file => file.path === 'binary.bin').binary, true)
  for (const [path, status] of [['file-to-dir', 'D'], ['file-to-dir/child.txt', 'A'], ['dir-to-file', 'A'], ['dir-to-file/child.txt', 'D']]) {
    assert.equal(comparison.files.find(file => file.path === path)?.status, status, path)
  }
  assert(!comparison.files.some(file => file.path.startsWith('ignored/') || file.path.startsWith('.git/')))
  const load = (path, mode) => store.file(repo, { token: comparison.token, path, mode })
  assert.equal((await load('tracked.txt', 'before')).text, 'base\n')
  assert.equal((await load('tracked.txt', 'after')).text, 'disk final\n')
  const patch = await load('tracked.txt', 'diff')
  assert(patch.hunks.some(hunk => hunk.lines.includes('+disk final')))
  await writeFile(join(comparisonRoot, 'tracked.txt'), 'later edit\n')
  assert.equal((await load('tracked.txt', 'after')).text, 'disk final\n')
  assert.equal((await load('deleted.txt', 'after')).exists, false)
  await assert.rejects(load('../tracked.txt', 'after'), /不在此/)
  await assert.rejects(store.compare(repo, { from: root, to: root }), /不同/)
  await assert.rejects(store.compare(repo, { from: root, to: foreign }), /不存在/)
  assert.deepEqual(await readFile(join(root, '.git', 'index')), indexBefore)
  assert.deepEqual(await readFile(join(linkedComparison.identity.gitDir, 'index')), linkedIndexBefore)
  console.log('PASS disk comparisons include uncommitted/untracked/deleted/binary files, exclude ignored files, preserve both indexes and retain immutable content')

  const reverse = await store.compare(repo, { from: comparisonRoot, to: root })
  for (const [path, status] of [['file-to-dir', 'A'], ['file-to-dir/child.txt', 'D'], ['dir-to-file', 'D'], ['dir-to-file/child.txt', 'A']]) {
    assert.equal(reverse.files.find(file => file.path === path)?.status, status, path)
  }
  await run(['add', '--', 'file-to-dir', 'dir-to-file'], comparisonRoot)
  const stagedReplacementIndex = await readFile(join(linkedComparison.identity.gitDir, 'index'))
  const stagedReplacement = await store.compare(repo, { from: root, to: comparisonRoot })
  assert.equal(stagedReplacement.files.find(file => file.path === 'file-to-dir')?.status, 'D')
  assert.equal(stagedReplacement.files.find(file => file.path === 'dir-to-file/child.txt')?.status, 'D')
  assert.deepEqual(await readFile(join(linkedComparison.identity.gitDir, 'index')), stagedReplacementIndex)
  console.log('PASS staged and unstaged file/directory replacements compare in both directions without changing the index')

  const outside = join(temp, 'outside-secret'), link = join(comparisonRoot, 'external-link')
  await writeFile(outside, 'external secret must not be read\n')
  try {
    await symlink(outside, link, 'file')
    const withLink = await store.compare(repo, { from: root, to: comparisonRoot })
    const linkContent = await store.file(repo, { token: withLink.token, path: 'external-link', mode: 'after' })
    assert(!linkContent.text.includes('external secret must not be read'))
    assert.equal(linkContent.text, outside)
  } catch (error) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error }
  await writeFile(join(comparisonRoot, 'large.bin'), Buffer.alloc(WORKTREE_COMPARE_LIMITS.fileBytes + 1))
  await assert.rejects(store.compare(repo, { from: root, to: comparisonRoot }), /超过 4 MiB/)
  await rm(join(comparisonRoot, 'large.bin'))
  await store.compare(repo, { from: root, to: comparisonRoot }); await store.compare(repo, { from: root, to: comparisonRoot })
  await assert.rejects(load('tracked.txt', 'after'), /快照已失效/)
  const rpcComparison = await rpc.call('worktreeCompare', { root, from: root, to: comparisonRoot })
  assert.equal(rpcComparison.ok, true, JSON.stringify(rpcComparison))
  assert.equal((await rpc.call('worktreeCompareFile', { root, token: rpcComparison.value.token, path: 'tracked.txt', mode: 'after' })).value.text, 'later edit\n')
  const originalNow = Date.now
  try {
    Date.now = () => originalNow() + WORKTREE_COMPARE_LIMITS.ttl + 1
    const expired = await rpc.call('worktreeCompareFile', { root, token: rpcComparison.value.token, path: 'tracked.txt', mode: 'after' })
    assert.equal(expired.error.code, 'git/worktree-snapshot-expired')
  } finally { Date.now = originalNow }
  console.log('PASS comparison limits, snapshot eviction, symlink isolation and RPC file previews')
} finally {
  const local = relative(tmpdir(), temp)
  assert(local && !local.startsWith('..') && !isAbsolute(local) && temp.includes('dsh-worktrees-check-'))
  await rm(temp, { recursive: true, force: true })
}

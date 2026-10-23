/** Regression checks for write scope and push confirmation, using local Git only. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, resolveGitPath } from '../lib/git/exec.js'
import { RepoRegistry } from '../lib/git/repo.js'
import { createRpc } from '../lib/rpc.js'
import { DEFAULT_CONFIG } from '../lib/config.js'
import { changelists } from '../lib/git/changelists.js'

for (const key of ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete process.env[key]
process.env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CONFIG_COUNT = '0'
const base = await mkdtemp(join(tmpdir(), 'dsh-write-safety-')), root = join(base, 'local'), remote = join(base, 'remote.git')
const gitPath = await resolveGitPath()
assert(gitPath)
await mkdir(root)
const run = async (args, cwd = root) => {
  const result = await git({ gitPath, cwd, args, timeoutMs: 60000 })
  assert.equal(result.code, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}
await run(['init', '-b', 'main'])
for (const [key, value] of Object.entries({ 'user.name': 'Write safety check', 'user.email': 'check@example.invalid',
  'core.autocrlf': 'false', 'commit.gpgsign': 'false', 'core.hooksPath': join(base, 'no-hooks') })) await run(['config', key, value])
for (const name of ['a[1].txt', 'a1.txt', 'outside.txt']) await writeFile(join(root, name), 'before\n')
await run(['add', '-A']); await run(['commit', '-m', 'initial'])
const registry = new RepoRegistry({ gitPath }), { session: repo } = await registry.open(root)
const rpc = createRpc({ registry, config: { get: () => ({ ...DEFAULT_CONFIG }) }, logger: { warn() {} } })
for (const name of ['a[1].txt', 'a1.txt', 'outside.txt']) await writeFile(join(root, name), 'after\n')
await run(['add', '--', 'outside.txt'])
// A wildcard-expanded commit must not silently include a blocked sibling.
let lists = await changelists(repo, {})
lists = await changelists(repo, { action: 'create', name: 'Blocked', paths: ['a1.txt'], version: lists.version })
await changelists(repo, { action: 'commitBlock', id: lists.lists.find(list => list.name === 'Blocked').id, blocked: true, version: lists.version })
const committed = await rpc.call('write.commit', { root, message: 'literal file only', paths: ['a[1].txt'] })
assert.equal(committed.ok, true, committed.error?.message)
assert.equal(await run(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']), 'a[1].txt')
assert.equal(await run(['show', 'HEAD:a1.txt']), 'before')
assert.equal(await run(['show', ':outside.txt']), 'after')
assert.equal(await run(['show', 'HEAD:outside.txt']), 'before')
assert.equal((await rpc.call('write.commit', { root, message: 'blocked', paths: ['a1.txt'] })).ok, false)
console.log('PASS literal selected commits preserve wildcard siblings, blocked files and outside staging')

await run(['init', '--bare', remote], base)
await run(['remote', 'add', 'origin', remote])
assert.equal((await rpc.call('write.push', { root, remote: 'origin', branch: 'main', setUpstream: true })).ok, true)
const published = await run(['rev-parse', 'HEAD'])
await run(['reset', '--hard', 'HEAD~1'])
await writeFile(join(root, 'replacement.txt'), 'replacement\n')
await run(['add', '--', 'replacement.txt']); await run(['commit', '-m', 'divergent replacement'])
const remoteHead = () => run(['--git-dir=' + remote, 'rev-parse', 'refs/heads/main'], base)
for (const branch of ['+main:main', ':main', ':', 'main:', 'main:main:other', 'main:--force', '--force', 'refs/heads/*:refs/heads/*', null]) {
  const result = await rpc.call('write.push', { root, remote: 'origin', branch })
  assert.equal(result.ok, false, 'Unsafe push accepted: ' + branch)
  assert.equal(await remoteHead(), published)
}
assert.equal((await rpc.call('write.push', { root, remote: '--mirror', branch: 'main' })).ok, false)
assert.equal((await rpc.call('write.push', { root, remote: 'origin', branch: 'main:main' })).ok, false, 'Ordinary push must reject divergent history')
assert.equal(await remoteHead(), published)
const request = { root, remote: 'origin', branch: 'main:main', forceWithLease: true }
assert.equal((await rpc.call('write.push', request)).error?.code, 'git/needs-confirmation')
assert.equal(await remoteHead(), published)
assert.equal((await rpc.call('write.push', { ...request, confirm: true })).ok, true)
assert.equal(await remoteHead(), await run(['rev-parse', 'HEAD']))
// Advance the remote without updating the local tracking ref: even confirmed
// force-with-lease must now refuse to overwrite the unseen remote commit.
await run(['--git-dir=' + remote, 'update-ref', 'refs/heads/main', published], base)
assert.equal((await rpc.call('write.push', { ...request, confirm: true })).ok, false)
assert.equal(await remoteHead(), published)
const replacement = await run(['rev-parse', 'HEAD'])
assert.equal((await rpc.call('write.push', { root, remote: 'origin', sourceBranch: 'main', targetBranch: 'review/target' })).ok, true)
assert.equal(await run(['--git-dir=' + remote, 'rev-parse', 'refs/heads/review/target'], base), replacement)
await run(['tag', 'review-v1'])
assert.equal((await rpc.call('write.push', { root, remote: 'origin', branch: 'refs/tags/review-v1' })).ok, true)
assert.equal(await run(['--git-dir=' + remote, 'rev-parse', 'refs/tags/review-v1'], base), replacement)
console.log('PASS push rejects force/deletion/option refspecs and retains confirmation and lease protection')

// Embedded repositories are VCS roots, never ordinary discard targets. Exercise
// both .git directories and .git files (linked worktrees), and a mixed selection.
const nested = join(root, 'embedded'), linked = join(root, 'linked')
await mkdir(nested)
await run(['init', '-b', 'main'], nested)
await writeFile(join(nested, 'keep.txt'), 'nested work\n')
await run(['worktree', 'add', '-b', 'linked', linked])
await writeFile(join(linked, 'keep.txt'), 'linked work\n')
await mkdir(join(root, 'ordinary'))
await writeFile(join(root, 'ordinary', 'discard.txt'), 'ordinary work\n')
const trackedBefore = await readFile(join(root, 'outside.txt'), 'utf8')
await writeFile(join(root, 'outside.txt'), 'discard tracked work\n')
for (const details of [false, true]) {
  const status = await repo.status({ force: true, details })
  for (const name of ['embedded', 'linked']) {
    const file = status.files.find(file => file.path === name + '/')
    assert.equal(file?.nestedRepository?.root, join(root, name))
  }
  assert.equal(status.files.find(file => file.path === 'ordinary/discard.txt')?.nestedRepository, undefined)
}
const discarded = await rpc.call('write.discardPaths', { root, confirm: true,
  paths: ['embedded/', 'linked/', 'ordinary/discard.txt', 'outside.txt'],
  untrackedPaths: ['embedded/', 'linked/', 'ordinary/discard.txt'] })
assert.equal(discarded.ok, false)
assert.equal(discarded.error.code, 'git/nested-repository')
assert.equal(discarded.error.details.nestedRepositories.length, 2)
assert.match(discarded.error.message, /已丢弃 2 个文件/)
assert.match(discarded.error.message, /独立 Git 仓库，已保留/)
await assert.rejects(access(join(root, 'ordinary', 'discard.txt')), { code: 'ENOENT' })
assert.equal(await readFile(join(root, 'outside.txt'), 'utf8'), trackedBefore)
assert.equal(await readFile(join(nested, 'keep.txt'), 'utf8'), 'nested work\n')
assert.equal(await readFile(join(linked, 'keep.txt'), 'utf8'), 'linked work\n')
await access(join(nested, '.git'))
await access(join(linked, '.git'))
assert.equal((await rpc.call('write.ignoreLocalPath', { root, path: 'embedded/' })).ok, true)
assert.match(await readFile(join(root, '.git', 'info', 'exclude'), 'utf8'), /\/embedded\//)
assert.equal((await repo.status({ force: true })).files.some(file => file.path === 'embedded/'), false)
await assert.rejects(access(join(root, '.gitignore')), { code: 'ENOENT' })
assert.equal((await rpc.call('write.ignorePath', { root, path: 'linked/' })).ok, true)
assert.match(await readFile(join(root, '.gitignore'), 'utf8'), /\/linked\//)
assert.equal((await repo.status({ force: true })).files.some(file => file.path === 'linked/'), false)
assert.equal(await readFile(join(nested, 'keep.txt'), 'utf8'), 'nested work\n')
assert.equal(await readFile(join(linked, 'keep.txt'), 'utf8'), 'linked work\n')
console.log('PASS nested repositories and linked worktrees survive mixed discards; local and shared ignore preserve content')
console.log('Write safety checks passed; fixture: ' + base)

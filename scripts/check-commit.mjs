/** Manual release check: real Git repositories, entirely under the OS temp dir. */
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir, release } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { git, resolveGitPath } from '../lib/git/exec.js'
import { RepoRegistry } from '../lib/git/repo.js'
import { commitPaths } from '../lib/git/scopedCommit.js'
import { readChunks } from '../lib/git/changeChunks.js'
import { changelists } from '../lib/git/changelists.js'
import { createRpc } from '../lib/rpc.js'
import { DEFAULT_CONFIG } from '../lib/config.js'

const countArg = process.argv.slice(2).find(arg => arg.startsWith('--files='))
const files = countArg ? Number(countArg.slice(8)) : 12000
if (!Number.isInteger(files) || files < 1000 || files > 50000) throw new Error('--files must be between 1000 and 50000')
const gitPath = await resolveGitPath()
if (!gitPath) throw new Error('Git is required')
const root = await mkdtemp(join(tmpdir(), 'dsh-commit-check-'))
const hooks = join(root, '.git', 'hooks')
const env = { GIT_INDEX_FILE: undefined, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined,
  GIT_CONFIG_COUNT: '0', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
// Isolate this process too: RepoSession's children inherit the same fixture-only environment.
for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
const run = async (args, input) => {
  const result = await git({ gitPath, cwd: root, args, input, timeoutMs: 60000, env })
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || args[0] + ' failed')
  return result.stdout.trim()
}
console.log(`Commit release check: ${files} files; fixture: ${root}`)
await run(['init', '-b', 'main'])
for (const [key, value] of Object.entries({ 'user.name': 'Commit check', 'user.email': 'check@example.invalid',
  'core.autocrlf': 'false', 'core.fsmonitor': 'false', 'core.hooksPath': hooks, 'commit.gpgsign': 'false' })) await run(['config', key, value])
await mkdir(join(root, 'files'))
const lines = Array.from({ length: 50 }, (_, index) => 'base line ' + index)
for (let offset = 0; offset < files; offset += 64) {
  await Promise.all(Array.from({ length: Math.min(64, files - offset) }, (_, index) =>
    writeFile(join(root, 'files', offset + index + '.txt'), lines.join('\n') + '\n')))
}
await run(['add', '-A']); await run(['commit', '-m', 'fixture base'])
const registry = new RepoRegistry({ gitPath }), { session: repo } = await registry.open(root)
assert(repo)
const report = { gitVersion: await run(['--version']), platform: process.platform, osRelease: release(), arch: process.arch,
  files, cases: [], timings: {} }
const check = name => { report.cases.push(name); console.log('PASS ' + name) }
const selected = Array.from({ length: 5 }, (_, index) => 'files/' + index + '.txt')
for (const path of selected) await writeFile(join(root, path), 'selected change\n')
await writeFile(join(root, 'outside.txt'), 'outside staged\n'); await run(['add', 'outside.txt'])
let start = Date.now()
let result = await commitPaths(repo, { paths: selected, message: 'five selected files' })
assert.equal(result.ok, true, result.message)
assert(result.commitDiagnostics?.traceComplete, 'A complete Git trace is needed to check index scans')
assert(result.commitDiagnostics.refreshScans <= selected.length + 2, 'Unexpected whole-worktree content scan')
assert.equal(await run(['show', ':outside.txt']), 'outside staged')
assert.deepEqual((await run(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).split('\n').sort(), selected.sort())
report.timings.fullWorktreeCommitMs = Date.now() - start
report.timings.contentScans = result.commitDiagnostics.refreshScans
check('full worktree preserves index cache and outside staging')

const partial = 'files/5.txt', staged = lines.slice()
staged[38] = 'outside staged hunk'
await writeFile(join(root, partial), staged.join('\n') + '\n'); await run(['add', partial])
staged[2] = 'selected hunk'
await writeFile(join(root, partial), staged.join('\n') + '\n')
const status = await repo.status({ force: true, details: false })
const chunks = await readChunks(repo, status.files.find(file => file.path === partial))
assert.equal(chunks.parts.length, 2)
await writeFile(join(root, '.git', 'dsh-changelists.json'), JSON.stringify({ version: 0, mode: 'lists', active: 'default', draftList: 'default',
  lists: [{ id: 'default', name: 'default', draft: '' }, { id: 'blocked', name: 'blocked', commitBlocked: true }],
  assignments: { [partial]: 'default', 'outside.txt': 'blocked' }, selected: [partial],
  chunks: { [partial]: { parts: chunks.parts.map((part, index) => ({ ...part, list: 'default', selected: index === 0 })) } } }))
const state = await changelists(repo)
result = await commitPaths(repo, { paths: [partial], changelistVersion: state.version, message: 'one selected hunk' })
assert.equal(result.ok, true, result.message)
assert(!(await run(['show', 'HEAD:' + partial])).includes('outside staged hunk'))
assert((await run(['show', ':' + partial])).includes('outside staged hunk'))
assert.equal(await run(['show', ':outside.txt']), 'outside staged')
check('partial commit preserves other staged hunks')

const target = 'files/6.txt'
await writeFile(join(root, target), 'selected next\n')
await writeFile(join(root, 'files/7.txt'), 'outside next\n')
await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\ngit add -- files/7.txt\n', { mode: 0o755 })
const before = await run(['rev-parse', 'HEAD']), index = await readFile(join(root, '.git', 'index'))
result = await commitPaths(repo, { paths: [target], message: 'must refuse outside hook change' })
assert.equal(result.ok, false)
assert.equal(await run(['rev-parse', 'HEAD']), before)
assert.deepEqual(await readFile(join(root, '.git', 'index')), index)
await rm(join(hooks, 'pre-commit'))
check('hook cannot add files outside the selected scope')

const rpc = createRpc({ registry, config: { get: () => DEFAULT_CONFIG } })
async function cancelHookCommit(method, phaseDetail) {
  const started = await rpc.methods.operationStart({ root, method, parameters: { paths: method.endsWith('commitPaths') ? [target] : undefined, message: 'cancel slow hook' } })
  assert.equal(started.ok, true, JSON.stringify(started))
  let requested = false, job
  const deadline = Date.now() + 30000
  do {
    job = (await rpc.methods.operationStatus({ root, id: started.value.id })).value
    if (!requested && job.phase === 'commit.phase.hook' && job.phaseDetail === phaseDetail) {
      requested = true; await rpc.methods.operationCancel({ root, id: job.id })
    }
    assert(Date.now() < deadline, 'Expected cancellable hook progress before deadline')
    if (job.state === 'running') await new Promise(resolve => setTimeout(resolve, 50))
  } while (job.state === 'running')
  assert(requested, 'Hook phase was not observable')
  return job
}
await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nsleep 15\n', { mode: 0o755 })
let job = await cancelHookCommit('write.commitPaths', 'pre-commit')
assert.equal(job.state, 'cancelled')
assert.equal(await run(['rev-parse', 'HEAD']), before)
assert.deepEqual(await readFile(join(root, '.git', 'index')), index)
await rm(join(hooks, 'pre-commit'))
check('cancelling a pre-commit hook keeps HEAD and the original index')

await writeFile(join(hooks, 'post-commit'), '#!/bin/sh\nsleep 15\n', { mode: 0o755 })
job = await cancelHookCommit('write.commitPaths', 'post-commit')
assert.equal(job.state, 'complete', JSON.stringify(job.result))
assert.equal(job.result.ok, true)
assert.equal(await run(['show', ':outside.txt']), 'outside staged')
await assert.rejects(stat(join(root, '.git', 'index.lock')), { code: 'ENOENT' })
check('confirmed commit remains successful after cancelling its post-commit hook')

await rm(join(root, '.git', 'dsh-changelists.json'))
job = await cancelHookCommit('write.commit', 'post-commit')
assert.equal(job.result.ok, false)
assert.equal(job.result.error.details.recovery.kind, 'commit-result-uncertain')
assert.match(job.result.error.message, /勿重复提交/)
await rm(join(hooks, 'post-commit'))
check('native staged commit checks HEAD after cancellation and avoids false retry advice')

// Reproduce a stat-only dirty entry under Windows-style checkout conversion.
// Status reads deliberately cannot refresh the real index (--no-optional-locks).
await run(['config', 'core.autocrlf', 'true'])
const ghost = 'status clean 中文.txt', changed = 'status-selected.txt', outside = 'status-staged.txt'
await writeFile(join(root, ghost), 'same\nlines\n')
await writeFile(join(root, changed), 'before\n')
result = await commitPaths(repo, { paths: [ghost, changed], message: 'status fixture' })
assert.equal(result.ok, true, result.message)
await writeFile(join(root, outside), 'staged version\n')
await run(['add', '--', outside])
await writeFile(join(root, outside), 'unstaged version\n')
for (const includeGhost of [false, true]) {
  const ghostBytes = Buffer.from(includeGhost ? 'same\nlines\n' : 'same\r\nlines\r\n')
  await writeFile(join(root, ghost), ghostBytes)
  await writeFile(join(root, changed), includeGhost ? 'third\n' : 'second\n')
  const beforeStatus = await repo.status({ force: true, details: false })
  assert(beforeStatus.files.some(file => file.path === ghost), 'Fixture must reproduce a stat-only modified entry')
  assert.equal(await run(['--no-optional-locks', 'diff', '--', ghost]), '')
  const outsideFiles = beforeStatus.files.filter(file => ![ghost, changed].includes(file.path))
  const outsideIndex = (await run(['ls-files', '--stage'])).split('\n').filter(line => ![ghost, changed].some(path => line.endsWith('\t' + path)))
  const selectedPaths = includeGhost ? [changed, ghost] : [changed]
  result = await commitPaths(repo, { paths: selectedPaths, message: 'refresh stat-only entry' })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(await readFile(join(root, ghost)), ghostBytes, 'Refresh must not rewrite worktree bytes')
  const afterStatus = await repo.status({ force: true, details: false })
  assert.deepEqual(afterStatus.files, outsideFiles, 'Only phantom and committed entries should disappear')
  assert.deepEqual((await run(['ls-files', '--stage'])).split('\n').filter(line => ![ghost, changed].some(path => line.endsWith('\t' + path))), outsideIndex,
    'Refresh must preserve every outside staged version')
  assert.equal(await run(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']), changed)
  check(includeGhost ? 'selected CRLF/LF phantom clears without staging outside changes' : 'unselected CRLF/LF phantom clears after scoped commit')
}
await writeFile(join(root, ghost), 'same\r\nlines\r\n')
await writeFile(join(root, changed), 'fourth\n')
const ghostIndex = await run(['show', ':' + ghost])
const originalWrite = repo.runWrite.bind(repo)
let raced = false
repo.runWrite = async (args, options) => {
  if (args[0] === 'add' && options?.env?.GIT_INDEX_FILE?.endsWith('refreshed-index')) {
    raced = true
    await writeFile(join(root, ghost), 'racing edit\r\n')
  }
  return originalWrite(args, options)
}
try { result = await commitPaths(repo, { paths: [changed], message: 'edit during stat refresh' }) }
finally { repo.runWrite = originalWrite }
assert.equal(result.ok, true, result.message)
assert(raced, 'Race fixture must edit between comparison and rehash')
assert.equal(await run(['show', ':' + ghost]), ghostIndex, 'Racing content must not enter the real index')
assert.equal(await readFile(join(root, ghost), 'utf8'), 'racing edit\r\n')
assert.equal(await run(['show', ':' + outside]), 'staged version')
assert.equal(await readFile(join(root, outside), 'utf8'), 'unstaged version\n')
check('edit racing with stat refresh stays unstaged and preserves outside staged content')
await writeFile(join(root, ghost), 'same\r\nlines\r\n')
await writeFile(join(root, changed), 'fifth\n')
let refreshFailed = false
repo.runWrite = async (args, options) => {
  if (args[0] === 'add' && options?.env?.GIT_INDEX_FILE?.endsWith('refreshed-index')) {
    refreshFailed = true
    return { code: 128, stdout: '', stderr: 'injected stat refresh failure' }
  }
  return originalWrite(args, options)
}
try { result = await commitPaths(repo, { paths: [changed], message: 'optional refresh failure' }) }
finally { repo.runWrite = originalWrite }
assert(refreshFailed)
assert.equal(result.ok, true, result.message)
assert.match(result.stderr, /injected stat refresh failure/)
assert.equal(await run(['show', ':' + ghost]), ghostIndex)
assert.equal(await run(['show', ':' + outside]), 'staged version')
assert.equal(await run(['show', 'HEAD:' + changed]), 'fifth')
await assert.rejects(stat(join(root, '.git', 'index.lock')), { code: 'ENOENT' })
check('optional stat refresh failure preserves a successful commit and restored index')
await run(['config', 'core.autocrlf', 'false'])

if (process.argv.includes('--lfs')) {
  await run(['lfs', 'version']); await run(['lfs', 'install', '--local'])
  await writeFile(join(root, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n')
  const bytes = Buffer.from(Array.from({ length: 8192 }, (_, index) => index % 256))
  await writeFile(join(root, 'image.bin'), bytes)
  result = await commitPaths(repo, { paths: ['.gitattributes', 'image.bin'], message: 'real LFS asset' })
  assert.equal(result.ok, true, result.message)
  assert((await run(['show', 'HEAD:image.bin'])).includes('oid sha256:' + createHash('sha256').update(bytes).digest('hex')))
  await run(['lfs', 'fsck', '--objects', 'HEAD'])
  check('LFS filters, hooks and real object content')
}
await writeFile(join(root, 'commit-check-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, fixture: root }, null, 2))

/** Real Git scope/budget regression checks; no external model requests. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rename, unlink, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { git, resolveGitPath } from '../lib/git/exec.js'
import { RepoRegistry } from '../lib/git/repo.js'
import { createRpc } from '../lib/rpc.js'
import { ConfigStore, DEFAULT_CONFIG, sanitize } from '../lib/config.js'
import { AI_CONTEXT_LIMITS, aiExcludeRules, commitMessageContext, commitContextIndexPath } from '../lib/git/aiContext.js'
import { readChunks } from '../lib/git/changeChunks.js'
import { createCommitContextCache } from '../lib/git/aiContextCache.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-ai-check-')), gitPath = await resolveGitPath()
assert(gitPath)
for (const key of ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete process.env[key]
process.env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_CONFIG_COUNT = '0'
const run = async args => {
  const result = await git({ gitPath, cwd: root, args, timeoutMs: 60000 })
  assert.equal(result.code, 0, result.stderr); return result.stdout.trim()
}
await run(['init', '-b', 'main'])
for (const [key, value] of Object.entries({ 'user.name': 'AI check', 'user.email': 'ai@example.invalid',
  'core.autocrlf': 'false', 'commit.gpgsign': 'false', 'core.hooksPath': join(root, 'no-hooks') })) await run(['config', key, value])
for (const dir of ['lib', 'src', 'dist']) await mkdir(join(root, dir))
const source = 'lib/main.js', artifact = 'dist/app.min.js', hand = 'dist/hand.js', excluded = 'lib/generated.js'
const base = Array.from({ length: 50 }, (_, i) => 'export const line' + i + ' = ' + i + ';')
await writeFile(join(root, source), base.join('\n') + '\n')
const registry = new RepoRegistry({ gitPath }), { session: repo } = await registry.open(root)
let captured, config = { ...DEFAULT_CONFIG }
let generateModel = async input => { captured = input; return 'fix: 示例提交' }
const rpc = createRpc({ registry, config: { get: () => config }, llm: {
  available: () => ({ available: true }), generateCommitMessage: input => generateModel(input),
} })
const generate = async payload => {
  captured = null
  const result = await rpc.methods['ai.commitMessage']({ root, ...payload })
  assert.equal(result.ok, true, JSON.stringify(result)); return result.value
}
assert.equal((await generate({ paths: [source] })).empty, false, 'Unborn repositories support selected untracked files')
await writeFile(join(root, artifact), 'var a=1;'.repeat(200000) + '\n')
await writeFile(join(root, hand), 'export const hand = 1;\n')
await writeFile(join(root, excluded), 'export const generated = 1;\n')
await writeFile(join(root, '.gitattributes'), 'dist/hand.js -linguist-generated\nlib/generated.js linguist-generated\n')
await run(['add', '.']); await run(['commit', '-m', 'base'])
const head = await run(['rev-parse', 'HEAD'])
await writeFile(join(root, source), base.join('\n').replace('line2 = 2', 'line2 = 200') + '\n')
await writeFile(join(root, artifact), 'var a=2;'.repeat(200000) + '\n')
await writeFile(join(root, hand), 'export const hand = 2;\n')
await writeFile(join(root, excluded), 'export const generated = 2;\n')
await writeFile(join(root, 'src/outside.js'), 'DO_NOT_READ_OUTSIDE\n')
const indexBefore = await readFile(join(root, '.git/index'))
const additions = [], originalWrite = repo.runWrite.bind(repo)
repo.runWrite = async (args, options) => { if (args[0] === 'add') additions.push(options.input || args.join(' ')); return originalWrite(args, options) }
let value = await generate({ paths: [source, artifact, hand, excluded] })
assert(!value.empty && captured.diff.includes('line2 = 200'))
assert(captured.diff.includes('hand = 2'))
assert(!captured.diff.includes('var a=') && !captured.diff.includes('generated = 2') && !captured.diff.includes('DO_NOT_READ_OUTSIDE'))
assert(additions.every(input => !input.includes(artifact) && !input.includes(excluded)), 'Generated files must be excluded before temporary staging')
assert.equal(value.context.summaryOnlyFiles, 2)
assert.deepEqual(await readFile(join(root, '.git/index')), indexBefore)
assert.equal(await run(['rev-parse', 'HEAD']), head)
console.log('PASS generated exclusion before add, .gitattributes overrides, selected scope, unchanged real index/HEAD')

value = await generate({ paths: [artifact] })
assert(!value.empty && captured.diff === '' && captured.files.some(file => file.includes(artifact)))
assert.equal(value.context.summaryOnlyFiles, 1)
config.aiExcludePatterns = 'lib/**\n!lib/main.js\ndist/hand.js'
await generate({ paths: [source, hand] })
assert(captured.diff.includes('line2 = 200') && !captured.diff.includes('hand = 2'))
config.aiExcludePatterns = ''
console.log('PASS generated-only scope remains meaningful; ordered custom exclusions and exceptions')
captured = null
value = await generate({ paths: [] })
assert(value.empty && captured === null, 'Empty selection must never fall back to unrelated changes')

await run(['add', '--', source, artifact])
await writeFile(join(root, source), 'WORKTREE_ONLY_NOT_STAGED\n')
await generate({})
assert(captured.diff.includes('line2 = 200') && !captured.diff.includes('WORKTREE_ONLY_NOT_STAGED'))
assert(!captured.files.join('\n').includes(hand))
assert(!captured.diff.includes('var a='))
console.log('PASS oversized staged diff does not become empty; staged snapshot excludes later workspace saves')
await run(['reset', '-q', 'HEAD'])

const edited = base.slice(); edited[2] = 'export const FIRST_SELECTED = true;'; edited[45] = 'export const SECOND_OUTSIDE = true;'
await writeFile(join(root, source), edited.join('\n') + '\n')
const status = await repo.status({ force: true, details: false })
const chunks = await readChunks(repo, status.files.find(file => file.path === source))
assert.equal(chunks.parts.length, 2)
const policy = { version: 7, mode: 'lists', active: 'default', draftList: 'default', lists: [{ id: 'default', name: '默认' }],
  assignments: { [source]: 'default' }, selected: [source], chunks: { [source]: { parts: chunks.parts.map((part, i) => ({ ...part, list: 'default', selected: i === 0 })) } } }
await writeFile(join(root, '.git/dsh-changelists.json'), JSON.stringify(policy))
await generate({ paths: [source], changelistVersion: 7 })
assert(captured.diff.includes('FIRST_SELECTED') && !captured.diff.includes('SECOND_OUTSIDE'))
captured = null
const stale = await rpc.methods['ai.commitMessage']({ root, paths: [source], changelistVersion: 6 })
assert.equal(stale.ok, false); assert.equal(captured, null)
console.log('PASS selected code blocks remain exact and stale selection versions cannot reach the model')

const many = []
for (let i = 0; i < 120; i++) { const path = 'src/文件 ' + i + '.js'; many.push(path); await writeFile(join(root, path), base.join('\n') + '\n') }
value = await generate({ paths: many })
assert.equal(value.context.totalFiles, 120)
assert(value.context.detailedFiles <= AI_CONTEXT_LIMITS.files)
assert(captured.diff.length <= AI_CONTEXT_LIMITS.patch)
assert(captured.files.join('\n').length <= AI_CONTEXT_LIMITS.manifest)
console.log('PASS large selections have bounded patches, bounded manifests and per-file sampling')

const moved = 'lib/moved file.js'
await rename(join(root, source), join(root, moved))
await run(['add', '--', source, moved])
await generate({ paths: [moved] })
assert(captured.diff.includes('FIRST_SELECTED') && !captured.diff.includes('DO_NOT_READ_OUTSIDE'))
assert(captured.files.some(file => file.includes(moved)))
await unlink(join(root, artifact))
await generate({ paths: [artifact] })
assert(captured.diff === '' && captured.files.some(file => file.startsWith('D ') && file.includes(artifact)))
console.log('PASS renamed paths with spaces and deleted large generated files stay within scope')

const secret = 'lib/fixture.txt'
await writeFile(join(root, secret), '-----BEGIN PRIVATE KEY-----\n' + ('SENSITIVE_KEY_MATERIAL\n'.repeat(180)) + '-----END PRIVATE KEY-----\n')
await generate({ paths: [secret] })
assert(!captured.diff.includes('SENSITIVE_KEY_MATERIAL'))
assert(captured.diff.includes('[private key redacted]'))
console.log('PASS excerpt limits cannot expose an incomplete private-key block')

for (const [patterns, path, expected] of [['**/*.map', 'x.map', true], ['**/*.map', 'src/x.map', true], ['dist/**\n!dist/hand.js', hand, false], ['lib/*', 'lib/sub/file.js', undefined]]) {
  let result; for (const rule of aiExcludeRules(patterns)) if (rule.match.test(path)) result = rule.exclude
  assert.equal(result, expected)
}
const store = new ConfigStore({ path: join(root, 'settings.json') })
await store.update({ aiExcludePatterns: 'dist/**\n!dist/hand.js' })
assert.equal((await new ConfigStore({ path: store.path }).load()).aiExcludePatterns, 'dist/**\n!dist/hand.js')
assert.equal(sanitize({ aiExcludePatterns: 12 }).aiExcludePatterns, DEFAULT_CONFIG.aiExcludePatterns)
assert.equal(sanitize({ aiExcludePatterns: '' }).aiExcludePatterns, DEFAULT_CONFIG.aiExcludePatterns)
// The add-workspace switch defaults on (this plugin's dialog) and has to survive
// a round trip; a Host that dropped the key would silently revert the choice.
await store.update({ workspaceAddDialog: false })
assert.equal((await new ConfigStore({ path: store.path }).load()).workspaceAddDialog, false)
assert.equal(sanitize({ workspaceAddDialog: 'no' }).workspaceAddDialog, DEFAULT_CONFIG.workspaceAddDialog)
await store.update({ workspaceAddDialog: true })
assert.equal((await new ConfigStore({ path: store.path }).load()).workspaceAddDialog, true)
console.log('PASS glob matching and persistent, validated AI exclusion and add-workspace settings')

config.aiExcludePatterns = DEFAULT_CONFIG.aiExcludePatterns
const cacheScope = { root, paths: [many[0]] }
const reads = [], originalRead = repo.run.bind(repo)
repo.run = async (args, options) => { reads.push(args); return originalRead(args, options) }
const prepare = async payload => {
  const result = await rpc.methods['ai.prepareCommitMessage'](payload)
  assert(result.ok, JSON.stringify(result)); return result.value
}
const first = await prepare(cacheScope), additionCount = additions.length
assert.equal(reads.filter(args => args[0] === 'status').length, 2, 'Cold preparation reuses its validated status snapshot')
assert.equal(reads.filter(args => args[0] === 'check-attr').length, 2, 'Workspace attributes are reused within preparation')
const readsBeforeHit = reads.length
const repeated = await prepare(cacheScope)
assert(!first.cacheHit && repeated.cacheHit && first.id === repeated.id)
assert.equal(additions.length, additionCount, 'Cache hit must skip temporary staging and diff generation')
assert(!reads.slice(readsBeforeHit).some(args => args[0] === 'rev-parse'), 'Stable index location must not spawn another Git process')
await writeFile(join(root, many[0]), 'export const cacheChanged = 1;\n')
captured = null
const staleContext = await rpc.methods['ai.commitMessage']({ ...cacheScope, contextId: repeated.id })
assert(!staleContext.ok && captured === null, 'Changed content cannot use an older context token')
const updated = await prepare(cacheScope)
assert(!updated.cacheHit && updated.id !== repeated.id)
config.aiExcludePatterns = 'src/**'
const excludedContext = await prepare(cacheScope)
assert(!excludedContext.cacheHit && excludedContext.context.summaryOnlyFiles === 1)
config.aiExcludePatterns = DEFAULT_CONFIG.aiExcludePatterns
console.log('PASS same scope reuses context without staging; file edits and exclusion changes invalidate it')

const attributesBefore = await readFile(join(root, '.gitattributes'), 'utf8')
const beforeAttributesChange = await prepare(cacheScope)
await writeFile(join(root, '.gitattributes'), attributesBefore + '\n' + JSON.stringify(many[0]) + ' linguist-generated\n')
const afterAttributesChange = await prepare(cacheScope)
assert(!afterAttributesChange.cacheHit && afterAttributesChange.id !== beforeAttributesChange.id)
assert.equal(afterAttributesChange.context.summaryOnlyFiles, 1)
await writeFile(join(root, '.gitattributes'), attributesBefore)
const beforeConfigChange = await prepare(cacheScope)
await run(['config', 'diff.algorithm', 'histogram'])
const indexBeforeConfigPreparation = await readFile(join(root, '.git/index'))
const afterConfigChange = await prepare(cacheScope)
assert(!afterConfigChange.cacheHit && afterConfigChange.id !== beforeConfigChange.id)
assert.deepEqual(await readFile(join(root, '.git/index')), indexBeforeConfigPreparation, 'Raw metadata diff must not refresh the real index')
console.log('PASS fresh attribute and Git configuration checks invalidate reused context')

const overrideIndex = join(root, '.git/ai-override-index')
await copyFile(join(root, '.git/index'), overrideIndex)
try {
  process.env.GIT_INDEX_FILE = overrideIndex
  assert.equal(await commitContextIndexPath(repo), overrideIndex)
  const overridden = await prepare(cacheScope)
  assert(!overridden.cacheHit && overridden.id !== afterConfigChange.id)
} finally { delete process.env.GIT_INDEX_FILE }
assert.equal(await commitContextIndexPath(repo), join(root, '.git/index'))
console.log('PASS alternate index overrides refresh location and invalidate context, even with identical index contents')

await run(['add', '--', many[0]])
const stagedContext = await prepare({ root })
await writeFile(join(root, many[0]), 'WORKSPACE_SAVE_AFTER_PREPARATION\n')
const stagedHit = await prepare({ root })
assert(stagedHit.cacheHit && stagedHit.id === stagedContext.id, 'Workspace saves cannot invalidate a frozen staged scope')
await generate({ contextId: stagedHit.id })
assert(captured.diff.includes('cacheChanged') && !captured.diff.includes('WORKSPACE_SAVE_AFTER_PREPARATION'))
console.log('PASS staged context cache follows the index rather than later workspace saves')

generateModel = async () => { await writeFile(join(root, many[1]), 'EDITED_WHILE_MODEL_RUNNING\n'); return 'fix: stale result' }
const changedDuringGeneration = await rpc.methods['ai.commitMessage']({ root, paths: [many[1]] })
assert(!changedDuringGeneration.ok && /范围已变化/.test(changedDuringGeneration.error.message))
console.log('PASS edits during model generation reject the obsolete result')

let modelStarted
const started = new Promise(resolve => { modelStarted = resolve })
generateModel = input => new Promise((resolve, reject) => {
  modelStarted(input.signal)
  input.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
})
const controller = new AbortController()
const pendingModel = rpc.methods['ai.commitMessage']({ root, paths: [many[2]] }, controller.signal)
assert.equal(await started, controller.signal)
controller.abort()
assert.equal((await pendingModel).ok, false)
const cancelled = new AbortController(); cancelled.abort()
const beforeCancelAdds = additions.length
assert.equal((await rpc.methods['ai.prepareCommitMessage']({ root, paths: [many[3]] }, cancelled.signal)).ok, false)
assert.equal(additions.length, beforeCancelAdds)
console.log('PASS cancellation reaches the model and cancelled preparation cannot stage temporary content')

generateModel = async input => { captured = input; return 'fix: 示例提交' }
const tiny = 'dist/tiny.js'
await writeFile(join(root, tiny), 'export const EDITABLE_DEFAULT_RULE = true;\n')
await generate({ paths: [tiny] })
assert.equal(captured.diff, '')
config.aiExcludePatterns = DEFAULT_CONFIG.aiExcludePatterns.split('\n').filter(rule => rule !== '**/dist/**').join('\n')
await generate({ paths: [tiny] })
assert(captured.diff.includes('EDITABLE_DEFAULT_RULE'), 'Deleting a visible default must remove that exclusion')
console.log('PASS editable defaults have no duplicate hidden rules')

const worktree = join(await mkdtemp(join(tmpdir(), 'dsh-ai-worktree-')), 'checkout')
await run(['worktree', 'add', '-b', 'ai-context-worktree', worktree])
const { session: worktreeRepo } = await registry.open(worktree)
const worktreeIndex = await commitContextIndexPath(worktreeRepo)
assert(worktreeIndex.includes('worktrees'), 'Linked worktree must use its own index')
await writeFile(join(worktree, source), 'export const LINKED_WORKTREE_ONLY = true;\n')
await generate({ root: worktree, paths: [source] })
assert(captured.diff.includes('LINKED_WORKTREE_ONLY'))
assert.equal(await commitContextIndexPath(repo), join(root, '.git/index'))
console.log('PASS linked worktree preparation uses the correct index and isolated status snapshot')

async function checkCacheBoundaries() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ai-cache-boundaries-'))
  const run = async args => {
    const result = await git({ gitPath, cwd: root, args, timeoutMs: 30000 })
    assert.equal(result.code, 0, result.stderr); return result.stdout
  }
  await run(['init', '-b', 'main'])
  for (const [key, value] of Object.entries({ 'user.name': 'Cache check', 'user.email': 'cache@example.invalid',
    'core.autocrlf': 'false', 'commit.gpgsign': 'false', 'core.hooksPath': join(root, 'no-hooks') })) await run(['config', key, value])
  for (const name of ['a.js', 'b.js']) await writeFile(join(root, name), 'export const a = 1;\n')
  await run(['add', '.']); await run(['commit', '-m', 'base'])
  await writeFile(join(root, 'a.js'), 'export const a = 2;\n'); await run(['add', 'a.js'])
  const { session: repo } = await new RepoRegistry({ gitPath }).open(root)
  const cache = createCommitContextCache(), options = {}

  // Hold both cold builders at the same point, so the test exercises two
  // overlapping cache misses regardless of process scheduling.
  const originalRun = repo.run.bind(repo)
  let waiting = 0, release, gateTimeout
  const gate = new Promise((resolve, reject) => {
    release = resolve; gateTimeout = setTimeout(() => reject(new Error('Concurrent preparation did not reach both builders')), 10000)
  })
  repo.run = async (args, settings) => {
    if (args[0] === 'diff' && args.includes('--cached') && args.includes('--raw')) {
      if (++waiting === 2) { clearTimeout(gateTimeout); release() }
      await gate
    }
    return originalRun(args, settings)
  }
  let parallel
  try { parallel = await Promise.all([cache.prepare(repo, {}, options), cache.prepare(repo, {}, options)]) }
  finally { clearTimeout(gateTimeout); repo.run = originalRun }
  assert.equal(parallel[0].id, parallel[1].id)
  for (const entry of parallel) await cache.read(entry.id, repo, {}, options)
  console.log('PASS concurrent same-scope preparations preserve both returned context tokens')

  const staged = parallel[0], scope = { paths: ['a.js'] }
  const selected = await cache.prepare(repo, scope, options)
  const before = await readFile(join(root, '.git/index')), entries = await run(['ls-files', '--stage', '-v', '-z'])
  await writeFile(join(root, 'b.js'), 'export const a = 1;\n')
  // Simulate another editor's ordinary status refresh; the plugin's Git runner
  // deliberately disables optional locks and cannot reproduce that refresh.
  await promisify(execFile)(gitPath, ['status', '--porcelain'], { cwd: root, windowsHide: true, timeout: 30000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '1' } })
  assert(!before.equals(await readFile(join(root, '.git/index'))), 'Fixture must change raw index metadata')
  assert.equal(await run(['ls-files', '--stage', '-v', '-z']), entries)
  assert.equal((await cache.prepare(repo, {}, options)).id, staged.id)
  assert.equal((await cache.prepare(repo, scope, options)).id, selected.id)
  await cache.validate(staged, repo, {}, options)
  await cache.validate(selected, repo, scope, options)
  await writeFile(join(root, 'a.js'), 'export const a = 3;\n'); await run(['add', 'a.js'])
  await assert.rejects(cache.read(staged.id, repo, {}, options), /范围已变化/)
  const changedBlob = await cache.prepare(repo, {}, options)
  await run(['update-index', '--chmod=+x', 'a.js'])
  await assert.rejects(cache.read(changedBlob.id, repo, {}, options), /范围已变化/)
  console.log('PASS index metadata refresh preserves staged and selected context; real blob/mode changes invalidate it')

  await run(['reset', '--hard', 'HEAD']); await run(['mv', 'a.js', 'renamed.js'])
  const renamed = await cache.prepare(repo, {}, options)
  assert(renamed.context.diff.includes('a/a.js'))
  await writeFile(join(root, '.git/info/attributes'), 'a.js linguist-generated\n')
  await assert.rejects(cache.read(renamed.id, repo, {}, options), /范围已变化/)
  const excluded = await cache.prepare(repo, {}, options)
  assert(!excluded.cacheHit && excluded.context.summary.summaryOnlyFiles === 1)
  assert(!excluded.context.diff.includes('a/a.js'), 'Excluded rename source must not retain its deletion body')
  await writeFile(join(root, '.git/info/attributes'), '')
  const restored = await cache.prepare(repo, {}, options)
  assert(restored.context.diff.includes('a/a.js'), 'Removing the attribute restores detail eligibility')
  console.log('PASS rename-source attribute changes invalidate cached deletion bodies in both directions')
}
await checkCacheBoundaries()
console.log('AI context checks passed; fixture: ' + root)

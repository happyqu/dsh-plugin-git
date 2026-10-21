import assert from 'node:assert/strict'
import { assertGitVersion } from '../lib/git/exec.js'
import { watchOperation } from '../lib/client/core/operations.js'
import { registerWorktreeWorkspace, worktreeWorkspace, publishWorktreeContext, worktreeAssociations } from '../lib/client/features/worktrees/workspace.js'
import { readWorktreePreferences, setWorktreeNote, touchWorktree, moveWorktreePreferences, worktreePathKey } from '../lib/client/features/worktrees/preferences.js'
import { readWorktreeDraft, writeWorktreeDraft, clearWorktreeDraft, moveWorktreeDraft } from '../lib/client/features/worktrees/drafts.js'

for (const text of ['git version 2.36.0', 'git version 2.50.1.windows.1', 'git version 3.0.0']) {
  assert.equal(assertGitVersion(text).text, text)
}
for (const text of ['git version 2.35.0', 'git version 2.35.9', 'git version 2.34.9', 'git version 1.9.0', 'invalid']) {
  assert.throws(() => assertGitVersion(text), error => error.code === 'git/unsupported-version')
}
console.log('PASS Git minimum version accepts supported releases and rejects old/unknown versions')

let workspaceCreates = 0, workspaceOpens = 0
const unregisterWorktree = registerWorktreeWorkspace({
  pickDirectory: async () => 'D:/tasks',
  workspaces: { create: async () => { workspaceCreates++; return { workspaceId: 'task-workspace' } } },
  navigation: { openWorkspace: async id => { assert.equal(id, 'task-workspace'); if (++workspaceOpens === 1) throw new Error('temporary navigation failure') } },
})
await assert.rejects(worktreeWorkspace().open('D:/tasks/feature'), /temporary navigation failure/)
await worktreeWorkspace().open('d:\\tasks\\feature\\')
assert.equal(workspaceCreates, 1)
assert.equal(workspaceOpens, 2)
publishWorktreeContext({ items: [] }, { byId: {} })
await worktreeWorkspace().open('D:/tasks/feature')
assert.equal(workspaceCreates, 2, 'An authoritative deletion must invalidate the previously created workspace')
unregisterWorktree()
assert.equal(worktreeWorkspace(), null)
console.log('PASS worktree workspace navigation retries reuse the created workspace and disposal clears services')

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), storage = new Map()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } })
setWorktreeNote('D:/repo/.git', 'D:/tasks/one', 'task one')
touchWorktree('d:/repo/.git', 'd:\\tasks\\one', 12345)
moveWorktreePreferences('D:/repo/.git', 'D:/tasks/one', 'D:/tasks/two')
let metadata = readWorktreePreferences('D:/repo/.git').entries
assert.equal(metadata[worktreePathKey('D:/tasks/two')].note, 'task one')
assert.equal(metadata[worktreePathKey('D:/tasks/two')].lastUsed, 12345)
writeWorktreeDraft('D:/repo/.git', 'D:/tasks/two', 'unsaved draft', 'task one')
moveWorktreeDraft('d:/repo/.git', 'D:/tasks/two', 'D:/tasks/three')
assert.equal(readWorktreeDraft('D:/repo/.git', 'D:/tasks/three', ''), 'unsaved draft')
assert.equal(readWorktreeDraft('D:/other/.git', 'D:/tasks/three', 'other repository'), 'other repository')
assert.equal(readWorktreeDraft('D:/repo/.git', 'D:/tasks/two', 'task one'), 'task one')
clearWorktreeDraft('D:/repo/.git', 'D:/tasks/three')
assert(!metadata[worktreePathKey('D:/tasks/one')])
assert.throws(() => setWorktreeNote('D:/repo/.git', 'D:/tasks/two', 'x'.repeat(4001)), /4000/)
assert.notEqual(worktreePathKey('/repos/Task'), worktreePathKey('/repos/task'))
assert.equal(worktreePathKey('D:\\Tasks\\Feature\\'), worktreePathKey('d:/tasks/feature'))
assert.equal(worktreePathKey('/'), '/')
assert.notEqual(worktreePathKey('/'), worktreePathKey(null))
assert.equal(worktreePathKey('D:\\'), 'd:/')
const originalSetItem = globalThis.localStorage.setItem
globalThis.localStorage.setItem = () => { throw new Error('storage quota exhausted') }
assert.throws(() => setWorktreeNote('D:/repo/.git', 'D:/tasks/two', 'must not lose saved note'), /quota/)
assert.equal(readWorktreePreferences('D:/repo/.git').entries[worktreePathKey('D:/tasks/two')].note, 'task one')
globalThis.localStorage.setItem = originalSetItem
let reused = 0, openedExisting = null
const unregisterExisting = registerWorktreeWorkspace({
  workspaces: { create: async () => { reused++; return { workspaceId: 'unexpected' } } },
  navigation: { openWorkspace: async id => { openedExisting = id } },
})
publishWorktreeContext({ items: [{ workspaceId: 'known', path: 'D:/tasks/two', sessionIds: ['s1'] }] },
  { byId: { s1: { title: 'Task conversation' }, s2: { cwd: 'd:\\tasks\\two', title: 'Second conversation' } } })
assert.equal(worktreeAssociations('d:/tasks/two')[0].sessions.length, 2)
await worktreeWorkspace().open('d:/tasks/two', 'D:/repo/.git', 'known')
assert.equal(reused, 0)
assert.equal(openedExisting, 'known')
assert(readWorktreePreferences('D:/repo/.git').entries[worktreePathKey('D:/tasks/two')].lastUsed > 12345)
await assert.rejects(worktreeWorkspace().open('D:/other', 'D:/repo/.git', 'known'), /关联工作区/)
unregisterExisting()
if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
else delete globalThis.localStorage
console.log('PASS notes and recent usage follow directory moves; known workspaces and their sessions are reused without duplication')

const running = { root: 'repo', id: 'job', state: 'running' }
const complete = { ...running, state: 'complete', result: { ok: true, value: { message: 'done' } } }
let reads = 0, updates = []
const result = await watchOperation(async (method, payload) => {
  assert.equal(method, 'operationStatus')
  assert.deepEqual(payload, { root: running.root, id: running.id })
  if (++reads <= 2) throw new Error('temporary disconnect')
  return reads === 3 ? running : complete
}, running, { interval: 0, retryDelay: 0, onUpdate: job => updates.push(job.state) })
assert.deepEqual(result, complete.result.value)
assert.equal(reads, 4)
assert.deepEqual(updates, ['running', 'running', 'complete'])
console.log('PASS job polling retries status reads without restarting or replaying updates')

reads = 0
assert.deepEqual(await watchOperation(() => { reads++; throw new Error('unexpected read') }, complete), complete.result.value)
assert.equal(reads, 0)
const failed = { ...running, state: 'failed', result: { ok: false, error: { message: 'conflict', code: 'git/conflict', details: { file: 'a' } } } }
await assert.rejects(watchOperation(() => { reads++ }, failed), error => error.code === 'git/conflict' && error.details.file === 'a')
assert.equal(reads, 0)
assert.equal(await watchOperation(() => {}, failed, { returnJob: true }), failed)
console.log('PASS terminal jobs settle once and preserve Host results and error details')

reads = 0
await assert.rejects(watchOperation(async () => { reads++; throw new Error('offline') }, running,
  { interval: 0, retryDelay: 0, maxFailures: 2 }), /offline/)
assert.equal(reads, 2)
reads = 0
await assert.rejects(watchOperation(async () => {
  reads++; throw Object.assign(new Error('reload Host'), { code: 'git/unknown-method' })
}, running, { interval: 0 }), /reload Host/)
assert.equal(reads, 1)
console.log('PASS retry exhaustion and incompatible Hosts stop polling')

reads = 0
const controller = new AbortController()
const cancelled = watchOperation(() => { reads++ }, running, { signal: controller.signal, interval: 60_000 })
controller.abort()
assert.equal(await cancelled, null)
assert.equal(reads, 0)
let alive = true, settle
const late = watchOperation(() => new Promise(resolve => { settle = resolve }), running,
  { interval: 0, alive: () => alive, onUpdate: job => { assert.equal(job.state, 'running') } })
await new Promise(resolve => setTimeout(resolve, 10))
alive = false; settle(complete)
assert.equal(await late, null)
console.log('PASS cancellation clears timers and ignores late results without cancelling the Host job')

import assert from 'node:assert/strict'
import { assertGitVersion } from '../lib/git/exec.js'
import { watchOperation } from '../lib/client/core/operations.js'

for (const text of ['git version 2.35.0', 'git version 2.50.1.windows.1', 'git version 3.0.0']) {
  assert.equal(assertGitVersion(text).text, text)
}
for (const text of ['git version 2.34.9', 'git version 1.9.0', 'invalid']) {
  assert.throws(() => assertGitVersion(text), error => error.code === 'git/unsupported-version')
}
console.log('PASS Git minimum version accepts supported releases and rejects old/unknown versions')

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

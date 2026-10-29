import assert from 'node:assert/strict'
import { assertGitVersion } from '../lib/git/exec.js'
import { watchOperation } from '../lib/client/core/operations.js'
import { registerWorktreeWorkspace, worktreeWorkspace, publishWorktreeContext, worktreeAssociations } from '../lib/client/features/worktrees/workspace.js'
import { readWorktreePreferences, setWorktreeNote, touchWorktree, moveWorktreePreferences, worktreePathKey } from '../lib/client/features/worktrees/preferences.js'
import { readWorktreeDraft, writeWorktreeDraft, clearWorktreeDraft, moveWorktreeDraft } from '../lib/client/features/worktrees/drafts.js'
import { chooseDirectory, desktopChooser, desktopPlatform } from '../lib/client/features/clone/picker-source.js'
import { cloneDestination, cloneDestinationProblem } from '../lib/client/features/clone/model.js'

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

// Host filesystems can keep NFC and NFD names as distinct directories. Keep
// their identities separate, including existing storage buckets and drafts.
assert.notEqual(worktreePathKey('/Users/me/Repo'), worktreePathKey('/Users/me/repo'))
assert.equal(worktreePathKey('/Users/me/Repo', true), worktreePathKey('/Users/me/repo', true))
assert.equal(worktreePathKey('D:/Work/Repo'), worktreePathKey('d:/work/repo'))
{
  const store = new Map()
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => { store.delete(key) }, } })
  try {
    for (const base of ['/repos/unicode-review', 'D:/unicode-review']) {
      const nfc = base + '/caf\u00e9', nfd = base + '/cafe\u0301', common = base + '/main/.git'
      assert.notEqual(worktreePathKey(nfc), worktreePathKey(nfd))
      // Reading an absent NFC bucket must not adopt or delete the NFD bucket.
      const nfdBucket = 'dshgit:worktrees:' + worktreePathKey(nfd)
      const stored = JSON.stringify({ version: 1, entries: { [worktreePathKey(nfd + '/task')]: { note: 'existing NFD note', lastUsed: 4321 } } })
      store.set(nfdBucket, stored)
      assert.deepEqual(readWorktreePreferences(nfc).entries, {})
      assert.equal(store.get(nfdBucket), stored)
      assert.equal(readWorktreePreferences(nfd).entries[worktreePathKey(nfd + '/task')].note, 'existing NFD note')
      setWorktreeNote(nfc, nfc + '/task', 'NFC repository note')
      assert.equal(readWorktreePreferences(nfd).entries[worktreePathKey(nfd + '/task')].note, 'existing NFD note')
      assert.equal(store.get(nfdBucket), stored)
      // Two worktrees in one repository must also retain independent metadata.
      setWorktreeNote(common, nfc, 'NFC task')
      setWorktreeNote(common, nfd, 'NFD task')
      touchWorktree(common, nfc, 123)
      touchWorktree(common, nfd, 456)
      const entries = readWorktreePreferences(common).entries
      assert.deepEqual(entries[worktreePathKey(nfc)], { note: 'NFC task', lastUsed: 123 })
      assert.deepEqual(entries[worktreePathKey(nfd)], { note: 'NFD task', lastUsed: 456 })
      writeWorktreeDraft(common, nfc, 'NFC draft', 'NFC task')
      writeWorktreeDraft(common, nfd, 'NFD draft', 'NFD task')
      assert.equal(readWorktreeDraft(common, nfc, 'NFC task'), 'NFC draft')
      assert.equal(readWorktreeDraft(common, nfd, 'NFD task'), 'NFD draft')
      clearWorktreeDraft(common, nfc)
      clearWorktreeDraft(common, nfd)
      let opened = null, created = 0
      const unregister = registerWorktreeWorkspace({
        workspaces: { create: async ({ path }) => { created++; assert.equal(path, nfd); return { workspaceId: 'nfd' } } },
        navigation: { openWorkspace: async id => { opened = id } },
      })
      try {
        publishWorktreeContext({ items: [{ workspaceId: 'nfc', path: nfc }] }, { byId: {} })
        assert.deepEqual(worktreeAssociations(nfd), [])
        await worktreeWorkspace().open(nfd)
        assert.equal(created, 1)
        assert.equal(opened, 'nfd')
      } finally { unregister() }
    }
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved)
    else delete globalThis.localStorage
  }
}
console.log('PASS NFC and NFD directories retain independent notes, storage, drafts and workspaces')

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

// Two choosers can exist at once. Which one answers first depends on the
// platform, because on macOS Desktop the Host's NSOpenPanel is the panel the
// rest of the app shows, while on Windows the Electron dialog avoids spawning a
// COM child process per pick.
const noBridge = {}
assert.equal(desktopChooser(noBridge), null)
assert.equal(desktopChooser({ __DSH_DIRECTORY_PICKER__: {} }), null)
assert.equal(desktopChooser(undefined), null)
const bridge = { pick: async () => '/Users/me/project' }
assert.equal(desktopChooser({ __DSH_DIRECTORY_PICKER__: bridge }), bridge)

// The platform comes from the Desktop preload's `html[data-platform]`, never from
// `navigator`: a remote session renders in a browser on one machine while the
// chooser opens on another.
const desktopOf = (platform, extra) => Object.assign({ document: { documentElement: { dataset: platform === null ? {} : { platform } } } }, extra)
assert.equal(desktopPlatform(desktopOf('darwin')), 'darwin')
assert.equal(desktopPlatform(desktopOf(null)), null)
assert.equal(desktopPlatform(undefined), null)
console.log('PASS the host platform is read from the preload attribute, absent in a browser')

let nativeCalls = 0, browseCalls = 0
const listingFixture = { path: '/home', home: '/home', crumbs: [], entries: [], truncated: false }
const source = (target, native, browse, platform) => ({
  target, platform,
  native: async () => { nativeCalls++; return native() },
  browse: async () => { browseCalls++; return browse() },
})

// --- macOS Desktop: the Host NSOpenPanel leads -----------------------------
nativeCalls = 0; browseCalls = 0
let localUsed = false
const macDesktop = desktopOf('darwin', { __DSH_DIRECTORY_PICKER__: { pick: async () => { localUsed = true; return '/sheet/path' } } })
assert.deepEqual(await chooseDirectory(source(macDesktop, () => '/host/project', () => null)),
  { path: '/host/project' })
assert.equal(nativeCalls, 1)
assert(!localUsed, 'the Electron sheet is not consulted when the Host panel answered')
console.log('PASS macOS Desktop opens the Host NSOpenPanel instead of the Electron sheet')

nativeCalls = 0; browseCalls = 0
assert.deepEqual(await chooseDirectory(source(macDesktop, () => null, () => null)), { path: null })
assert.equal(nativeCalls, 1); assert.equal(browseCalls, 0)
console.log('PASS cancelling the macOS Host panel settles as a cancel without a second dialog')

nativeCalls = 0; browseCalls = 0
assert.deepEqual(await chooseDirectory(source(macDesktop, () => { throw new Error('osascript unavailable') }, () => null)),
  { path: '/sheet/path' })
assert.equal(nativeCalls, 1)
console.log('PASS a failed macOS Host panel falls back to the Electron sheet')

nativeCalls = 0; browseCalls = 0
const macBothBroken = desktopOf('darwin', { __DSH_DIRECTORY_PICKER__: { pick: async () => { throw new Error('bridge gone') } } })
assert.deepEqual(await chooseDirectory(source(macBothBroken, () => { throw new Error('osascript unavailable') }, () => listingFixture)), { listing: listingFixture })
console.log('PASS macOS with both choosers broken still reaches the browse dialog')

// A hung chooser must settle on cancellation and must not open a fallback
// when the abandoned Host call eventually fails.
{
  const controller = new AbortController()
  let failHost, localCalls = 0, listings = 0
  const pending = chooseDirectory({
    target: desktopOf('darwin', { __DSH_DIRECTORY_PICKER__: { pick: async () => { localCalls++; return '/unexpected' } } }),
    signal: controller.signal,
    native: () => new Promise((resolve, reject) => { failHost = reject }),
    browse: async () => { listings++; return listingFixture },
  })
  controller.abort()
  await assert.rejects(pending, error => error.name === 'AbortError')
  failHost(new Error('late Host failure'))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(localCalls, 0)
  assert.equal(listings, 0)
  await assert.rejects(chooseDirectory({ signal: controller.signal,
    native: () => { throw new Error('must not start') }, browse: async () => listingFixture }),
    error => error.name === 'AbortError')
}
console.log('PASS a hung macOS chooser can be cancelled and late failure never opens another dialog')

// --- Windows Desktop: the Electron dialog leads ----------------------------
nativeCalls = 0; browseCalls = 0
assert.deepEqual(await chooseDirectory(source(desktopOf('win32', { __DSH_DIRECTORY_PICKER__: bridge }), () => '/host/project', () => null)),
  { path: '/Users/me/project' })
assert.equal(nativeCalls + browseCalls, 0)
console.log('PASS Windows Desktop keeps using the Electron dialog first')

nativeCalls = 0; browseCalls = 0
assert.deepEqual(await chooseDirectory(source(desktopOf('linux', { __DSH_DIRECTORY_PICKER__: bridge }), () => '/host/project', () => null)),
  { path: '/Users/me/project' })
assert.equal(nativeCalls, 0)
console.log('PASS a non-macOS Desktop still leads with its Electron dialog')

let cancelledLocal = false
assert.deepEqual(await chooseDirectory(source(desktopOf('win32', { __DSH_DIRECTORY_PICKER__: { pick: async () => { cancelledLocal = true; return null } } }),
  () => '/host/project', () => null)), { path: null })
assert(cancelledLocal, 'a cancelled local dialog settles the request instead of falling through')
console.log('PASS cancelling the Electron dialog settles as a cancel, not a Host call')

nativeCalls = 0; browseCalls = 0
assert.deepEqual(await chooseDirectory(source(desktopOf('win32', { __DSH_DIRECTORY_PICKER__: { pick: async () => { throw new Error('bridge gone') } } }),
  () => '/host/project', () => null)), { path: '/host/project' })
assert.equal(nativeCalls, 1)
console.log('PASS a broken Electron bridge falls back to the Host chooser')

// --- Ordinary Web: no bridge at all ----------------------------------------
nativeCalls = 0; browseCalls = 0
assert.deepEqual(await chooseDirectory(source(noBridge, () => '/host/project', () => null)), { path: '/host/project' })
assert.equal(nativeCalls, 1); assert.equal(browseCalls, 0)
console.log('PASS ordinary Web still uses the Host chooser')

nativeCalls = 0; browseCalls = 0
assert.deepEqual(await chooseDirectory(source(noBridge, () => null, () => null)), { path: null })
assert.equal(nativeCalls, 1)
console.log('PASS a Host chooser cancel reports null rather than opening the browser')

const listing = { path: '/home', home: '/home', crumbs: [], entries: [], truncated: false }
assert.deepEqual(await chooseDirectory(source(noBridge, () => { throw new Error('native only') }, () => listing)), { listing })
console.log('PASS a browse-only Host hands the caller a listing to present')

await assert.rejects(chooseDirectory(source(noBridge, () => { throw new Error('native only') }, () => { throw new Error('no browse') })),
  /native only/)
console.log('PASS a Host with neither capability keeps its original picker error')

// macOS is the platform where this flow used to be inert, and every fixture in
// this file is a Windows path. Both choosers can answer with a POSIX path and
// with an empty line, so pin that down rather than assuming `D:/` shapes.
assert.deepEqual(await chooseDirectory(source(noBridge, () => '', () => null)), { path: null })
assert.deepEqual(await chooseDirectory(source(desktopOf('darwin', { __DSH_DIRECTORY_PICKER__: { pick: async () => 'unused' } }),
  () => '', () => null)), { path: null })
console.log('PASS an empty chooser answer normalizes to a cancel on both paths')

const macHome = '/Users/张三/My Project'
const bridgedHome = desktopOf('win32', { __DSH_DIRECTORY_PICKER__: { pick: async () => macHome } })
const macBridged = desktopOf('darwin', { __DSH_DIRECTORY_PICKER__: { pick: async () => macHome } })
assert.deepEqual(await chooseDirectory(source(bridgedHome, () => '/host', () => null)), { path: macHome })
assert.deepEqual(await chooseDirectory(source(macBridged, () => macHome, () => null)), { path: macHome })
assert.deepEqual(await chooseDirectory(source(noBridge, () => macHome, () => null)), { path: macHome })
console.log('PASS POSIX paths with spaces and CJK survive both choosers verbatim')

// The Host's macOS chooser prints an empty line when the panel is cancelled and
// the path with no trailing newline otherwise; only the empty case is a cancel.
assert.deepEqual(await chooseDirectory(source(noBridge, () => '/Volumes/外部盘/项目', () => null)),
  { path: '/Volumes/外部盘/项目' })
assert.deepEqual(await chooseDirectory(source(noBridge, () => '/', () => null)), { path: '/' })
console.log('PASS volume and root selections are not mistaken for cancels')

// A destination the form rejects must say why. `cloneDestination` returning null
// is what the submit guard needs, but a merely dimmed button leaves the operator
// guessing — and the macOS mistake (`~/projects`) looks like a filled-in field.
assert.equal(cloneDestinationProblem('~/projects', 'app'), 'clone.problem.tilde')
assert.equal(cloneDestinationProblem('relative/dir', 'app'), 'clone.problem.relative')
assert.equal(cloneDestinationProblem('', 'app'), 'clone.problem.parentEmpty')
assert.equal(cloneDestinationProblem('/Users/me', ''), 'clone.problem.nameEmpty')
// Both fields wrong: the path is what the operator is fixing, so it is named.
assert.equal(cloneDestinationProblem('~/projects', ''), 'clone.problem.tilde')
assert.equal(cloneDestinationProblem('', ''), 'clone.problem.parentEmpty')
assert.equal(cloneDestinationProblem('/Users/me', '..'), 'clone.problem.nameReserved')
assert.equal(cloneDestinationProblem('/Users/me', 'a/b'), 'clone.problem.nameSeparator')
assert.equal(cloneDestinationProblem('C:\\Users\\me', 'CON'), 'clone.problem.nameWindows')
assert.equal(cloneDestinationProblem('/Users/me', 'app'), null)
// The reason and the computed destination must never disagree.
assert.equal(cloneDestination('~/projects', 'app'), null)
assert.equal(cloneDestination('/Users/me', 'app'), '/Users/me/app')
assert.equal(cloneDestination('/', 'app'), '/app')
assert.equal(cloneDestination('/Volumes/外部盘/项目', 'app'), '/Volumes/外部盘/项目/app')
assert.equal(cloneDestination('C:\\Users\\me', 'app'), 'C:\\Users\\me\\app')
// A trailing space is only illegal on Windows, where the name is checked trimmed.
assert.equal(cloneDestinationProblem('/Users/me', 'ok '), null)
assert.equal(cloneDestinationProblem('C:\\Users\\me', 'ok'), null)
console.log('PASS a rejected destination names its reason and agrees with the computed path')

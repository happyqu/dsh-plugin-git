var cache = new Map(), listeners = new Set()
export function worktreePathKey(path) {
  var value = String(path || '').replace(/\\/g, '/')
  if (value !== '/' && !/^[a-z]:\/$/i.test(value)) value = value.replace(/\/$/, '')
  return /^[a-z]:|^\/\//i.test(value) ? value.toLowerCase() : value
}
function storageKey(common) { return 'dshgit:worktrees:' + worktreePathKey(common) }
export function readWorktreePreferences(common) {
  var key = storageKey(common)
  if (!cache.has(key)) {
    var value = null
    try { value = JSON.parse(globalThis.localStorage?.getItem(key) || 'null') } catch (error) {}
    var entries = {}
    if (value?.version === 1 && value.entries && typeof value.entries === 'object' && !Array.isArray(value.entries)) {
      Object.keys(value.entries).forEach(function (path) {
        var item = value.entries[path]
        if (!item || typeof item !== 'object' || Array.isArray(item)) return
        entries[path] = { note: typeof item.note === 'string' ? item.note.slice(0, 4000) : '',
          lastUsed: Number.isFinite(item.lastUsed) && item.lastUsed > 0 ? item.lastUsed : 0 }
      })
    }
    cache.set(key, { version: 1, entries: entries })
  }
  return cache.get(key)
}
function save(common, entries) {
  var value = { version: 1, entries: entries }, key = storageKey(common)
  if (!globalThis.localStorage) throw new Error('本机存储不可用，无法保存工作树备注')
  globalThis.localStorage.setItem(key, JSON.stringify(value))
  cache.set(key, value); listeners.forEach(function (listener) { listener() })
}
export function setWorktreeNote(common, path, note) {
  if (typeof note !== 'string' || note.length > 4000) throw new Error('任务备注不能超过 4000 字')
  var state = readWorktreePreferences(common), key = worktreePathKey(path)
  save(common, Object.assign({}, state.entries, { [key]: Object.assign({}, state.entries[key], { note: note }) }))
}
export function touchWorktree(common, path, now) {
  var state = readWorktreePreferences(common), key = worktreePathKey(path)
  save(common, Object.assign({}, state.entries, { [key]: Object.assign({}, state.entries[key], { lastUsed: now || Date.now() }) }))
}
export function moveWorktreePreferences(common, from, to) {
  var state = readWorktreePreferences(common), source = worktreePathKey(from), target = worktreePathKey(to)
  if (source === target || !state.entries[source]) return
  var entries = Object.assign({}, state.entries)
  entries[target] = Object.assign({}, entries[target], entries[source]); delete entries[source]
  save(common, entries)
}
export function subscribeWorktreePreferences(listener) {
  listeners.add(listener)
  var changed = function (event) { if (!event.key || event.key.startsWith('dshgit:worktrees:')) { cache.clear(); listener() } }
  globalThis.window?.addEventListener('storage', changed)
  return function () { listeners.delete(listener); globalThis.window?.removeEventListener('storage', changed) }
}

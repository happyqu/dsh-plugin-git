var cache = new Map(), listeners = new Set()
/**
 * Identity of one worktree path, for matching and for storage keys.
 *
 * Three separate folds, each for a case that really merges two spellings of one
 * directory:
 *
 * - separators: a Windows caller and Git may hand back either slash.
 * - trailing slash: `/repos/x` and `/repos/x/` are the same directory.
 * - case: only where the filesystem is known to be case-insensitive. Windows
 *   always is. macOS usually is, but a case-sensitive APFS volume is legal and
 *   there `/Users/me/Repo` and `/Users/me/repo` are two different directories —
 *   folding those would merge unrelated worktrees, so the platform has to say
 *   so rather than being assumed.
 *
 * Preserve Unicode spelling: NFC and NFD can name distinct directories on
 * the Host filesystem. The client cannot infer that from the desktop platform.
 *
 * @param path - the directory path.
 * @param caseInsensitive - whether this platform's volumes ignore case.
 * @returns the identity key.
 */
export function worktreePathKey(path, caseInsensitive) {
  var value = String(path || '').replace(/\\/g, '/')
  if (value !== '/' && !/^[a-z]:\/$/i.test(value)) value = value.replace(/\/$/, '')
  var fold = caseInsensitive === undefined
    ? /^[a-z]:|^\/\//i.test(value)
    : caseInsensitive
  return fold ? value.toLowerCase() : value
}
function storageKey(common) { return 'dshgit:worktrees:' + worktreePathKey(common) }

/** One stored entry, re-keyed, or null when it is not a usable record. */
function readEntry(key, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  return { key: worktreePathKey(key),
    note: typeof item.note === 'string' ? item.note.slice(0, 4000) : '',
    lastUsed: Number.isFinite(item.lastUsed) && item.lastUsed > 0 ? item.lastUsed : 0 }
}

/** Parse one stored bucket into entries re-keyed with the current algorithm. */
function readBucket(text) {
  var entries = {}, value = null
  try { value = JSON.parse(text || 'null') } catch (error) {}
  if (value?.version !== 1 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) return entries
  Object.keys(value.entries).forEach(function (path) {
    var entry = readEntry(path, value.entries[path])
    if (entry === null) return
    // Two spellings can fold onto one key. Keep the note somebody wrote and the
    // most recent use rather than letting key order decide.
    var previous = entries[entry.key]
    entries[entry.key] = previous === undefined ? { note: entry.note, lastUsed: entry.lastUsed } : {
      note: previous.note || entry.note,
      lastUsed: Math.max(previous.lastUsed, entry.lastUsed),
    }
  })
  return entries
}

export function readWorktreePreferences(common) {
  var key = storageKey(common)
  if (!cache.has(key)) {
    var text = null
    try { text = globalThis.localStorage?.getItem(key) } catch (error) {}
    var entries = readBucket(text)
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

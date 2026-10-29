

/**
 * The graph module's sidebar: what the lanes mean.
 *
 * A graph with no legend is unreadable — the reader cannot tell a branch tip
 * from a merge. These counts plus the branch-tip list are the minimum needed
 * to interpret the lanes in the editor.
 */
function readWorkbenchStorage(key, fallback) {
  try {
    var value = JSON.parse(localStorage.getItem('dshgit:wb:' + key))
    if (value === null || (Array.isArray(fallback) && !Array.isArray(value))) return fallback
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && (typeof value !== 'object' || Array.isArray(value))) return fallback
    return value
  }
  catch (error) { return fallback }
}

function writeWorkbenchStorage(key, value) { try { localStorage.setItem('dshgit:wb:' + key, JSON.stringify(value)) } catch (error) {} }


/**
 * The shared tree/flat choice for file lists, and the listeners that keep
 * every open list in step.
 *
 * One preference, not one per list. Two lists on screen at once (a changelist
 * and the commit history, say) must not disagree, and a fresh mount must not
 * silently revert to the default — that is the bug this store fixes.
 */
var fileListLayoutStored = null

var fileListLayoutListeners = new Set()

/** Read the shared file-list layout. */
function fileListLayout(fallback) {
  if (fileListLayoutStored === null) {
    var saved = readWorkbenchStorage('file-list-layout', null)
    fileListLayoutStored = saved === 'tree' || saved === 'flat' ? saved : (fallback === 'flat' ? 'flat' : 'tree')
  }
  return fileListLayoutStored
}

/** Persist a layout and notify every mounted list. */
function setFileListLayout(value) {
  if (value !== 'tree' && value !== 'flat') return
  fileListLayoutStored = value
  writeWorkbenchStorage('file-list-layout', value)
  fileListLayoutListeners.forEach(function (listener) { listener(value) })
}

function readPreviewMode(root, path, fallback) {
  var mode = readWorkbenchStorage('preview-modes', {})[JSON.stringify([root, path])]
  return ['diff', 'content', 'before', 'after'].includes(mode) ? mode : fallback
}
function writePreviewMode(root, path, mode) {
  var modes = readWorkbenchStorage('preview-modes', {}), key = JSON.stringify([root, path])
  delete modes[key]; modes[key] = mode
  Object.keys(modes).slice(0, Math.max(0, Object.keys(modes).length - 200)).forEach(function (old) { delete modes[old] })
  writeWorkbenchStorage('preview-modes', modes)
}
export { fileListLayout, fileListLayoutListeners, readWorkbenchStorage, setFileListLayout, writeWorkbenchStorage, readPreviewMode, writePreviewMode }

/**
 * How a diff should be READ, shared by every surface that renders one.
 *
 * These are review choices, not history ones: they change which hunks are shown and
 * never what is committed. They exist because the Host has accepted them for a long
 * time while the panel sent none of them — `ignoreWhitespace` and `ignoreAllSpace`
 * were dead arguments, so a reformat-then-change commit stayed unreadable.
 *
 * A store rather than React state, because the preference belongs to the panel and not
 * to one diff: opening another file must keep the choice the reviewer just made, and a
 * component that owned it would reset on every mount.
 */
var reviewPrefs = null
var reviewPrefsListeners = new Set()

/** The current review preferences, with defaults filled in. */
function getReviewPrefs() {
  if (reviewPrefs === null) {
    var saved = readWorkbenchStorage('review-prefs', null)
    reviewPrefs = {
      // Defaults match a plain `git diff`, deliberately: a panel that silently shows
      // something different from the user's terminal is worse than a plainer diff.
      ignoreWhitespace: saved?.ignoreWhitespace === true,
      ignoreAllSpace: saved?.ignoreAllSpace === true,
      wordDiff: saved?.wordDiff === true,
      algorithm: saved?.algorithm === 'histogram' || saved?.algorithm === 'patience' ? saved.algorithm : '',
      contextLines: [3, 10, 25].includes(saved?.contextLines) ? saved.contextLines : 3,
    }
  }
  return reviewPrefs
}

/**
 * Replace the review preferences and notify every mounted diff.
 *
 * @param next - a partial preference object.
 * @returns the stored preferences.
 */
function setReviewPrefs(next) {
  reviewPrefs = {
    ignoreWhitespace: next?.ignoreWhitespace === true,
    // `-w` is strictly stronger than `-b`, so holding both would send two flags whose
    // combined meaning is "the last one wins". Only one is ever true.
    ignoreAllSpace: next?.ignoreAllSpace === true,
    wordDiff: next?.wordDiff === true,
    algorithm: next?.algorithm === 'histogram' || next?.algorithm === 'patience' ? next.algorithm : '',
    contextLines: [3, 10, 25].includes(next?.contextLines) ? next.contextLines : 3,
  }
  if (reviewPrefs.ignoreAllSpace) reviewPrefs.ignoreWhitespace = false
  writeWorkbenchStorage('review-prefs', reviewPrefs)
  reviewPrefsListeners.forEach(function (listener) { listener(reviewPrefs) })
  return reviewPrefs
}

/** Subscribe to preference changes; returns the unsubscribe function. */
function subscribeReviewPrefs(listener) {
  reviewPrefsListeners.add(listener)
  return function () { reviewPrefsListeners.delete(listener) }
}

/**
 * Attach the review preferences to a `diff` payload.
 *
 * Only NON-DEFAULT values are attached. Sending `ignoreWhitespace: false` is harmless
 * to git but harmful to the command log: every read would look like it deliberately
 * asked for something, and the log is where a user checks what actually ran.
 *
 * @param payload - the diff request.
 * @returns a new payload.
 */
function withReviewPrefs(payload) {
  var prefs = getReviewPrefs()
  var next = Object.assign({}, payload)
  if (prefs.ignoreAllSpace) next.ignoreAllSpace = true
  else if (prefs.ignoreWhitespace) next.ignoreWhitespace = true
  if (prefs.wordDiff) next.wordDiff = true
  if (prefs.algorithm !== '') next.algorithm = prefs.algorithm
  if (prefs.contextLines !== 3) next.contextLines = prefs.contextLines
  return next
}

export { getReviewPrefs, setReviewPrefs, subscribeReviewPrefs, withReviewPrefs }

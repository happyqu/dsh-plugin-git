

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

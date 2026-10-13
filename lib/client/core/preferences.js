

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

/**
 * Read the saved layout.
 *
 * The per-repository `file-layout:<root>` key is the older form and is still
 * honoured as a one-time fallback, so an existing choice survives the move to
 * a single global preference.
 *
 * @param fallback - used only when nothing was ever saved.
 * @param root - repository root, for migrating the older per-repo key.
 */
function fileListLayout(fallback, root) {
  if (fileListLayoutStored === null) {
    var saved = readWorkbenchStorage('file-list-layout', null)
    if (saved !== 'tree' && saved !== 'flat' && root) {
      var legacy = readWorkbenchStorage('file-layout:' + root, null)
      if (legacy === 'tree' || legacy === 'flat') saved = legacy
    }
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

export { fileListLayout, fileListLayoutListeners, readWorkbenchStorage, setFileListLayout, writeWorkbenchStorage }

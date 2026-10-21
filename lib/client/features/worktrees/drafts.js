import { worktreePathKey } from './preferences.js'

// Session changes remount GitApp. Keep unsaved text for the plugin's lifetime,
// separately from saved preferences; restoring a draft never marks it saved.
var drafts = new Map()
function key(common, path) { return worktreePathKey(common) + '\0' + worktreePathKey(path) }
export function readWorktreeDraft(common, path, saved) {
  var id = key(common, path)
  return drafts.has(id) ? drafts.get(id) : saved
}
export function writeWorktreeDraft(common, path, text, saved) {
  var id = key(common, path)
  if (text === saved) drafts.delete(id)
  else drafts.set(id, text)
}
export function clearWorktreeDraft(common, path) { drafts.delete(key(common, path)) }
export function moveWorktreeDraft(common, from, to) {
  var source = key(common, from), destination = key(common, to)
  if (source === destination || !drafts.has(source)) return
  drafts.set(destination, drafts.get(source)); drafts.delete(source)
}

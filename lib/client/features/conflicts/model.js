var drafts = new Map()
function draftKey(root, path) { return JSON.stringify([root, path]) }
function readDraft(root, path) { return drafts.get(draftKey(root, path)) }
function saveDraft(root, path, hash, text, choice) {
  var key = draftKey(root, path), weight = text.length * 2
  if (!drafts.has(key) && drafts.size >= 100) return false
  for (var entry of drafts) if (entry[0] !== key) weight += entry[1].text.length * 2
  if (weight > 32 * 1024 * 1024) return false
  drafts.set(key, { hash: hash, text: text, choice: choice }); return true
}
function clearDraft(root, path) { drafts.delete(draftKey(root, path)) }
function conflictBlocks(text) {
  var expression = /^<{7,}[^\r\n]*\r?\n([\s\S]*?)^={7,}\r?\n([\s\S]*?)^>{7,}[^\r\n]*(?:\r?\n|$)/gm
  return Array.from(text.matchAll(expression)).map(function (match) { return { start: match.index, end: match.index + match[0].length, ours: match[1].split(/^\|{7,}[^\r\n]*\r?\n/m)[0], theirs: match[2] } })
}
export { readDraft, saveDraft, clearDraft, conflictBlocks }

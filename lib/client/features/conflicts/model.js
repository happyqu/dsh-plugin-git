var drafts = new Map()
function draftKey(root, path) { return JSON.stringify([root, path]) }
function readDraft(root, path) { return drafts.get(draftKey(root, path)) }
function saveDraft(root, path, hash, text, choice, history) {
  var key = draftKey(root, path), snapshots = (history || []).slice(-20)
  var weightOf = function () { return text.length * 2 + snapshots.reduce(function (sum, item) { return sum + item.text.length * 2 }, 0) }
  if (!drafts.has(key) && drafts.size >= 100) return false
  while (snapshots.length && weightOf() > 16 * 1024 * 1024) snapshots.shift()
  var otherWeight = 0
  for (var entry of drafts) if (entry[0] !== key) otherWeight += entry[1].weight || entry[1].text.length * 2
  while (snapshots.length && otherWeight + weightOf() > 32 * 1024 * 1024) snapshots.shift()
  if (otherWeight + weightOf() > 32 * 1024 * 1024) return false
  drafts.set(key, { hash: hash, text: text, choice: choice, history: snapshots, weight: weightOf() }); return true
}
function clearDraft(root, path) { drafts.delete(draftKey(root, path)) }
function conflictBlocks(text) {
  var expression = /^<{7,}[^\r\n]*\r?\n([\s\S]*?)^={7,}\r?\n([\s\S]*?)^>{7,}[^\r\n]*(?:\r?\n|$)/gm
  return Array.from(text.matchAll(expression)).map(function (match) { return { start: match.index, end: match.index + match[0].length, ours: match[1].split(/^\|{7,}[^\r\n]*\r?\n/m)[0], theirs: match[2] } })
}
export { readDraft, saveDraft, clearDraft, conflictBlocks }

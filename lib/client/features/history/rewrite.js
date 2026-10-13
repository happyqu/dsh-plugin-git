

/**
 * Decide what a set of ticked commits should do, and why not when they
 * cannot be acted on.
 *
 * This is the single source of truth for both the toolbar's text and the
 * action button's enabled state. Duplicating the rule would let the button
 * offer something the validation then refuses, which is the most irritating
 * possible outcome: the user did everything asked and is still told no.
 *
 * Contiguity is decided by walking the PARENT CHAIN, never by list position.
 * The list is a filtered view — a search or a path filter hides commits — so
 * two rows that look adjacent can have arbitrary history between them.
 * Comparing indexes would report "ready" and then have the Host refuse,
 * which is exactly the failure this function exists to prevent.
 *
 * @param list - every commit the view knows about, newest first.
 * @param selected - the ticked SHAs.
 * @returns `{ action, ok, reason, shas, missing }`; `action` is `null`,
 *   `'reword'` (one ticked) or `'squash'` (two or more).
 */
function rewriteSelection(list, selected) {
  var commits = list || []
  var picked = selected || []
  if (picked.length === 0) return { action: null, ok: false, reason: 'none', shas: [], missing: [] }

  var bySha = Object.create(null)
  for (var i = 0; i < commits.length; i++) bySha[commits[i].sha] = commits[i]
  for (var j = 0; j < picked.length; j++) {
    if (bySha[picked[j]] === undefined) return { action: null, ok: false, reason: 'stale', shas: [], missing: [] }
  }

  // One ticked commit is a message edit; no contiguity question arises.
  if (picked.length === 1) {
    var only = bySha[picked[0]]
    if (only.unpublished !== true) return { action: null, ok: false, reason: 'pushed', shas: [], missing: [] }
    return { action: 'reword', ok: true, reason: null, shas: [only.sha], missing: [] }
  }

  // A ticked commit may not be published.
  for (var k = 0; k < picked.length; k++) {
    if (bySha[picked[k]].unpublished !== true) return { action: null, ok: false, reason: 'pushed', shas: [], missing: [] }
  }

  // The list arrives newest-first from git, so position identifies the newest
  // and oldest ticked commits. Deriving "newest" from parent links instead
  // does not work: with a gap, two ticks both lack a ticked child.
  var position = Object.create(null)
  for (var p = 0; p < commits.length; p++) position[commits[p].sha] = p
  var ordered = picked.slice().sort(function (a, b) { return position[a] - position[b] })
  var newest = ordered[0]
  var oldest = ordered[ordered.length - 1]

  // Walk DOWN from the newest tick to the oldest through real parent links.
  // `parents` comes from git, so this stays correct when a search or path
  // filter has hidden commits: a hidden one surfaces as `missing` instead of
  // vanishing, which is what makes "filtered" detectable at all.
  var run = []
  var missing = []
  var cursor = newest
  var steps = 0
  while (cursor !== undefined && steps <= commits.length + picked.length + 1) {
    steps++
    var current = bySha[cursor]
    if (current === undefined) { missing.push(cursor); break }
    if (current.unpublished !== true) return { action: null, ok: false, reason: 'pushed', shas: [], missing: [] }
    if (picked.indexOf(cursor) === -1) missing.push(cursor)
    run.unshift(cursor)
    if (cursor === oldest) break
    var next = (current.parents || [])[0]
    if (next === undefined) break
    cursor = next
  }
  if (missing.length > 0) {
    // "Hidden by the filter" and "simply not ticked" need different offers:
    // clear the filter, or tick the row. Both are reported so the UI chooses.
    var hidden = missing.filter(function (sha) { return bySha[sha] === undefined })
    return { action: 'squash', ok: false, reason: hidden.length ? 'filtered' : 'gap', shas: [], missing: missing }
  }
  // Every tick must have been on the path; otherwise the ticks are not one
  // chain (they branch, or two separate runs were ticked).
  if (run.length !== picked.length) return { action: null, ok: false, reason: 'unordered', shas: [], missing: [] }
  return { action: 'squash', ok: true, reason: null, shas: run, missing: [] }
}

export { rewriteSelection }

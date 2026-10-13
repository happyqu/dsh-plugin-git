

/**
 * The local branch name a remote-tracking ref implies.
 *
 * `origin/feature/login` → `feature/login`: strip only the REMOTE prefix, not
 * everything up to the last slash. A naive `baseName` would produce `login`,
 * silently creating a differently-named branch than the one on the remote —
 * and `git checkout -b login origin/feature/login` would then push to a
 * brand-new `login`, which is a real way to lose track of a branch.
 *
 * @param ref - a remote-tracking ref, e.g. `origin/feature/login`.
 * @returns the short name, e.g. `feature/login`.
 */
function shortBranchName(ref) {
  var value = String(ref || '')
  var slash = value.indexOf('/')
  return slash === -1 ? value : value.slice(slash + 1)
}



/** Stable lane hue, adjusted against the host foreground for either theme. */
var LANE_COLORS = ['#6ea8fe', '#7ee787', '#ffa657', '#d2a8ff', '#79c0ff', '#ff7b72', '#a5d6ff', '#f2cc60']


function laneColor(lane) {
  return 'color-mix(in srgb, var(--dsw-alias-label-primary) 35%, ' + LANE_COLORS[((lane % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length] + ')'
}



/**
 * The branch picker: a filter box over grouped local / remote / tag refs.
 *
 * Modelled on VS Code's quick pick because that is the interaction people
 * already know: type to filter, arrows and Enter to pick, and each row
 * carries enough metadata (relative time, author, sha, subject) to tell two
 * similarly-named branches apart without checking them out.
 *
 * @param props - `{ t, refs, current, query, setQuery, onSwitch, onRemote, onNew, onFetch }`.
 */
function branchUpdatedTime(branch) {
  var value = Number(branch.committerDate)
  return Number.isFinite(value) ? value : 0
}


function compareBranchesByUpdated(a, b) {
  return branchUpdatedTime(b) - branchUpdatedTime(a) || String(a.ref || a.name || '').localeCompare(String(b.ref || b.name || ''))
}


function sortedBranches(branches) { return (branches || []).slice().sort(compareBranchesByUpdated) }



function workbenchUpstream(branch) {
  return branch.upstreamRef || (branch.upstream ? (branch.upstream.startsWith('refs/') ? branch.upstream : 'refs/remotes/' + branch.upstream) : '')
}

export { branchUpdatedTime, compareBranchesByUpdated, laneColor, sortedBranches, workbenchUpstream }

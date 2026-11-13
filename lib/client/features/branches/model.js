import { compareTagsByCreated } from '../../../shared/refOrder.js'

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
function sortedTags(tags) { return (tags || []).slice().sort(compareTagsByCreated) }



function workbenchUpstream(branch) {
  return branch.upstreamRef || (branch.upstream ? (branch.upstream.startsWith('refs/') ? branch.upstream : 'refs/remotes/' + branch.upstream) : '')
}

/**
 * Resolve an explicit source/target pair, including remotes whose names contain slashes.
 *
 * `force` adds `--force-with-lease` to the payload instead of returning a second
 * shape. It is derived from the SAME upstream resolution as a plain push, which
 * is what makes "force push this branch" mean the branch that is on screen
 * rather than whatever the current checkout happens to be. A branch without an
 * upstream has nothing to overwrite, so it resolves to null either way.
 *
 * @param branch - a ref record with `ref` (and usually `upstreamRef`).
 * @param remotes - configured remotes.
 * @param force - request the lease-protected force form.
 * @returns `{ remote, sourceBranch, targetBranch, forceWithLease? }` or null.
 */
function branchPushTarget(branch, remotes, force) {
  if (!branch?.ref?.startsWith('refs/heads/')) return null
  var upstream = workbenchUpstream(branch)
  var remote = (remotes || []).filter(function (item) { return upstream.startsWith('refs/remotes/' + item.name + '/') })
    .sort(function (a, b) { return b.name.length - a.name.length })[0]
  if (!remote) return null
  var target = upstream.slice(('refs/remotes/' + remote.name + '/').length)
  if (!target) return null
  return Object.assign({ remote: remote.name, sourceBranch: branch.ref.slice(11), targetBranch: target },
    force === true ? { forceWithLease: true } : null)
}

/**
 * The force-push payload for the CURRENT branch, built from `status.branch`.
 *
 * The title bar only knows the branch name and its short upstream (`origin/main`),
 * not the full ref record the branch list carries, so this rebuilds the minimum
 * shape {@link branchPushTarget} needs. Returning null for a branch with no
 * upstream is deliberate: forcing an unpublished branch would be a plain
 * publish, which is not what the button says.
 *
 * @param branch - `status.branch`.
 * @param remotes - configured remotes.
 * @returns `{ remote, sourceBranch, targetBranch, forceWithLease: true }` or null.
 */
function currentForcePushTarget(branch, remotes) {
  if (!branch || branch.detached === true) return null
  var name = typeof branch.head === 'string' ? branch.head : ''
  var upstream = typeof branch.upstream === 'string' ? branch.upstream : ''
  if (name === '' || upstream === '') return null
  return branchPushTarget({
    ref: 'refs/heads/' + name,
    upstreamRef: upstream.startsWith('refs/') ? upstream : 'refs/remotes/' + upstream,
  }, remotes, true)
}

export { branchPushTarget, branchUpdatedTime, compareBranchesByUpdated, currentForcePushTarget, laneColor, sortedBranches, sortedTags, workbenchUpstream }

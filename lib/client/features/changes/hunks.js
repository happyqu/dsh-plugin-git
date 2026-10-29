/**
 * dsh-plugin-git — per-hunk controls for a rendered diff.
 *
 * The Host side (`lib/git/hunks.js`) turns a set of hunk fingerprints into a patch
 * subset; this hook is the other half: it fetches those fingerprints for the file being
 * shown, exposes the actions the current section allows, and keeps the two in step after
 * every write.
 *
 * Three decisions worth stating:
 *
 * 1. **Fingerprints come from a separate read.** `diff` renders the file; `fileHunks`
 *    supplies the hashes. That looks redundant and is not: the panel renders diffs in a
 *    dozen places (history, compare, stash, worktree compare) where no staging is
 *    possible, and making `diff` compute hashes for all of them would pay for a feature
 *    most callers cannot use.
 * 2. **Only the actions the current section supports are offered.** A staged hunk can be
 *    unstaged; an unstaged one can be staged or discarded. Offering all three everywhere
 *    is how a user discards work they meant to stage.
 * 3. **A changed file hides the controls instead of showing stale ones.** When the hashes
 *    no longer match the file the write layer would refuse anyway; hiding them and saying
 *    "content changed, refresh" is the honest version of the same answer.
 */
import { React } from '../../core/runtime.js'

/**
 * Fetch hunk fingerprints for a file and expose per-hunk actions.
 *
 * @param options - `{ run, repo, path, staged, enabled, hunks, onDone, confirm, t }`.
 *   `hunks` is the rendered diff's hunk list, used to map row order onto fingerprints.
 * @returns `{ hashes, actions, busy, error, act, reload }`.
 */
function useFileHunks(options) {
  var run = options.run
  var enabled = options.enabled === true && options.repo !== null && options.repo !== undefined
    && typeof options.path === 'string' && options.path !== ''
  /**
   * The rendered hunks are part of the cache key.
   *
   * Staging one hunk changes the SET: the file then has fewer hunks, and their positions
   * shift. Keying only on `[root, path, staged]` meant the hook kept the fingerprints it
   * had read before the write, so the next click sent an index that no longer mapped to
   * the hunk on screen. The Host refused it (a stale fingerprint is rejected, never
   * misapplied), but the user saw a button that did nothing.
   *
   * Include content too: replacing text without changing line counts is still an edit.
   */
  var signature = JSON.stringify(options.hunks || [])
  var key = JSON.stringify([options.repo?.root || '', options.path || '', options.staged === true, signature])
  var state = React.useState({ key: key, hashes: null, error: '' })
  var current = state[0].key === key ? state[0] : { key: key, hashes: null, error: '' }
  var busyState = React.useState(false)

  var load = React.useCallback(function () {
    if (!enabled) { state[1]({ key: key, hashes: null, error: '' }); return undefined }
    var active = true
    // A read: `silent`, so opening a file never spins the status bar. A failure is
    // recorded rather than thrown — most files simply cannot be split (binary, rename,
    // untracked) and those are not errors to interrupt anyone with.
    run('fileHunks', { root: options.repo.root, path: options.path, staged: options.staged === true },
      { silent: true, silentError: true })
      .then(function (value) {
        if (!active) return
        // Coordinates alone do not identify content: a save between these two reads
        // can replace text without moving any line. Both responses must agree on the
        // digest of the body the user actually saw. Older Hosts fail closed.
        var hashes = (options.hunks || []).map(function (shown) {
          var match = (value.hunks || []).find(function (candidate) {
            var coords = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(candidate.header || '')
            return typeof shown.contentHash === 'string' && candidate.contentHash === shown.contentHash && coords !== null
              && Number(coords[1]) === shown.oldStart && Number(coords[2] ?? 1) === shown.oldLines
              && Number(coords[3]) === shown.newStart && Number(coords[4] ?? 1) === shown.newLines
          })
          return match ? match.hash : null
        })
        // A single unmatched hunk means the panel and the Host disagree about the file,
        // so NO control is offered: a partial map would put the wrong action on a row.
        var missing = hashes.some(function (hash) { return hash === null })
        state[1]({ key: key, hashes: missing ? null : hashes, error: '' })
      })
      .catch(function (failure) {
        if (active) state[1]({ key: key, hashes: null, error: failure.message })
      })
    return function () { active = false }
  }, [enabled, key, run])
  React.useEffect(load, [load])

  // A staged file can only be unstaged; an unstaged one can be staged or discarded.
  var actions = options.staged === true ? ['unstage'] : ['stage', 'discard']

  var act = function (action, index) {
    var hash = current.hashes?.[index]
    if (typeof hash !== 'string' || busyState[0]) return
    var perform = function () {
      if (busyState[0]) return
      busyState[1](true)
      var method = action === 'stage' ? 'write.stageHunks'
        : action === 'unstage' ? 'write.unstageHunks' : 'write.discardHunks'
      run(method, Object.assign({
        root: options.repo.root,
        path: options.path,
        hashes: [hash],
        // The discard side decides WHAT is reverted, so it must match what was shown.
        staged: options.staged === true,
      }, action === 'discard'
        // Only the destructive one needs a token; the RPC layer enforces this and would
        // refuse without it, so sending it unconditionally would be a lie.
        ? { confirm: true }
        : {}), { silent: true, silentError: true })
        .then(function () {
          busyState[1](false)
          if (options.onDone) options.onDone(action)
        })
        .catch(function (failure) {
          busyState[1](false)
          state[1]({ key: key, hashes: current.hashes, error: failure.message })
        })
    }
    if (action === 'discard') {
      // The confirmation names the CONSEQUENCE, not the action: "discard hunk" is not
      // self-explanatory, "these lines will be reverted" is.
      if (options.confirm) options.confirm(options.t ? options.t('hunk.confirmDiscard') : 'Discard this hunk?', perform)
      else perform()
      return
    }
    perform()
  }

  return {
    hashes: current.hashes,
    actions: actions,
    busy: busyState[0],
    error: current.error,
    act: act,
    reload: load,
    offer: enabled && current.hashes !== null && current.hashes.length > 0,
  }
}

export { useFileHunks }

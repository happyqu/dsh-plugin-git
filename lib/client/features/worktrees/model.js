import { React } from '../../core/runtime.js'
import { readWorktreePreferences, subscribeWorktreePreferences, worktreePathKey } from './preferences.js'
import { getWorktreeContext, subscribeWorktreeContext } from './workspace.js'

export function sameWorktree(a, b) {
  return worktreePathKey(a) === worktreePathKey(b)
}

/** List first, then at most three lightweight status requests concurrently. */
export function useWorktrees(repo, run, enabled, revision) {
  var state = React.useState({ root: null, trees: [], details: {}, loading: true, error: null })
  var selected = React.useState(null), retry = React.useState(0)
  var getMetadata = React.useCallback(function () { return readWorktreePreferences(repo?.commonDir || repo?.root || '') }, [repo?.commonDir, repo?.root])
  var metadata = React.useSyncExternalStore(subscribeWorktreePreferences, getMetadata)
  var context = React.useSyncExternalStore(subscribeWorktreeContext, getWorktreeContext)
  React.useEffect(function () {
    if (!enabled || !repo) return
    var active = true, controller = new AbortController()
    state[1](function (current) { return Object.assign({}, current.root === repo.root ? current : { trees: [], details: {} }, { root: repo.root, loading: true, error: null }) })
    run('worktrees', { root: repo.root }, { silent: true, silentError: true, signal: controller.signal }).then(async function (trees) {
      if (!active) return
      state[1]({ root: repo.root, trees: trees, details: {}, loading: false, error: null })
      selected[1](function (path) { return trees.some(function (tree) { return sameWorktree(tree.path, path) }) ? path : repo.root })
      var cursor = 0
      var worker = async function () {
        while (active && cursor < trees.length) {
          var tree = trees[cursor++]
          if (tree.bare) continue
          var value
          try { value = await run('worktreeDetails', { root: repo.root, directory: tree.path }, { silent: true, silentError: true, signal: controller.signal }) }
          catch (error) { value = { error: error.message } }
          if (active) state[1](function (current) { return Object.assign({}, current, { details: Object.assign({}, current.details, { [tree.path]: value }) }) })
        }
      }
      await Promise.all([worker(), worker(), worker()])
    }).catch(function (error) { if (active) state[1](function (current) { return Object.assign({}, current, { loading: false, error: error.message }) }) })
    return function () { active = false; controller.abort() }
  }, [repo?.root, run, enabled, revision, retry[0]])
  var visible = state[0].root === repo?.root ? state[0] : { trees: [], details: {}, loading: true, error: null }
  return Object.assign({}, visible, { metadata: metadata.entries, context: context, common: repo?.commonDir || repo?.root,
    selected: selected[0], select: selected[1], refresh: function () { retry[1](function (value) { return value + 1 }) } })
}

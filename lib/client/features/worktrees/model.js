import { React } from '../../core/runtime.js'
import { readWorktreePreferences, subscribeWorktreePreferences, worktreePathKey } from './preferences.js'
import { getWorktreeContext, subscribeWorktreeContext } from './workspace.js'

export function sameWorktree(a, b) {
  return worktreePathKey(a) === worktreePathKey(b)
}

/** List first, then at most three lightweight status requests concurrently. */
export function useWorktrees(repo, run, enabled, revision, busy) {
  var state = React.useState({ root: null, trees: [], details: {}, loading: true, error: null })
  var selected = React.useState(null), retry = React.useState(0)
  var getMetadata = React.useCallback(function () { return readWorktreePreferences(repo?.commonDir || repo?.root || '') }, [repo?.commonDir, repo?.root])
  var metadata = React.useSyncExternalStore(subscribeWorktreePreferences, getMetadata)
  var context = React.useSyncExternalStore(subscribeWorktreeContext, getWorktreeContext)
  var busyRef = React.useRef(busy)
  busyRef.current = busy
  React.useEffect(function () {
    if (!enabled || !repo) return
    var active = true, controller = new AbortController(), timer = null, running = false, force = true
    var stamps = new Map()
    var snapshot = state[0].root === repo.root ? state[0] : { trees: [], details: {} }
    var details = Object.assign({}, snapshot.details)
    state[1](Object.assign({}, snapshot, { root: repo.root, loading: true, error: null }))
    var read = function (method, payload) { return run(method, payload, { silent: true, silentError: true, signal: controller.signal }) }
    var schedule = function (delay) {
      clearTimeout(timer)
      if (active && !document.hidden) timer = setTimeout(load, delay)
    }
    var publish = function (trees) {
      if (!active) return
      var next = { root: repo.root, trees: trees, details: Object.assign({}, details), loading: false, error: null }
      state[1](function (previous) { return JSON.stringify(previous) === JSON.stringify(next) ? previous : next })
    }
    var load = async function () {
      if (!active || document.hidden || running) return
      if (busyRef.current) { schedule(1000); return }
      running = true
      var forceRead = force; force = false
      try {
        var trees = await read('worktrees', { root: repo.root })
        if (!active) return
        var paths = new Set(trees.map(function (tree) { return tree.path }))
        Object.keys(details).forEach(function (path) { if (!paths.has(path)) { delete details[path]; stamps.delete(path) } })
        publish(trees)
        selected[1](function (path) { return trees.some(function (tree) { return sameWorktree(tree.path, path) }) ? path : repo.root })
        var cursor = 0
        var worker = async function () {
          while (active && !document.hidden && !busyRef.current && cursor < trees.length) {
            var tree = trees[cursor++]
            if (tree.bare) continue
            var version = await read('repositoryVersion', { root: tree.path }).catch(function () { return null })
            if (!active || document.hidden) return
            if (busyRef.current) { force = true; return }
            var key = version && version.supported !== false ? JSON.stringify([tree, version.generation, version.version]) : null
            var stamp = stamps.get(tree.path)
            if (!forceRead && key && stamp?.key === key && Date.now() - stamp.at < 60000 && details[tree.path] && !details[tree.path].error) continue
            try {
              details[tree.path] = await read('worktreeDetails', { root: repo.root, directory: tree.path })
              stamps.set(tree.path, { key: key, at: Date.now() })
            } catch (error) { details[tree.path] = { error: error.message } }
            publish(trees)
          }
        }
        await Promise.all([worker(), worker(), worker()])
      } catch (error) {
        if (active) state[1](function (current) { return Object.assign({}, current, { loading: false, error: error.message }) })
      } finally { running = false; schedule(force ? 0 : 5000) }
    }
    var resume = function () { force = true; clearTimeout(timer); if (!document.hidden) load() }
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    load()
    return function () {
      active = false; clearTimeout(timer); controller.abort()
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [repo?.root, run, enabled, revision, retry[0]])
  var visible = state[0].root === repo?.root ? state[0] : { trees: [], details: {}, loading: true, error: null }
  return Object.assign({}, visible, { metadata: metadata.entries, context: context, common: repo?.commonDir || repo?.root,
    selected: selected[0], select: selected[1], refresh: function () { retry[1](function (value) { return value + 1 }) } })
}

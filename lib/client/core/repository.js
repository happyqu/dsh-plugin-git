import { usePluginConfig } from './state.js'
import { React } from './runtime.js'

// One leased filesystem-version subscription per repository, shared by the
// toolbar and workbench. Unchanged ticks never launch Git commands.
var repositorySubscriptions = new Map()

var repositorySnapshots = new Map()

function hasCachedRepositoryStatus(root) {
  if (!root) return false
  var normalized = String(root).replace(/\\/g, '/').replace(/\/$/, '')
  return ['basic', 'full'].some(function (level) {
    var record = repositorySnapshots.get(JSON.stringify([normalized, level]))
    return !!record?.key && !!record.value && Date.now() - record.readAt < 60000
  })
}

function summaryStatus(status) {
  return { branch: status.branch, total: status.total ?? status.files?.length ?? 0, operation: status.operation, files: [], summary: true }
}

/** A warm header can paint immediately while the version check runs. */
function cachedRepositorySummary(root) {
  var record = ['summary', 'basic', 'full'].map(function (level) { return repositorySnapshots.get(JSON.stringify([root, level])) })
    .filter(function (item) { return item?.value }).sort(function (a, b) { return b.readAt - a.readAt })[0]
  return record?.value && Date.now() - record.readAt < 60000 ? summaryStatus(record.value.status) : null
}

/** Share reads across the toolbar, workbench and watcher for one version. */
function readRepositorySnapshot(root, call, options) {
  var opts = options || {}, requestedAt = Date.now()
  return (opts.version ? Promise.resolve(opts.version) : call('repositoryVersion', { root: root }).catch(function () { return null }))
    .then(function (version) {
      var key = version ? JSON.stringify([version.generation, version.version]) : null
      var cacheKey = JSON.stringify([root, opts.summary ? 'summary' : opts.basic ? 'basic' : 'full'])
      var record = repositorySnapshots.get(cacheKey)
      if (opts.basic && !opts.force) {
        var full = repositorySnapshots.get(JSON.stringify([root, 'full']))
        if (key && version.supported !== false && full?.key === key && full.value && (!opts.metadata || full.metadata) && Date.now() - full.readAt < 60000) return full.value
      }
      var compatible = record && key && record.key === key && (!opts.metadata || record.metadata)
      if (compatible && record.promise) {
        if (!opts.force || requestedAt <= record.startedAt) return record.promise
        // A mutation may finish while an older read is still in flight.
        return record.promise.catch(function () {}).then(function () { return readRepositorySnapshot(root, call, opts) })
      }
      if (compatible && !opts.force && Date.now() - record.readAt < 60000 && version.supported !== false) return record.value
      record = { key: key, metadata: opts.metadata === true, startedAt: Date.now(), readAt: 0, value: null, promise: null }
      repositorySnapshots.set(cacheKey, record)
      // Closed repositories need no permanent client-side cache.
      if (repositorySnapshots.size > 100) repositorySnapshots.delete(repositorySnapshots.keys().next().value)
      record.promise = Promise.all([
        opts.summary ? call('statusSummary', { root: root, force: true }).catch(function (failure) {
          if (failure.code !== 'git/unknown-method') throw failure
          // A running older Host can still serve the existing status endpoint.
          return call('status', { root: root, force: true }).then(summaryStatus)
        }) : call('status', Object.assign({ root: root, force: true }, opts.basic ? { details: false } : {})),
        opts.metadata ? call('refs', { root: root, force: true }).catch(function () { return null }) : null,
        opts.metadata ? call('branchTracking', { root: root }).catch(function () { return null }) : null,
      ]).then(function (values) {
        record.readAt = Date.now()
        var branch = values[0].branch
        record.value = { status: values[0], refs: values[1], tracking: values[2] || {
          ref: 'HEAD', upstream: branch?.upstream || null, ahead: branch?.ahead || 0, behind: branch?.behind || 0,
        }, version: version }
        return record.value
      }).finally(function () { record.promise = null })
      return record.promise
    })
}

function useRepositoryUpdates(root, enabled, call, busy, receive, previewPath, options) {
  var settings = usePluginConfig(call), fetchState = React.useState(null)
  var latest = React.useRef(null)
  var previewStamp = React.useRef(null)
  latest.current = { call: call, busy: busy, summary: options?.summary === true, metadata: options?.metadata !== false,
    previewPath: previewPath, previewStamp: previewStamp, autoFetch: settings?.autoFetch === true,
    receive: receive, receiveAutoFetch: function (next) {
      fetchState[1](function (previous) { return JSON.stringify(previous || null) === JSON.stringify(next || null) ? previous : next || null })
    } }
  React.useEffect(function () {
    if (!root || !enabled) return
    var entry = repositorySubscriptions.get(root)
    if (!entry) {
      entry = { listeners: new Set(), timer: null, running: false, stopped: false, version: null, lastRead: Date.now(), force: true }
      var schedule = function (delay) {
        clearTimeout(entry.timer)
        if (!entry.stopped && !document.hidden) entry.timer = setTimeout(tick, delay)
      }
      var tick = function () {
        if (entry.stopped || document.hidden || entry.running) return
        var subscribers = Array.from(entry.listeners).map(function (ref) { return ref.current })
        if (!subscribers.length || subscribers.some(function (sub) { return sub.busy })) { schedule(2000); return }
        var rpc = subscribers[0].call, force = entry.force
        entry.force = false; entry.running = true
        Promise.all([
          rpc('repositoryVersion', { root: root, paths: Array.from(new Set(subscribers.map(function (sub) { return sub.previewPath }).filter(Boolean))) }),
          subscribers.some(function (sub) { return sub.autoFetch }) && !entry.autoFetchUnsupported
            ? rpc('write.backgroundFetch', { root: root }).catch(function (error) {
              if (error.code === 'git/unknown-method') entry.autoFetchUnsupported = true
              return entry.autoFetch || null
            }) : null,
        ]).then(function (results) {
          var version = results[0], autoFetch = results[1]
          if (entry.stopped || document.hidden) return
          var previous = entry.version
          var autoCompleted = autoFetch?.lastSuccess && autoFetch.lastSuccess !== entry.autoFetch?.lastSuccess
          entry.autoFetch = autoFetch
          entry.listeners.forEach(function (ref) { ref.current.receiveAutoFetch(autoFetch) })
          var changed = previous && (previous.generation !== version.generation || previous.version !== version.version)
          var contentChanged = previous && previous.generation === version.generation &&
            Number.isFinite(previous.contentVersion) && Number.isFinite(version.contentVersion)
            ? previous.contentVersion !== version.contentVersion : changed
          // Watch events can be missed; periodically verify the file list.
          var fallback = Date.now() - entry.lastRead >= 60000
          var currentSubscribers = Array.from(entry.listeners).map(function (ref) { return ref.current })
          var summary = currentSubscribers.every(function (sub) { return sub.summary })
          var metadata = currentSubscribers.some(function (sub) { return sub.metadata }) && (force || fallback || autoCompleted || !previous || previous.generation !== version.generation || previous.metadataVersion !== version.metadataVersion)
          var previewChanged = force || !!contentChanged || fallback || !previous || !version.supported
          var previewChanges = new Map(), previewStamps = new Map(), fileChanged = false
          entry.listeners.forEach(function (ref) {
            var sub = ref.current, stamp = sub.previewPath && version.previews?.[sub.previewPath]
            if (typeof stamp !== 'string') return
            var last = sub.previewStamp.current
            var changedFile = !!last && last.root === root && last.path === sub.previewPath && last.stamp !== stamp
            previewChanges.set(ref, changedFile)
            previewStamps.set(ref, { root: root, path: sub.previewPath, stamp: stamp })
            fileChanged = fileChanged || changedFile
          })
          if (!force && !changed && !fallback && !autoCompleted && !fileChanged) { entry.version = version; return }
          // Coalesce editor save bursts before taking a status snapshot.
          return new Promise(function (resolve) { setTimeout(resolve, 350) }).then(function () {
            if (entry.stopped || document.hidden || Array.from(entry.listeners).some(function (ref) { return ref.current.busy })) { entry.force = true; return }
            // A workbench can subscribe while the save-burst debounce runs.
            // Select the read level from the current demand, not the old tick.
            summary = Array.from(entry.listeners).every(function (ref) { return ref.current.summary })
            metadata = Array.from(entry.listeners).some(function (ref) { return ref.current.metadata }) && (metadata || entry.force)
            return readRepositorySnapshot(root, rpc, { version: version, summary: summary, metadata: metadata, force: fallback || !!autoCompleted || !version.supported || (!changed && fileChanged) }).then(function (snapshot) {
              if (entry.stopped || document.hidden) return
              entry.version = version; entry.autoFetch = autoFetch; entry.lastRead = Date.now()
              entry.listeners.forEach(function (ref) {
                if (!ref.current.busy) {
                  // Demand may also have changed after the request was sent.
                  // Never let an empty summary erase a complete file list.
                  if (snapshot.status.summary && !ref.current.summary) {
                    entry.force = true; entry.rerun = true
                    return
                  }
                  if (previewStamps.has(ref)) ref.current.previewStamp.current = previewStamps.get(ref)
                  ref.current.receive({ status: snapshot.status, refs: snapshot.refs, tracking: snapshot.tracking, metadata: metadata,
                    previewChanged: previewChanges.has(ref) ? previewChanges.get(ref) : previewChanged,
                    versionChanged: !!contentChanged || !previous || !version.supported })
                }
              })
            })
          })
        }).catch(function () { entry.force = true }).finally(function () {
          entry.running = false
          var delay = entry.rerun ? 0 : entry.force ? 10000 : 2000
          entry.rerun = false; schedule(delay)
        })
      }
      entry.resume = function () {
        clearTimeout(entry.timer)
        if (!document.hidden) { entry.force = true; schedule(300) }
      }
      entry.refresh = function () {
        entry.force = true
        if (entry.running) entry.rerun = true
        else schedule(0)
      }
      document.addEventListener('visibilitychange', entry.resume)
      window.addEventListener('focus', entry.resume)
      repositorySubscriptions.set(root, entry)
      schedule(0)
    }
    entry.listeners.add(latest)
    // A newly opened or restored workbench must not inherit a stale baseline.
    entry.refresh()
    return function () {
      entry.listeners.delete(latest)
      if (entry.listeners.size) return
      entry.stopped = true; clearTimeout(entry.timer)
      document.removeEventListener('visibilitychange', entry.resume)
      window.removeEventListener('focus', entry.resume)
      repositorySubscriptions.delete(root)
    }
  }, [root, enabled, previewPath, options?.summary, options?.metadata])
  return fetchState[0]
}


function stableRepositoryStatus(previous, next) {
  if (!previous) return next
  if (JSON.stringify(previous) === JSON.stringify(next)) return previous
  var files = new Map((previous.files || []).map(function (file) { return [file.path, file] }))
  return Object.assign({}, next, { files: (next.files || []).map(function (file) {
    var old = files.get(file.path)
    return old && JSON.stringify(old) === JSON.stringify(file) ? old : file
  }) })
}

export { cachedRepositorySummary, hasCachedRepositoryStatus, readRepositorySnapshot, stableRepositoryStatus, useRepositoryUpdates }

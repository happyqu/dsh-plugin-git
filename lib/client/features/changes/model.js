import { React } from '../../core/runtime.js'
import { fileListLayout, fileListLayoutListeners, setFileListLayout } from '../../core/preferences.js'
import { allowedChangelistCommitPaths, applyChangelistCommitBlocks } from '../../../shared/changelistCommitPolicy.js'

var changelistListeners = new Set()

var changelistReads = new Map()

// Pending metadata edits affect the view immediately. The persisted version
// stays separate so queued requests and scoped commits still validate it.
function previewChangelist(data, operation) {
  if (!data) return data
  var next = Object.assign({}, data), action = operation.action
  if (action === 'mode') next.mode = operation.mode
  if (action === 'layout') next.fileLayout = operation.layout
  if (action === 'commitBlock') next.lists = data.lists.map(function (list) { return list.id === operation.id ? Object.assign({}, list, { commitBlocked: operation.blocked }) : list })
  if (action === 'reorder' && operation.id !== operation.target) {
    var moved = data.lists.find(function (list) { return list.id === operation.id })
    var ordered = data.lists.filter(function (list) { return list.id !== operation.id })
    var target = ordered.findIndex(function (list) { return list.id === operation.target })
    if (moved && target >= 0) {
      ordered.splice(target + (operation.position === 'after' ? 1 : 0), 0, moved)
      next.lists = ordered
    }
  }
  if (action === 'expand' || action === 'active') {
    next.lists = data.lists.map(function (list) { return list.id === operation.id && action === 'expand' ? Object.assign({}, list, { expanded: operation.expanded }) : list })
  }
  if (action === 'select' || action === 'scope' || action === 'active' || action === 'selectChunk') {
    var paths = new Set(operation.paths || []), selected = new Set(data.selected)
    if (action === 'scope' || action === 'active') {
      next.draftList = operation.id
      if (action === 'active') next.active = operation.id
      selected = new Set(action === 'scope' ? operation.paths : Object.keys(data.assignments).filter(function (path) { return data.assignments[path] === operation.id }))
    } else if (action === 'select') paths.forEach(function (path) { operation.checked ? selected.add(path) : selected.delete(path) })
    next.chunks = Object.assign({}, data.chunks)
    Object.keys(data.chunks || {}).forEach(function (path) {
      var record = data.chunks[path]
      if ((action === 'select' && !paths.has(path)) || (action === 'selectChunk' && operation.path !== path)) return
      next.chunks[path] = Object.assign({}, record, { parts: record.parts.map(function (part) {
        var checked = part.selected
        if (action === 'active' || action === 'scope') checked = part.list === operation.id
        else if (action === 'select' && (!operation.id || part.list === operation.id)) checked = operation.checked === true && !!part.list
        else if (action === 'selectChunk' && part.id === operation.chunk) checked = operation.checked === true && !!part.list
        return checked === part.selected ? part : Object.assign({}, part, { selected: checked })
      }) })
      if (!record.invalid && next.chunks[path].parts.some(function (part) { return part.selected })) selected.add(path)
      else selected.delete(path)
    })
    next.selected = Array.from(selected)
  }
  if (action === 'move' || action === 'moveChunk') {
    next.assignments = Object.assign({}, data.assignments)
    next.chunks = Object.assign({}, data.chunks)
    ;(action === 'move' ? operation.paths || [] : [operation.path]).forEach(function (path) {
      var record = data.chunks?.[path]
      if (record && (operation.from || action === 'moveChunk')) {
        next.chunks[path] = Object.assign({}, record, { parts: record.parts.map(function (part) {
          return (action === 'moveChunk' ? part.id === operation.chunk : part.list === operation.from) ? Object.assign({}, part, { list: operation.id }) : part
        }) })
      } else { next.assignments[path] = operation.id; delete next.chunks[path] }
    })
  }
  return applyChangelistCommitBlocks(next)
}


/** Shared worktree metadata for the workbench and header commit popover. */
function useChangelists(repo, status, call) {
  var root = repo?.root || ''
  var valueState = React.useState(null), errorState = React.useState(null), pendingState = React.useState(0)
  var draftState = React.useState({}), retryState = React.useState(0)
  var optimisticState = React.useState([])
  var layoutState = React.useState(0)
  var reference = React.useRef({ root: root, data: null, queue: Promise.resolve(), alive: true, drafts: {}, timer: null })
  var api = React.useRef(call); api.current = call
  if (reference.current.root !== root) {
    clearTimeout(reference.current.timer)
    reference.current.alive = false
    reference.current = { root: root, data: null, queue: Promise.resolve(), alive: true, drafts: {}, timer: null }
  }
  var context = reference.current
  var accept = function (data) {
    if (!context.alive || reference.current !== context) return
    if (context.data && data.version <= context.data.version) return
    context.data = data; valueState[1]({ root: root, data: data })
  }
  var refresh = function () {
    if (!root) return Promise.resolve()
    var read = changelistReads.get(root)
    if (!read) {
      read = api.current('changelists', { root: root }, { silent: true, silentError: true }).finally(function () {
        if (changelistReads.get(root) === read) changelistReads.delete(root)
      })
      changelistReads.set(root, read)
    }
    return read.then(function (data) {
      accept(data); changelistListeners.forEach(function (listener) { listener(root, context, data) })
    })
  }
  React.useEffect(function () {
    if (!root || !status) return
    var active = true
    refresh().then(function () { if (active) errorState[1](null) })
      .catch(function (error) { if (active) errorState[1](error.message) })
    return function () { active = false }
  }, [root, status, retryState[0]])
  var mutate = function (operation) {
    if (!root || !context.data) return Promise.reject(new Error('改动列表尚未加载'))
    // File layout is a client preference, shared with the history, stash and
    // compare lists. It is never sent to the Host: the value is presentational
    // and a stale Host must not be able to disagree with the panel about it.
    if (operation.action === 'layout') {
      if (operation.layout !== 'tree' && operation.layout !== 'flat') return Promise.reject(new Error('无效的文件布局'))
      setFileListLayout(operation.layout)
      layoutState[1](function (value) { return value + 1 }); errorState[1](null)
      changelistListeners.forEach(function (listener) { listener(root, context, null, operation.layout) })
      return Promise.resolve(Object.assign({}, context.data, { fileLayout: operation.layout }))
    }
    var edit = { context: context, operation: operation }
    if (['expand', 'select', 'scope', 'active', 'selectChunk', 'move', 'moveChunk', 'mode', 'layout'].includes(operation.action)) optimisticState[1](function (edits) { return edits.concat(edit) })
    if (operation.action !== 'draft') pendingState[1](function (value) { return value + 1 })
    var task = context.queue.catch(function () {}).then(function () {
      if (!context.alive) return
      // Flush still waits behind selection edits, but an already persisted
      // message needs no extra RPC before committing the resulting scope.
      if (operation.action === 'draft' && context.data.lists.some(function (list) { return list.id === operation.id && list.draft === operation.text })) {
        if (context.drafts[operation.id] === operation.text) delete context.drafts[operation.id]
        errorState[1](null)
        return context.data
      }
      return api.current('updateChangelist', Object.assign({ root: root, version: context.data.version }, operation),
        { silent: true, silentError: true }).then(function (data) {
          if (operation.action === 'draft' && context.drafts[operation.id] === operation.text) delete context.drafts[operation.id]
          if (!context.alive || reference.current !== context) return data
          accept(data); errorState[1](null)
          changelistListeners.forEach(function (listener) { listener(root, context, data) })
          return data
        })
    }).catch(function (error) {
      if (context.alive && reference.current === context) {
        errorState[1](error.message); refresh().catch(function () {})
      }
      throw error
    }).finally(function () {
      if (context.alive && reference.current === context) optimisticState[1](function (edits) { return edits.filter(function (entry) { return entry !== edit }) })
      if (operation.action !== 'draft' && context.alive && reference.current === context) pendingState[1](function (value) { return Math.max(0, value - 1) })
    })
    context.queue = task
    return task
  }
  React.useEffect(function () {
    context.alive = true
    pendingState[1](0); errorState[1](null)
    var listener = function (changedRoot, origin, data, layout) {
      if (changedRoot !== root || origin === context) return
      if (layout) layoutState[1](function (value) { return value + 1 })
      else if (data) accept(data)
    }
    changelistListeners.add(listener)
    return function () {
      clearTimeout(context.timer); context.alive = false; changelistListeners.delete(listener)
      var invoke = api.current, drafts = Object.assign({}, context.drafts)
      // Closing a popover or switching repositories must not lose the last
      // keystrokes that have not reached the debounce timer yet.
      context.queue.catch(function () {}).then(async function () {
        var latest = context.data
        if (!latest || !root) return
        for (var id of Object.keys(drafts)) {
          if (latest.lists.some(function (list) { return list.id === id && list.draft !== drafts[id] })) {
            latest = await invoke('updateChangelist', { root: root, version: latest.version, action: 'draft', id: id, text: drafts[id] }, { silent: true, silentError: true })
          }
        }
      }).catch(function () {})
    }
  }, [root])
  var persisted = valueState[0]?.root === root ? valueState[0].data : null
  // The shared layout store is a module-level value, so a change made in the
  // history list has to be able to re-render this one: `layoutState` is the
  // subscription that makes that happen.
  React.useEffect(function () {
    var listener = function () { layoutState[1](function (value) { return value + 1 }) }
    fileListLayoutListeners.add(listener)
    return function () { fileListLayoutListeners.delete(listener) }
  }, [])
  var data = React.useMemo(function () {
    var value = optimisticState[0].reduce(function (value, edit) { return edit.context === context ? previewChangelist(value, edit.operation) : value }, persisted)
    return value ? Object.assign({}, value, { fileLayout: fileListLayout(value.fileLayout, root) }) : null
  }, [persisted, optimisticState[0], context, layoutState[0], root])
  var current = data?.lists.find(function (list) { return list.id === (data.draftList || data.active) })
  var message = current ? Object.prototype.hasOwnProperty.call(context.drafts, current.id) ? context.drafts[current.id] : current.draft : ''
  var saveDraft = function (id, text) {
    clearTimeout(context.timer)
    return mutate({ action: 'draft', id: id, text: text })
  }
  var setMessage = function (text) {
    if (!current) return
    context.drafts[current.id] = text
    draftState[1](Object.assign({}, context.drafts))
    clearTimeout(context.timer)
    var id = current.id
    context.timer = setTimeout(function () { saveDraft(id, text).catch(function () {}) }, 400)
  }
  // The commit SCOPE, derived from one place. `pathsFor` exists so the commit
  // can recompute the scope from the data its `flush()` just returned instead
  // of trusting the `paths` captured at render time: a selection write that is
  // still in flight (or that failed) makes the captured value stale, and
  // committing that stale scope would include a file the user did not select.
  var pathsFor = function (target) {
    var valid = new Set((status?.files || []).filter(function (file) { return file.kind !== 'unmerged' }).map(function (file) { return file.path }))
    return allowedChangelistCommitPaths(target).filter(function (path) { return valid.has(path) })
  }
  return { data: data, mode: data?.mode || 'lists', loading: !data, error: errorState[0], pending: pendingState[0] > 0,
    message: message, setMessage: setMessage, mutate: mutate, retry: function () { retryState[1](function (value) { return value + 1 }) },
    flush: function () { return current ? saveDraft(current.id, message) : Promise.reject(new Error('改动列表尚未加载')) },
    pathsFor: pathsFor,
    paths: React.useMemo(function () { return pathsFor(data) }, [data, status]),
  }
}


function changelistHasFile(data, id, path) {
  var record = data.chunks?.[path]
  return record ? record.parts.some(function (part) { return part.list === id || (!part.list && data.assignments[path] === id) })
    : data.assignments[path] === id
}

function changelistSelection(data, id, files) {
  var checked = [], mixed = [], included = new Set(data.selected)
  if (data.lists.some(function (list) { return list.id === id && list.commitBlocked === true })) return { checked: checked, mixed: mixed }
  files.forEach(function (file) {
    var record = data.chunks?.[file.path]
    if (!record) { if (included.has(file.path)) checked.push(file.path); return }
    var parts = record.parts.filter(function (part) { return part.list === id || (!part.list && data.assignments[file.path] === id) })
    var selected = parts.filter(function (part) { return part.selected }).length
    if (!record.invalid && selected === parts.length && parts.length) checked.push(file.path)
    else if (selected) mixed.push(file.path)
  })
  return { checked: checked, mixed: mixed }
}

export { changelistHasFile, changelistSelection, useChangelists }

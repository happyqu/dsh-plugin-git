import { React, ReactDOM, h } from '../../core/runtime.js'
import { IconFolder } from '../../ui/icons.js'
import { useDialogFocus } from '../../ui/controls.js'
import { chooseDirectory } from './picker-source.js'
import { cloneDestinationProblem } from './model.js'
import { cloneStyles } from './styles.js'

/** How long this page must hold the foreground before the recovery dialog earns its place. */
var PICKER_GRACE = 2000

/** Whether this page is the window the operator is actually looking at. */
function pageIsForeground() {
  if (typeof document === 'undefined' || document === null) return true
  if (document.hidden === true) return false
  return typeof document.hasFocus !== 'function' || document.hasFocus() !== false
}

/**
 * Call `onReveal` once this page has clearly been the foreground for a while.
 *
 * A native panel steals focus the moment it opens and hands it back when it
 * answers, so “still focused after the grace period” is the only cheap evidence
 * that no panel is coming at all: a remote or headless Host, or a wedged
 * `osascript`. Every blur restarts the period, which is what keeps the recovery
 * dialog from popping up over a panel the operator is still browsing in, and
 * from flashing into view in the instant a cancelled panel returns focus.
 *
 * @param onReveal - called when the page has held the foreground.
 * @returns a function releasing the timer and the listeners.
 */
function watchForeground(onReveal) {
  var grace = null
  var arm = function () {
    if (grace !== null) clearTimeout(grace)
    grace = setTimeout(function () { grace = null; if (pageIsForeground()) onReveal() }, PICKER_GRACE)
  }
  var cancel = function () { if (grace !== null) { clearTimeout(grace); grace = null } }
  var resumed = function () { if (grace === null) arm() }
  window.addEventListener('blur', cancel)
  window.addEventListener('focus', resumed)
  document.addEventListener('visibilitychange', resumed)
  arm()
  return function () {
    cancel()
    window.removeEventListener('blur', cancel)
    window.removeEventListener('focus', resumed)
    document.removeEventListener('visibilitychange', resumed)
  }
}

/** One picker per activation; use only DSH's public workspace service. */
export function createHostDirectoryPicker(navigation, t) {
  var value = null, listeners = new Set(), busy = false, disposed = false, sequence = 0
  var publish = function (next) { value = next; listeners.forEach(function (listener) { listener() }) }
  var finish = function (path) {
    var current = value
    // Settle the selection before aborting the competing native request.
    current?.resolve(path); current?.controller?.abort(); publish(null)
  }
  return {
    getSnapshot: function () { return value },
    subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener) } },
    choose: finish,
    list: function (path, signal) { return navigation.listDirectory(path, signal) },
    create: function (path, name) { return navigation.createDirectory(path, name) },
    pick: async function () {
      if (busy || disposed) throw new Error(t('clone.pickerBusy'))
      busy = true
      var controller = new AbortController(), request
      var selection = new Promise(function (resolve, reject) {
        request = { id: ++sequence, waiting: true, controller: controller,
          resolve: function (path) { resolve({ path: path }) }, reject: reject }
      })
      publish(request)
      try {
        var outcome = await Promise.race([chooseDirectory({
          signal: controller.signal,
          native: function () { return navigation.pickDirectory() },
          // Native-only Hosts cannot browse; browse-only Hosts reject pick()
          // but serve listDirectory().
          browse: function () { return navigation.listDirectory() },
        }), selection])
        if (outcome.path !== undefined) return outcome.path
        if (disposed) throw new Error(t('clone.pickerClosed'))
        request.waiting = false; request.listing = outcome.listing
        publish(Object.assign({}, request))
        return (await selection).path
      } finally { controller.abort(); publish(null); busy = false }
    },
    dispose: function () {
      disposed = true
      var current = value; publish(null)
      current?.reject(new Error(t('clone.pickerClosed')))
      current?.controller?.abort()
    },
  }
}

export function HostDirectoryPicker(props) {
  var request = React.useSyncExternalStore(props.picker.subscribe, props.picker.getSnapshot)
  // Keyed by the request, so a second pick starts from an unrevealed dialog with
  // an empty path field rather than inheriting what the last one left behind.
  return request ? h(request.waiting ? WaitingDirectoryPicker : DirectoryBrowser, { key: request.id, picker: props.picker, request: request, t: props.t }) : null
}

/** The native picker may never answer; keep a way to cancel or enter a path. */
function WaitingDirectoryPicker(props) {
  var t = props.t, ref = React.useRef(null), path = React.useState('')
  var revealed = React.useState(false)
  var close = function () { props.picker.choose(null) }
  useDialogFocus(ref, close)
  React.useEffect(function () {
    var active = true
    var release = watchForeground(function () { if (active) revealed[1](true) })
    return function () { active = false; release() }
  }, [])
  // The panel may appear long after this component mounted, so the focus trap's
  // one-shot effect already ran with no panel to place the caret in. Move it in
  // on reveal: Escape and Tab only reach the trap once focus is inside.
  React.useEffect(function () {
    if (revealed[0]) ref.current?.querySelector?.('input')?.focus?.()
  }, [revealed[0]])
  var problem = cloneDestinationProblem(path[0], 'selected')
  // The panel is the escape hatch for a chooser that never arrives, so it waits
  // for evidence of one. Until then the screen is left to the native window, and
  // Escape or that window's own answer still settles the request.
  if (!revealed[0]) return null
  return ReactDOM.createPortal(h('div', { className: 'dshgit dshgit-scrim dshgit-clone-scrim dshgit-picker-scrim', style: { zIndex: 1600 }, onClick: close },
    h('form', { className: 'dshgit-clone-dialog dshgit-clone-form dshgit-picker-reveal', ref: ref, tabIndex: -1, role: 'dialog', 'aria-modal': true,
      'aria-label': t('clone.choose'), onClick: function (event) { event.stopPropagation() },
      onSubmit: function (event) { event.preventDefault(); if (problem === null) props.picker.choose(path[0].trim()) } }, [
      h('style', { key: 'style' }, cloneStyles),
      h('h2', { key: 'title' }, t('clone.choose')),
      h('p', { key: 'waiting', role: 'status' }, t('clone.pickerWaiting')),
      h('label', { key: 'path' }, [t('clone.path'), h('input', { key: 'input', value: path[0], placeholder: t('clone.pathHint'),
        onChange: function (event) { path[1](event.target.value) } })]),
      path[0].trim() && problem !== null ? h('p', { key: 'problem', className: 'dshgit-clone-problem', role: 'status' }, t(problem)) : null,
      h('div', { key: 'actions', className: 'dshgit-clone-actions' }, [
        h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', onClick: close }, t('action.cancel')),
        h('button', { key: 'use', type: 'submit', className: 'dshgit-btn dshgit-btn-primary', disabled: problem !== null }, t('clone.useDirectory')),
      ]),
    ])), document.body)
}

function DirectoryBrowser(props) {
  var t = props.t, ref = React.useRef(null), active = React.useRef(true), controller = React.useRef(null), pending = React.useRef(false)
  var cancelRef = React.useRef(null)
  var listing = React.useState(props.request.listing), path = React.useState(props.request.listing.path)
  var loading = React.useState(false), error = React.useState(null), hidden = React.useState(false), folder = React.useState(null)
  var close = function () {
    if (!active.current) return
    // Withdraw before aborting: a late list/create result must not update the
    // dialog or start another read while React is unmounting it.
    active.current = false
    controller.current?.abort()
    props.picker.choose(null)
  }
  useDialogFocus(ref, close)
  React.useEffect(function () { active.current = true; return function () { active.current = false; controller.current?.abort() } }, [])
  var load = async function (target, createName) {
    if (pending.current || !active.current) return
    pending.current = true; loading[1](true); error[1](null)
    // The clicked folder/path control becomes disabled. Keep focus in the
    // dialog on its available action so Escape still reaches the focus trap.
    cancelRef.current?.focus()
    controller.current = new AbortController()
    try {
      if (createName !== undefined) target = await props.picker.create(listing[0].path, createName)
      if (!active.current) return
      var next = await props.picker.list(target, controller.current.signal)
      if (active.current) { listing[1](next); path[1](next.path); folder[1](null) }
    } catch (failure) { if (active.current) error[1](failure.message) }
    finally { pending.current = false; if (active.current) loading[1](false) }
  }
  return ReactDOM.createPortal(h('div', { className: 'dshgit dshgit-scrim dshgit-clone-scrim dshgit-picker-scrim', style: { zIndex: 1600 }, onClick: close }, [
    h('style', { key: 'style' }, cloneStyles),
    h('div', { key: 'dialog', className: 'dshgit-clone-dialog dshgit-directory-browser dshgit-picker-reveal', ref: ref, tabIndex: -1, role: 'dialog',
      'aria-modal': true, 'aria-label': t('clone.choose'), onClick: function (event) { event.stopPropagation() } }, [
      h('h2', { key: 'title' }, t('clone.choose')),
      h('form', { key: 'path', className: 'dshgit-clone-directory', onSubmit: function (event) { event.preventDefault(); if (path[0].trim()) load(path[0].trim()) } }, [
        h('input', { key: 'input', 'aria-label': t('clone.path'), value: path[0], disabled: loading[0], onChange: function (event) { path[1](event.target.value) } }),
        h('button', { key: 'go', type: 'submit', className: 'dshgit-btn', disabled: loading[0] || !path[0].trim() }, t('clone.go')),
      ]),
      h('nav', { key: 'crumbs', className: 'dshgit-directory-crumbs', 'aria-label': t('clone.ancestors') }, listing[0].crumbs.map(function (crumb) {
        return h('button', { key: crumb.path, type: 'button', className: 'dshgit-btn', disabled: loading[0], onClick: function () { load(crumb.path) } }, crumb.name)
      })),
      h('div', { key: 'folders', className: 'dshgit-directory-list', 'aria-busy': loading[0] }, listing[0].entries.filter(function (entry) { return hidden[0] || !entry.hidden }).map(function (entry) {
        return h('button', { key: entry.path, type: 'button', disabled: loading[0], onClick: function () { load(entry.path) } }, [h(IconFolder, { key: 'icon', size: 16 }), entry.name])
      })),
      listing[0].truncated ? h('p', { key: 'truncated' }, t('clone.truncated')) : null,
      h('div', { key: 'options', className: 'dshgit-directory-options' }, [
        h('label', { key: 'hidden' }, [h('input', { key: 'input', type: 'checkbox', checked: hidden[0], onChange: function (event) { hidden[1](event.target.checked) } }), t('clone.showHidden')]),
        h('button', { key: 'new', type: 'button', className: 'dshgit-btn', disabled: loading[0], onClick: function () { folder[1](folder[0] === null ? '' : null) } }, t('clone.newFolder')),
      ]),
      folder[0] !== null ? h('form', { key: 'create', className: 'dshgit-clone-directory', onSubmit: function (event) { event.preventDefault(); if (folder[0].trim()) load(null, folder[0].trim()) } }, [
        h('input', { key: 'name', 'aria-label': t('clone.folder'), value: folder[0], disabled: loading[0], onChange: function (event) { folder[1](event.target.value) } }),
        h('button', { key: 'create', type: 'submit', className: 'dshgit-btn', disabled: loading[0] || !folder[0].trim() }, t('clone.createFolder')),
      ]) : null,
      error[0] ? h('div', { key: 'error', role: 'alert' }, error[0]) : null,
      h('div', { key: 'actions', className: 'dshgit-clone-actions' }, [
        h('button', { key: 'cancel', ref: cancelRef, type: 'button', className: 'dshgit-btn', onClick: close }, t('action.cancel')),
        h('button', { key: 'choose', type: 'button', className: 'dshgit-btn dshgit-btn-primary', disabled: loading[0] || path[0] !== listing[0].path,
          onClick: function () { if (!pending.current) props.picker.choose(listing[0].path) } }, t('clone.useDirectory')),
      ]),
    ]),
  ]), document.body)
}

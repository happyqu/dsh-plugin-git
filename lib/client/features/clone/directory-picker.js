import { React, ReactDOM, h } from '../../core/runtime.js'
import { IconFolder } from '../../ui/icons.js'
import { useDialogFocus } from '../../ui/controls.js'
import { cloneStyles } from './styles.js'

/** One picker per activation; use only DSH's public workspace service. */
export function createHostDirectoryPicker(navigation, t) {
  var value = null, listeners = new Set(), busy = false, disposed = false
  var publish = function (next) { value = next; listeners.forEach(function (listener) { listener() }) }
  var finish = function (path) { var current = value; publish(null); current?.resolve(path) }
  return {
    getSnapshot: function () { return value },
    subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener) } },
    choose: finish,
    list: function (path, signal) { return navigation.listDirectory(path, signal) },
    create: function (path, name) { return navigation.createDirectory(path, name) },
    pick: async function () {
      if (busy || disposed) throw new Error(t('clone.pickerBusy'))
      busy = true
      try {
        try { return await navigation.pickDirectory() }
        catch (nativeFailure) {
          // Native-only Hosts cannot browse; keep their original picker error.
          // Browse-only Hosts reject pick() but serve listDirectory().
          var listing
          try { listing = await navigation.listDirectory() }
          catch (browseFailure) { throw nativeFailure }
          if (disposed) throw new Error(t('clone.pickerClosed'))
          return await new Promise(function (resolve, reject) { publish({ listing: listing, resolve: resolve, reject: reject }) })
        }
      } finally { busy = false }
    },
    dispose: function () {
      disposed = true
      var current = value; publish(null)
      current?.reject(new Error(t('clone.pickerClosed')))
    },
  }
}

export function HostDirectoryPicker(props) {
  var request = React.useSyncExternalStore(props.picker.subscribe, props.picker.getSnapshot)
  return request ? h(DirectoryBrowser, { picker: props.picker, request: request, t: props.t }) : null
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
  return ReactDOM.createPortal(h('div', { className: 'dshgit dshgit-scrim dshgit-clone-scrim', style: { zIndex: 1600 }, onClick: close }, [
    h('style', { key: 'style' }, cloneStyles),
    h('div', { key: 'dialog', className: 'dshgit-clone-dialog dshgit-directory-browser', ref: ref, tabIndex: -1, role: 'dialog',
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

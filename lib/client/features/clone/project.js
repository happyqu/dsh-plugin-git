import { React, ReactDOM, h } from '../../core/runtime.js'
import { callRpc } from '../../core/rpc.js'
import { useDialogFocus } from '../../ui/controls.js'
import { cloneDestination } from './model.js'
import { cloneStyles } from './styles.js'

export function NewProjectEntry(props) {
  var open = React.useSyncExternalStore(props.request.subscribe, props.request.getSnapshot)
  return open ? h(NewProjectDialog, props) : null
}

/** The request outlives the form, so Back/remount cannot reorder Host writes. */
function queueProjectPreference(request, task) {
  var next = (request.preferenceQueue || Promise.resolve()).then(task)
  request.preferenceQueue = next.catch(function () {})
  return next
}

function NewProjectDialog(props) {
  var t = props.t, draft = props.request.draft, ref = React.useRef(null), alive = React.useRef(true), pending = React.useRef(false)
  var parent = React.useState(draft.parent || ''), name = React.useState(draft.name || '')
  var loading = React.useState(true), busy = React.useState(false), error = React.useState(null), directory = React.useState(draft.directory || '')
  var hostReady = React.useState(false), reloadHost = React.useState(false)
  var workspace = React.useRef(draft.workspace || null), identity = React.useRef(draft.identity || null)
  var call = function (method, payload) { return callRpc(props.connection, method, payload) }
  var close = function () { if (!pending.current) props.onClose() }
  useDialogFocus(ref, close)
  var hostFailure = function (failure) {
    if (failure.code === 'git/unknown-method') {
      hostReady[1](false); reloadHost[1](true); error[1](null)
    } else error[1](failure.message)
  }
  var checkHost = function () {
    loading[1](true); error[1](null)
    return queueProjectPreference(props.request, function () { return call('projectPreferences') }).then(function (saved) {
      if (!alive.current) return
      hostReady[1](true); reloadHost[1](false)
      if (draft.parent === undefined) { parent[1](saved.parent); draft.parent = saved.parent }
      if (draft.name === undefined) { name[1](saved.name); draft.name = saved.name }
    }).catch(function (failure) { if (alive.current) hostFailure(failure) })
      .finally(function () { if (alive.current) loading[1](false) })
  }
  React.useEffect(function () {
    alive.current = true
    checkHost()
    return function () { alive.current = false }
  }, [])
  var remember = function (patch) {
    if (!hostReady[0]) return Promise.resolve()
    return queueProjectPreference(props.request, function () { return call('projectPreferences', patch) })
      .catch(function (failure) { if (alive.current) hostFailure(failure) })
  }
  var pick = async function () {
    if (pending.current || loading[0]) return
    pending.current = true; busy[1](true); error[1](null)
    try {
      var value = await props.picker.pick()
      if (alive.current && value) { parent[1](value); draft.parent = value; await remember({ parent: value }) }
    } catch (failure) { if (alive.current) error[1](failure.message) }
    finally { pending.current = false; if (alive.current) busy[1](false) }
  }
  var target = cloneDestination(parent[0], name[0].trim())
  var submit = async function (event) {
    event.preventDefault()
    if (pending.current || loading[0] || (!directory[0] && (!hostReady[0] || !target))) return
    pending.current = true; busy[1](true); error[1](null)
    try {
      var path = directory[0]
      if (!path) {
        var signature = JSON.stringify([parent[0].trim(), name[0].trim()])
        if (identity.current?.signature !== signature) identity.current = { signature: signature,
          requestId: globalThis.crypto?.randomUUID?.() || 'project-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) }
        draft.identity = identity.current
        var created = await queueProjectPreference(props.request, function () {
          return call('createProject', { parent: parent[0], name: name[0], requestId: identity.current.requestId })
        })
        path = created.directory; draft.directory = path
        if (!alive.current) return
        directory[1](path)
      }
      if (!workspace.current) { workspace.current = await props.workspaces.create({ path: path }); draft.workspace = workspace.current }
      if (!alive.current) return
      await props.navigation.openWorkspace(workspace.current.workspaceId)
      if (alive.current) { props.request.draft = {}; props.onClose() }
    } catch (failure) { if (alive.current) hostFailure(failure) }
    finally { pending.current = false; if (alive.current) busy[1](false) }
  }
  var disabled = loading[0] || busy[0] || !!directory[0]
  return ReactDOM.createPortal(h('div', { className: 'dshgit dshgit-scrim dshgit-clone-scrim', style: { zIndex: 1500 }, onClick: close }, [
    h('style', { key: 'style' }, cloneStyles),
    h('form', { key: 'dialog', className: 'dshgit-clone-dialog', ref: ref, tabIndex: -1, role: 'dialog', 'aria-modal': true,
      'aria-label': t('project.title'), onSubmit: submit, onClick: function (event) { event.stopPropagation() } }, [
      h('h2', { key: 'title' }, t('project.title')),
      h('p', { key: 'hint' }, t('project.hint')),
      h('div', { key: 'parent', className: 'dshgit-clone-field' }, [
        h('label', { key: 'label', htmlFor: 'dshgit-project-parent' }, t('clone.parent')),
        h('div', { key: 'row', className: 'dshgit-clone-directory' }, [
          h('input', { key: 'input', id: 'dshgit-project-parent', value: parent[0], disabled: disabled, required: true, placeholder: t('clone.pathHint'),
            onChange: function (event) { parent[1](event.target.value); draft.parent = event.target.value },
            onBlur: function (event) { remember({ parent: event.target.value }) } }),
          h('button', { key: 'pick', type: 'button', className: 'dshgit-btn', disabled: disabled, onClick: pick }, t('clone.choose')),
        ]),
      ]),
      h('label', { key: 'name' }, [t('project.folder'), h('input', { key: 'input', value: name[0], disabled: disabled, required: true,
        onChange: function (event) { name[1](event.target.value); draft.name = event.target.value },
        onBlur: function (event) { remember({ name: event.target.value }) } })]),
      target ? h('p', { key: 'target', className: 'dshgit-project-target' }, target) : null,
      reloadHost[0] ? h('p', { key: 'host', role: 'status' }, t('project.reloadHost')) : null,
      error[0] ? h('div', { key: 'error', role: 'alert' }, error[0]) : null,
      h('div', { key: 'actions', className: 'dshgit-clone-actions' }, [
        h('button', { key: 'back', type: 'button', className: 'dshgit-btn dshgit-step-back', disabled: busy[0],
          onClick: function () { if (!pending.current) props.onBack() } }, t('workspace.back')),
        h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', disabled: busy[0], onClick: close }, t('action.cancel')),
        !hostReady[0] && !directory[0] ? h('button', { key: 'check', type: 'button', className: 'dshgit-btn', disabled: loading[0] || busy[0], onClick: checkHost }, t('project.checkHost')) : null,
        h('button', { key: 'submit', type: 'submit', className: 'dshgit-btn dshgit-btn-primary', disabled: loading[0] || busy[0] || (!directory[0] && (!hostReady[0] || !target)) },
          t(busy[0] ? directory[0] ? 'clone.opening' : 'project.creating' : directory[0] ? 'clone.open' : 'project.create')),
      ]),
    ]),
  ]), document.body)
}

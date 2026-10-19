import { React, h } from '../../core/runtime.js'
import { callRpc } from '../../core/rpc.js'
import { useDialogFocus } from '../../ui/controls.js'
import { cloneDestination, cloneFolderName, cloneWorkspace } from './model.js'
import { cloneStyles } from './styles.js'

/** Dialog state belongs to the plugin's root lifetime, not the menu occurrence. */
export function CloneWorkspaceEntry(props) {
  var open = React.useSyncExternalStore(props.request.subscribe, props.request.getSnapshot)
  return h(React.Fragment, null, [
    h('style', { key: 'style' }, cloneStyles),
    open ? h(CloneWorkspaceDialog, Object.assign({ key: 'dialog', onClose: function () { props.request.set(false) } }, props)) : null,
  ])
}

/** Persist the draft explicitly across closing/reopening an uncertain task. */
function useDraftField(draft, name, initial) {
  var state = React.useState(draft[name] === undefined ? initial : draft[name])
  return [state[0], function (value) { draft[name] = value; state[1](value) }]
}

function CloneWorkspaceDialog(props) {
  var draft = props.request.draft || (props.request.draft = {})
  var t = props.t, ref = React.useRef(null), pending = React.useRef(false), mounted = React.useRef(true), touched = React.useRef(draft.touched || false)
  var address = useDraftField(draft, 'address', ''), parent = useDraftField(draft, 'parent', ''), folder = useDraftField(draft, 'folder', '')
  var busy = React.useState(false), job = useDraftField(draft, 'job', null), result = useDraftField(draft, 'result', null), error = React.useState(null)
  var workspace = React.useRef(draft.workspace || null)
  var close = function () { if (!pending.current) props.onClose() }
  useDialogFocus(ref, close)
  React.useEffect(function () { mounted.current = true; return function () { mounted.current = false } }, [])
  var call = function (method, payload) { return callRpc(props.connection, method, payload) }
  var directory = cloneDestination(parent[0], folder[0])
  var locked = busy[0] || job[0]?.state === 'running'
  var enterWorkspace = async function (value) {
    if (!workspace.current) { workspace.current = await props.workspaces.create({ path: value.directory }); draft.workspace = workspace.current }
    if (!mounted.current) return
    await props.navigation.openWorkspace(workspace.current.workspaceId)
    if (mounted.current) { props.request.draft = {}; props.onClose() }
  }
  var submit = async function (event) {
    event.preventDefault()
    if (result[0]) { await openWorkspace(); return }
    if (pending.current || !directory || !address[0].trim()) return
    pending.current = true; busy[1](true); error[1](null)
    try {
      var value = await cloneWorkspace(call, { url: address[0].trim(), directory: directory }, job[1], function () { return mounted.current }, job[0]?.state === 'running' ? job[0] : null)
      if (mounted.current && value) {
        result[1](value)
        await enterWorkspace(value)
      }
    } catch (failure) {
      if (mounted.current) error[1](failure.code === 'git/unknown-method' || (failure.code === 'git/bad-request' && failure.message.split(/\r?\n/)[0] === '此操作不支持后台执行')
        ? t('clone.reload') : ['clone.cancelled', 'clone.failed'].includes(failure.message) ? t(failure.message) : failure.message)
    } finally {
      if (mounted.current) { pending.current = false; busy[1](false) }
    }
  }
  var openWorkspace = async function () {
    if (pending.current) return
    pending.current = true; busy[1](true); error[1](null)
    try {
      await enterWorkspace(result[0])
    } catch (failure) { if (mounted.current) error[1](failure.message) }
    finally { if (mounted.current) { pending.current = false; busy[1](false) } }
  }
  var pick = async function () {
    if (pending.current) return
    pending.current = true; busy[1](true); error[1](null)
    try { var path = await props.navigation.pickDirectory(); if (mounted.current && path) parent[1](path) }
    catch (failure) { if (mounted.current) error[1](failure.message) }
    finally { if (mounted.current) { pending.current = false; busy[1](false) } }
  }
  return h('div', { className: 'dshgit dshgit-scrim dshgit-clone-scrim', style: { zIndex: 1500 }, onClick: close },
    h('form', { className: 'dshgit-clone-dialog', ref: ref, tabIndex: -1, role: 'dialog', 'aria-modal': true,
      'aria-label': t('clone.entry'), onClick: function (event) { event.stopPropagation() }, onSubmit: submit }, [
      h('h2', { key: 'title' }, t('clone.entry')),
      h('p', { key: 'hint' }, t('clone.hint')),
      !result[0] ? h(React.Fragment, { key: 'fields' }, [
        h('label', { key: 'url' }, [t('clone.url'), h('input', { key: 'input', value: address[0], disabled: locked, required: true,
          placeholder: 'https://github.com/owner/repository.git', onChange: function (event) {
            var value = event.target.value; address[1](value); if (!touched.current) folder[1](cloneFolderName(value))
          } })]),
        h('div', { key: 'parent', className: 'dshgit-clone-field' }, [h('label', { key: 'label', htmlFor: 'dshgit-clone-parent' }, t('clone.parent')), h('div', { key: 'row', className: 'dshgit-clone-directory' }, [
          h('input', { key: 'input', id: 'dshgit-clone-parent', value: parent[0], disabled: locked, required: true, placeholder: t('clone.pathHint'),
            onChange: function (event) { parent[1](event.target.value) } }),
          h('button', { key: 'pick', type: 'button', className: 'dshgit-btn', disabled: locked, onClick: pick }, t('clone.choose')),
        ])]),
        h('label', { key: 'folder' }, [t('clone.folder'), h('input', { key: 'input', value: folder[0], disabled: locked, required: true,
          onChange: function (event) { touched.current = true; draft.touched = true; folder[1](event.target.value) } })]),
        directory ? h('p', { key: 'destination', title: directory, style: { overflowWrap: 'anywhere' } }, directory) : null,
      ]) : null,
      job[0] || result[0] ? h('div', { key: 'progress', className: 'dshgit-clone-status', role: 'status' }, [
        h('span', { key: 'label' }, t(result[0] ? busy[0] ? 'clone.opening' : 'clone.complete' : job[0]?.state === 'running' ? 'clone.running' : 'clone.stopped')),
        result[0] ? h('pre', { key: 'path' }, result[0].directory) : job[0]?.progress ? h('pre', { key: 'output' }, job[0].progress) : null,
      ]) : null,
      error[0] ? h('div', { key: 'error', role: 'alert' }, error[0]) : null,
      error[0] && job[0]?.state === 'running' && !busy[0] ? h('p', { key: 'uncertain' }, t('clone.uncertain')) : null,
      h('div', { key: 'actions', className: 'dshgit-clone-actions' }, [
        props.onBack ? h('button', { key: 'back', type: 'button', className: 'dshgit-btn dshgit-step-back', disabled: busy[0],
          onClick: function () { if (!pending.current) props.onBack() } }, t('workspace.back')) : null,
        h('button', { key: 'close', type: 'button', className: 'dshgit-btn', disabled: busy[0], onClick: close }, t('action.close')),
        job[0]?.state === 'running' ? h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', onClick: function () {
          call('operationCancel', { root: job[0].root, id: job[0].id, requestId: job[0].requestId }).then(function () { if (!pending.current && mounted.current) submit({ preventDefault: function () {} }) })
            .catch(function (failure) { if (mounted.current) error[1](failure.message) })
        } }, t('clone.cancel')) : null,
        result[0] ? h('button', { key: 'open', type: 'button', className: 'dshgit-btn dshgit-btn-primary', disabled: busy[0], onClick: openWorkspace }, t(busy[0] ? 'clone.opening' : 'clone.open'))
          : h('button', { key: 'submit', type: 'submit', className: 'dshgit-btn dshgit-btn-primary', disabled: busy[0] || !directory || !address[0].trim() }, t(busy[0] ? 'clone.running' : job[0]?.state === 'running' ? 'clone.resume' : 'clone.start')),
      ]),
    ]))
}

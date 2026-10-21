import { React, h } from '../../core/runtime.js'
import { useDialogFocus } from '../../ui/controls.js'
import { worktreeWorkspace } from './workspace.js'

export function WorktreeManagementDialog(props) {
  var t = props.t, request = props.request, panel = React.useRef(null), pending = React.useRef(false), alive = React.useRef(true)
  var reason = React.useState(''), destination = React.useState(''), preview = React.useState(null), error = React.useState(null), busy = React.useState(false)
  var close = function () { if (!pending.current) props.onClose() }
  useDialogFocus(panel, close)
  React.useEffect(function () { alive.current = true; return function () { alive.current = false } }, [])
  var parameters = { action: request.action, directory: request.tree?.path, reason: reason[0], destination: destination[0] }
  var signature = JSON.stringify(parameters), ready = preview[0]?.signature === signature
  var pathAction = ['move', 'repair'].includes(request.action)
  var act = async function (execute) {
    if (pending.current) return
    pending.current = true; busy[1](true); error[1](null)
    try {
      if (execute) {
        if (!ready || preview[0].value.empty) return
        await props.onWrite(Object.assign({}, parameters, { token: preview[0].value.token, confirm: true }))
        if (alive.current) props.onClose()
      } else {
        var value = await props.run('worktreeManagementPreview', Object.assign({ root: props.repo.root }, parameters), { silentError: true })
        if (alive.current) preview[1]({ signature: signature, value: value })
      }
    } catch (failure) { if (alive.current) { error[1](failure.message); preview[1](null) } }
    finally { pending.current = false; if (alive.current) busy[1](false) }
  }
  var choose = async function () {
    if (pending.current) return
    pending.current = true; busy[1](true); error[1](null)
    try {
      var path = await worktreeWorkspace().pickDirectory()
      if (alive.current && path) destination[1](request.action === 'move' ? path.replace(/[\\/]$/, '') + '/' + request.tree.path.replace(/\\/g, '/').split('/').pop() : path)
    } catch (failure) { if (alive.current) error[1](failure.message) }
    finally { pending.current = false; if (alive.current) busy[1](false) }
  }
  var title = t('wt.' + request.action), value = ready ? preview[0].value : null
  var button = function (key, label, action, disabled, primary) { return h('button', { key: key, type: 'button', className: 'dshgit-btn' + (primary ? ' dshgit-btn-primary' : ''), onClick: action, disabled: disabled }, label) }
  return h('div', { className: 'dshgit-modal', onClick: close }, h('form', { ref: panel, tabIndex: -1, role: 'dialog', 'aria-modal': true, 'aria-label': title, className: 'dshgit-dialog dshgit-worktree-form',
    onClick: function (event) { event.stopPropagation() }, onSubmit: function (event) { event.preventDefault(); act(false) } }, [
    h('div', { key: 'title', className: 'dshgit-dialogtitle' }, title),
    request.tree ? h('div', { key: 'source', style: { overflowWrap: 'anywhere' } }, request.tree.path) : null,
    h('p', { key: 'hint', className: 'dshgit-muted' }, t('wt.' + request.action + 'Hint')),
    request.action === 'lock' ? h('label', { key: 'reason' }, [t('wt.lockReason'), h('input', { key: 'input', name: 'reason', className: 'dshgit-input', maxLength: 1000, value: reason[0], disabled: busy[0], onChange: function (event) { reason[1](event.target.value) } })]) : null,
    pathAction ? h('label', { key: 'destination' }, [t('wt.destination'), h('input', { key: 'input', name: 'destination', className: 'dshgit-input', required: true, value: destination[0], disabled: busy[0], onChange: function (event) { destination[1](event.target.value) } })]) : null,
    pathAction ? button('pick', t(request.action === 'move' ? 'wt.pickParent' : 'wt.pickMoved'), choose, busy[0] || !worktreeWorkspace()) : null,
    value ? h('div', { key: 'preview', role: 'status', className: 'dshgit-worktree-form' }, [
      h('strong', { key: 'title' }, t('wt.preview')),
      value.tree?.locked ? h('p', { key: 'locked' }, t('wt.locked') + ': ' + (value.tree.lockReason || '—')) : null,
      value.reason ? h('p', { key: 'reason' }, value.reason) : null,
      value.destination ? h('p', { key: 'path', style: { overflowWrap: 'anywhere' } }, value.tree.path + ' → ' + value.destination) : null,
      value.changes ? h('p', { key: 'changes' }, t('wt.moveChanges', { count: value.changes })) : null,
      request.action === 'prune' ? h('div', { key: 'prune' }, [
        (value.candidates || []).map(function (tree) { return h('p', { key: tree.path, style: { overflowWrap: 'anywhere' } }, tree.path + ' · ' + (tree.pruneReason || '')) }),
        h('pre', { key: 'output', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, value.output || t('wt.nothingToPrune')),
      ]) : null,
    ]) : null,
    error[0] ? h('div', { key: 'error', role: 'alert', className: 'dshgit-error' }, error[0]) : null,
    h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
      button('cancel', t('action.cancel'), close, busy[0]),
      button('preview', t('wt.checkPreview'), function () { act(false) }, busy[0] || (pathAction && !destination[0].trim())),
      button('apply', t('wt.confirmAction', { action: title }), function () { act(true) }, busy[0] || !ready || !!value?.empty, true),
    ]),
  ]))
}

import { React, ReactDOM, h } from '../../core/runtime.js'
import { IconFolder, IconFolderPlus, IconGit } from '../../ui/icons.js'
import { useDialogFocus } from '../../ui/controls.js'
import { cloneStyles } from './styles.js'

/** Existing directoryFlow owner contract; adoption and navigation stay in DSH. */
export function WorkspaceAddFlow(props) {
  var ref = React.useRef(null), pending = React.useRef(false), alive = React.useRef(true)
  var picking = React.useState(false), latest = React.useRef(props)
  latest.current = props
  React.useEffect(function () { alive.current = true; return function () { alive.current = false } }, [])
  var close = function () { if (!pending.current && !latest.current.busy) latest.current.onCancel() }
  useDialogFocus(ref, close)
  var local = async function () {
    if (pending.current || latest.current.busy) return
    pending.current = true; picking[1](true)
    try {
      var path = await latest.current.pickDirectory()
      if (!alive.current) return
      if (path === null) latest.current.onCancel()
      else latest.current.onPicked(path)
    } catch (failure) {
      if (alive.current) latest.current.onError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      pending.current = false
      if (alive.current) picking[1](false)
    }
  }
  var disabled = picking[0] || props.busy
  var choice = function (key, icon, title, hint, onClick, label) {
    return h('button', { key: key, type: 'button', className: 'dshgit-workspace-choice', disabled: disabled, onClick: onClick, 'aria-label': title, title: hint }, [
      h(icon, { key: 'icon', size: 28 }),
      h('strong', { key: 'title' }, label || title),
    ])
  }
  return ReactDOM.createPortal(h('div', { className: 'dshgit dshgit-scrim dshgit-clone-scrim', style: { zIndex: 1500 }, onClick: close }, [
    h('style', { key: 'style' }, cloneStyles),
    h('div', { key: 'dialog', className: 'dshgit-clone-dialog dshgit-workspace-dialog', ref: ref, tabIndex: -1,
      role: 'dialog', 'aria-modal': true, 'aria-label': props.t('clone.add'), onClick: function (event) { event.stopPropagation() } }, [
      h('h2', { key: 'title' }, props.t('clone.add')),
      h('div', { key: 'choices', className: 'dshgit-workspace-choices' }, [
        choice('project', IconFolderPlus, props.t('project.title'), props.t('project.hint'), function () {
          if (!pending.current && !latest.current.busy) latest.current.onProject()
        }),
        choice('local', IconFolder, props.t('clone.local'), props.t('clone.localHint'), local, props.t('workspace.local')),
        choice('clone', IconGit, props.t('clone.entry'), props.t('clone.remoteHint'), function () {
          if (!pending.current && !latest.current.busy) latest.current.onClone()
        }, props.t('workspace.clone')),
      ]),
      h('div', { key: 'footer', className: 'dshgit-clone-actions' }, h('button', {
        type: 'button', className: 'dshgit-btn', disabled: disabled, onClick: close,
      }, props.t('action.cancel'))),
    ]),
  ]), document.body)
}

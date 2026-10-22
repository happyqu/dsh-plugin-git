import { React, ReactDOM, h } from '../../core/runtime.js'
import { useDialogFocus } from '../../ui/controls.js'

/** A read-only explanation and an explicit, guarded removal confirmation. */
export function WorktreeRemovalDialog(props) {
  var t = props.t, panel = React.useRef(null), alive = React.useRef(true), pending = React.useRef(false)
  var data = React.useState(null), error = React.useState(null), loading = React.useState(true), busy = React.useState(false), revision = React.useState(0)
  var close = function () { if (!pending.current) props.onClose() }
  useDialogFocus(panel, close)
  React.useEffect(function () { alive.current = true; return function () { alive.current = false } }, [])
  React.useEffect(function () {
    var active = true, controller = new AbortController()
    loading[1](true); error[1](null); data[1](null)
    props.run('worktreeRemovalPreview', { root: props.root, directory: props.tree.path }, { silent: true, silentError: true, signal: controller.signal })
      .then(function (value) { if (active) data[1](value) })
      .catch(function (failure) { if (active) error[1](failure.message) })
      .finally(function () { if (active) loading[1](false) })
    return function () { active = false; controller.abort() }
  }, [props.root, props.tree.path, props.run, revision[0]])
  var preview = data[0]
  var remove = async function () {
    if (pending.current || loading[0] || !preview?.removable) return
    pending.current = true; busy[1](true); error[1](null)
    try { await props.onRemove(preview.tree); if (alive.current) props.onRemoved() }
    catch (failure) { if (alive.current) { error[1](failure.message); data[1](null) } }
    finally { pending.current = false; if (alive.current) busy[1](false) }
  }
  var open = async function () {
    if (pending.current) return
    pending.current = true; busy[1](true); error[1](null)
    try { await props.onOpen(props.tree.path); if (alive.current) props.onClose() }
    catch (failure) { if (alive.current) error[1](failure.message) }
    finally { pending.current = false; if (alive.current) busy[1](false) }
  }
  return ReactDOM.createPortal(h('div', { className: 'dshgit-modal', onClick: close }, h('div', {
    ref: panel, tabIndex: -1, role: 'dialog', 'aria-modal': true, 'aria-label': t('wt.remove'), className: 'dshgit-dialog dshgit-worktree-form',
    onClick: function (event) { event.stopPropagation() },
  }, [
    h('div', { key: 'title', className: 'dshgit-dialogtitle' }, t('wt.remove')),
    h('p', { key: 'scope', className: 'dshgit-muted' }, t('wt.removeConfirm', { path: props.tree.path })),
    loading[0] ? h('div', { key: 'loading', role: 'status' }, t('state.loading')) : null,
    error[0] ? h('div', { key: 'error', role: 'alert', className: 'dshgit-error' }, error[0]) : null,
    preview?.blockers.length ? h('div', { key: 'blockers', role: 'status', className: 'dshgit-worktree-form' }, [
      h('strong', { key: 'heading' }, t('wt.removeBlocked')),
      h('ul', { key: 'reasons', className: 'dshgit-worktree-blockers' }, preview.blockers.map(function (item) { return h('li', { key: item.kind }, item.message) })),
    ]) : null,
    preview && (preview.files.length || preview.ignoredPaths.length) ? h('div', { key: 'files', className: 'dshgit-worktree-blockerfiles' }, [
      h('div', { key: 'summary', className: 'dshgit-muted' }, t('wt.removeFiles', { changes: preview.fileCount, ignored: preview.ignoredCount })),
      preview.files.map(function (file) { return h('div', { key: 'change:' + file.path }, [
        h('span', { key: 'kind', className: 'dshgit-muted' }, t(file.kind === 'untracked' ? 'wt.fileUntracked' : file.kind === 'unmerged' ? 'wt.fileConflict' : 'wt.fileChanged')),
        h('span', { key: 'path', title: file.path }, file.path),
      ]) }),
      preview.ignoredPaths.map(function (path) { return h('div', { key: 'ignored:' + path }, [
        h('span', { key: 'kind', className: 'dshgit-muted' }, t('wt.fileIgnored')), h('span', { key: 'path', title: path }, path),
      ]) }),
      preview.fileCount > preview.files.length || preview.ignoredCount > preview.ignoredPaths.length ? h('p', { key: 'limit', className: 'dshgit-muted' }, t('wt.removeFilesLimit')) : null,
    ]) : null,
    h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
      h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', disabled: busy[0], onClick: close }, t('action.cancel')),
      h('button', { key: 'refresh', type: 'button', className: 'dshgit-btn', disabled: busy[0] || loading[0], onClick: function () { revision[1](function (value) { return value + 1 }) } }, t('wt.recheck')),
      preview && !preview.removable && preview.blockers.some(function (item) { return ['changes', 'ignored', 'operation'].includes(item.kind) }) ? h('button', { key: 'open', type: 'button', className: 'dshgit-btn', disabled: busy[0], onClick: open }, t('wt.openToResolve')) : null,
      h('button', { key: 'remove', type: 'button', className: 'dshgit-btn dshgit-btn-danger', disabled: busy[0] || loading[0] || !preview?.removable, onClick: remove }, t('wt.remove')),
    ]),
  ])), document.body)
}

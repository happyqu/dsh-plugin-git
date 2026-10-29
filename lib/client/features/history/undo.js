/**
 * dsh-plugin-git — the recovery-point dialog.
 *
 * Every rewrite in this plugin records where the branch was; before this panel
 * existed the ref was written and then forgotten, so the record was there and
 * unreachable. That is the other half of the same contract: a rewrite is only safe if
 * "get me back" is one click away.
 *
 * The two restore modes are two buttons with different wording, not one button plus a
 * hidden option, because they answer different questions:
 *
 * - "show me what was there" creates a branch, and cannot lose anything;
 * - "put the branch back" moves it, and `--keep` refuses rather than overwrite.
 *
 * Presenting them as a mode switch would let someone move their branch while intending
 * to look.
 */
import { React, h } from '../../core/runtime.js'
import { formatTime } from '../../core/format.js'
import { Toast } from '../../ui/notifications.js'
import { useDialogFocus } from '../../ui/controls.js'

/** Localisation key for one recorded action. */
function actionKey(action) {
  var known = { reword: 'actionReword', squash: 'actionSquash', rebase: 'actionRebase' }
  return 'undo.' + (known[action] || 'actionRewrite')
}

/**
 * The recovery-point dialog.
 *
 * @param props - `{ repo, run, onClose, onRestored, t }`.
 */
function UndoDialog(props) {
  var t = props.t
  var panel = React.useRef(null)
  var recordsState = React.useState(null)
  var errorState = React.useState('')
  var busyState = React.useState(null)
  var noticeState = React.useState(null)
  var retryState = React.useState(0)
  var confirmState = React.useState(null)
  useDialogFocus(panel, props.onClose)

  React.useEffect(function () {
    var active = true
    recordsState[1](null)
    errorState[1]('')
    // A read, so `silent`: opening the list must not spin the status bar or disable
    // the write controls.
    props.run('undoPoints', { root: props.repo.root, limit: 50 }, { silent: true, silentError: true })
      .then(function (value) { if (active) recordsState[1](Array.isArray(value) ? value : []) })
      .catch(function (failure) { if (active) { recordsState[1]([]); errorState[1](failure.message) } })
    return function () { active = false }
  }, [props.repo.root, retryState[0]])

  var records = recordsState[0]
  var reload = function () { retryState[1](function (value) { return value + 1 }) }

  var act = function (record, mode) {
    if (busyState[0] !== null) return
    busyState[1](record.ref)
    confirmState[1](null)
    props.run('write.restoreUndoPoint', {
      root: props.repo.root,
      ref: record.ref,
      mode: mode,
      // Only moving the branch is a write that can replace commits. Creating a branch is
      // safe by construction — a name that already exists is refused — so it sends no
      // token. Sending one anyway would claim the user confirmed a destructive act they
      // were never shown, and would also mask which of the two buttons needs care.
      ...(mode === 'reset' ? { confirm: true } : {}),
    }, { silent: true, silentError: true }).then(function (value) {
      busyState[1](null)
      noticeState[1]({ seq: Date.now(), text: value.message || t('action.ok') })
      // A reset moved the branch, so every view derived from it has to reload.
      if (mode === 'reset') props.onRestored?.(value)
      reload()
    }).catch(function (failure) {
      busyState[1](null)
      noticeState[1]({ seq: Date.now(), text: failure.message })
      // A refusal here is usually "local changes would be overwritten", which is a
      // truthful answer rather than an error. The list is reloaded either way, and
      // the shell is told so the commit views stop claiming the old positions.
      props.onRestored?.(null)
      reload()
    })
  }

  var remove = function (record) {
    if (busyState[0] !== null) return
    busyState[1](record.ref)
    props.run('write.deleteUndoPoint', { root: props.repo.root, ref: record.ref }, { silent: true, silentError: true })
      .then(function (value) {
        busyState[1](null)
        noticeState[1]({ seq: Date.now(), text: value.message || t('action.ok') })
        reload()
      }).catch(function (failure) {
        busyState[1](null)
        noticeState[1]({ seq: Date.now(), text: failure.message })
      })
  }

  return h('div', { className: 'dshgit-modal', onClick: props.onClose }, h('div', {
    className: 'dshgit-dialog dshgit-workbench-dialog dshgit-undo-dialog', role: 'dialog', 'aria-modal': true,
    'aria-label': t('undo.title'), ref: panel, tabIndex: -1, 'data-undo-dialog': 'true',
    onClick: function (event) { event.stopPropagation() },
  }, [
    h('div', { key: 'title', className: 'dshgit-dialogtitle' }, t('undo.title')),
    h('div', { key: 'description', className: 'dshgit-muted' }, t('undo.description')),
    errorState[0] ? h('div', { key: 'error', role: 'alert', className: 'dshgit-lfs-danger' }, errorState[0]) : null,
    noticeState[0]
      ? h(Toast, { key: 'notice', seq: noticeState[0].seq, text: noticeState[0].text, tone: 'warning',
          onDone: function () { noticeState[1](null) } })
      : null,
    records === null
      ? h('div', { key: 'loading', className: 'dshgit-muted', role: 'status' }, t('state.loading'))
      : records.length === 0
        ? h('div', { key: 'empty', className: 'dshgit-muted' }, t('undo.empty'))
        : h('div', { key: 'list', className: 'dshgit-undo-list' }, records.map(function (record) {
          var busy = busyState[0] === record.ref
          return h('div', {
            key: record.ref, className: 'dshgit-undo-item',
            'data-undo-ref': record.ref, 'data-undo-action': record.action,
          }, [
            h('div', { key: 'line', className: 'dshgit-undo-line' }, [
              h('span', { key: 'action', className: 'dshgit-undo-action' }, t(actionKey(record.action))),
              h('code', { key: 'sha', className: 'dshgit-rewrite-sha', title: record.sha }, record.shortSha),
              h('span', { key: 'origin', className: 'dshgit-muted' },
                record.origin ? record.origin.replace(/^refs\/heads\//, '') : '—'),
              record.at ? h('span', { key: 'time', className: 'dshgit-muted' }, formatTime(record.at / 1000)) : null,
            ]),
            confirmState[0] === record.ref
              ? h('div', { key: 'confirm', className: 'dshgit-undo-confirm' }, [
                h('span', { key: 'text', className: 'dshgit-muted' }, t('undo.deleteHint')),
                h('button', {
                  key: 'yes', type: 'button', className: 'dshgit-btn dshgit-btn-danger', disabled: busy,
                  'data-undo-delete': record.ref, onClick: function () { remove(record) },
                }, t('undo.delete')),
                h('button', {
                  key: 'no', type: 'button', className: 'dshgit-btn',
                  onClick: function () { confirmState[1](null) },
                }, t('action.cancel')),
              ])
              : h('div', { key: 'actions', className: 'dshgit-undo-actions' }, [
                h('button', {
                  key: 'branch', type: 'button', className: 'dshgit-btn', disabled: busy,
                  'data-undo-restore': 'branch', onClick: function () { act(record, 'branch') },
                }, t('undo.branch')),
                h('button', {
                  key: 'reset', type: 'button', className: 'dshgit-btn', disabled: busy,
                  title: t('undo.resetHint'), 'data-undo-restore': 'reset',
                  onClick: function () { act(record, 'reset') },
                }, t('undo.reset')),
                h('button', {
                  key: 'delete', type: 'button', className: 'dshgit-iconbtn', disabled: busy,
                  title: t('undo.delete'), 'aria-label': t('undo.delete'),
                  onClick: function () { confirmState[1](record.ref) },
                }, '×'),
              ]),
          ])
        })),
    h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
      h('button', { key: 'refresh', type: 'button', className: 'dshgit-btn', onClick: reload }, t('action.refresh')),
      h('button', { key: 'close', type: 'button', className: 'dshgit-btn', onClick: props.onClose }, t('action.close')),
    ]),
  ]))
}

export { UndoDialog }

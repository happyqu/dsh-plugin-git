/**
 * dsh-plugin-git — the cherry-pick queue dialog.
 *
 * Picking one commit already existed as a per-commit form. The missing operation was
 * "apply these five fixes from that branch, here", which is the one people actually
 * reach for — and doing it one at a time loses the queue on the first conflict.
 *
 * Three decisions:
 *
 * 1. **The queue is applied with ONE `git cherry-pick`, not a loop.** Git then records
 *    the whole queue in its sequencer, so a conflict half-way can be continued or skipped
 *    commit by commit instead of abandoning all of them.
 * 2. **The dialog shows the ORDER, because order matters.** A queue applied newest-first
 *    would try to apply each commit before the one it builds on; the model reports the
 *    oldest-first order and this renders exactly that.
 * 3. **A merge commit is refused before anything runs.** Replaying one needs `-m <parent>`
 *    and guessing the parent silently discards one side of the merge.
 */
import { React, h } from '../../core/runtime.js'
import { Spinner } from '../../ui/spinner.js'
import { useDialogFocus } from '../../ui/controls.js'

/**
 * The queue confirmation dialog.
 *
 * @param props - `{ repo, shas, commits, run, onClose, onDone, t }`.
 *   `commits` is the ticked list from the sidebar, used for the subjects shown here.
 */
function PickQueueDialog(props) {
  var t = props.t
  var panel = React.useRef(null)
  var busyState = React.useState(false)
  var errorState = React.useState('')
  var originState = React.useState(false)
  var pending = React.useRef(false)
  var close = function () { if (!pending.current) props.onClose() }
  useDialogFocus(panel, close)

  var bySha = {}
  for (var i = 0; i < (props.commits || []).length; i++) bySha[props.commits[i].sha] = props.commits[i]
  var shas = props.shas || []

  var execute = function () {
    if (busyState[0] || pending.current || shas.length === 0) return
    pending.current = true
    busyState[1](true)
    errorState[1]('')
    props.run('write.cherryPickQueue', {
      root: props.repo.root,
      shas: shas,
      recordOrigin: originState[0] === true,
      // A queue creates commits on the current branch, which is why the Host classifies
      // it as a rewrite and demands this token.
      confirm: true,
    }, { silent: true, silentError: true }).then(function (value) {
      pending.current = false
      props.onDone(value)
    }).catch(function (failure) {
      pending.current = false
      busyState[1](false)
      errorState[1](failure.message)
    })
  }

  return h('div', { className: 'dshgit-modal', onClick: close }, h('div', {
    className: 'dshgit-dialog dshgit-pick-dialog', role: 'dialog', 'aria-modal': true,
    'aria-label': t('pick.title'), ref: panel, tabIndex: -1, 'data-pick-dialog': 'true',
    onClick: function (event) { event.stopPropagation() },
  }, [
    h('div', { key: 'title', className: 'dshgit-dialogtitle' }, t('pick.title')),
    h('div', { key: 'target', className: 'dshgit-muted' },
      t('pick.target') + ': ' + (props.repo.branch || 'HEAD')),
    h('div', { key: 'order', className: 'dshgit-muted' }, t('pick.order')),
    errorState[0] ? h('div', { key: 'error', role: 'alert', className: 'dshgit-lfs-danger' }, errorState[0]) : null,
    h('div', { key: 'list', className: 'dshgit-pick-list' }, shas.map(function (sha, index) {
      var commit = bySha[sha] || {}
      return h('div', { key: sha, className: 'dshgit-pick-row', 'data-pick-sha': sha }, [
        h('span', { key: 'n', className: 'dshgit-muted' }, String(index + 1) + '.'),
        h('code', { key: 'sha', className: 'dshgit-rewrite-sha' }, String(sha).slice(0, 8)),
        h('span', { key: 'subject', className: 'dshgit-name', title: commit.subject || '' }, commit.subject || ''),
      ])
    })),
    h('label', { key: 'origin', className: 'dshgit-check', title: t('pick.recordOriginHint') }, [
      h('input', {
        key: 'input', type: 'checkbox', checked: originState[0], disabled: busyState[0],
        'data-pick-origin': 'true',
        onChange: function (event) { originState[1](event.currentTarget.checked) },
      }),
      t('pick.recordOrigin'),
    ]),
    h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
      h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', disabled: busyState[0], onClick: close },
        t('action.cancel')),
      h('button', {
        key: 'run', type: 'button', className: 'dshgit-btn dshgit-btn-primary',
        'data-pick-confirm': 'true', disabled: busyState[0] || shas.length === 0, onClick: execute,
      }, busyState[0] ? h(Spinner, { className: 'dshgit-spinner', 'aria-hidden': true }) : t('pick.run')),
    ]),
  ]))
}

export { PickQueueDialog }

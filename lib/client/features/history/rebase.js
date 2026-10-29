/**
 * dsh-plugin-git — the interactive rebase dialog.
 *
 * This is the one screen where the user rearranges history, so the design question is
 * not "how do we expose six git verbs" but "how does someone see, at a glance, what
 * they are about to change".
 *
 * Everything a row CAN be is decided by `rebase-model.js`; this file only turns those
 * answers into rows, chips and buttons. The split keeps the rules testable without a
 * DOM and keeps this file about layout.
 *
 * Three presentation decisions follow from the model:
 *
 * 1. **A dropped row stays visible and dimmed.** "Which one did I drop?" has to remain
 *    answerable; a vanishing row answers it by making it impossible to check.
 * 2. **A leading fold is not offered.** The chip is omitted rather than shown
 *    disabled: there is nothing the user could do to enable it, and a greyed control
 *    invites the question "why not" that a missing one does not.
 * 3. **The numbers are counts, not promises.** Folding and dropping change how many
 *    commits survive, and git may drop more (a patch already upstream); the dialog
 *    says "planned", and the result reports what actually happened.
 */
import { React, h } from '../../core/runtime.js'
import { Spinner } from '../../ui/spinner.js'
import { useDialogFocus } from '../../ui/controls.js'
import {
  ROW_ACTIONS,
  initialPlan,
  movedRow,
  planCounts,
  planProblem,
  planRequest,
  resetPlan,
  setRowAction,
} from './rebase-model.js'

/** Localisation key for one row action. */
function actionKey(action) {
  return 'rebase.action' + action.charAt(0).toUpperCase() + action.slice(1)
}

/**
 * The plan editor.
 *
 * @param props - `{ repo, base, commits, published, run, onClose, onDone, t }`.
 *   `commits` is the range, oldest first, each `{ sha, shortSha, subject }`;
 *   `published` is how many of them are already on a remote.
 */
function RebaseDialog(props) {
  var t = props.t
  var panel = React.useRef(null)
  // The plan starts as the existing history: opening this dialog must not, by itself,
  // change anything, so every row begins as `pick`.
  var planState = React.useState(function () { return initialPlan(props.commits) })
  var plan = planState[0]
  var setPlan = planState[1]
  var errorState = React.useState('')
  var busyState = React.useState(false)
  var previewState = React.useState(null)
  var allowPublishedState = React.useState(false)
  var editingState = React.useState(null)
  var pending = React.useRef(false)
  var close = function () { if (!pending.current) props.onClose() }
  useDialogFocus(panel, close)

  var counts = planCounts(plan)
  // WHICH commits are published comes from the Host's preview, not from the list this
  // dialog was opened from: that list can be minutes old, and a count derived from it
  // would be a guess dressed up as a rule. Before the first preview lands there is no
  // answer, so nothing is claimed and the run button stays disabled.
  var publishedCount = previewState[0] ? (previewState[0].published || 0) : (props.published || 0)
  var problem = planProblem(plan, {
    published: publishedCount,
    allowPublished: allowPublishedState[0],
  })

  // The preview is a READ, so it never touches the busy counter: arranging the plan is
  // browsing, and a spinner here would suggest something is being written.
  var loadPreview = React.useCallback(function () {
    if (!problem.ok && problem.reason !== 'published') { previewState[1](null); return }
    var active = true
    var request = planRequest(props.base, plan)
    props.run('rebasePreview', { root: props.repo.root, base: request.base, commits: request.commits },
      { silent: true, silentError: true })
      .then(function (value) { if (active) { previewState[1](value); errorState[1]('') } })
      .catch(function (failure) { if (active) { previewState[1](null); errorState[1](failure.message) } })
    return function () { active = false }
  }, [props.repo.root, props.base, plan, problem.ok, problem.reason])
  React.useEffect(loadPreview, [loadPreview])

  var canRun = problem.ok && previewState[0] !== null && !busyState[0]
  var execute = function () {
    if (!canRun || pending.current) return
    pending.current = true
    busyState[1](true)
    errorState[1]('')
    var request = planRequest(props.base, plan)
    props.run('write.applyPlan', {
      root: props.repo.root,
      base: request.base,
      commits: request.commits,
      messages: request.messages,
      // The guard is what makes "the thing I confirmed" and "the thing that ran" the
      // same operation: the Host recomputes the plan and compares this against the
      // repository, refusing if anything moved while the dialog was open.
      guard: previewState[0].guard,
      // This is the token the Host checks before touching a published commit. Sending it
      // only when the checkbox is ticked is the whole point: the checkbox is a statement
      // by the user that nobody else has these commits, and without it the Host refuses.
      allowPublished: allowPublishedState[0] === true,
      confirm: true,
    }, { silent: true, silentError: true }).then(function (value) {
      pending.current = false
      props.onDone(value)
    }).catch(function (failure) {
      pending.current = false
      busyState[1](false)
      errorState[1](failure.message)
      // The plan is no longer trustworthy after a refusal, so reload it rather than
      // leaving a stale preview next to a fresh error.
      loadPreview()
    })
  }

  var row = function (entry, index) {
    var first = index === 0
    var canFold = plan.slice(0, index).some(function (row) { return row.action !== 'drop' })
    var editing = editingState[0] === entry.sha
    /**
     * Double-clicking a row opens its message editor, which is the shortcut IDEA offers
     * and the one people reach for first. A row that is not a message-carrying action is
     * switched to `reword` first, because editing a message that will be discarded (a
     * `drop`) or never used (a `fixup`'s own text) would silently do nothing.
     */
    var beginEdit = function () {
      if (busyState[0]) return
      if (entry.action !== 'reword' && entry.action !== 'squash' && entry.action !== 'fixup') {
        setPlan(setRowAction(plan, index, 'reword'))
      }
      editingState[1](entry.sha)
    }
    var folds = entry.action === 'squash' || entry.action === 'fixup'
    return h('div', {
      key: entry.sha,
      className: 'dshgit-rebase-row',
      'data-action': entry.action,
      'data-rebase-row': entry.sha,
      'data-dropped': entry.action === 'drop',
      'data-rebase-index': index,
      // A `fixup` discards its own message, so offering the editor there would collect
      // text that is never committed.
      onDoubleClick: entry.action === 'drop' || entry.action === 'fixup' ? undefined : beginEdit,
    }, [
      h('div', { key: 'order', className: 'dshgit-rebase-order' }, [
        h('button', {
          key: 'up', type: 'button', className: 'dshgit-iconbtn',
          title: t('rebase.up'), 'aria-label': t('rebase.up'),
          disabled: busyState[0] || first,
          onClick: function () { setPlan(movedRow(plan, index, -1)) },
        }, '↑'),
        h('button', {
          key: 'down', type: 'button', className: 'dshgit-iconbtn',
          title: t('rebase.down'), 'aria-label': t('rebase.down'),
          disabled: busyState[0] || index === plan.length - 1,
          onClick: function () { setPlan(movedRow(plan, index, 1)) },
        }, '↓'),
      ]),
      h('div', { key: 'body', className: 'dshgit-rebase-body' }, [
        h('div', { key: 'line', className: 'dshgit-rebase-line' }, [
          h('code', { key: 'sha', className: 'dshgit-rewrite-sha' }, entry.shortSha),
          h('span', { key: 'subject', className: 'dshgit-rebase-subject', title: entry.subject }, entry.subject),
        ]),
        h('div', { key: 'actions', className: 'dshgit-rebase-actions', role: 'group', 'aria-label': t('rebase.title') },
          ROW_ACTIONS.map(function (action) {
            // A leading fold is impossible, so the control is omitted rather than shown
            // disabled: there is nothing the user could do to enable it.
            if (!canFold && (action === 'squash' || action === 'fixup')) return null
            return h('button', {
              key: action, type: 'button',
              className: 'dshgit-rebase-chip' + (entry.action === action ? ' dshgit-rebase-chip-on' : ''),
              'aria-pressed': entry.action === action, 'data-rebase-action': action,
              disabled: busyState[0],
              onClick: function () { setPlan(setRowAction(plan, index, action)) },
            }, t(actionKey(action)))
          })),
        (entry.action === 'reword' || entry.action === 'squash' || entry.action === 'fixup')
          ? h('div', { key: 'message', className: 'dshgit-rebase-message' }, [
            folds ? h('span', { key: 'hint', className: 'dshgit-muted' }, t('rebase.foldMessageHint')) : null,
            editing
              ? h('textarea', {
                key: 'input', className: 'dshgit-textarea', rows: 3,
                value: entry.message, disabled: busyState[0],
                placeholder: t(folds ? 'rebase.foldMessageHint' : 'rebase.messageHint'), 'aria-label': t('rebase.message'),
                onChange: function (event) {
                  var text = event.currentTarget.value
                  setPlan(function (current) {
                    return current.map(function (item) {
                      return item.sha === entry.sha ? Object.assign({}, item, { message: text }) : item
                    })
                  })
                },
              })
              // The button shows the message when one was written, because that text is
              // what will be committed — hiding it behind "edit" would let a stale draft
              // run unnoticed.
              : h('button', {
                key: 'edit', type: 'button', className: 'dshgit-btn dshgit-rebase-editmessage',
                disabled: busyState[0], 'data-rebase-editmessage': entry.sha,
                onClick: function () { editingState[1](entry.sha) },
              }, entry.message.trim() !== '' ? entry.message.split('\n')[0] : t('rebase.message')),
          ])
          : null,
      ]),
    ])
  }

  var problemText = ''
  if (problem.reason === 'leadingFold') problemText = t('rebase.leadingFold', { sha: problem.detail })
  else if (problem.reason === 'allDropped') problemText = t('rebase.allDropped')
  else if (problem.reason === 'empty') problemText = t('rebase.emptyPlan')
  else if (problem.reason === 'published') problemText = t('rebase.published', { count: problem.detail })

  /**
   * The action map: what each commit becomes, in the order it will be replayed.
   *
   * A single summary line ("3 kept, 1 dropped") says how many, not WHICH. The map answers
   * the question a user actually asks before moving history — "did I drop the right one"
   * — by showing every commit's fate in the same order as the list above, including the
   * ones that fold into a neighbour.
   */
  var actionMap = h('div', { key: 'map', className: 'dshgit-rebase-map', 'data-rebase-map': 'true' }, [
    h('div', { key: 'heading', className: 'dshgit-muted' }, t('rebase.mapTitle')),
  ].concat(plan.map(function (entry, index) {
    var fate = entry.action
    // A fold's fate is "into the one above", which is clearer than the verb alone.
    var label = t('rebase.fate.' + fate)
    var target = (fate === 'squash' || fate === 'fixup') && index > 0 ? plan[index - 1] : null
    return h('div', {
      key: entry.sha, className: 'dshgit-rebase-maprow',
      'data-rebase-fate': fate, 'data-rebase-map-sha': entry.sha,
    }, [
      h('code', { key: 'sha', className: 'dshgit-rewrite-sha' }, entry.shortSha),
      h('span', { key: 'arrow', className: 'dshgit-muted' }, '→'),
      h('span', { key: 'fate', className: 'dshgit-rebase-fate' }, label),
      target ? h('code', { key: 'target', className: 'dshgit-rewrite-sha' }, target.shortSha) : null,
      entry.message.trim() !== ''
        ? h('span', { key: 'msg', className: 'dshgit-muted', title: entry.message }, entry.message.split('\n')[0])
        : null,
    ])
  })))

  return h('div', { className: 'dshgit-modal', onClick: close }, h('div', {
    className: 'dshgit-dialog dshgit-rebase-dialog', role: 'dialog', 'aria-modal': true,
    'aria-label': t('rebase.title'), ref: panel, tabIndex: -1, 'data-rebase-dialog': 'true',
    onClick: function (event) { event.stopPropagation() },
  }, [
    h('div', { key: 'title', className: 'dshgit-dialogtitle' }, t('rebase.title')),
    h('div', { key: 'base', className: 'dshgit-muted' },
      t('rebase.base') + ': ' + String(props.base).slice(0, 10) + ' — ' + t('rebase.baseHint')),
    h('div', { key: 'order', className: 'dshgit-muted' }, t('rebase.order')),
    errorState[0] ? h('div', { key: 'error', role: 'alert', className: 'dshgit-lfs-danger' }, errorState[0]) : null,
    h('div', { key: 'list', className: 'dshgit-rebase-list' }, plan.map(row)),
    // Counted by the HOST against the remote refs, so this warning is evidence rather
    // than a guess from the list this dialog was opened from.
    publishedCount > 0 ? h('div', { key: 'published', className: 'dshgit-lfs-danger', role: 'alert',
      'data-rebase-published': String(publishedCount) },
      t('rebase.published', { count: publishedCount })) : null,
    publishedCount > 0 ? h('label', { key: 'allow', className: 'dshgit-check' }, [
      h('input', {
        key: 'input', type: 'checkbox', checked: allowPublishedState[0], disabled: busyState[0],
        onChange: function (event) { allowPublishedState[1](event.currentTarget.checked) },
      }),
      t('rebase.allowPublished'),
    ]) : null,
    h('div', { key: 'counts', className: 'dshgit-muted', 'data-rebase-counts': 'true' },
      t('rebase.counts', {
        kept: counts.kept, reworded: counts.reword + counts.edit,
        squashed: counts.squash + counts.fixup, dropped: counts.drop,
      })),
    // The plan's size is what this dialog can vouch for; git decides how many commits
    // survive a replay, so the wording says "planned" rather than promising a result.
    h('div', { key: 'planned', className: 'dshgit-muted' },
      t('rebase.planned', { count: previewState[0] ? previewState[0].planned : plan.length })),
    problemText ? null : actionMap,
    problemText ? h('div', { key: 'problem', className: 'dshgit-muted', role: 'status' }, problemText) : null,
    h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
      h('button', {
        key: 'reset', type: 'button', className: 'dshgit-btn', 'data-rebase-reset': 'true',
        disabled: busyState[0], onClick: function () { setPlan(resetPlan(plan)) },
      }, t('rebase.reset')),
      h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', disabled: busyState[0], onClick: close },
        t('action.cancel')),
      h('button', {
        key: 'run', type: 'button', className: 'dshgit-btn dshgit-btn-primary', 'data-rebase-confirm': 'true',
        disabled: !canRun, onClick: execute,
      }, busyState[0] ? h(Spinner, { className: 'dshgit-spinner', 'aria-hidden': true }) : t('rebase.run')),
    ]),
  ]))
}

export { RebaseDialog }

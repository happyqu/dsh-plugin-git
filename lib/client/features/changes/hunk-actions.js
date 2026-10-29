/**
 * dsh-plugin-git — the per-hunk action strip.
 *
 * A strip above the patch rather than buttons on each hunk header. Two reasons, both
 * practical:
 *
 * 1. **The renderer does not know hunk indices.** `DiffBody` is shared by history,
 *    compare, stash and worktree views, and teaching it about staging would put a write
 *    action inside a component that must stay read-only everywhere else.
 * 2. **One selected hunk is the real workflow.** Staging "the one change I meant" is a
 *    pointer at a hunk, not a bulk operation, so the strip asks which hunk and then what.
 *
 * The count of hunks is shown even when no controls are offered, because "this file has
 * 3 separate changes" is itself useful information to a reviewer.
 */
import { React, h } from '../../core/runtime.js'
import { Spinner } from '../../ui/spinner.js'
import { useFileHunks } from './hunks.js'
import { getReviewPrefs } from '../../core/preferences.js'

/** Localisation key for one action. */
function actionKey(action) {
  return 'hunk.action' + action.charAt(0).toUpperCase() + action.slice(1)
}

/**
 * The hunk action strip.
 *
 * @param props - `{ t, actions, busy, error, onAct }`.
 *   `actions` is the subset the current section allows (`stage`/`unstage`/`discard`).
 */
function HunkActions(props) {
  var t = props.t
  // Which hunk the user pointed at. A number index is what the Host's payload uses, and
  // it survives a re-read of the same file; a hash would go stale on its own.
  var targetState = React.useState(null)
  var target = targetState[0]
  var errorState = React.useState('')
  var error = props.error || errorState[0]
  var busy = props.busy === true

  var fire = function (action) {
    if (target === null || busy) return
    errorState[1]('')
    try {
      props.onAct(action, target)
    } catch (failure) {
      errorState[1](failure.message || String(failure))
    }
  }

  return h('div', { key: 'hunkbar', className: 'dshgit-hunkbar', 'data-hunk-bar': 'true' }, [
    h('label', { key: 'target', className: 'dshgit-hunkpick' }, [
      h('span', { key: 'l', className: 'dshgit-muted' }, t('hunk.target')),
      h('select', {
        key: 'select', className: 'dshgit-input', value: target === null ? '' : String(target),
        'data-hunk-target': target === null ? '' : String(target),
        disabled: busy,
        onChange: function (event) {
          var value = event.currentTarget.value
          targetState[1](value === '' ? null : Number(value))
        },
      }, [h('option', { key: 'none', value: '' }, t('hunk.none'))].concat(
        // One entry per rendered hunk position. The labels are positional because the
        // strip cannot see the hunk text; the diff above shows it.
        props.count > 0
          ? Array.from({ length: props.count }, function (_unused, index) {
            return h('option', { key: index, value: String(index) }, t('hunk.number', { number: index + 1 }))
          })
          : [],
      )),
    ]),
    h('div', { key: 'buttons', className: 'dshgit-hunkactions' }, props.actions.map(function (action) {
      return h('button', {
        key: action, type: 'button',
        className: 'dshgit-btn' + (action === 'discard' ? ' dshgit-btn-danger' : ''),
        'data-hunk-action': action,
        disabled: target === null || busy,
        onClick: function () { fire(action) },
      }, busy ? h(Spinner, { className: 'dshgit-spinner', 'aria-hidden': true }) : t(actionKey(action)))
    })),
    error !== '' ? h('span', { key: 'error', role: 'alert', className: 'dshgit-muted dshgit-hunkerror' }, error) : null,
  ])
}

/** Bind the shared action strip to the file and the exact diff being displayed. */
function FileHunkActions(props) {
  var file = props.selection?.file
  var prefs = getReviewPrefs()
  var hunks = props.diff?.files?.find(function (entry) { return entry.path === file?.path })?.hunks || props.diff?.hunks || []
  var staging = useFileHunks({
    enabled: hunks.length > 0 && !props.diff?.tooLarge && !props.diff?.truncated
      && props.fileDisplay !== 'content' && props.selection?.rev !== 'HEAD' && !props.previewStale && !props.busy
      && file?.kind === 'ordinary' && !file.binary && !file.originalPath
      && (props.selection?.section === 'working' || (!prefs.ignoreWhitespace && !prefs.ignoreAllSpace
        && !prefs.wordDiff && !prefs.algorithm && prefs.contextLines === 3))
      && !hunks.some(function (hunk) { return hunk.wordDiff }),
    run: props.run, repo: props.repo, path: file?.path,
    staged: props.selection?.section === 'staged', hunks: hunks,
    t: props.t, confirm: props.requestConfirm,
    onDone: props.afterWrite,
  })
  return staging.offer ? h(HunkActions, {
    key: JSON.stringify([file?.path, props.selection?.section, hunks]),
    t: props.t, actions: staging.actions, busy: staging.busy || !!props.busy || !!props.previewStale,
    error: staging.error, onAct: staging.act, count: hunks.length,
  }) : null
}

export { HunkActions, FileHunkActions }

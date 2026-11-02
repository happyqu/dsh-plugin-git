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
import { ComboBox } from '../../ui/controls.js'
import { useFileHunks } from './hunks.js'
import { useLinePicker } from './line-picker.js'
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
  // The line bar arrives from the caller, which owns the pick set so the diff
  // renderer (a sibling of this strip) can decorate rows with it.
  var lineBar = props.lineBar || null

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
      // The themed ComboBox, not a native <select>: the native popup is painted
      // by the browser and ignores the panel's theme entirely.
      h(ComboBox, {
        key: 'combo', t: t, value: target === null ? '' : String(target),
        label: t('hunk.target'), className: 'dshgit-hunkcombo',
        // A stable marker so the test can find this control among the panel's
        // other comboboxes without depending on a native element.
        name: 'hunkTarget',
        options: [{ value: '', label: t('hunk.none') }].concat(
          // One entry per rendered hunk position. The labels are positional because the
          // strip cannot see the hunk text; the diff above shows it.
          props.count > 0
            ? Array.from({ length: props.count }, function (_unused, index) {
              return { value: String(index), label: t('hunk.number', { number: index + 1 }) }
            })
            : [],
        ),
        onChange: function (value) { targetState[1](value === '' ? null : Number(value)) },
      }),
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
  ].concat(lineBar === null ? [] : [lineBar]))
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
  // The line picker is HOISTED to this level so its `pickFor` can be handed to
  // the diff renderer, which is a sibling of the strip. Both read the same
  // `useFileHunks` result, so the two granularities cannot disagree about which
  // side of the index (or which file) is being written.
  var linePicker = useLinePicker({
    t: props.t,
    enabled: staging.offer === true && !staging.busy && !props.busy && !props.previewStale,
    fileKey: (file?.path || '') + ':' + (props.selection?.section || ''),
    actions: staging.actions,
    busy: staging.busy || !!props.busy,
    confirm: props.requestConfirm,
    // Hunk-level "this one cannot be sliced safely" flags, so the picker does
    // not offer a control the Host would refuse.
    lineSafe: staging.lineSafe,
    onActLines: function (action, byHunk) { staging.actLines(action, byHunk) },
  })
  // The renderer is a sibling, not a child, so the picker is published upward
  // through a stable callback rather than threaded through the tree.
  //
  // The cleanup runs whenever `pickFor` changes (every pick toggle), so it must
  // NOT null the parent: that would blank the gutters for one frame on every
  // single click. Instead the newest picker is published on each run and the
  // parent simply keeps it; only unmounting withdraws it.
  var onPicker = props.onPicker
  var pickFor = linePicker.pickFor
  React.useEffect(function () {
    if (typeof onPicker === 'function') onPicker(pickFor)
  }, [onPicker, pickFor])
  React.useEffect(function () {
    // Withdraw on unmount only, so a file switch stops decorating rows that
    // belong to a diff the picker no longer describes.
    if (typeof onPicker !== 'function') return undefined
    return function () { onPicker(null) }
  }, [onPicker])
  if (!staging.offer) return null
  return h(HunkActions, {
    key: JSON.stringify([file?.path, props.selection?.section, hunks]),
    t: props.t, actions: staging.actions, busy: staging.busy || !!props.busy || !!props.previewStale,
    error: staging.error, onAct: staging.act, count: hunks.length,
    lineBar: linePicker.bar,
  })
}

export { HunkActions, FileHunkActions }

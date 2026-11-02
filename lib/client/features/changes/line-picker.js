/**
 * dsh-plugin-git — line-level staging for the working-tree diff.
 *
 * The hunk strip already answers "stage this whole change"; this adds "stage
 * these LINES", which is the case a hunk cannot express: one hunk holding an
 * intended edit next to a debug print or a stray reformat.
 *
 * Design notes, each of which came from a failure mode:
 *
 * 1. **Selection is per hunk, in rendered order.** The Host keys a line
 *    selection by the same hunk fingerprints the whole-hunk path validates, so
 *    a line staged against a stale diff is refused rather than misapplied.
 * 2. **A picked row must be a CHANGE line.** Staging a context line is a
 *    no-op that would still rewrite the patch header, and picking one invites
 *    a user to think they have selected something meaningful.
 * 3. **The action bar appears only while something is picked.** A permanent
 *    second toolbar over the diff would compete with the hunk strip above it
 *    and push the code down for a feature most files never need.
 */
import { React, h } from '../../core/runtime.js'
import { Spinner } from '../../ui/spinner.js'

/** One pick per change line: `{ [hunkIndex]: Set<lineIndex> }`. */
function emptySelection() {
  return new Map()
}

/** How many lines are picked across every hunk. */
function selectionSize(selection) {
  var total = 0
  selection.forEach(function (lines) { total += lines.size })
  return total
}

/**
 * The "stage these lines" bar.
 *
 * @param props - `{ t, count, actions, busy, error, onAct, onClear }`.
 */
function LinePickBar(props) {
  var t = props.t
  var busy = props.busy === true
  return h('div', { key: 'linebar', className: 'dshgit-linebar', 'data-line-bar': 'true', role: 'region',
    'aria-label': t('line.selected', { count: props.count }) }, [
    h('span', { key: 'count', className: 'dshgit-linebar-count' }, t('line.selected', { count: props.count })),
    h('span', { key: 'spacer', className: 'dshgit-linebar-spacer' }),
    h('button', { key: 'clear', type: 'button', className: 'dshgit-btn', disabled: busy,
      'data-line-clear': 'true', onClick: props.onClear }, t('line.clear')),
    props.actions.map(function (action) {
      return h('button', {
        key: action, type: 'button',
        className: 'dshgit-btn' + (action === 'discard' ? ' dshgit-btn-danger' : ''),
        'data-line-action': action, disabled: busy,
        onClick: function () { props.onAct(action) },
      }, busy ? h(Spinner, { className: 'dshgit-spinner', 'aria-hidden': true }) : t('hunk.action' + action.charAt(0).toUpperCase() + action.slice(1)))
    }),
    props.error ? h('span', { key: 'error', role: 'alert', className: 'dshgit-muted' }, props.error) : null,
  ])
}

/**
 * Own the pick set and expose `pickFor`, which `DiffBody` calls per row.
 *
 * @param props - `{ t, enabled, actions, onActLines, confirm, staging }`.
 *   `staging` is the `useFileHunks` result, shared with the hunk strip so the
 *   two cannot disagree about which file side is being written.
 */
function useLinePicker(props) {
  var state = React.useState(emptySelection)
  var selection = state[0]
  var setSelection = state[1]
  // Selections belong to one file: switching files must not carry them over.
  var key = props.fileKey || ''
  var keyRef = React.useRef(key)
  if (keyRef.current !== key) {
    keyRef.current = key
    if (selection.size > 0) setSelection(emptySelection())
  }

  var toggle = function (hunkIndex, lineIndex) {
    setSelection(function (current) {
      var next = new Map(current)
      var lines = new Set(next.get(hunkIndex) || [])
      if (lines.has(lineIndex)) lines.delete(lineIndex)
      else lines.add(lineIndex)
      if (lines.size === 0) next.delete(hunkIndex)
      else next.set(hunkIndex, lines)
      return next
    })
  }

  var clear = function () { setSelection(emptySelection()) }

  var pickFor = props.enabled === true ? function (row) {
    // Defensive: the renderer may hand over a row it already rejected, and a
    // crash here would blank the whole diff rather than one gutter cell.
    if (row === null || row === undefined) return null
    // Context lines have no side to move between, so they are not selectable.
    if (row.kind !== 'add' && row.kind !== 'del') return null
    if (!Number.isInteger(row.hunkIndex) || !Number.isInteger(row.lineIndex)) return null
    var picked = selection.get(row.hunkIndex)
    return {
      index: row.hunkIndex + ':' + row.lineIndex,
      selected: picked !== undefined && picked.has(row.lineIndex),
      disabled: props.busy === true,
      title: props.t('line.pick'),
      onPick: function () { toggle(row.hunkIndex, row.lineIndex) },
    }
  } : null

  var count = selectionSize(selection)
  var act = function (action) {
    if (count === 0) return
    var byHunk = {}
    selection.forEach(function (lines, hunkIndex) { byHunk[hunkIndex] = Array.from(lines) })
    var run = function () { props.onActLines(action, byHunk); clear() }
    // Discarding lines is as destructive as discarding a hunk, so it asks the
    // same question — with the line count in it.
    if (action === 'discard' && props.confirm) props.confirm(props.t('line.confirmDiscard', { count: count }), run)
    else run()
  }

  return {
    pickFor: pickFor,
    count: count,
    clear: clear,
    act: act,
    bar: count === 0 ? null : h(LinePickBar, {
      key: 'linebar', t: props.t, count: count, actions: props.actions,
      busy: props.busy === true, error: props.error, onAct: act, onClear: clear,
    }),
  }
}

export { useLinePicker, LinePickBar }

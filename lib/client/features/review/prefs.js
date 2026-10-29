/**
 * dsh-plugin-git — review switches for a rendered diff.
 *
 * The Host has accepted `ignoreWhitespace`, `ignoreAllSpace`, `wordDiff`, `algorithm`
 * and `contextLines` for a long time, but the panel sent none of them, so a commit
 * that reformatted a block before changing one line was unreadable and the settings
 * looked decorative.
 *
 * Three decisions:
 *
 * 1. **A popover, not four switches in the toolbar.** These are set once per review
 *    session and then left alone, while the toolbar is where the per-file actions live;
 *    four inline switches would push those out.
 * 2. **Only non-default values are sent.** A plain `git diff` must stay plain, or the
 *    output log stops matching what the user's terminal shows.
 * 3. **The chosen values are visible on the trigger.** A reviewer who forgot that
 *    "ignore whitespace" is on will misread a patch, so the button says how many
 *    switches are active instead of looking identical either way.
 */
import { React, h } from '../../core/runtime.js'
import { ComboBox } from '../../ui/controls.js'
import { getReviewPrefs, setReviewPrefs, subscribeReviewPrefs } from '../../core/preferences.js'

/**
 * The review-switch popover.
 *
 * @param props - `{ t }`.
 */
function ReviewPrefsButton(props) {
  var t = props.t
  var state = React.useState(function () { return getReviewPrefs() })
  var prefs = state[0]
  var openState = React.useState(false)
  var open = openState[0]
  var rootRef = React.useRef(null)

  React.useEffect(function () { return subscribeReviewPrefs(function (next) { state[1](next) }) }, [])
  React.useEffect(function () {
    if (!open) return undefined
    var dismiss = function (event) { if (rootRef.current && !rootRef.current.contains(event.target)) openState[1](false) }
    var escape = function (event) { if (event.key === 'Escape') openState[1](false) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return function () {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  var update = function (patch) { state[1](setReviewPrefs(Object.assign({}, prefs, patch))) }
  var check = function (key, labelKey, titleKey) {
    return h('label', { key: key, className: 'dshgit-check', title: t(titleKey) }, [
      h('input', {
        key: 'input', type: 'checkbox', checked: prefs[key] === true,
        'data-review-flag': key,
        onChange: function (event) { update({ [key]: event.currentTarget.checked }) },
      }),
      t(labelKey),
    ])
  }

  // The count is what makes an active switch visible from the closed state; without
  // it, a reviewer reads a filtered diff as the whole change.
  var active = 0
  if (prefs.ignoreWhitespace) active++
  if (prefs.ignoreAllSpace) active++
  if (prefs.wordDiff) active++
  if (prefs.algorithm !== '') active++
  if (prefs.contextLines !== 3) active++

  return h('div', { key: 'reviewprefs', className: 'dshgit-reviewprefs', ref: rootRef }, [
    h('button', {
      key: 'trigger', type: 'button',
      className: 'dshgit-iconbtn' + (active > 0 ? ' dshgit-reviewprefs-on' : ''),
      'data-review-open': open ? 'true' : 'false',
      'aria-expanded': open, 'aria-haspopup': 'dialog',
      title: active > 0 ? t('review.hintActive', { count: active }) : t('review.title'),
      'aria-label': t('review.title'),
      onClick: function () { openState[1](!open) },
    }, active > 0 ? '⌥' + active : '⌥'),
    open
      ? h('div', {
        key: 'panel', className: 'dshgit-reviewpanel', role: 'dialog', 'aria-label': t('review.title'),
        'data-review-panel': 'true',
      }, [
        h('div', { key: 'note', className: 'dshgit-muted' }, t('review.hint')),
        check('ignoreWhitespace', 'review.ignoreWhitespace', 'review.ignoreWhitespaceHint'),
        check('ignoreAllSpace', 'review.ignoreAllSpace', 'review.ignoreAllSpaceHint'),
        check('wordDiff', 'review.wordDiff', 'review.wordDiffHint'),
        h('label', { key: 'algorithm', className: 'dshgit-reviewline' }, [
          h('span', { key: 'l' }, t('review.algorithm')),
          h(ComboBox, {
            key: 'combo', t: t, value: prefs.algorithm, label: t('review.algorithm'),
            options: [
              { value: '', label: t('review.algorithmDefault') },
              { value: 'histogram', label: 'histogram' },
              { value: 'patience', label: 'patience' },
            ],
            onChange: function (value) { update({ algorithm: value }) },
          }),
        ]),
        h('label', { key: 'context', className: 'dshgit-reviewline' }, [
          h('span', { key: 'l' }, t('review.context')),
          h(ComboBox, {
            key: 'combo', t: t, value: String(prefs.contextLines), label: t('review.context'),
            options: [3, 10, 25].map(function (count) {
              return { value: String(count), label: t('review.contextValue', { count: count }) }
            }),
            onChange: function (value) { update({ contextLines: Number(value) }) },
          }),
        ]),
        h('div', { key: 'reset', className: 'dshgit-reviewactions' }, [
          h('button', {
            key: 'reset', type: 'button', className: 'dshgit-btn', 'data-review-reset': 'true',
            onClick: function () {
              update({ ignoreWhitespace: false, ignoreAllSpace: false, wordDiff: false, algorithm: '', contextLines: 3 })
            },
          }, t('review.reset')),
        ]),
      ])
      : null,
  ])
}

export { ReviewPrefsButton }

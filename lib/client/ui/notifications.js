import { React, ReactDOM, h } from '../core/runtime.js'
import { IconAlert, IconCheck, IconClose, IconCopyPath } from './icons.js'

function NoticeSurface(props) {
  var node = React.useRef(null), host = React.useState(null), top = React.useState(null)
  React.useLayoutEffect(function () {
    if (props.placement === 'center') {
      host[1](node.current?.closest('.dshgit-fileviewer,.dshgit-workbench,.dshgit-popover') || document.body)
      top[1](null)
      return
    }
    var workbench = node.current?.closest('.dshgit-workbench')
    host[1](workbench || document.body)
    if (workbench) return
    var anchor = node.current?.closest('.dshgit-chipcluster') || document.querySelector('.dshgit-chipcluster')
    var update = function () { top[1](Math.max(80, anchor?.getBoundingClientRect().bottom + 8 || 80)) }
    update()
    var observer = typeof ResizeObserver === 'function' && anchor ? new ResizeObserver(update) : null
    if (observer) observer.observe(anchor)
    globalThis.addEventListener('resize', update)
    globalThis.addEventListener('scroll', update, true)
    return function () { observer?.disconnect(); globalThis.removeEventListener('resize', update); globalThis.removeEventListener('scroll', update, true) }
  }, [props.placement])
  var placementStyle = props.placement === 'center' ? {
    position: host[0] && host[0] !== document.body ? 'absolute' : 'fixed',
    top: '50%', left: '50%', right: 'auto', bottom: 'auto', transform: 'translate(-50%,-50%)',
  } : top[0] === null ? {} : { top: top[0] + 'px' }
  var content = h('div', { ref: node, className: props.className, role: props.role, style: Object.assign({}, props.style, placementStyle), title: props.title, 'data-tone': props['data-tone'], 'data-notice': props['data-notice'], 'data-placement': props.placement, 'aria-live': props['aria-live'], 'aria-label': props['aria-label'] }, props.children)
  return host[0] ? ReactDOM.createPortal(content, host[0]) : content
}


/** A transient banner used for action outcomes. */
function Toast(props) {
  var leaving = React.useState(false), tone = props.tone || 'success'
  var duration = props.duration ?? (props.action ? 8000 : tone === 'warning' ? 4500 : props.placement === 'center' && tone === 'success' ? 1800 : 3000)
  React.useEffect(
    function () {
      leaving[1](false)
      var exitTimer
      var timer = setTimeout(function () {
        leaving[1](true)
        exitTimer = setTimeout(props.onDone, 160)
      }, duration)
      return function () { clearTimeout(timer); clearTimeout(exitTimer) }
    },
    [props.seq, duration],
  )
  var content = [
    props.busy === true ? h('span', { key: 's', className: 'dshgit-spinner' }) : null,
    !props.busy ? h('span', { key: 'icon', className: 'dshgit-toast-icon', 'aria-hidden': true }, h(tone === 'error' || tone === 'warning' ? IconAlert : IconCheck, { size: 16 })) : null,
    h('span', { key: 't' }, props.text),
    props.action ? h('button', { key: 'action', type: 'button', className: 'dshgit-btn', style: { marginLeft: '8px' },
      onClick: function () { props.onDone(); props.action.run() },
    }, props.action.label) : null,
  ]
  return h(NoticeSurface, { className: 'dshgit-toast dshgit-toast-message' + (leaving[0] ? ' dshgit-toast-leaving' : ''),
    role: tone === 'error' ? 'alert' : 'status', placement: props.placement, 'data-tone': tone,
    style: props.action ? { pointerEvents: 'auto' } : undefined },
    h('span', { className: 'dshgit-toast-content' }, content))
}


/** Prepare paths only on demand; browsing and toast renders never scan files. */
function CopyFilePathsButton(props) {
  var toast = React.useState(null)
  var files = props.files || [], pending = React.useRef(false), mounted = React.useRef(true)
  var maxFiles = 100
  React.useEffect(function () { mounted.current = true; return function () { mounted.current = false } }, [])
  var label = props.t(props.history ? 'history.copyPaths' : 'action.copyPaths')
  return h(React.Fragment, null, [
    h('button', { key: 'button', type: 'button', className: 'dshgit-iconbtn', disabled: !files.length,
      'data-file-action': 'copy-paths', 'data-history-action': props.history ? 'copy-paths' : undefined,
      title: label, 'aria-label': label, onClick: function () {
        if (pending.current) return
        if (files.length > maxFiles) {
          toast[1]({ seq: Date.now(), tone: 'warning', text: props.t('copy.tooManyFiles', { count: files.length, limit: maxFiles }) })
          return
        }
        pending.current = true
        toast[1](null)
        Promise.resolve().then(function () {
          var paths = [], seen = new Set()
          for (var index = 0; index < files.length; index++) {
            var path = files[index].path
            if (path && !seen.has(path)) { seen.add(path); paths.push(path) }
          }
          return navigator.clipboard.writeText(paths.join('\n'))
        })
          .then(function () { if (mounted.current) toast[1]({ seq: Date.now(), tone: 'success', text: props.t('diff.copied') }) })
          .catch(function () { if (mounted.current) toast[1]({ seq: Date.now(), tone: 'error', text: props.t('diff.copyFailed') }) })
          .finally(function () { pending.current = false })
      },
    }, h(IconCopyPath, { size: 16 })),
    toast[0] ? h(Toast, { key: 'toast', placement: 'center', tone: toast[0].tone, seq: toast[0].seq, text: toast[0].text,
      onDone: function () { toast[1](null) } }) : null,
  ])
}


/**
 * The outcome of a Git action, shown next to the chips that started it.
 *
 * Replaces a bare `<span>` that printed the raw message in error-red at a
 * fixed 220px. That had five problems, all of them visible in one screenshot:
 *
 *   1. It printed git's raw stderr, which leads with the URL and repeats
 *      `error: failed to push some refs` — the sentence that says what to DO
 *      was last, and clipped.
 *   2. 220px + `text-overflow: ellipsis` cut the reason off mid-word.
 *   3. It was ALWAYS red, so a successful push read as a failure.
 *   4. It sat inline in the chip row, so a long message squeezed the chips.
 *   5. It had no icon, no dismissal, and no way to see the full text.
 *
 * This banner instead: a tone (success/error) that drives colour AND icon, a
 * one-line summary, an optional plain-language hint plus the action that
 * resolves it, a dismiss control, and the full raw text on demand.
 *
 * It renders into the chip row but is absolutely positioned below it, so it
 * can never push the chips around. Success auto-dismisses; an error does not,
 * because a failure the user did not read is a failure they will hit again.
 *
 * @param props - `{ outcome, onDismiss, onAction, onDetails, t }`.
 */
function ChipNotice(props) {
  var t = props.t
  var outcome = props.outcome
  var failed = outcome.tone === 'error'
  var summary = outcome.summary
  // The full text is only worth a disclosure when it says MORE than the
  // summary already did — otherwise the toggle would expand to a repeat.
  var hasDetail = typeof outcome.detail === 'string' && outcome.detail.trim() !== '' &&
    outcome.detail.trim() !== summary

  return h(NoticeSurface, {
    className: 'dshgit-notice',
    'data-tone': outcome.tone,
    'data-notice': outcome.id,
    role: failed ? 'alert' : 'status',
    // Errors interrupt a screen reader immediately; successes wait their turn.
    'aria-live': failed ? 'assertive' : 'polite',
  }, [
    h('span', { key: 'i', className: 'dshgit-noticeicon', 'aria-hidden': 'true' },
      failed ? h(IconAlert, { size: 14 }) : h(IconCheck, { size: 14 })),
    h('div', { key: 'body', className: 'dshgit-noticebody' }, [
      h('div', { key: 'text', className: 'dshgit-noticetext', title: outcome.detail || summary, style: failed ? { whiteSpace: 'pre-wrap', maxHeight: '240px', overflow: 'auto' } : undefined }, summary),
      hasDetail && props.detailsOpen === true
        ? h('pre', { key: 'detail', className: 'dshgit-noticedetail' }, outcome.detail)
        : null,
    ]),
    hasDetail
      ? h('button', {
          key: 'details',
          type: 'button',
          className: 'dshgit-noticebtn',
          title: t('notice.details'),
          'aria-label': t('notice.details'),
          'aria-expanded': props.detailsOpen === true,
          onClick: props.onDetails,
        }, props.detailsOpen === true ? t('notice.hideDetails') : t('notice.details'))
      : null,
    // The fix, when the plugin knows it. This is the whole point of
    // classifying the failure: a dead end becomes one click.
    outcome.action === null || outcome.action === undefined
      ? null
      : h('button', {
          key: 'action',
          type: 'button',
          className: 'dshgit-noticebtn dshgit-noticebtn-primary',
          onClick: function () { props.onAction(outcome.action) },
        }, outcome.action.label),
    h('button', {
      key: 'close',
      type: 'button',
      className: 'dshgit-noticeclose',
      title: t('action.close'),
      'aria-label': t('action.close'),
      onClick: props.onDismiss,
    }, h(IconClose, { size: 12 })),
  ])
}


/**
 * Render the Git workbench.
 *
 * @param props - slot props (`connection` is injected by the registration).
 * @returns the panel element tree.
 */
function OperationProgress(props) {
  var job = props.job
  var label = job.command || props.t('lfs.running')
  return h(NoticeSurface, { className: 'dshgit-progress', role: 'status', 'aria-label': props.t('lfs.progress'), title: [label, job.progress].filter(Boolean).join('\n') }, [
    h('span', { key: 'spinner', className: 'dshgit-progress-spinner', 'aria-hidden': true }),
    h('span', { key: 'label', className: 'dshgit-progress-label' }, label),
    props.onCancel ? h('button', { key: 'cancel', type: 'button', className: 'dshgit-progress-cancel', title: props.t('lfs.cancel'), 'aria-label': props.t('lfs.cancel'), onClick: props.onCancel }, h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true }, h('path', { d: 'M4 4l8 8M12 4l-8 8' }))) : null,
  ])
}

export { ChipNotice, CopyFilePathsButton, OperationProgress, Toast }

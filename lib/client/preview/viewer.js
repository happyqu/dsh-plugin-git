import { Fragment, React, ReactDOM, h } from '../core/runtime.js'
import { readPreviewMode, writePreviewMode } from '../core/preferences.js'
import { PreviewModeControls, PreviewRefreshButton, usePreviewWrap } from './controls.js'
import { PaneResizeHandle, beginResize, endResizeWith, moveResize } from '../ui/resize.js'
import { useRepositoryUpdates } from '../core/repository.js'
import { callRpc } from '../core/rpc.js'
import { isImagePath } from '../core/files.js'
import { DiffBody, FilePreview, readAnnotatedPreview } from './code.js'
import { windowState } from '../core/state.js'
import { ImageDiffView } from './images.js'
import { IconChanges, IconResize, svg } from '../ui/icons.js'

/**
 * The file viewer: one changed file, as its diff or its full contents.
 *
 * A modal window rather than a popover. Reading a file needs room, wants to
 * be resizable, and must outlive the commit popover that opened it — a
 * popover closes on the first outside click, which is exactly what clicking a
 * file row would otherwise cause.
 *
 * It fetches on its own: the commit popover holds a file LIST, not file
 * bodies, so sending the diff/content for every changed file up front would
 * be wasted work on a large working tree.
 *
 * @param props - `{ repo, path, kind, files, onNavigate, onClose, onStage,
 *   connection, t }`.
 */
function FileViewer(props) {
  var t = props.t
  var path = props.path
  var kind = React.useMemo(function () { return props.kind }, [props.repo?.root, path])
  var stale = React.useState(false), previewRetry = React.useState(0)
  var bodyRef = React.useRef(null)
  var requestRef = React.useRef(0)

  /** Whether this file has no patch to show. */
  var untracked = kind === 'untracked' || kind === 'added'

  // `diff` shows the patch; `content` shows the file itself.
  //
  // A brand-new file has no patch (there is nothing to diff against), so it
  // opens as its contents — a "no diff" panel for a file the user just
  // created would look broken rather than empty.
  var defaultMode = untracked ? 'content' : readPreviewMode(props.repo?.root, path, 'diff')
  // The mode is remembered per FILE. The component instance survives
  // navigation (so wrap/size persist), which means storing a bare mode would
  // carry one file's manual toggle onto the next. Keying by path makes a
  // stale mode apply to nothing, without an extra effect or a wasted fetch.
  var modeKey = path + (untracked ? ':u' : ':t')
  var modeState = React.useState({ key: modeKey, mode: defaultMode })
  var mode = modeState[0].key === modeKey ? modeState[0].mode : defaultMode
  var setMode = function (next) { writePreviewMode(props.repo?.root, path, next); modeState[1]({ key: modeKey, mode: next }) }
  var wrapState = usePreviewWrap(), wrap = wrapState[0]
  // Size is per-viewer and starts at the stylesheet default; `null` means
  // "let the CSS decide", which is what keeps it responsive until the user
  // actually drags the grip.
  var sizeState = React.useState(null)
  var size = sizeState[0]
  var setSize = sizeState[1]
  var expandedState = React.useState(false), expanded = expandedState[0]
  var positionState = React.useState(null)
  var viewportState = React.useState({ width: window.innerWidth, height: window.innerHeight })
  var dragRef = React.useRef(null)
  React.useEffect(function () {
    var resizeViewport = function () { viewportState[1]({ width: window.innerWidth, height: window.innerHeight }) }
    window.addEventListener('resize', resizeViewport)
    return function () { window.removeEventListener('resize', resizeViewport); dragRef.current = null }
  }, [])
  var viewport = viewportState[0]
  var normalWidth = Math.min(size?.width || Math.min(1180, viewport.width * .94), viewport.width - 24)
  var normalHeight = Math.min(size?.height || Math.min(740, viewport.height * .86), viewport.height - 72)
  var clampPosition = function (x, y) {
    return { x: Math.max(12, Math.min(x, viewport.width - normalWidth - 12)),
      y: Math.max(56, Math.min(y, viewport.height - normalHeight - 12)) }
  }
  var position = positionState[0] || { x: (viewport.width - normalWidth) / 2, y: (viewport.height - normalHeight) / 2 + 22 }
  position = clampPosition(position.x, position.y)
  var startDrag = function (event) {
    if (expanded || event.button !== 0 || event.target.closest('button,input,select,textarea,a,[role="button"]')) return
    var node = bodyRef.current, rect = node.getBoundingClientRect()
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
    node.setPointerCapture(event.pointerId)
    event.preventDefault(); event.stopPropagation()
  }
  var movePointer = function (event) {
    var drag = dragRef.current
    if (!drag) { moveResize(event); return }
    if (drag.pointerId !== event.pointerId) return
    drag.position = clampPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y)
    Object.assign(bodyRef.current.style, { left: drag.position.x + 'px', top: drag.position.y + 'px' })
  }
  var finishPointer = function (event) {
    var drag = dragRef.current
    if (!drag) { endResize(event); return }
    if (drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (drag.position) positionState[1](drag.position)
    if (bodyRef.current?.hasPointerCapture(event.pointerId)) bodyRef.current.releasePointerCapture(event.pointerId)
  }
  var root = props.repo === null ? null : props.repo.root
  var previewEpoch = React.useRef(0)
  useRepositoryUpdates(root, true, function (method, payload) { return callRpc(props.connection, method, payload, undefined) }, false, function (snapshot) {
    if (snapshot.previewChanged === false) return
    previewEpoch.current++; stale[1](true)
  }, path)
  React.useEffect(function () { stale[1](false) }, [root, path])
  var contentKey = JSON.stringify([root, path, kind])
  var diffState = React.useState(null)
  var diff = diffState[0]?.key === contentKey ? diffState[0].value : null
  var setDiff = function (value) { diffState[1]({ key: contentKey, value: value }) }
  // Kept alongside the text diff: an image has no hunks, so its comparison
  // is what the diff mode renders instead.
  var imageDiffState = React.useState(null)
  var imageDiff = imageDiffState[0]?.key === contentKey ? imageDiffState[0].value : null
  var setImageDiff = function (value) { imageDiffState[1]({ key: contentKey, value: value }) }
  var blobState = React.useState(null)
  var blob = blobState[0]?.key === contentKey ? blobState[0].value : null
  var setBlob = function (value) { blobState[1]({ key: contentKey, value: value }) }
  var failureState = React.useState(null)
  var failure = failureState[0]
  var setFailure = failureState[1]

  // Load whichever representation is showing. Re-runs when the file OR the
  // mode changes, so switching to Diff does not need its own click handler.
  React.useEffect(
    function () {
      if (root === null) return
      var requestId = ++requestRef.current
      var stopped = false
      setFailure(null)
      var readEpoch = previewEpoch.current
      if (kind === 'unmerged') return
      if (mode === 'diff') {
        // Keep the current file visible while repository state revalidates.
        // A different file has a different key and still starts with loading.
        // `to: 'HEAD'` is the working tree against the last commit. The
        // response carries per-file hunks, so the wanted file is picked out
        // by path rather than re-running git with a pathspec.
        callRpc(props.connection, 'diff', { root: root, to: 'HEAD', path: path }, undefined)
          .then(function (value) {
            if (stopped || requestRef.current !== requestId) return
            setDiff(value); if (previewEpoch.current === readEpoch) stale[1](false)
          })
          .catch(function (error) {
            if (stopped || requestRef.current !== requestId) return
            setFailure(error.message)
          })
        if (isImagePath(path)) {
          callRpc(props.connection, 'imageDiff', { root: root, path: path, from: 'HEAD' }, undefined)
            .then(function (value) {
              if (stopped || requestRef.current !== requestId) return
              setImageDiff(value?.image === true ? value : null)
            })
            .catch(function () {
              if (stopped || requestRef.current !== requestId) return
              setImageDiff(null)
            })
        }
      } else {
        readAnnotatedPreview(callRpc(props.connection, 'fileContent', { root: root, path: path }, undefined), untracked || isImagePath(path) ? null : function () {
          return callRpc(props.connection, 'diff', { root: root, to: 'HEAD', path: path }, undefined)
        }, path, untracked)
          .then(function (value) {
            if (stopped || requestRef.current !== requestId) return
            setBlob(value); if (previewEpoch.current === readEpoch) stale[1](false)
          })
          .catch(function (error) {
            if (stopped || requestRef.current !== requestId) return
            setFailure(error.message)
          })
      }
      return function () { stopped = true }
    },
    [root, path, mode, kind, previewRetry[0]],
  )

  // Escape closes the viewer. Nothing else listens: the viewer is the top
  // surface while it is open.
  React.useEffect(
    function () {
      var onKey = function (event) {
        if (event.key !== 'Escape' || props.blockedByDialog || event.target?.closest?.('[role="alertdialog"]')) return
        event.stopPropagation()
        props.onClose()
      }
      document.addEventListener('keydown', onKey, true)
      return function () { document.removeEventListener('keydown', onKey, true) }
    },
    [props.onClose, props.blockedByDialog],
  )

  // Where the current file sits in the changed-file list, so the footer can
  // page through them. -1 when the list does not contain it (a stale path).
  var order = props.files || []
  var index = order.indexOf(path)
  var previous = index > 0 ? order[index - 1] : null
  var next = index >= 0 && index < order.length - 1 ? order[index + 1] : null

  /**
   * Begin a resize of this viewer.
   *
   * @param event - the pointer-down event.
   */
  var startResize = function (event) {
    if (expanded) return
    var rect = bodyRef.current.getBoundingClientRect()
    positionState[1]({ x: rect.left, y: rect.top })
    beginResize(event, bodyRef)
    if (windowState.resize) {
      var bounds = windowState.resize.bounds
      bounds.maxWidth = Math.max(1, viewport.width - rect.left - 12)
      bounds.maxHeight = Math.max(1, viewport.height - rect.top - 12)
      bounds.minWidth = Math.min(bounds.minWidth, bounds.maxWidth)
      bounds.minHeight = Math.min(bounds.minHeight, bounds.maxHeight)
    }
  }

  /** Commit one resize gesture's dimensions into this viewer's own size. */
  var endResize = function (event) {
    endResizeWith(event, setSize)
  }

  // `null` until the user actually drags the grip, which is what lets the
  // stylesheet's responsive default hold until then.
  var style = expanded ? null : { width: normalWidth + 'px', height: normalHeight + 'px', left: position.x + 'px', top: position.y + 'px', transform: 'none' }

  var files = props.files || []
  var diffFiles = diff === null ? [] : (diff.files || [])
  var shown = diffFiles.filter(function (file) { return file.path === path })
  var hunks = shown.length > 0 ? shown[0].hunks : (diff === null ? [] : diff.hunks)

  var body = null
  if (kind === 'unmerged') {
    body = props.renderConflict?.(path)
  } else if (failure !== null && (mode === 'content' ? blob === null : diff === null)) {
    body = h('div', { className: 'dshgit-err', style: { padding: '12px 14px' } }, failure)
  } else if (mode === 'content') {
    body = h(FilePreview, { blob: blob, path: path, wrap: wrap, t: t })
  } else if (diff === null) {
    body = h('div', { className: 'dshgit-empty' }, t('state.loading'))
  } else if (imageDiff !== null && imageDiff !== undefined && imageDiff.image === true) {
    // This viewer diffs the working tree against HEAD, so the sides are
    // HEAD and the working tree.
    body = h(ImageDiffView, { data: imageDiff, path: path, t: t })
  } else if (hunks === undefined || hunks === null || hunks.length === 0) {
    body = h('div', { className: 'dshgit-empty' }, t('state.diffEmpty'))
  } else {
    body = h(DiffBody, { t: t, path: path, hunks: hunks, wrap: wrap, emptyText: t('state.diffEmpty') })
  }

  return ReactDOM.createPortal(h(Fragment, null, [
    h('div', { key: 'scrim', className: 'dshgit-viewerscrim', onClick: props.onClose }),
    h('div', {
      key: 'viewer',
      ref: bodyRef,
      className: 'dshgit-fileviewer', 'data-preview-root': props.repo.root, 'data-preview-revision': props.staged ? 'staged' : 'worktree',
      role: 'dialog',
      'aria-label': path,
      'data-file-viewer': path,
      'data-maximized': expanded,
      'data-wrap': wrap === true ? 'true' : 'false',
      style: style,
      onPointerMove: movePointer,
      onPointerUp: finishPointer,
      onPointerCancel: finishPointer,
      onLostPointerCapture: finishPointer,
    }, [
      h('div', { key: 'head', className: 'dshgit-fileviewerhead', 'data-draggable': !expanded, onPointerDown: startDrag }, [
        h(IconChanges, { key: 'i', size: 14 }),
        h('span', { key: 'p', className: 'dshgit-fileviewerpath', title: path }, path),
        kind !== 'unmerged' ? h(PreviewRefreshButton, { key: 'refresh', t: t, stale: stale[0], error: failure, onRefresh: function () { previewRetry[1](function (value) { return value + 1 }) } }) : null,
        kind !== 'unmerged' ? h(PreviewModeControls, { key: 'controls', t: t, content: mode === 'content', onToggle: function () { setMode(mode === 'diff' ? 'content' : 'diff') } }) : null,
        h('button', { key: 'maximize', type: 'button', className: 'dshgit-iconbtn',
          title: t(expanded ? 'fileViewer.restore' : 'fileViewer.maximize'),
          'aria-label': t(expanded ? 'fileViewer.restore' : 'fileViewer.maximize'), 'aria-pressed': expanded,
          onClick: function () { expandedState[1](!expanded) },
        }, svg({ size: 16 }, expanded
          ? h('path', { d: 'M5 5V3h8v8h-2M3 5h8v8H3z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' })
          : h('rect', { x: 3, y: 3, width: 10, height: 10, rx: 1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }))),
        h('button', {
          key: 'x', type: 'button', className: 'dshgit-iconbtn',
          title: t('action.close'), 'aria-label': t('action.close'),
          onClick: props.onClose,
        }, '✕'),
      ]),
      h('div', { key: 'layout', className: 'dshgit-fileviewerlayout' }, [
        h('aside', { key: 'navigation', className: 'dshgit-fileviewernav' }, [h(PaneResizeHandle, { key: 'resize', t: t }), props.sidebar]),
        h('div', { key: 'body', className: 'dshgit-fileviewerbody' }, body),
      ]),
      h('div', { key: 'foot', className: 'dshgit-fileviewerfoot' }, [
        h('button', {
          key: 'prev', type: 'button', className: 'dshgit-iconbtn',
          title: t('action.previousFile'), 'aria-label': t('action.previousFile'),
          disabled: previous === null,
          onClick: function () { if (previous !== null) props.onNavigate(previous) },
        }, '‹'),
        h('span', { key: 'pos' }, index >= 0 ? (index + 1) + ' / ' + files.length : ''),
        h('button', {
          key: 'next', type: 'button', className: 'dshgit-iconbtn',
          title: t('action.nextFile'), 'aria-label': t('action.nextFile'),
          disabled: next === null,
          onClick: function () { if (next !== null) props.onNavigate(next) },
        }, '›'),
        h('span', { key: 'spacer', style: { flex: '1' } }),
        // Staging is offered whenever it would DO something. It deliberately
        // does not depend on which view is loaded: `blob` only exists in
        // content mode, so keying off it would hide the action in diff mode —
        // exactly where someone reading a patch decides to stage it.
        // `busy` is the one exception: the write layer refuses a second write
        // in silence, so a live-looking button mid-commit is a dead control.
        props.staged !== true && kind !== 'unmerged'
          ? h('button', {
              key: 'stage', type: 'button', className: 'dshgit-pickinline',
              disabled: props.busy === true,
              title: props.busy === true ? t('state.busy') : undefined,
              onClick: function () { props.onStage(path) },
            }, t('action.stage'))
          : null,
        // The grip starts its own gesture; without it the dialog would be
        // fixed at its default size and long lines would be unreadable.
        !expanded && h('button', {
          key: 'resize', type: 'button', className: 'dshgit-resize',
          title: t('window.resizeHint'), 'aria-label': t('window.resizeHint'),
          onPointerDown: startResize,
        }, h(IconResize, {})),
      ]),
    ]),
  ]), document.body)
}

export { FileViewer }

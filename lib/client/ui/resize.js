import { React, h } from '../core/runtime.js'
import { windowState } from '../core/state.js'

function PaneResizeHandle(props) {
  var drag = React.useRef(null)
  return h('div', { className: 'dshgit-pane-grip', title: props.t('batch.resize'), role: 'separator', 'aria-orientation': 'vertical', 'aria-label': props.t('batch.resize'),
    onPointerDown: function (event) { event.preventDefault(); event.stopPropagation(); drag.current = { x: event.clientX, width: event.currentTarget.parentElement.getBoundingClientRect().width }; event.currentTarget.setPointerCapture(event.pointerId) },
    onPointerMove: function (event) { if (!drag.current) return; var pane = event.currentTarget.parentElement; pane.style.width = Math.max(180, Math.min(pane.parentElement.clientWidth * .6, drag.current.width + event.clientX - drag.current.x)) + 'px' },
    onPointerUp: function () { drag.current = null }, onPointerCancel: function () { drag.current = null },
  })
}


/**
 * The floor and ceiling a resize may not cross.
 *
 * Below the minimum the header's own controls wrap and the body becomes a
 * sliver; above the maximum the dialog covers the app it is a tool for. Both
 * bounds are derived from the viewport so a small screen is never given a
 * dialog it cannot fit.
 *
 * @returns `{ minWidth, minHeight, maxWidth, maxHeight }`.
 */
function resizeBounds() {
  var viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1440
  var viewportHeight = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 900
  // A header plus one readable row is the smallest useful box.
  return {
    minWidth: Math.min(420, viewportWidth - 16),
    minHeight: Math.min(320, viewportHeight - 16),
    maxWidth: Math.max(160, viewportWidth - 16),
    maxHeight: Math.max(120, viewportHeight - 16),
  }
}


/**
 * Begin a resize from a dialog's corner grip.
 *
 * Shared by the workbench window and the file viewer: both are centred
 * dialogs, so growing one moves its right edge by the full pointer delta and
 * it stays centred — no left/top pinning is needed.
 *
 * @param event - the pointer-down event.
 * @param ref - the dialog's node ref.
 */
function beginResize(event, ref) {
  if (event.button !== undefined && event.button !== 0) return
  var node = ref === null || ref === undefined ? null : ref.current
  if (node === null || node === undefined) return
  var rect = typeof node.getBoundingClientRect === 'function'
    ? node.getBoundingClientRect()
    : { width: 0, height: 0 }
  var bounds = resizeBounds()
  windowState.resize = {
    pointerId: event.pointerId,
    node: node,
    startX: event.clientX,
    startY: event.clientY,
    // Measured once at gesture start, so each frame is computed from an
    // absolute origin. Accumulating per-frame deltas drifts.
    startWidth: rect.width || node.offsetWidth || bounds.minWidth,
    startHeight: rect.height || node.offsetHeight || bounds.minHeight,
    bounds: bounds,
  }
  if (typeof node.setPointerCapture === 'function' && event.pointerId !== undefined) {
    try {
      node.setPointerCapture(event.pointerId)
    } catch (error) {
      // Capture is a nicety; the listeners still work without it.
    }
  }
  event.preventDefault()
  event.stopPropagation()
}


/**
 * Track a resize in progress.
 *
 * @param event - the pointer-move event.
 */
function moveResize(event) {
  var resize = windowState.resize
  if (resize === null || resize === undefined) return
  if (resize.pointerId !== undefined && event.pointerId !== undefined &&
      resize.pointerId !== event.pointerId) return
  var node = resize.node
  if (node === null || node === undefined) return
  var bounds = resize.bounds
  var width = Math.max(bounds.minWidth,
    Math.min(resize.startWidth + (event.clientX - resize.startX), bounds.maxWidth))
  var height = Math.max(bounds.minHeight,
    Math.min(resize.startHeight + (event.clientY - resize.startY), bounds.maxHeight))
  node.style.width = width + 'px'
  node.style.height = height + 'px'
  // The stylesheet's `max-height` was sized for the default box, so it
  // would silently clamp a deliberately taller dialog.
  node.style.maxHeight = 'none'
  resize.lastWidth = width
  resize.lastHeight = height
}


/**
 * Finish a resize, reporting the size the user chose.
 *
 * @param event - the pointer-up event, if any.
 * @param onCommit - called with `{ width, height }` when the gesture moved.
 */
function endResizeWith(event, onCommit) {
  var resize = windowState.resize
  if (resize === null || resize === undefined) return
  if (event && resize.pointerId !== undefined && event.pointerId !== undefined &&
      resize.pointerId !== event.pointerId) return
  windowState.resize = null
  if (resize.lastWidth !== undefined && resize.lastHeight !== undefined) {
    onCommit({ width: resize.lastWidth, height: resize.lastHeight })
  }
  var node = resize.node
  if (node !== null && node !== undefined &&
      typeof node.releasePointerCapture === 'function' && resize.pointerId !== undefined) {
    try {
      node.releasePointerCapture(resize.pointerId)
    } catch (error) {
      // Already released; nothing to do.
    }
  }
}

export { PaneResizeHandle, beginResize, endResizeWith, moveResize }

/** Anchor a bounded popover to its trigger, flipping above when space is tight. */
export function popoverPosition(anchor, options, viewport) {
  var margin = 8, gap = 6
  var width = Math.min(options.width || 380, Math.max(0, viewport.width - margin * 2))
  var start = Number.isFinite(anchor.left) ? anchor.left : anchor.right - 120
  var left = Math.max(margin, Math.min(options.align === 'start' ? start : anchor.right - width, viewport.width - width - margin))
  var below = Math.max(0, viewport.height - anchor.bottom - gap - margin)
  var above = Math.max(0, (anchor.top ?? anchor.bottom) - gap - margin)
  var limit = options.maxHeight || 560
  var flip = below < Math.min(240, limit) && above > below
  var style = { left: left + 'px', width: width + 'px', maxHeight: Math.min(limit, flip ? above : below) + 'px' }
  if (flip) style.bottom = Math.max(margin, viewport.height - (anchor.top ?? anchor.bottom) + gap) + 'px'
  else style.top = Math.max(margin, anchor.bottom + gap) + 'px'
  return style
}

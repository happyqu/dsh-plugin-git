// One geometry model for navigation, search, overview and reading-position memory.
function previewScroller(node) {
  for (var parent = node?.parentElement; parent; parent = parent.parentElement) if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent
  return null
}

function previewViewport(code) {
  var scroller = previewScroller(code), box = scroller?.getBoundingClientRect()
  var top = Math.max(0, (box?.top || 0) + (scroller?.clientTop || 0)), bottom = Math.min(window.innerHeight, box ? box.top + scroller.clientTop + scroller.clientHeight : window.innerHeight)
  var surface = code?.closest('.dshgit-file-content,.dshgit-diff-preview')
  ;['.dshgit-findbar'].forEach(function (selector) {
    var toolbar = surface?.querySelector(selector)
    if (toolbar) top = Math.max(top, Math.min(bottom, toolbar.getBoundingClientRect().bottom))
  })
  return { scroller: scroller, top: top, bottom: bottom, height: Math.max(0, bottom - top), origin: (box?.top || 0) + (scroller?.clientTop || 0) }
}

function scrollPreviewRow(code, row, atTop, revealHorizontal) {
  if (!row) return
  var view = previewViewport(code), delta = row.getBoundingClientRect().top - view.top - (atTop ? 0 : view.height / 3)
  if (view.scroller) view.scroller.scrollTop += delta
  else window.scrollBy(0, delta)
  if (revealHorizontal && code) {
    var box = code.getBoundingClientRect(), match = row.getBoundingClientRect()
    var gutter = code.querySelector('.dshgit-diffgutter')?.getBoundingClientRect()
    var left = Math.max(box.left + code.clientLeft + 8, (gutter?.right || box.left) + 8)
    var right = box.left + code.clientLeft + code.clientWidth - 8
    if (match.left < left || match.width > right - left) code.scrollLeft += match.left - left
    else if (match.right > right) code.scrollLeft += match.right - right
  }
}

function visiblePreviewRows(code, rows) {
  rows = rows || code?.querySelectorAll('[data-preview-index]') || []
  var view = previewViewport(code), length = rows.length
  var lower = function (boundary, bottom) {
    var low = 0, high = length
    while (low < high) {
      var middle = (low + high) >>> 1, rect = rows[middle].getBoundingClientRect()
      if ((bottom ? rect.bottom : rect.top) <= boundary) low = middle + 1
      else high = middle
    }
    return low
  }
  // scrollTop rounds fractional line heights. Ignore sub-pixel remnants of
  // the preceding row so a jump reports the row it actually aligned.
  var first = Math.min(Math.max(0, length - 1), lower(view.top + 1, true)), end = Math.max(first + 1, lower(view.bottom, false))
  return { first: first, end: Math.min(length, end), view: view }
}
export { previewScroller, previewViewport, scrollPreviewRow, visiblePreviewRows }

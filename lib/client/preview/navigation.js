import { React } from '../core/runtime.js'
import { readWorkbenchStorage, writeWorkbenchStorage } from '../core/preferences.js'
import { previewScroller } from './scroll.js'

/** Bounded metadata only; never persist source text or run renders on scroll. */
function usePreviewMemory(ref, path, kind, page, setPage, ready, maxPage) {
  var session = React.useRef(null)
  React.useLayoutEffect(function () {
    var node = ref.current, scroller = previewScroller(node)
    if (!ready || !node || !scroller) return
    var root = node.closest('[data-preview-root]')?.getAttribute('data-preview-root') || ''
    var revision = node.closest('[data-preview-revision]')?.getAttribute('data-preview-revision') || node.closest('[data-history-commit]')?.getAttribute('data-history-commit') || 'worktree'
    var key = JSON.stringify([root, revision, path, kind])
    if (session.current?.key !== key) {
      var entries = readWorkbenchStorage('preview-positions', {})
      var saved = entries[key] || { page: 0, top: 0, left: 0 }
      session.current = { key, saved, restoring: true }
    }
    var current = session.current
    current.saved.page = Math.min(Math.max(0, Number(current.saved.page) || 0), maxPage)
    if (current.restoring && current.saved.page !== page) { setPage(current.saved.page); return }
    scroller.scrollTop = current.restoring ? current.saved.top : 0
    node.scrollLeft = current.restoring ? current.saved.left : 0
    current.restoring = false
    var timer
    // DOM updates may clamp scrollTop before effect cleanup. Retain the last
    // observed coordinates instead of reading the replacement file on exit.
    var last = { top: scroller.scrollTop, left: node.scrollLeft }
    var save = function () {
      var entries = readWorkbenchStorage('preview-positions', {})
      delete entries[key]; entries[key] = { page, top: last.top, left: last.left }
      Object.keys(entries).slice(0, Math.max(0, Object.keys(entries).length - 200)).forEach(function (old) { delete entries[old] })
      writeWorkbenchStorage('preview-positions', entries)
    }
    var schedule = function () { last = { top: scroller.scrollTop, left: node.scrollLeft }; clearTimeout(timer); timer = setTimeout(save, 250) }
    scroller.addEventListener('scroll', schedule); node.addEventListener('scroll', schedule); window.addEventListener('pagehide', save)
    return function () { clearTimeout(timer); save(); scroller.removeEventListener('scroll', schedule); node.removeEventListener('scroll', schedule); window.removeEventListener('pagehide', save) }
  }, [path, kind, page, ready, maxPage])
}

export { usePreviewMemory }

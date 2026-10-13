import { React, codePrimitives, h } from '../core/runtime.js'
import { usePreviewWrap } from './controls.js'
import { ImagePreview } from './images.js'
import { IconClose } from '../ui/icons.js'

/**
 * A small cache of highlight results, keyed by grammar + exact text.
 *
 * Tokenisation is the expensive part of rendering a code surface and it is
 * pure: the same text and grammar always produce the same tokens. Switching
 * between "文件内容" and "查看差异" unmounts one view and mounts the other,
 * so without a cache that lives OUTSIDE the components each toggle
 * re-tokenised from scratch — which is what made the toggle feel slow.
 *
 * An `undefined` result is deliberately NOT cached: it means the grammar is
 * still loading, and `useCodeHighlighter` re-renders once it arrives, at which
 * point the pass must run again. Caching that first `undefined` would pin the
 * view to plain text forever.
 *
 * Bounded, so a long session cannot retain every file it has ever shown.
 */
var highlightCache = new Map()

var HIGHLIGHT_CACHE_MAX = 24


// Pages are already bounded (1000 diff rows / 2000 file rows). Keep the
// loaded page mounted so scrolling never swaps code for placeholders.
function codeChunks(rows, renderRow) {
  return rows.map(renderRow)
}


function resetCodeScroll(node) {
  for (var parent = node?.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) parent.scrollTop = 0
  }
}


var CodeText = React.memo(function (props) {
  return h('span', { className: 'dshgit-codetext' }, props.matches?.length
    ? renderSearchTokens(props.tokens, props.text, props.matches, props.queryLength, props.activeMatch)
    : renderTokens(props.tokens, props.text))
})


function renderDiffRow(row) {
  if (row.header) return h('div', { key: row.key, className: 'dshgit-hunkhead', 'data-preview-index': row.key.slice(1) }, row.header)
  return h('div', { key: row.key, className: 'dshgit-diffrow' + (row.file ? ' dshgit-coderow' : ''), 'data-kind': row.kind, 'data-preview-index': row.key.slice(1) }, [
    h('span', { key: 'g', className: 'dshgit-diffgutter' }, [
      h('span', { key: 'o', className: 'dshgit-diffnum' }, row.left),
      h('span', { key: 'n', className: 'dshgit-diffnum' }, row.right),
    ]),
    h('span', { key: 'm', className: 'dshgit-diffmarker',
      'aria-label': row.kind === 'add' ? 'added' : row.kind === 'del' ? 'removed' : undefined },
      row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ''),
    h(CodeText, { key: 't', tokens: row.tokens, text: row.text, matches: row.matches, queryLength: row.queryLength, activeMatch: row.activeMatch }),
  ])
}


/**
 * Highlight `text`, reusing a cached result when there is one.
 *
 * @param highlight - the host tokenizer for the chosen grammar.
 * @param language - the grammar id, part of the cache key.
 * @param text - the exact text to tokenise.
 * @returns the tokens, or undefined when the grammar is not ready.
 */
function highlightCached(highlight, language, text) {
  if (typeof highlight !== 'function') return undefined
  var key = String(language) + '\u0000' + text
  var cached = highlightCache.get(key)
  if (cached !== undefined) {
    // Refresh recency: Map preserves insertion order, so re-inserting makes
    // the first key the least recently used.
    highlightCache.delete(key)
    highlightCache.set(key, cached)
    return cached
  }
  var value = highlight(text)
  if (Array.isArray(value)) {
    // Some host tokenizers reuse their output arrays. Snapshot each read so
    // highlighting the new side cannot overwrite the old side or the cache.
    value = value.map(function (line) {
      return Array.isArray(line) ? line.map(function (token) {
        return Object.assign({}, token, { style: token?.style ? Object.assign({}, token.style) : undefined })
      }) : undefined
    })
    if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
      highlightCache.delete(highlightCache.keys().next().value)
    }
    highlightCache.set(key, value)
  }
  return Array.isArray(value) ? value : undefined
}


/** An inline monospace diff body for one file's hunks. */
/**
 * Render a diff with syntax highlighting.
 *
 * A diff cannot be highlighted as one block. A hunk interleaves the old and
 * new file, and each side is its own contiguous program, so Shiki is handed
 * each side as a block and the tokens are handed back to that side's rows —
 * the same split DSH's own diff review uses. Highlighting the interleaved
 * lines as one text would mis-lex the moment a hunk boundary falls inside a
 * string or a comment.
 *
 * `path` selects the grammar; without it (or without the host highlighter)
 * this degrades to the plain text it used to render.
 */
// Bound each colour to 256 bands, keeping additions and deletions distinct.
function overviewBands(changes, total) {
  var bins = new Map()
  changes.forEach(function (change) {
    var slot = Math.min(255, Math.floor(change.index / Math.max(1, total) * 256))
    var key = slot + ':' + change.kind, previous = bins.get(key)
    bins.set(key, { index: previous ? previous.index : change.index, slot: slot, kind: change.kind })
  })
  return Array.from(bins.values()).sort(function (a, b) { return a.index - b.index })
}


function PreviewOverview(props) {
  var rail = React.useRef(null), viewport = React.useRef(null), pending = React.useRef(null), drag = React.useRef(null), dragFrame = React.useRef(0)
  React.useEffect(function () { return function () { cancelAnimationFrame(dragFrame.current) } }, [])
  React.useLayoutEffect(function () {
    var code = props.code.current, track = rail.current, thumb = viewport.current
    if (!code || !track || !thumb) return
    var scroller = code.parentElement
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    var frame = 0, rows = code.querySelectorAll('[data-preview-index]'), last = rows[rows.length - 1]
    var update = function () {
      frame = 0
      var box = code.getBoundingClientRect(), scrollBounds = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }
      var bounds = { top: Math.max(0, scrollBounds.top), bottom: Math.min(window.innerHeight, scrollBounds.bottom) }
      var available = Math.max(80, bounds.bottom - Math.max(bounds.top + 8, box.top) - 16)
      track.style.height = Math.min(available, Math.max(120, Math.sqrt(props.total) * 14)) + 'px'
      var height = last ? last.getBoundingClientRect().bottom - box.top : box.height
      var count = rows.length, total = Math.max(1, props.total)
      var top = Math.max(0, Math.min(1, (bounds.top - box.top) / Math.max(1, height)))
      var bottom = Math.max(top, Math.min(1, (bounds.bottom - box.top) / Math.max(1, height)))
      var thumbHeight = Math.min(100, Math.max(20 / track.clientHeight * 100, (bottom - top) * count / total * 100))
      thumb.style.top = Math.min(100 - thumbHeight, (props.start + top * count) / total * 100) + '%'
      thumb.style.height = thumbHeight + '%'
      track.setAttribute('aria-valuenow', String(Math.min(total - 1, Math.floor(props.start + top * count))))
    }
    var schedule = function () { if (!frame) frame = requestAnimationFrame(update) }
    var target = pending.current
    if (target !== null) {
      pending.current = null
      frame = requestAnimationFrame(function () {
        frame = 0
        var row = code.querySelector('[data-preview-index="' + target.index + '"]')
        if (row && scroller) scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (target.atTop ? 0 : scroller.clientHeight / 3)
        else if (row) window.scrollBy(0, row.getBoundingClientRect().top - (target.atTop ? 0 : window.innerHeight / 3))
        update()
      })
    } else schedule()
    // Scroll and resize only move the indicator; code rows stay mounted.
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    observer?.observe(code); if (scroller) observer?.observe(scroller)
    return function () { window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); observer?.disconnect(); cancelAnimationFrame(frame) }
  }, [props.start, props.total, props.bands, props.code])
  var navigate = function (index, atTop) {
    index = Math.max(0, Math.min(props.total - 1, index))
    if (index >= props.start && index < props.start + props.size) {
      var row = props.code.current?.querySelector('[data-preview-index="' + index + '"]')
      if (row) {
        var scroller = props.code.current.parentElement
        while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
        if (scroller) scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (atTop ? 0 : scroller.clientHeight / 3)
        else window.scrollBy(0, row.getBoundingClientRect().top - (atTop ? 0 : window.innerHeight / 3))
      }
    } else { pending.current = { index: index, atTop: atTop }; props.onNavigate(index) }
  }
  var moveDrag = function () {
    dragFrame.current = 0
    var active = drag.current, track = rail.current
    if (!active || !track || Math.abs(active.y - active.origin) < 3) return
    var bounds = track.getBoundingClientRect()
    navigate(Math.floor((active.y - bounds.top - active.offset) / bounds.height * props.total), true)
  }
  return h('div', { ref: rail, className: 'dshgit-overview', role: 'slider', tabIndex: 0,
    title: props.t('batch.overview'), 'aria-label': props.t('batch.overview'), 'aria-orientation': 'vertical',
    'aria-valuemin': 0, 'aria-valuemax': Math.max(0, props.total - 1), 'aria-valuenow': props.start,
    onPointerDown: function (event) {
      if (event.button !== 0) return
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true })
      var bounds = event.currentTarget.getBoundingClientRect()
      var thumb = viewport.current.getBoundingClientRect(), inside = event.clientY >= thumb.top && event.clientY <= thumb.bottom
      drag.current = { pointer: event.pointerId, origin: event.clientY, y: event.clientY, offset: inside ? event.clientY - thumb.top : thumb.height / 2 }
      event.currentTarget.setPointerCapture(event.pointerId)
      if (!inside) navigate(Math.floor((event.clientY - bounds.top) / bounds.height * props.total))
    },
    onPointerMove: function (event) {
      if (drag.current?.pointer !== event.pointerId) return
      event.preventDefault(); drag.current.y = event.clientY
      if (!dragFrame.current) dragFrame.current = requestAnimationFrame(moveDrag)
    },
    onPointerUp: function (event) {
      if (drag.current?.pointer !== event.pointerId) return
      drag.current.y = event.clientY; cancelAnimationFrame(dragFrame.current); moveDrag(); drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onLostPointerCapture: function () { drag.current = null; cancelAnimationFrame(dragFrame.current); dragFrame.current = 0 },
    onPointerCancel: function () { drag.current = null; cancelAnimationFrame(dragFrame.current); dragFrame.current = 0 },
    onKeyDown: function (event) {
      var current = Number(event.currentTarget.getAttribute('aria-valuenow')), target
      if (event.key === 'Home') target = 0
      else if (event.key === 'End') target = props.total - 1
      else if (event.key === 'ArrowDown') target = props.bands.find(function (band) { return band.index > current })?.index ?? props.total - 1
      else if (event.key === 'ArrowUp') target = props.bands.slice().reverse().find(function (band) { return band.index < current })?.index ?? 0
      else return
      event.preventDefault(); navigate(target)
    },
  }, props.bands.map(function (band) {
    return h('span', { key: band.slot + ':' + band.kind, className: 'dshgit-overview-mark', 'data-kind': band.kind,
      style: { top: band.slot / 256 * 100 + '%', height: Math.max(0.4, 100 / Math.max(1, props.total)) + '%' } })
  }).concat(h('span', { key: 'viewport', ref: viewport, className: 'dshgit-overview-viewport' })))
}


function DiffBody(props) {
  var sharedWrap = usePreviewWrap(), wrap = props.wrap === undefined ? sharedWrap[0] : props.wrap
  // Called before ANY early return: React identifies hooks by call order, so a
  // hook placed after the empty-diff branch would change the order between
  // renders and corrupt this component's state.
  var highlight = (codePrimitives !== null && typeof codePrimitives.useCodeHighlighter === 'function')
    ? codePrimitives.useCodeHighlighter(grammarForFile(props.path))
    : function () { return undefined }
  var hunks = props.hunks || []
  var pageState = React.useState({ path: props.path, page: 0 })
  var page = pageState[0].path === props.path ? pageState[0].page : 0
  var codeNode = React.useRef(null)
  var lineCount = React.useMemo(function () { return hunks.reduce(function (total, hunk) { return total + hunk.lines.length + 1 }, 0) }, [hunks])
  page = Math.min(page, Math.max(0, Math.ceil(lineCount / 1000) - 1))
  React.useLayoutEffect(function () { resetCodeScroll(codeNode.current) }, [page, props.path])
  var pageSize = 1000, pageStart = page * pageSize, pageEnd = pageStart + pageSize
  var language = grammarForFile(props.path)
  // Keep colours in the same render as the text. Cache hits are immediate;
  // expensive generated hunks stay plain instead of repainting afterwards.
  var stableSides = React.useRef(null)
  var sides = React.useMemo(function () {
    if (stableSides.current?.hunks === hunks && stableSides.current.language === language) return stableSides.current.value
    var compute = function () {
      // Large patches remain plain throughout browsing, avoiding expensive
      // synchronous tokenisation and subsequent colour flashes.
      if (lineCount > 4000) return hunks.map(function () { return null })
      var budget = 128000
      return hunks.map(function (hunk) {
        var oldText = [], newText = [], chars = 0
        for (var i = 0; i < hunk.lines.length; i++) {
          var line = hunk.lines[i]
          chars += line.length
          if (line.length > 4000 || chars > budget || hunk.lines.length > 4000) return null
          if (line.charAt(0) !== '+') oldText.push(line.slice(1))
          if (line.charAt(0) !== '-') newText.push(line.slice(1))
        }
        budget -= chars
        return { old: highlightCached(highlight, language, oldText.join('\n')),
          new: highlightCached(highlight, language, newText.join('\n')) }
      })
    }
    var value = compute()
    stableSides.current = { hunks: hunks, language: language, value: value }
    return value
  }, [hunks, highlight, language, lineCount])
  if (hunks.length === 0) {
    return h('div', { className: 'dshgit-empty' }, props.emptyText)
  }
  var rows = []
  var key = 0
  for (var hi = 0; hi < hunks.length; hi++) {
    var hunk = hunks[hi]
    var side = sides[hi]
    // Each side advances independently: a context line belongs to both, an
    // addition only to the new file, a deletion only to the old one.
    var oldIndex = 0
    var newIndex = 0
    if (key >= pageEnd) break
    if (key >= pageStart) rows.push({ key: 'h' + key, header:
      '@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@' })
    key++
    var oldLine = hunk.oldStart
    var newLine = hunk.newStart
    for (var li = 0; li < hunk.lines.length; li++) {
      if (key >= pageEnd) break
      var line = hunk.lines[li]
      var marker = line.charAt(0)
      var kind = marker === '+' ? 'add' : marker === '-' ? 'del' : 'ctx'
      var left = kind === 'add' ? '' : String(oldLine)
      var right = kind === 'del' ? '' : String(newLine)
      if (kind !== 'add') oldLine++
      if (kind !== 'del') newLine++
      var lineTokens
      if (side !== null) {
        if (kind === 'add') { lineTokens = side.new == null ? undefined : side.new[newIndex]; newIndex++ }
        else if (kind === 'del') { lineTokens = side.old == null ? undefined : side.old[oldIndex]; oldIndex++ }
        else { lineTokens = side.new == null ? undefined : side.new[newIndex]; oldIndex++; newIndex++ }
      }
      if (key >= pageStart) rows.push({ key: 'l' + key, kind: kind, left: left, right: right,
        tokens: lineTokens, text: line.slice(1) })
      key++
    }
  }
  // `data-wrap` is what the word-wrap CSS keys off; the viewer sets it.
  return h('div', { ref: codeNode, className: 'dshgit-code dshgit-diffcode', style: { overflowAnchor: 'none' }, 'data-wrap': wrap === true ? 'true' : 'false' }, [
    h('div', { key: page, 'data-diff-page': page }, codeChunks(rows, renderDiffRow)),
    lineCount > pageSize ? h('div', { key: 'pages', className: 'dshgit-preview-more' }, [
      h('button', { key: 'previous', type: 'button', className: 'dshgit-btn', disabled: page === 0, onClick: function () { pageState[1]({ path: props.path, page: page - 1 }) } }, props.t ? props.t('lfs.previous') : '←'),
      h('span', { key: 'page' }, (page + 1) + ' / ' + Math.ceil(lineCount / pageSize)),
      h('button', { key: 'next', type: 'button', className: 'dshgit-btn', disabled: pageEnd >= lineCount, onClick: function () { pageState[1]({ path: props.path, page: page + 1 }) } }, props.t ? props.t('lfs.next') : '→'),
    ]) : null,
  ])
}


/**
 * Map a file path to a Shiki grammar id.
 *
 * Delegated to DSH's `languageForPath`, which owns the one extension →
 * grammar table the whole app shares. Returns undefined for an unknown
 * suffix, which is the signal to render plain text.
 *
 * @param path - the file path.
 * @returns a grammar id, or undefined.
 */
function grammarForFile(path) {
  if (codePrimitives === null || typeof codePrimitives.languageForPath !== 'function') return undefined
  try {
    return codePrimitives.languageForPath(path)
  } catch (error) {
    return undefined
  }
}


/**
 * Render one highlighted line's tokens.
 *
 * Shiki hands back `{ text, style }` per token with the colour already
 * resolved from the theme's CSS variables, so this only has to turn them
 * into spans — no palette of our own, and light/dark follow the app.
 *
 * @param tokens - one line's tokens, or undefined for plain text.
 * @param fallback - the raw line, used when there is nothing to highlight.
 * @returns a React child.
 */
function renderTokens(tokens, fallback) {
  if (!Array.isArray(tokens)) return fallback
  if (tokens.length === 0) return fallback
  // Colours may come from the host; displayed text must come from Git.
  if (tokens.map(function (token) { return token?.text || '' }).join('') !== fallback) return fallback
  return tokens.map(function (token, index) {
    // An empty token contributes nothing but a key; skip it so the DOM is
    // not padded with empty spans on every line.
    if (!token || token.text === '') return null
    return h('span', { key: index, style: token.style }, token.text)
  })
}


function renderSearchTokens(tokens, text, offsets, length, active) {
  if (!Array.isArray(tokens) || tokens.map(function (token) { return token?.text || '' }).join('') !== text) tokens = [{ text: text }]
  var position = 0, match = 0, children = []
  tokens.forEach(function (token, tokenIndex) {
    var value = token?.text || '', end = position + value.length, cursor = position, pieces = []
    while (cursor < end) {
      while (match < offsets.length && offsets[match] + length <= cursor) match++
      var offset = offsets[match], hit = offset !== undefined && cursor >= offset && cursor < offset + length
      var boundary = Math.min(end, hit ? offset + length : offset === undefined ? end : offset)
      var piece = value.slice(cursor - position, boundary - position)
      pieces.push(hit ? h('mark', { key: cursor, className: 'dshgit-find-hit' + (offset === active ? ' dshgit-find-active' : '') }, piece) : piece)
      cursor = boundary
    }
    children.push(h('span', { key: tokenIndex, style: token?.style }, pieces)); position = end
  })
  return children
}


// Publish content and its bounded patch together; never add markers in a
// second paint or fetch them in response to scrolling.
function readAnnotatedPreview(content, readChanges, path, allAdded) {
  return content.then(function (blob) {
    if (!blob?.exists || blob.binary || blob.truncated || blob.image) return blob
    if (allAdded) return Object.assign({}, blob, { allAdded: String(blob.text || '').length > 0 })
    if (!readChanges) return blob
    return readChanges().then(function (patch) {
      var file = (patch.files || []).find(function (file) { return file.path === path })
      return Object.assign({}, blob, { changeHunks: file?.hunks || patch.hunks || [], changesUnavailable: patch.tooLarge === true })
    }).catch(function () { return Object.assign({}, blob, { changesUnavailable: true }) })
  })
}


function fileContentRows(lines, hunks, allAdded) {
  var deleted = new Map(), added = new Set()
  ;(hunks || []).forEach(function (hunk) {
    // Zero-context deletions point at the preceding surviving line.
    var line = hunk.newLines === 0 ? hunk.newStart + 1 : Math.max(1, hunk.newStart)
    ;(hunk.lines || []).forEach(function (text) {
      if (text.charAt(0) === '-') {
        var removed = deleted.get(line) || []
        removed.push(text.slice(1)); deleted.set(line, removed)
      } else if (text.charAt(0) === '+') added.add(line++)
      else if (text.charAt(0) === ' ') line++
    })
  })
  var rows = [], oldLine = 1
  for (var index = 0; index <= lines.length; index++) {
    ;(deleted.get(index + 1) || []).forEach(function (text) {
      rows.push({ key: 'l' + rows.length, file: true, kind: 'del', left: String(oldLine++), right: '', text: text, index: -1 })
    })
    if (index === lines.length) break
    var isAdded = allAdded || added.has(index + 1)
    rows.push({ key: 'l' + rows.length, file: true, kind: isAdded ? 'add' : 'ctx',
      left: isAdded ? '' : String(oldLine++), right: String(index + 1), text: lines[index] || ' ', index: index })
  }
  return rows
}


/** Show the actual working-tree file with line numbers. */
function FilePreview(props) {
  var sharedWrap = usePreviewWrap(), wrap = props.wrap === undefined ? sharedWrap[0] : props.wrap
  var blob = props.blob
  var t = props.t
  // The highlighter hook must be called on EVERY render, before any early
  // return: React identifies hooks by call order, so calling it after the
  // loading/binary/truncated branches would change the order between
  // renders and corrupt the component's state.
  //
  // `codePrimitives` is a module constant, so the chosen hook identity is
  // stable for the life of the component — the branch cannot flip.
  var highlight = (codePrimitives !== null && typeof codePrimitives.useCodeHighlighter === 'function')
    ? codePrimitives.useCodeHighlighter(grammarForFile(props.path))
    : function () { return undefined }

  var page = React.useState({ path: props.path, index: 0 })
  var findOpen = React.useState(false), findState = React.useState({ path: props.path, query: '', index: 0, sensitive: false })
  var find = findState[0].path === props.path ? findState[0] : { path: props.path, query: '', index: 0, sensitive: false }
  var findInput = React.useRef(null), previewNode = React.useRef(null)
  var requestedPage = page[0].path === props.path ? page[0].index : 0
  var codeNode = React.useRef(null)
  var prepared = React.useMemo(function () {
    var text = String(blob?.text || '').replace(/\n$/, '')
    var lines = text.split(/\r?\n/, 20001)
    return { text: text, lines: lines }
  }, [blob])
  var rows = React.useMemo(function () { return fileContentRows(prepared.lines, blob?.changeHunks, blob?.allAdded) }, [prepared, blob])
  var matches = React.useMemo(function () {
    var byRow = new Map(), entries = [], total = 0
    if (!findOpen[0] || !find.query) return { byRow: byRow, entries: entries, total: total }
    var pattern = new RegExp(find.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), find.sensitive ? 'g' : 'gi')
    rows.forEach(function (row, index) {
      var offsets = [], hit; pattern.lastIndex = 0
      while ((hit = pattern.exec(row.text)) !== null) offsets.push(hit.index)
      if (!offsets.length) return
      var entry = { row: index, offsets: offsets, start: total }
      entries.push(entry); byRow.set(index, entry); total += offsets.length
    })
    return { byRow: byRow, entries: entries, total: total }
  }, [rows, find.query, find.sensitive, findOpen[0]])
  var matchIndex = Math.min(find.index, Math.max(0, matches.total - 1))
  var currentMatch = matches.entries.find(function (entry) { return matchIndex >= entry.start && matchIndex < entry.start + entry.offsets.length })
  var pendingFind = React.useRef(null)
  var moveMatch = function (step) { if (matches.total) findState[1](Object.assign({}, find, { index: (matchIndex + step + matches.total) % matches.total })) }
  var closeFind = function () { findOpen[1](false); previewNode.current?.focus({ preventScroll: true }) }
  React.useEffect(function () {
    var keydown = function (event) {
      var node = previewNode.current
      if (!node || event.defaultPrevented || node.getBoundingClientRect().width === 0) return
      var modal = document.querySelector('.dshgit-fileviewer')
      if (modal && !modal.contains(node)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        if (!node.contains(event.target) && event.target.closest?.('input,textarea,[contenteditable="true"]')) return
        event.preventDefault(); event.stopPropagation(); findOpen[1](true)
        if (findInput.current) { findInput.current.focus(); findInput.current.select() }
      } else if (findOpen[0] && event.key === 'Escape' && node.contains(event.target)) {
        event.preventDefault(); event.stopPropagation(); closeFind()
      }
    }
    window.addEventListener('keydown', keydown, true)
    return function () { window.removeEventListener('keydown', keydown, true) }
  }, [findOpen[0]])
  React.useLayoutEffect(function () { if (findOpen[0]) { findInput.current?.focus({ preventScroll: true }); findInput.current?.select() } }, [findOpen[0], props.path])
  var pageIndex = Math.min(requestedPage, Math.max(0, Math.ceil(rows.length / 2000) - 1))
  React.useLayoutEffect(function () { resetCodeScroll(codeNode.current) }, [pageIndex, props.path])
  React.useLayoutEffect(function () {
    pendingFind.current = currentMatch || null
    if (!currentMatch) return
    var targetPage = Math.floor(currentMatch.row / 2000)
    if (targetPage !== pageIndex) { page[1]({ path: props.path, index: targetPage }); return }
    codeNode.current?.querySelector('.dshgit-find-active')?.scrollIntoView({ block: 'center', inline: 'nearest' })
    pendingFind.current = null
  }, [matches, matchIndex, props.path])
  React.useLayoutEffect(function () {
    if (!pendingFind.current || Math.floor(pendingFind.current.row / 2000) !== pageIndex) return
    codeNode.current?.querySelector('.dshgit-find-active')?.scrollIntoView({ block: 'center', inline: 'nearest' })
    pendingFind.current = null
  }, [pageIndex])
  var start = pageIndex * 2000, limit = start + 2000
  var pageRows = React.useMemo(function () { return rows.slice(start, limit) }, [rows, start, limit])
  var firstLine = pageRows.find(function (row) { return row.index >= 0 })?.index ?? 0
  var lastLine = pageRows.slice().reverse().find(function (row) { return row.index >= 0 })?.index ?? -1
  // Bound tokenisation to the loaded page and guard generated long lines.
  // Rendering is windowed separately; colours never use a second paint.
  var visible = React.useMemo(function () {
    return prepared.lines.slice(firstLine, lastLine + 1).join('\n')
  }, [prepared, firstLine, lastLine])
  var bands = React.useMemo(function () {
    var changes = []
    rows.forEach(function (row, index) { if (row.kind !== 'ctx') changes.push({ index: index, kind: row.kind }) })
    return overviewBands(changes, rows.length)
  }, [rows])
  var language = grammarForFile(props.path)
  // Cached: toggling to the diff and back must not re-tokenise the file.
  var stableHighlight = React.useRef(null)
  var highlighted = React.useMemo(function () {
    if (stableHighlight.current?.prepared === prepared && stableHighlight.current.visible === visible && stableHighlight.current.language === language) return stableHighlight.current.value
    var value = blob?.exists === true && !blob.binary && !blob.truncated && visible.length <= 128000 && !prepared.lines.slice(firstLine, lastLine + 1).some(function (line) { return line.length > 4000 })
      ? highlightCached(highlight, language, visible) : undefined
    stableHighlight.current = { prepared: prepared, visible: visible, language: language, value: value }
    return value
  }, [visible, prepared, language, highlight])
  if (blob === null) return h('div', { className: 'dshgit-empty' }, t('state.loading'))
  if (blob.exists !== true) return h('div', { className: 'dshgit-empty' }, t('state.fileMissing'))
  // An image blob arrives as a data URL; `binary` is true for it because the
  // bytes are not text, so this test must come BEFORE the binary branch.
  if (typeof blob.image === 'string' && blob.image !== '') {
    return h(ImagePreview, { key: 'image', blob: blob, path: props.path, t: t })
  }
  if (/^version https:\/\/git-lfs.github.com\/spec\/v1\r?\n(?:ext-[^\n]*\r?\n)*oid sha256:[a-f0-9]{64}\r?\nsize \d+\s*$/.test(blob.text || '')) return h('div', { className: 'dshgit-empty', 'data-lfs-pointer': true }, t('lfs.pointerHint'))
  // Truncation is checked before `binary` so an oversized image reports
  // "too large" rather than the generic "binary" message.
  if (blob.truncated === true) return h('div', { className: 'dshgit-empty' }, t('state.fileTooLarge'))
  if (prepared.lines.length > 20000) return h('div', { className: 'dshgit-empty' }, t('state.fileTooLarge'))
  if (blob.binary === true) return h('div', { className: 'dshgit-empty' }, t('state.fileBinary'))
  // `data-wrap` is what the word-wrap CSS keys off; the viewer sets it.
  return h('div', { ref: previewNode, tabIndex: -1, className: 'dshgit-file-content' }, [findOpen[0] ? h('div', { key: 'find', className: 'dshgit-findbar', role: 'search' }, h('div', { className: 'dshgit-findpanel' }, [
    h('input', { key: 'input', ref: findInput, className: 'dshgit-input', placeholder: t('batch.findText'), 'aria-label': t('batch.findText'), value: find.query,
      onChange: function (event) { findState[1](Object.assign({}, find, { path: props.path, query: event.target.value, index: 0 })) },
      onKeyDown: function (event) { if (event.key === 'Enter') { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1) } },
    }),
    h('span', { key: 'count', className: 'dshgit-find-count', 'aria-live': 'polite' }, matches.total ? (matchIndex + 1) + ' / ' + matches.total : '0 / 0'),
    h('button', { key: 'case', type: 'button', className: 'dshgit-iconbtn', title: t('batch.findCase'), 'aria-label': t('batch.findCase'), 'aria-pressed': find.sensitive,
      onClick: function () { findState[1](Object.assign({}, find, { sensitive: !find.sensitive, index: 0 })) } }, 'Aa'),
    h('button', { key: 'previous', type: 'button', className: 'dshgit-iconbtn', title: t('batch.findPrevious'), 'aria-label': t('batch.findPrevious'), disabled: !matches.total, onClick: function () { moveMatch(-1) } }, '↑'),
    h('button', { key: 'next', type: 'button', className: 'dshgit-iconbtn', title: t('batch.findNext'), 'aria-label': t('batch.findNext'), disabled: !matches.total, onClick: function () { moveMatch(1) } }, '↓'),
    h('button', { key: 'close', type: 'button', className: 'dshgit-iconbtn', title: t('action.close'), 'aria-label': t('action.close'), onClick: closeFind }, h(IconClose, { size: 14 })),
  ])) : null, h('div', { key: 'preview', className: 'dshgit-preview-with-overview', style: { '--dshgit-overview-width': rows.length >= 2000 ? '44px' : rows.length >= 200 ? '36px' : '32px' } }, [h('div', {
    key: 'code',
    ref: codeNode,
    className: 'dshgit-code dshgit-diffcode',
    style: { overflowAnchor: 'none' },
    'data-file-preview': 'true',
    'data-wrap': wrap === true ? 'true' : 'false',
  }, [h('div', { key: 'rows', 'data-diff-page': pageIndex }, codeChunks(pageRows, function (row) {
    var rowIndex = Number(row.key.slice(1)), entry = matches.byRow.get(rowIndex)
    return renderDiffRow(Object.assign({}, row, { tokens: row.index < 0 || !highlighted ? undefined : highlighted[row.index - firstLine],
      matches: entry?.offsets, queryLength: find.query.length, activeMatch: currentMatch?.row === rowIndex ? currentMatch.offsets[matchIndex - currentMatch.start] : undefined }))
  }))].concat(rows.length > 2000 ? [
    h('div', { key: 'more', className: 'dshgit-preview-more' }, [
      h('button', { key: 'previous', type: 'button', className: 'dshgit-btn', disabled: pageIndex === 0, onClick: function () { page[1]({ path: props.path, index: pageIndex - 1 }) } }, t('lfs.previous')),
      h('span', { key: 'count' }, (pageIndex + 1) + ' / ' + Math.ceil(rows.length / 2000)),
      h('button', { key: 'next', type: 'button', className: 'dshgit-btn', disabled: limit >= rows.length, onClick: function () { page[1]({ path: props.path, index: pageIndex + 1 }) } }, t('lfs.next')),
    ]),
  ] : [])), h(PreviewOverview, { key: 'overview', code: codeNode, bands: bands, total: rows.length, start: start, size: 2000,
    t: t, onNavigate: function (index) { page[1]({ path: props.path, index: Math.floor(index / 2000) }) } })])])
}


DiffBody = React.memo(DiffBody)

FilePreview = React.memo(FilePreview)

export { DiffBody, FilePreview, readAnnotatedPreview }

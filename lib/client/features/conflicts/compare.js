import { React, h } from '../../core/runtime.js'

var ConflictVersion = React.memo(function (props) {
  var version = props.version, lines = version && !version.binary ? version.text.split('\n') : [], ranges = props.ranges || []
  var marked = new Set()
  if (lines.length <= 10000) ranges.forEach(function (range) { for (var i = range[0]; i < range[0] + range[1]; i++) marked.add(i) })
  return h('section', { className: 'dshgit-conflict-version', 'data-side': props.side, 'data-active': props.active }, [
    h('header', { key: 'head' }, [h('strong', { key: 'label', title: version?.sha }, props.label),
      props.onSelect ? h('button', { key: 'whole', className: 'dshgit-btn', disabled: props.disabled, 'aria-pressed': props.selected, onClick: props.onSelect }, version ? props.t('conflict.useWhole', { side: props.t('conflict.' + props.side) }) : props.t('conflict.acceptDeletion') + ' · ' + props.t('conflict.' + props.side)) : null]),
    h('pre', { key: 'text', onScroll: props.side === 'base' ? undefined : function (event) {
      var node = event.currentTarget, other = node.closest('.dshgit-conflict-versions')?.querySelector('section[data-side="' + (props.side === 'ours' ? 'theirs' : 'ours') + '"] pre')
      var expected = node.getAttribute('data-sync-top')
      node.removeAttribute('data-sync-top')
      if (expected !== null && Math.abs(node.scrollTop - Number(expected)) < 1) return
      if (!other) return
      var line = node.scrollTop / 20 + 1, mapped = line, delta = 0
      for (var index = 0; index < ranges.length; index++) {
        var own = ranges[index], peer = props.otherRanges?.[index]
        if (!peer) break
        var start = own[0] + (own[1] === 0 ? 1 : 0), peerStart = peer[0] + (peer[1] === 0 ? 1 : 0)
        if (line < start) break
        if (own[1] && line < start + own[1]) { mapped = peerStart + (line - start) * peer[1] / own[1]; break }
        delta = peerStart + peer[1] - start - own[1]; mapped = line + delta
      }
      var top = Math.max(0, Math.min(other.scrollHeight - other.clientHeight, (mapped - 1) * 20))
      if (Math.abs(other.scrollTop - top) > 1) { other.setAttribute('data-sync-top', String(top)); other.scrollTop = top }
    } }, !version ? props.t('conflict.deleted') : version.binary ? props.t('state.fileBinary') : lines.length > 10000 ? version.text : lines.map(function (line, index) {
      return h('span', { key: index, className: 'dshgit-conflict-line', 'data-kind': marked.has(index + 1) ? props.side === 'ours' ? 'del' : 'add' : undefined }, [h('span', { key: 'number', className: 'dshgit-conflict-lineno', 'aria-hidden': true }, index + 1), line || ' '])
    })),
  ])
})

// Keep the result text as the single source of truth; accepting a block replaces only its marker range.
function ConflictResult(props) {
  var t = props.t, manual = React.useState(false), active = React.useState(0), preview = React.useRef(null), editor = React.useRef(null)
  var newline = React.useRef('\n'), ending = props.text.match(/\r\n|\r|\n/)
  if (ending) newline.current = ending[0]
  React.useEffect(function () { if (props.choice !== 'text') manual[1](false) }, [props.choice])
  var blocks = props.blocks, index = Math.min(active[0], Math.max(0, blocks.length - 1))
  var reveal = function (number) {
    active[1](number)
    var block = blocks[number]
    if (manual[0] && editor.current && block) {
      var node = editor.current
      // Textarea offsets use LF even when the retained draft contains CRLF.
      var before = props.text.slice(0, block.start).replace(/\r\n?/g, '\n')
      var selected = props.text.slice(block.start, block.end).replace(/\r\n?/g, '\n')
      node.focus(); node.setSelectionRange(before.length, before.length + selected.length)
      node.scrollTop = Math.max(0, (before.split('\n').length - 2) * 20)
    } else {
      var node = preview.current, target = node?.querySelector('[data-conflict-index="' + number + '"]')
      if (node && target) node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top
      target?.focus({ preventScroll: true })
    }
  }
  var accept = function (block, side) {
    var text = side === 'ours' ? block.ours : side === 'theirs' ? block.theirs : block.ours + block.theirs
    props.onEdit(props.text.slice(0, block.start) + text + props.text.slice(block.end), 'text', true)
  }
  var parts = [], offset = 0
  if (!manual[0] && !props.binary) {
    blocks.forEach(function (block, number) {
      if (block.start > offset) parts.push(h('pre', { key: 'before-' + number }, props.text.slice(offset, block.start)))
      parts.push(h('section', { key: 'block-' + number, className: 'dshgit-conflict-block', tabIndex: -1, 'data-conflict-index': number, 'data-active': number === index, onFocus: function () { active[1](number) } }, [
        h('div', { key: 'actions', className: 'dshgit-conflict-block-actions' }, [h('span', { key: 'label' }, t('conflict.block', { number: number + 1 })), ['ours', 'theirs', 'both'].map(function (side) { return h('button', { key: side, disabled: props.disabled, onClick: function () { accept(block, side) } }, t(side === 'both' ? 'conflict.both' : 'conflict.acceptSide', { side: t('conflict.' + side) })) })]),
        h('div', { key: 'ours', className: 'dshgit-conflict-chunk', 'data-side': 'ours' }, [h('span', { key: 'label' }, t('conflict.ours')), h('pre', { key: 'code' }, block.ours || ' ')]),
        h('div', { key: 'theirs', className: 'dshgit-conflict-chunk', 'data-side': 'theirs' }, [h('span', { key: 'label' }, t('conflict.theirs')), h('pre', { key: 'code' }, block.theirs || ' ')]),
      ]))
      offset = block.end
    })
    if (offset < props.text.length) parts.push(h('pre', { key: 'tail' }, props.text.slice(offset)))
  }
  return h('section', { className: 'dshgit-conflict-result' }, [
    h('header', { key: 'head' }, [h('strong', { key: 'title' }, t('conflict.result')),
      h('span', { key: 'count', className: 'dshgit-muted', role: 'status' }, t('conflict.unresolved', { count: blocks.length })),
      h('span', { key: 'nav', className: 'dshgit-conflict-nav' }, [
        h('button', { key: 'prev', className: 'dshgit-btn', title: t('conflict.previousBlock'), 'aria-label': t('conflict.previousBlock'), disabled: !blocks.length, onClick: function () { reveal((index - 1 + blocks.length) % blocks.length) } }, '↑'),
        h('button', { key: 'next', className: 'dshgit-btn', title: t('conflict.nextBlock'), 'aria-label': t('conflict.nextBlock'), disabled: !blocks.length, onClick: function () { reveal((index + 1) % blocks.length) } }, '↓'),
      ]),
      h('button', { key: 'undo', className: 'dshgit-btn', disabled: props.disabled || !props.canUndo, onClick: props.onUndo }, t('conflict.undo')),
      !props.binary ? h('button', { key: 'edit', className: 'dshgit-btn', disabled: props.disabled, 'aria-pressed': manual[0], onClick: function () { if (!manual[0] && props.choice !== 'text') props.onEdit(props.text, 'text'); manual[1](!manual[0]) } }, t(manual[0] ? 'conflict.previewResult' : 'conflict.editResult')) : null,
    ]),
    props.deleting ? h('div', { key: 'deleting', role: 'status', className: 'dshgit-conflict-warning' }, t('conflict.deleteHint')) : null,
    props.binary ? h('div', { key: 'binary', className: 'dshgit-conflict-hint dshgit-muted' }, t('conflict.binary')) : manual[0] ? h('textarea', { key: 'editor', ref: editor, className: 'dshgit-textarea', 'aria-label': t('conflict.result'), value: props.text, disabled: props.disabled || props.choice !== 'text', spellCheck: false, onChange: function (event) { props.onEdit(event.currentTarget.value.replace(/\n/g, newline.current), 'text') } }) : h('div', { key: 'preview', ref: preview, className: 'dshgit-conflict-result-code', 'aria-label': t('conflict.result'), tabIndex: 0 }, parts),
  ])
}
export { ConflictVersion, ConflictResult }

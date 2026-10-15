import { React, h } from '../../core/runtime.js'

function ConflictSplitHandle(props) {
  var drag = React.useRef(null)
  var resize = function (node, height) {
    var pane = node.previousElementSibling, body = node.parentElement
    var maximum = Math.max(100, body.clientHeight - 280)
    pane.style.flexBasis = Math.max(100, Math.min(maximum, height)) + 'px'
  }
  return h('div', { className: 'dshgit-conflict-split', role: 'separator', tabIndex: 0, 'aria-orientation': 'horizontal', 'aria-label': props.t('conflict.resize'),
    onPointerDown: function (event) { if (event.button !== 0) return; event.preventDefault(); drag.current = { y: event.clientY, height: event.currentTarget.previousElementSibling.clientHeight }; event.currentTarget.setPointerCapture(event.pointerId) },
    onPointerMove: function (event) { if (drag.current) resize(event.currentTarget, drag.current.height + event.clientY - drag.current.y) },
    onPointerUp: function () { drag.current = null }, onPointerCancel: function () { drag.current = null }, onLostPointerCapture: function () { drag.current = null },
    onKeyDown: function (event) { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); resize(event.currentTarget, event.currentTarget.previousElementSibling.clientHeight + (event.key === 'ArrowUp' ? -20 : 20)) } },
  })
}
export { ConflictSplitHandle }

import { h } from '../core/runtime.js'

/** One round loading arc for buttons, notices and operation progress. */
function Spinner(props) {
  var attributes = Object.assign({ 'aria-hidden': props.role || props['aria-label'] ? undefined : true }, props, {
    className: 'dshgit-spinner' + (props.className && props.className !== 'dshgit-spinner' ? ' ' + props.className : ''),
  })
  return h('span', attributes, h('svg', { width: '100%', height: '100%', viewBox: '0 0 20 20', fill: 'none', focusable: 'false', 'aria-hidden': true },
    h('circle', { cx: 10, cy: 10, r: 8, stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeDasharray: '38 13' })))
}

export { Spinner }

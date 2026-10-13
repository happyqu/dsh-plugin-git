import { React, h } from '../core/runtime.js'
import { readWorkbenchStorage, writeWorkbenchStorage } from '../core/preferences.js'
import { IconRefresh } from '../ui/icons.js'

var previewWrapValue, previewWrapListeners = new Set()

function usePreviewWrap() {
  var state = React.useState(function () {
    if (previewWrapValue === undefined) previewWrapValue = readWorkbenchStorage('preview-wrap', false) === true
    return previewWrapValue
  })
  React.useEffect(function () { previewWrapListeners.add(state[1]); return function () { previewWrapListeners.delete(state[1]) } }, [])
  return [state[0], function (value) {
    previewWrapValue = value === true
    writeWorkbenchStorage('preview-wrap', previewWrapValue)
    previewWrapListeners.forEach(function (listener) { listener(previewWrapValue) })
  }]
}


function PreviewModeControls(props) {
  var wrap = usePreviewWrap(), t = props.t
  return h('span', { className: 'dshgit-previewactions' }, [
    h('button', { key: 'mode', type: 'button', className: 'dshgit-btn', 'data-preview-mode': true, onClick: props.onToggle }, t(props.content ? 'action.viewDiff' : 'action.viewFile')),
    h('button', { key: 'wrap', type: 'button', className: 'dshgit-btn', 'data-preview-wrap': true, 'aria-pressed': wrap[0],
      title: t(wrap[0] ? 'action.nowrap' : 'action.wrap'), onClick: function () { wrap[1](!wrap[0]) },
    }, t(wrap[0] ? 'action.nowrap' : 'action.wrap')),
  ])
}


function PreviewRefreshButton(props) {
  var label = props.t(props.stale ? 'batch.updated' : 'action.refresh')
  return h('button', { type: 'button', className: 'dshgit-iconbtn', title: label + (props.error ? '\n' + props.error : ''), 'aria-label': label,
    'data-preview-refresh': true, disabled: props.busy, onClick: props.onRefresh,
    style: props.stale || props.error ? { color: 'var(--dshgit-warning-text)' } : undefined,
  }, h(IconRefresh, { size: 16 }))
}

export { PreviewModeControls, PreviewRefreshButton, usePreviewWrap }

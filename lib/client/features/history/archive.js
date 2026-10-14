import { React, ReactDOM, h } from '../../core/runtime.js'
import { useDialogFocus } from '../../ui/controls.js'
import { Toast } from '../../ui/notifications.js'
import { IconChangeAction } from '../../ui/icons.js'
import { decodeExportFile } from './export.js'

function ArchiveDialog(props) {
  var panel = React.useRef(null), selected = React.useState([]), search = React.useState(''), busy = React.useState(false), error = React.useState(null), request = React.useRef(null)
  useDialogFocus(panel, props.onClose)
  React.useEffect(function () { return function () { request.current?.abort(); request.current = null } }, [])
  var files = props.files.filter(function (file) { return file.status !== 'D' && file.path.toLowerCase().includes(search[0].toLowerCase()) }).slice(0, 100)
  var chosen = new Set(selected[0])
  var download = async function () {
    if (request.current || !chosen.size) return
    var controller = new AbortController(); request.current = controller; busy[1](true); error[1](null)
    try {
      var options = { silent: true, silentError: true, signal: controller.signal }
      var host = await props.run('ping', {}, options)
      if (!host?.capabilities?.exportRevisionZip) throw new Error(props.t('history.exportReloadHost'))
      var result = await props.run('exportRevisionZip', { root: props.root, rev: props.rev, paths: selected[0] }, options)
      if (controller.signal.aborted) return
      var blob = await decodeExportFile(result.base64, controller.signal)
      if (controller.signal.aborted) return
      var url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = 'files-' + props.rev.slice(0, 10) + '.zip'; document.body.appendChild(link); link.click(); link.remove()
      setTimeout(function () { URL.revokeObjectURL(url) }, 1000); props.onClose()
    } catch (failure) { if (!controller.signal.aborted) error[1]({ seq: Date.now(), text: failure.message }) }
    finally { if (request.current === controller) { request.current = null; busy[1](false) } }
  }
  return ReactDOM.createPortal(h('div', { className: 'dshgit-modal', style: { zIndex: 1650 }, onClick: props.onClose }, h('div', { ref: panel, tabIndex: -1, role: 'dialog', 'aria-modal': true, 'aria-label': props.t('history.exportZip'), className: 'dshgit-dialog', onClick: function (event) { event.stopPropagation() } }, [
    h('strong', { key: 'title' }, props.t('history.exportZip')),
    h('div', { key: 'hint', className: 'dshgit-muted' }, props.t('history.zipHint')),
    h('input', { key: 'search', type: 'search', className: 'dshgit-input', placeholder: props.t('list.searchFiles'), 'aria-label': props.t('list.searchFiles'), value: search[0], disabled: busy[0], onChange: function (event) { search[1](event.target.value) } }),
    h('div', { key: 'bulk', className: 'dshgit-dialogactions' }, [
      h('button', { className: 'dshgit-btn', disabled: busy[0], onClick: function () { selected[1](files.map(function (file) { return file.path })) } }, props.t('history.zipSelectShown')),
      h('button', { className: 'dshgit-btn', disabled: busy[0], onClick: function () { selected[1]([]) } }, props.t('history.zipClear')),
      h('span', null, chosen.size + ' / 100'),
    ]),
    h('div', { key: 'files', className: 'dshgit-archive-files' }, files.map(function (file) { return h('label', { key: file.path }, [h('input', { type: 'checkbox', checked: chosen.has(file.path), disabled: busy[0] || !chosen.has(file.path) && chosen.size >= 100, onChange: function (event) { selected[1](event.target.checked ? selected[0].concat(file.path) : selected[0].filter(function (path) { return path !== file.path })) } }), file.path]) })),
    h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [h('button', { className: 'dshgit-btn', onClick: props.onClose }, props.t('action.close')), h('button', { className: 'dshgit-btn', disabled: busy[0] || !chosen.size, onClick: download }, props.t(busy[0] ? 'state.loading' : 'history.exportZip'))]),
    error[0] ? h(Toast, { key: 'error', seq: error[0].seq, text: error[0].text, tone: 'error', onDone: function () { error[1](null) } }) : null,
  ])), document.body)
}
function HistoryZipExport(props) {
  var open = React.useState(false)
  return h(React.Fragment, null, [h('button', { key: 'button', className: 'dshgit-iconbtn', disabled: !props.files.some(function (file) { return file.status !== 'D' }), title: props.t('history.exportZip'), 'aria-label': props.t('history.exportZip'), onClick: function () { open[1](true) } }, h(IconChangeAction, { kind: 'archive', size: 16 })), open[0] ? h(ArchiveDialog, Object.assign({}, props, { key: 'dialog', onClose: function () { open[1](false) } })) : null])
}
export { HistoryZipExport }

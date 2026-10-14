import { React, h } from '../../core/runtime.js'
import { imageFileName } from '../../core/files.js'
import { Toast } from '../../ui/notifications.js'
import { IconChangeAction } from '../../ui/icons.js'

/** Bound temporary allocations and return control to the UI between batches. */
async function decodeExportFile(base64, signal) {
  var parts = [], chunkSize = 256 * 1024
  for (var offset = 0; offset < base64.length; offset += chunkSize) {
    // Base64 slices must end on a four-character boundary. Yield at most
    // every 768 KiB of decoded bytes, including before the first batch.
    if (offset % (chunkSize * 4) === 0) {
      await new Promise(function (resolve) { setTimeout(resolve, 0) })
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    var text = atob(base64.slice(offset, offset + chunkSize)), bytes = new Uint8Array(text.length)
    for (var index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index)
    parts.push(bytes)
  }
  return new Blob(parts, { type: 'application/octet-stream' })
}

function HistoryFileExport(props) {
  var busy = React.useState(false), toast = React.useState(null), pending = React.useRef(null)
  React.useEffect(function () { return function () { pending.current?.abort(); pending.current = null } }, [props.rev, props.path])
  return h(React.Fragment, null, [
    h('button', { key: 'export', type: 'button', className: 'dshgit-iconbtn',
      disabled: busy[0] || !props.rev, 'data-history-action': 'export-file',
      title: props.t('history.exportFile'), 'aria-label': props.t('history.exportFile'), 'aria-busy': busy[0], onClick: async function () {
        if (pending.current) return
        var controller = new AbortController(); pending.current = controller; busy[1](true)
        try {
          var host = await props.run('ping', {}, { silent: true, silentError: true, signal: controller.signal })
          if (controller.signal.aborted) return
          if (host?.capabilities?.exportRevisionFile !== true) throw new Error(props.t('history.exportReloadHost'))
          var result = await props.run('exportRevisionFile', { root: props.root, rev: props.rev, path: props.path },
            { silent: true, silentError: true, signal: controller.signal })
          if (controller.signal.aborted) return
          if (result.tooLarge) throw new Error(props.t('history.exportTooLarge'))
          // An older running Host may still return the stored pointer. Never
          // save that metadata under the original image/file extension.
          if (result.base64.length <= 12000 && /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\n/.test(atob(result.base64))) {
            throw new Error(props.t('history.exportLfsReloadHost'))
          }
          var blob = await decodeExportFile(result.base64, controller.signal)
          if (controller.signal.aborted) return
          var url = URL.createObjectURL(blob)
          var link = document.createElement('a'); link.href = url; link.download = imageFileName(props.path)
          document.body.appendChild(link); link.click(); link.remove()
          setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
        } catch (error) {
          if (!controller.signal.aborted) toast[1]({ seq: Date.now(), text: error.code === 'git/unknown-method' ? props.t('history.exportReloadHost') : error.message })
        } finally {
          if (pending.current === controller) { pending.current = null; busy[1](false) }
        }
      },
    }, busy[0] ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : h(IconChangeAction, { kind: 'export', size: 16 })),
    toast[0] ? h(Toast, { key: 'toast', seq: toast[0].seq, text: toast[0].text, tone: 'error', onDone: function () { toast[1](null) } }) : null,
  ])
}

export { HistoryFileExport, decodeExportFile }

import { Fragment, React, ReactDOM, h } from '../core/runtime.js'
import { formatBytes } from '../core/format.js'
import { imageFileName } from '../core/files.js'
import { ComboBox, useDialogFocus } from '../ui/controls.js'
import { watchOperation } from '../core/operations.js'
import { Toast } from '../ui/notifications.js'

/**
 * A single image with its controls underneath, the way a photo page is laid
 * out: the picture on top, a caption strip below it carrying the name, the
 * size, zoom and download.
 *
 * Zooming happens in place; the window-scoped view is a separate affordance,
 * because "look closer" and "get this file out" are different intents and
 * neither should require the other.
 *
 * @param props - `{ blob, path, t }` where `blob.image` is a data URL.
 */
function ImagePreview(props) {
  var t = props.t
  var zoomState = React.useState(1)
  var zoom = zoomState[0]
  var expanded = React.useState(false)
  var setZoomClamped = function (value) { zoomState[1](Math.max(0.25, Math.min(8, value))) }
  var open = function () { expanded[1](true) }
  return h(Fragment, null, [
    expanded[0] ? h(ImageLightbox, { key: 'lightbox', src: props.blob.image, name: props.path, size: props.blob.size, t: t, onClose: function () { expanded[1](false) } }) : null,
    h('div', { key: 'view', className: 'dshgit-imageview', 'data-image-preview': 'true' }, [
      h('div', { key: 'meta', className: 'dshgit-imagemeta' }, [
        h('span', { key: 'name', className: 'dshgit-name', title: props.path }, props.path || ''),
        typeof props.blob.size === 'number' ? h('span', { key: 'size', className: 'dshgit-muted' }, formatBytes(props.blob.size)) : null,
        h('div', { key: 'controls', className: 'dshgit-imagecontrols' }, [
          h('button', { key: 'out', type: 'button', className: 'dshgit-iconbtn', title: t('image.zoomOut'), 'aria-label': t('image.zoomOut'),
            disabled: zoom <= 0.25, onClick: function () { setZoomClamped(zoom / 1.25) } }, '−'),
          h('button', { key: 'reset', type: 'button', className: 'dshgit-btn dshgit-lightbox-zoom', title: t('image.zoomReset'),
            onClick: function () { setZoomClamped(1) } }, Math.round(zoom * 100) + '%'),
          h('button', { key: 'in', type: 'button', className: 'dshgit-iconbtn', title: t('image.zoomIn'), 'aria-label': t('image.zoomIn'),
            disabled: zoom >= 8, onClick: function () { setZoomClamped(zoom * 1.25) } }, '+'),
          h('button', { key: 'full', type: 'button', className: 'dshgit-btn', onClick: open }, t('image.view')),
          h('a', { key: 'save', className: 'dshgit-btn', href: props.blob.image, download: imageFileName(props.path),
            title: t('image.download') }, t('image.download')),
        ]),
      ]),
      h('div', { key: 'stage', className: 'dshgit-imageview-stage' },
        h('img', { key: 'img', className: 'dshgit-image dshgit-image-zoomable', src: props.blob.image, alt: props.path || '',
          title: t('image.view'), tabIndex: 0, role: 'button', onClick: open,
          style: { transform: 'scale(' + zoom + ')' },
          onKeyDown: function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } } })),
    ]),
  ])
}


/**
 * Window-scoped image viewer.
 *
 * A thumbnail in a column is the wrong way to look at an image you are
 * reviewing, so clicking one opens it here at full size. The toolbar stays at the top of the owning Git window; the image gets
 * the remaining space without covering the rest of the application.
 *
 * The data URL is already in memory (the preview fetched it), which is why
 * this needs no request of its own — and why download is a plain anchor with
 * `download`, rather than a round-trip to the Host.
 *
 * @param props - `{ src, name, size?, t, onClose }`.
 */
function ImageLightbox(props) {
  var anchor = React.useRef(null), host = React.useState(null)
  React.useLayoutEffect(function () {
    var owner = anchor.current?.closest('.dshgit-fileviewer,.dshgit-workbench,.dshgit') || anchor.current?.parentElement
    if (!owner) return
    var position = owner.style.position, needsPosition = getComputedStyle(owner).position === 'static'
    if (needsPosition) owner.style.position = 'relative'
    host[1](owner)
    return function () { if (needsPosition && owner.style.position === 'relative') owner.style.position = position }
  }, [])
  return h(Fragment, null, [h('span', { key: 'anchor', ref: anchor, hidden: true }),
    host[0] ? ReactDOM.createPortal(h(ImageLightboxPanel, props), host[0]) : null])
}


function ImageLightboxPanel(props) {
  var t = props.t
  var panel = React.useRef(null)
  var zoomState = React.useState(1)
  var zoom = zoomState[0]
  useDialogFocus(panel, props.onClose, { capture: true })
  // Zoom is keyboard-accessible because a trackpad-only affordance would
  // exclude the people who most need to inspect a pixel.
  var setZoomClamped = function (value) { zoomState[1](Math.max(0.25, Math.min(8, value))) }
  var zoomed = zoom !== 1
  return h('div', { className: 'dshgit-modal dshgit-lightbox', style: { position: 'absolute', inset: 0, padding: 0, background: 'var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base))' }, onClick: props.onClose }, h('div', {
    className: 'dshgit-lightbox-panel', role: 'dialog', 'aria-modal': true, 'aria-label': props.name || t('image.view'),
    ref: panel, tabIndex: -1, 'data-image-lightbox': 'true', onClick: function (event) { event.stopPropagation() },
  }, [
    h('div', { key: 'bar', className: 'dshgit-lightbox-bar' }, [
      h('span', { key: 'name', className: 'dshgit-name', title: props.name }, props.name || ''),
      typeof props.size === 'number' ? h('span', { key: 'size', className: 'dshgit-muted' }, formatBytes(props.size)) : null,
      h('div', { key: 'controls', className: 'dshgit-lightbox-controls' }, [
        h('button', { key: 'out', type: 'button', className: 'dshgit-iconbtn', title: t('image.zoomOut'), 'aria-label': t('image.zoomOut'),
          disabled: zoom <= 0.25, onClick: function () { setZoomClamped(zoom / 1.25) } }, '−'),
        h('button', { key: 'reset', type: 'button', className: 'dshgit-btn dshgit-lightbox-zoom', title: t('image.zoomReset'),
          onClick: function () { setZoomClamped(1) } }, Math.round(zoom * 100) + '%'),
        h('button', { key: 'in', type: 'button', className: 'dshgit-iconbtn', title: t('image.zoomIn'), 'aria-label': t('image.zoomIn'),
          disabled: zoom >= 8, onClick: function () { setZoomClamped(zoom * 1.25) } }, '+'),
        h('button', { key: 'fit', type: 'button', className: 'dshgit-btn', disabled: !zoomed,
          onClick: function () { setZoomClamped(1) } }, t('image.fit')),
        // `download` works because the src is a data URL: no server route and
        // no blob lifetime to manage, and the browser names the file from it.
        h('a', { key: 'save', className: 'dshgit-btn dshgit-lightbox-save', href: props.src,
          download: imageFileName(props.name), title: t('image.download'), onClick: function (event) { event.stopPropagation() } }, t('image.download')),
        h('button', { key: 'close', type: 'button', className: 'dshgit-btn dshgit-lightbox-close',
          title: t('action.close'), onClick: props.onClose }, t('action.close')),
      ]),
    ]),
    h('div', { key: 'stage', className: 'dshgit-lightbox-stage', onClick: function (event) { if (event.target === event.currentTarget) props.onClose() } },
      h('img', { className: 'dshgit-lightbox-image', src: props.src, alt: props.name || '', style: { transform: 'scale(' + zoom + ')' } })),
  ]))
}


/**
 * Side-by-side image comparison, the way a desktop diff tool shows one.
 *
 * Git reports an image change as "Binary files differ", so the text diff has
 * nothing to say about it. This puts the two versions next to each other
 * with their sizes, which is the only useful way to review a changed image.
 *
 * Pass either `data` (an already-fetched `imageDiff` payload) or the
 * coordinates plus `run`, in which case the component fetches its own sides.
 * The fetching form is what lets the history, compare and stash viewers show
 * an image without each of them growing its own request logic.
 *
 * @param props - `{ data?, run?, root?, path, originalPath?, from?, to?, t }`.
 */
function ImageDiffView(props) {
  var t = props.t
  var fetched = React.useState(props.data === undefined ? null : props.data)
  var refreshed = React.useState(null), failure = React.useState(''), downloading = React.useState(false), retry = React.useState(0)
  var notice = React.useState(null), noticeSequence = React.useRef(0)
  var reportError = function (message) { failure[1](message); notice[1]({ seq: ++noticeSequence.current, text: message }) }
  var remotes = React.useState(null), remote = React.useState(''), request = React.useRef(0)
  var zoomed = React.useState(null)
  var coordinates = JSON.stringify([props.root || '', props.path, props.originalPath || '', props.from || '', props.to || ''])
  var data = refreshed[0]?.key === coordinates ? refreshed[0].value : props.data !== undefined ? props.data : fetched[0]
  var readImages = function () { return props.run('imageDiff', { root: props.root, path: props.path, originalPath: props.originalPath,
    from: props.from === null ? undefined : props.from, to: props.to === null ? undefined : props.to }, { silent: true, silentError: true }) }
  React.useEffect(function () {
    request.current++; failure[1](''); notice[1](null); downloading[1](false)
    return function () { request.current++ }
  }, [coordinates, props.root])
  React.useEffect(function () { refreshed[1](null) }, [props.data])
  React.useEffect(function () {
    if (props.data !== undefined || props.run === undefined) return
    var active = true
    fetched[1](null)
    readImages()
      .then(function (value) { if (active) fetched[1](value?.image === true ? value : null) })
      .catch(function (error) { if (active) reportError(error.message) })
    return function () { active = false }
  }, [coordinates, props.data, props.run, props.root, retry[0]])
  var missingLfs = data?.before?.pointer || data?.after?.pointer
  React.useEffect(function () {
    if (!missingLfs || !props.run) return
    var active = true
    remotes[1](null); remote[1]('')
    props.run('remotes', { root: props.root }, { silent: true, silentError: true }).then(function (value) {
      if (!active) return
      remotes[1](value); remote[1](function (previous) { return value.some(function (item) { return item.name === previous }) ? previous : value.find(function (item) { return item.name === 'origin' })?.name || value[0]?.name || '' })
    }).catch(function (error) { if (active) reportError(error.message) })
    return function () { active = false }
  }, [missingLfs, props.root, props.run])
  var download = function () {
    if (downloading[0] || !remote[0]) return
    var id = ++request.current, call = function (method, payload) { return props.run(method, payload, { silent: true, silentError: true }) }
    downloading[1](true); failure[1](''); notice[1](null)
    var refs = [props.from, props.to].filter(function (value) { return value && !['INDEX', 'WORKTREE', ':0', 'EMPTY'].includes(value) })
    call('ping', {}).then(function (host) {
      if (host?.capabilities?.lfsImageFetch !== true) throw new Error(t('image.reloadHost'))
      if (request.current !== id) return null
      return call('operationStart', { root: props.root, method: 'write.lfsTransfer', parameters: { root: props.root, action: 'fetch', remote: remote[0],
        paths: Array.from(new Set([props.originalPath || props.path, props.path])), refs: refs } })
    })
      .then(function (job) {
        if (!job) return null
        return watchOperation(call, job, { alive: function () { return request.current === id }, message: function (state) { return t('lfs.' + state) } })
      }).then(function () { if (request.current === id) return readImages() })
      .then(function (value) {
        if (request.current !== id || !value) return
        refreshed[1]({ key: coordinates, value: value })
        if (value.before?.pointer || value.after?.pointer) reportError(t('image.lfsUnavailable'))
      })
      .catch(function (error) {
        if (request.current === id) reportError(/不支持的 LFS 操作|unsupported LFS operation/i.test(error.message) ? t('image.reloadHost') : error.message)
      })
      .finally(function () { if (request.current === id) downloading[1](false) })
  }
  React.useEffect(function () {
    var error = data?.before?.error || data?.after?.error
    if (error) reportError(error)
  }, [coordinates, data?.before?.error, data?.after?.error])
  var toast = notice[0] ? h(Toast, { key: 'error-toast', seq: notice[0].seq, text: notice[0].text, tone: 'error', onDone: function () { notice[1](null) } }) : null
  if (data == null && failure[0]) return h(Fragment, null, [toast, h('div', { key: 'retry', className: 'dshgit-empty' },
    h('button', { type: 'button', className: 'dshgit-btn', onClick: function () { failure[1](''); notice[1](null); retry[1](retry[0] + 1) } }, t('action.refresh')))])
  if (data === null || data === undefined) return h(Fragment, null, [toast, h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))])
  if (data.image !== true) return toast
  if (data.exists === false) return h(Fragment, null, [toast, h('div', { key: 'missing', className: 'dshgit-empty' }, t('state.fileMissing'))])
  var side = function (key, slot, label) {
    return h('div', { key: key, className: 'dshgit-imageside' }, [
      h('div', { key: 'label', className: 'dshgit-imagesidehead' }, [
        h('span', { key: 'name', className: 'dshgit-name' }, label),
        typeof slot?.size === 'number' ? h('span', { key: 'size', className: 'dshgit-muted' }, formatBytes(slot.size)) : null,
      ]),
      slot?.image
        ? h('img', { key: 'img', className: 'dshgit-image dshgit-image-zoomable', src: slot.image, alt: label,
            title: t('image.view'), tabIndex: 0, role: 'button',
            onClick: function () { zoomed[1]({ src: slot.image, name: props.path, size: slot.size }) },
            onKeyDown: function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); zoomed[1]({ src: slot.image, name: props.path, size: slot.size }) } },
          })
        : h('div', { key: 'none', className: 'dshgit-empty' }, t(slot?.pointer === true ? 'image.fetchLfsHint' : slot?.exists === false ? 'state.fileMissing' : 'state.fileTooLarge')),
    ])
  }
  return h(Fragment, null, [
    toast,
    zoomed[0] ? h(ImageLightbox, { key: 'lightbox', src: zoomed[0].src, name: zoomed[0].name, size: zoomed[0].size, t: t, onClose: function () { zoomed[1](null) } }) : null,
    h('div', { key: 'sides', className: 'dshgit-imagediff', 'data-image-diff': 'true' }, [
      missingLfs && props.run ? h('div', { key: 'download', className: 'dshgit-lfs-actions' }, [
        remotes[0]?.length > 1 ? h(ComboBox, { key: 'remote', value: remote[0], label: t('lfs.remote'), t: t, disabled: downloading[0],
          onChange: remote[1], options: remotes[0].map(function (item) { return { value: item.name, label: item.name } }), style: { width: '160px' } }) : null,
        h('button', { key: 'fetch', type: 'button', className: 'dshgit-btn', disabled: downloading[0] || !remote[0], onClick: download }, downloading[0] ? t('lfs.running') : t('image.fetchLfs')),
        remotes[0] === null || remotes[0].length === 0 ? h('span', { key: 'none', className: 'dshgit-muted' }, t(remotes[0] === null ? 'state.loading' : 'lfs.noRemote')) : null,
      ]) : null,
      data.changed === false && data.before?.image && data.after?.image
        ? h('div', { key: 'same', className: 'dshgit-muted' }, t('state.imagesSame'))
        : null,
      h('div', { key: 'grid', className: 'dshgit-imagegrid' }, [
        side('before', data.before, t('image.before')),
        side('after', data.after, t('image.after')),
      ]),
    ]),
  ])
}

export { ImageDiffView, ImagePreview }

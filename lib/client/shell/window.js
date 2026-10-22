import { Fragment, React, h } from '../core/runtime.js'
import { getWindowState, openGitWindow, setWindowState, subscribeWindow, windowState } from '../core/state.js'
import { GitStatusChips } from './header.js'
import { IconGit, IconResize } from '../ui/icons.js'
import { beginResize, endResizeWith, moveResize } from '../ui/resize.js'
import { baseName } from '../core/files.js'
import { GitApp } from './app.js'
import { getWorkspaceNavigation, subscribeWorkspaceNavigation } from '../core/workspace-navigation.js'

/**
 * The session-header Git cluster: branch chip, changes chip, sync controls,
 * and the workbench launcher.
 *
 * This is the front door. It replaces the old compact "simple window"
 * entirely: the everyday facts (which branch, how much is uncommitted, am I
 * ahead or behind) live here as always-visible chips, and each chip opens a
 * popover for the actions that need more room. The workbench window stays as
 * the deep surface — blame, file history, commit graph, compare, output.
 *
 * Being chips rather than a second window is what makes the design simpler
 * AND more capable: the facts are visible without opening anything, so there
 * is no mode to remember and nothing to dismiss.
 *
 * @param props - `{ connection, sessionId, t }` from the session-scoped slot.
 */
function HeaderGitCluster(props) {
  var t = props.t
  var stateHook = React.useState(getWindowState())
  var state = stateHook[0]
  var setState = stateHook[1]

  React.useEffect(
    function () {
      return subscribeWindow(function () { setState(getWindowState()) })
    },
    [],
  )

  // This cluster is the only place that knows which session is on screen
  // (`sessionId` arrives on the session-scoped slot props), and the window
  // itself renders in a root-scoped slot that never gets one. Publishing it
  // here is what makes "open Git" mean THIS conversation's repository.
  React.useEffect(
    function () {
      if (!props.sessionId && !props.directory) return
      if (getWindowState().sessionId === (props.sessionId || '') && getWindowState().directory === (props.directory || '')) return
      setWindowState({ sessionId: props.sessionId || '', directory: props.directory || '', workspace: props.directory || '' })
    },
    [props.sessionId, props.directory],
  )

  var open = state.mode !== 'closed'
  var minimized = open && state.minimized === true

  return h('div', { className: 'dshgit-workspace-actions', 'data-compact': props.compact || undefined }, [
    // One positioned cluster, so the outcome banner can hang BELOW the chips
    // as an absolutely positioned card. Every other child here is either a
    // `position:fixed` overlay (popovers, dialogs, the viewer) or a plain
    // button, so a relative wrapper changes no existing layout.
    h('div', { key: 'cluster', className: 'dshgit-chipcluster' }, [
      h(GitStatusChips, {
        key: 'chips',
        connection: props.connection,
        // The chips re-resolve when the conversation changes, so they need the
        // id themselves — publishing it to the window store only tells the
        // RPC layer WHICH session to send, not that the answer went stale.
        sessionId: props.sessionId,
        directory: props.directory,
        compact: props.compact,
        refreshToken: state.refreshToken,
        t: t,
      }),
    ]),
    props.compact ? null : h('button', {
      key: 'launcher',
      type: 'button',
      className: 'dshgit-iconbtn',
      style: { width: '28px', height: '28px', padding: 0, gap: '6px' },
      title: minimized ? t('window.restore') : open ? t('window.focus') : t('window.open'),
      'aria-label': t('window.open'),
      'aria-pressed': open,
      onClick: function () {
        // Restore first: a minimized window must come back before anything
        // else, or the click would act on something invisible.
        var current = getWindowState()
        // Older Hosts bind only a session. Their chips may have resolved an
        // explicit repository directory, which still belongs to that session.
        var sameContext = current.sessionId === (props.sessionId || '') && (props.directory
          ? current.directory === props.directory : !!props.sessionId || !current.directory)
        if (!sameContext) {
          openGitWindow({ sessionId: props.sessionId, directory: props.directory })
          return
        }
        if (minimized) {
          setWindowState({ minimized: false })
          return
        }
        // Clicking while open closes it rather than toggling a size: there
        // is only one window now, so the toggle has nothing to toggle.
        setWindowState({ mode: open ? 'closed' : 'full', minimized: false })
      },
    }, [
      h(IconGit, { key: 'i', size: 16 }),
      open ? h('span', { key: 'd', className: 'dshgit-dotbadge', 'aria-hidden': 'true' }) : null,
    ]),
  ])
}


/**
 * The Git workbench window, rendered into the frame-wide overlay slot.
 *
 * A centred, resizable dialog. It was previously a two-mode window whose
 * compact half duplicated the header chips; now the chips are the everyday
 * surface and this is the deep one.
 */
function GitWindow(props) {
  var t = props.t
  var navigation = React.useSyncExternalStore(subscribeWorkspaceNavigation, getWorkspaceNavigation)
  var stateHook = React.useState(getWindowState())
  var state = stateHook[0]
  var setState = stateHook[1]

  // The window node itself, so resize math measures the element directly
  // instead of walking up from the header. `parentElement` happens to work
  // in a browser but couples the logic to the DOM's shape, and it silently
  // breaks wherever the header is not a direct child.
  var windowRef = React.useRef(null)
  var dragRef = React.useRef(null)
  var viewportState = React.useState(0)
  React.useEffect(function () {
    var update = function () { viewportState[1](function (value) { return value + 1 }) }
    window.addEventListener('resize', update)
    return function () { window.removeEventListener('resize', update) }
  }, [])

  var clampPosition = function (x, y) {
    var rect = windowRef.current?.dataset.maximized === 'true' ? null : windowRef.current?.getBoundingClientRect()
    var width = Math.min(rect?.width || state.size?.width || Math.min(1180, window.innerWidth * .94), window.innerWidth - 24)
    var height = Math.min(rect?.height || state.size?.height || Math.min(780, window.innerHeight * .88), window.innerHeight - 72)
    return { x: Math.max(12, Math.min(x, window.innerWidth - width - 12)),
      y: Math.max(56, Math.min(y, window.innerHeight - height - 12)) }
  }
  var startDrag = function (event) {
    if (state.maximized || event.button !== 0 || event.target.closest('button,input,select,textarea,a,[role="button"]')) return
    var node = windowRef.current, rect = node.getBoundingClientRect()
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
    node.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }
  var movePointer = function (event) {
    var drag = dragRef.current
    if (!drag) { moveResize(event); return }
    if (drag.pointerId !== event.pointerId) return
    var position = clampPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y)
    drag.position = position
    Object.assign(windowRef.current.style, { left: position.x + 'px', top: position.y + 'px', transform: 'none' })
  }
  var finishPointer = function (event) {
    var drag = dragRef.current
    if (!drag) { endResize(event); return }
    if (drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (drag.position) setWindowState({ position: drag.position })
    if (windowRef.current.hasPointerCapture(event.pointerId)) windowRef.current.releasePointerCapture(event.pointerId)
  }

  React.useEffect(
    function () {
      return subscribeWindow(function () { setState(getWindowState()) })
    },
    [],
  )

  // Escape minimizes, then closes, so a single keypress never discards the
  // user's context outright.
  React.useEffect(
    function () {
      if (state.mode === 'closed' || state.minimized === true) return undefined
      var onKey = function (event) {
        if (event.key !== 'Escape') return
        if (event.defaultPrevented || event.target?.closest?.('.dshgit-dialog,[role="alertdialog"],.dshgit-fileviewer')) return
        setWindowState({ minimized: true })
      }
      document.addEventListener('keydown', onKey)
      return function () { document.removeEventListener('keydown', onKey) }
    },
    [state.mode, state.minimized],
  )

  // The resize helpers keep pointer tracking and size bounds together.
  var startResize = function (event) {
    beginResize(event, windowRef)
    if (state.position && windowState.resize) {
      var bounds = windowState.resize.bounds, rect = windowRef.current.getBoundingClientRect()
      bounds.maxWidth = Math.min(bounds.maxWidth, window.innerWidth - rect.left - 12)
      bounds.maxHeight = Math.min(bounds.maxHeight, window.innerHeight - rect.top - 12)
      bounds.minWidth = Math.min(bounds.minWidth, bounds.maxWidth)
      bounds.minHeight = Math.min(bounds.minHeight, bounds.maxHeight)
    }
  }
  var endResize = function (event) {
    endResizeWith(event, function (next) { setWindowState({ size: next }) })
  }
  var visible = state.mode !== 'closed' && state.minimized !== true
  var mountedRef = React.useRef(false)
  var cachedSessionRef = React.useRef(state.sessionId)
  var cachedDirectoryRef = React.useRef(state.directory)
  if (visible) cachedSessionRef.current = state.sessionId
  if (visible) cachedDirectoryRef.current = state.directory
  if (visible) mountedRef.current = true
  if (!mountedRef.current) return null

  // Keep one workbench mounted after the first open, including when minimized.
  var pill = state.mode !== 'closed' && state.minimized === true ? h('button', {
    key: 'pill', type: 'button', className: 'dshgit-pill',
    disabled: !!navigation,
    title: t('window.restore'), 'aria-label': t('window.restore'),
    onClick: function () { setWindowState({ minimized: false }) },
  }, [
    h(IconGit, { key: 'i', size: 15 }),
    h('span', { key: 'l' }, t('panel.title')),
    state.workspace ? h('span', { key: 'ws', className: 'dshgit-muted', title: state.workspace }, baseName(state.workspace)) : null,
  ]) : null

  // An explicit size, applied only after the user has actually resized:
  // until then the stylesheet's centred default (1180×780) stays in charge.
  var saved = state.size === null || state.size === undefined ? null : state.size
  var style = state.maximized || saved === null
    ? undefined
    : {
        width: saved.width + 'px',
        height: saved.height + 'px',
      }
  if (!state.maximized && state.position) {
    var position = clampPosition(state.position.x, state.position.y)
    style = Object.assign({}, style, { left: position.x + 'px', top: position.y + 'px', transform: 'none' })
  }

  var workbench = h(
    'div',
    {
      key: 'workbench',
      ref: windowRef,
      className: 'dshgit-workbench',
      role: 'dialog',
      'aria-label': t('panel.title'),
      'data-mode': state.mode,
      'data-maximized': state.maximized === true ? 'true' : 'false',
      'data-resized': saved === null ? 'false' : 'true',
      style: Object.assign({}, style, visible ? {} : { display: 'none' }),
      'aria-hidden': !visible,
      inert: navigation ? true : undefined,
      'aria-busy': !!navigation,
      // Pointer capture is held by this node, so release and movement events
      // must be handled here even after the pointer leaves the grip.
      onPointerMove: movePointer,
      onPointerUp: finishPointer,
      onPointerCancel: finishPointer,
      onLostPointerCapture: finishPointer,
    },
    [
      h(
        'div',
        { key: 'body', className: 'dshgit-floatbody' },
        h(GitApp, { key: (cachedSessionRef.current || '') + ':' + (cachedDirectoryRef.current || ''), active: visible, connection: props.connection, t: t, focusTab: state.tab,
          focusPath: state.historyPath, compareWith: state.compareWith,
          sessionId: cachedSessionRef.current,
          directory: cachedDirectoryRef.current,
          refreshToken: state.refreshToken,
          // The window chrome (minimize/close) is rendered by GitApp's title
          // bar so it sits on the same row as the repository identity, which
          // is what a workbench window looks like. The callbacks travel down
          // as props because the window state store lives up here.
          onMinimize: function () { setWindowState({ minimized: true }) },
          onDragStart: startDrag,
          maximized: state.maximized === true,
          onMaximize: function () { setWindowState({ maximized: !state.maximized }) },
          onClose: function () { setWindowState({ mode: 'closed', minimized: false }) },
        }),
      ),
      // A real control rather than the browser's native `resize` corner: it
      // is themeable, its hit area is larger than its paint, and it starts a
      // pointer-captured gesture.
      state.maximized ? null : h('button', {
        key: 'resize', type: 'button', className: 'dshgit-resize',
        title: t('window.resizeHint'), 'aria-label': t('window.resizeHint'),
        onPointerDown: startResize,
      }, h(IconResize, {})),
    ],
  )
  return h(Fragment, null, [workbench, pill])
}

export { GitWindow, HeaderGitCluster }

import { Fragment, React, ReactDOM, h } from './runtime.js'
import { HeaderGitCluster } from '../shell/window.js'
import { findHeroWorkspaceRow, insertHeroActions, syncHeroBranchFont } from './hero-placement.js'
import { getWorkspaceNavigation, subscribeWorkspaceNavigation, acknowledgeWorkspaceNavigation } from './workspace-navigation.js'
import { Spinner } from '../ui/spinner.js'

/** Keep the public composer slot as lifecycle owner; place its UI after the preset. */
function HeroGitPlacement(props) {
  var anchor = React.useRef(null), target = React.useState(null)
  React.useLayoutEffect(function () {
    var container = null, row = null
    var syncFont = function () { if (row && container) syncHeroBranchFont(row, container) }
    var sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(syncFont) : null
    var detach = function () {
      sizeObserver?.disconnect()
      container?.remove()
      row?.removeAttribute('data-dshgit-hero-row')
      container = null; row = null
    }
    var place = function () {
      var next = findHeroWorkspaceRow(anchor.current)
      if (next === row && container?.parentElement === row) { syncFont(); return }
      detach()
      if (next) {
        row = next
        container = document.createElement('div')
        container.className = 'dshgit-hero-actions'
        row.setAttribute('data-dshgit-hero-row', '')
        insertHeroActions(row, container)
        syncFont()
        sizeObserver?.observe(row)
      }
      target[1](container)
    }
    place()
    // Hero and its preset seat can be replaced as the selected workspace changes.
    var observer = typeof MutationObserver === 'function' ? new MutationObserver(place) : null
    observer?.observe(document.body, { childList: true, subtree: true })
    return function () { observer?.disconnect(); detach() }
  }, [])
  return h(Fragment, null, [
    h('span', { key: 'anchor', ref: anchor, hidden: true, 'data-dshgit-hero-anchor': '' }),
    // Older Hosts without a Hero preset anchor retain the toolbar entry.
    target[0] ? ReactDOM.createPortal(props.children, target[0]) : props.children,
  ])
}

/** Resolve the selected session's workspace, never the registry's first item. */
export function workspaceDirectory(workspaces, sessions, sessionId) {
  var workspace = (workspaces?.items || []).find(function (item) {
    return (item.sessionIds || []).includes(sessionId)
  })
  return workspace?.path || sessions?.byId?.[sessionId]?.cwd || ''
}

/** Both the blank composer and the resident header share this context adapter. */
export function WorkspaceGitAction(props) {
  var workspaces = props.useWorkspaces ? props.useWorkspaces(function (value) { return value }) : null
  var sessions = props.useSessions ? props.useSessions(function (value) { return value }) : null
  var blank = props.useSession ? props.useSession(function (value) { return value?.blank === true }) : false
  var directory = workspaceDirectory(workspaces, sessions, props.sessionId)
  var navigation = React.useSyncExternalStore(subscribeWorkspaceNavigation, getWorkspaceNavigation)
  React.useEffect(function () {
    if (directory) acknowledgeWorkspaceNavigation(props.sessionId)
  }, [navigation, props.sessionId, directory])
  if (props.blankOnly && (!blank || !directory)) return null
  // Older Hosts without standard workspace hooks keep the session resolver.
  if ((workspaces || sessions) && !directory) return null
  var controls = navigation ? h('button', { type: 'button', className: 'dshgit-chip', disabled: true, 'aria-busy': true, 'data-workspace-pending': true }, [
    h(Spinner, { key: 'spinner', className: 'dshgit-spinner' }), props.t('state.loading'),
  ]) : h(HeaderGitCluster, {
    key: String(props.sessionId || '') + ':' + directory,
    connection: props.connection, sessionId: props.sessionId,
    directory: directory || undefined, compact: props.blankOnly, t: props.t,
  })
  return props.blankOnly ? h(HeroGitPlacement, null, controls) : controls
}

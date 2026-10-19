import { h, NS } from '../../core/runtime.js'
import { CloneWorkspaceEntry } from './view.js'
import { WorkspaceAddFlow } from './workspace-flow.js'
import { createHostDirectoryPicker, HostDirectoryPicker } from './directory-picker.js'

/** One observable per plugin activation; disposing the menu does not close a task. */
function createCloneRequest() {
  var open = false, listeners = new Set()
  return {
    draft: {},
    getSnapshot: function () { return open },
    subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener) } },
    set: function (value) { if (open === value) return; open = value; listeners.forEach(function (listener) { listener() }) },
  }
}

/** Root-scoped integration; the Git feature never owns DSH Session lifetime. */
export function registerCloneWorkspace(ctx, connection, t) {
  ctx.inject(['workspaces', 'uiWorkspace'], function (scope) {
    var request = createCloneRequest()
    var picker = createHostDirectoryPicker(scope.uiWorkspace, t)
    scope.effect(function () { return function () { picker.dispose() } }, 'git: directory picker')
    var flowSlots = ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow']
    flowSlots.forEach(function (slot) {
      scope.slots.inject(slot, function () {
        // Documented single-slot shadowing: the lower rank renders. The native
        // occupant stays registered and resumes when this plugin is disposed.
        return scope.slots.register({ name: slot, priority: -10, locale: NS }, function (props) {
          return props.open ? h(WorkspaceAddFlow, {
            busy: props.busy, onPicked: props.onPicked, onCancel: props.onCancel, onError: props.onError,
            pickDirectory: picker.pick,
            onClone: function () { props.onCancel(); request.set(true) },
            t: props.t || t,
          }) : null
        })
      })
    })
    scope.slots.inject('shell.overlay', function () {
      return scope.slots.register({ name: 'shell.overlay', id: 'git-clone-workspace', order: 45, locale: NS }, function (props) {
        return h(CloneWorkspaceEntry, { connection: connection, request: request,
          workspaces: scope.workspaces, navigation: { pickDirectory: picker.pick,
            openWorkspace: function (id) { return scope.uiWorkspace.openWorkspace(id) } }, t: props.t || t })
      })
    })
    scope.slots.inject('shell.overlay', function () {
      return scope.slots.register({ name: 'shell.overlay', id: 'git-directory-picker', order: 46, locale: NS }, function (props) {
        return h(HostDirectoryPicker, { picker: picker, t: props.t || t })
      })
    })
  })
}

import { h, NS, React } from '../../core/runtime.js'
import { CloneWorkspaceEntry } from './view.js'
import { WorkspaceAddFlow } from './workspace-flow.js'
import { createHostDirectoryPicker, HostDirectoryPicker } from './directory-picker.js'
import { NewProjectEntry } from './project.js'
import { registerWorktreeWorkspace } from '../worktrees/workspace.js'

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
    var projectRequest = createCloneRequest()
    var finish = function (dialog) {
      dialog.set(false)
      var cancel = dialog.onCancel; dialog.onCancel = null
      cancel?.()
    }
    var picker = createHostDirectoryPicker(scope.uiWorkspace, t)
    scope.effect(function () { return registerWorktreeWorkspace({
      pickDirectory: picker.pick, workspaces: scope.workspaces, navigation: scope.uiWorkspace,
    }) }, 'git: worktree workspaces')
    scope.effect(function () { return function () { picker.dispose() } }, 'git: directory picker')
    var flowSlots = ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow']
    flowSlots.forEach(function (slot) {
      scope.slots.inject(slot, function () {
        // Documented single-slot shadowing: the lower rank renders. The native
        // occupant stays registered and resumes when this plugin is disposed.
        return scope.slots.register({ name: slot, priority: -10, locale: NS }, function (props) {
          var cloning = React.useSyncExternalStore(request.subscribe, request.getSnapshot)
          var creating = React.useSyncExternalStore(projectRequest.subscribe, projectRequest.getSnapshot)
          return props.open && !cloning && !creating ? h(WorkspaceAddFlow, {
            busy: props.busy, onPicked: props.onPicked, onCancel: props.onCancel, onError: props.onError,
            pickDirectory: picker.pick,
            onClone: function () { request.onCancel = props.onCancel; request.set(true) },
            onProject: function () { projectRequest.onCancel = props.onCancel; projectRequest.set(true) },
            t: props.t || t,
          }) : null
        })
      })
    })
    scope.slots.inject('shell.overlay', function () {
      return scope.slots.register({ name: 'shell.overlay', id: 'git-clone-workspace', order: 45, locale: NS }, function (props) {
        return h(CloneWorkspaceEntry, { connection: connection, request: request,
          onBack: function () { request.set(false) }, onClose: function () { finish(request) },
          workspaces: scope.workspaces, navigation: { pickDirectory: picker.pick,
            openWorkspace: function (id) { return scope.uiWorkspace.openWorkspace(id) } }, t: props.t || t })
      })
    })
    scope.slots.inject('shell.overlay', function () {
      return scope.slots.register({ name: 'shell.overlay', id: 'git-directory-picker', order: 46, locale: NS }, function (props) {
        return h(HostDirectoryPicker, { picker: picker, t: props.t || t })
      })
    })
    scope.slots.inject('shell.overlay', function () {
      return scope.slots.register({ name: 'shell.overlay', id: 'git-new-project', order: 47, locale: NS }, function (props) {
        return h(NewProjectEntry, { request: projectRequest, picker: picker, connection: connection,
          onBack: function () { projectRequest.set(false) }, onClose: function () { finish(projectRequest) },
          workspaces: scope.workspaces, navigation: scope.uiWorkspace, t: props.t || t })
      })
    })
  })
}

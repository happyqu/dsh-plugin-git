import { h, NS, React } from '../../core/runtime.js'
import { CloneWorkspaceEntry } from './view.js'
import { WorkspaceAddFlow } from './workspace-flow.js'
import { createHostDirectoryPicker, HostDirectoryPicker } from './directory-picker.js'
import { NewProjectEntry } from './project.js'
import { registerWorktreeWorkspace } from '../worktrees/workspace.js'
import { callRpc } from '../../core/rpc.js'
import { readPluginConfig, watchPluginConfig } from '../../core/state.js'

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
    /** Dispose a set of seat contributions, ignoring ones already collected. */
    var releaseAll = function (disposers) {
      if (!disposers) return
      for (var dispose of disposers) {
        try {
          dispose()
        } catch (failure) { /* an already-collected effect is the outcome we wanted */ }
      }
    }
    /**
     * Shadow DSH's own add-workspace flow with this plugin's chooser.
     *
     * Documented single-slot shadowing: the lower rank renders. The native
     * occupant stays registered and resumes when this registration is disposed,
     * which is what the `workspaceAddDialog` switch relies on: turning it off
     * hands the seat back rather than leaving a dead button.
     */
    var installFlowShadow = function () {
      var disposers = []
      try {
        // `forEach`, not `for...of`: a seat whose declaration has not landed yet
        // runs its body LATER, and a function-scoped loop variable would then
        // register both seats under the last slot's name.
        flowSlots.forEach(function (slot) {
          disposers.push(scope.slots.inject(slot, function () {
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
          }))
        })
        return disposers
      } catch (failure) {
        // Half a shadow is worse than none: one seat would open this dialog and
        // the other DSH's own flow, which reads as a random difference between
        // the sidebar and the new-session hero.
        releaseAll(disposers)
        throw failure
      }
    }
    var shadow = null, settled = false
    /** Bring the shadow in line with the switch, without touching the other seats. */
    var setFlowShadow = function (enabled) {
      settled = true
      if (enabled === (shadow !== null)) return
      if (enabled) {
        try {
          shadow = installFlowShadow()
        } catch (failure) {
          // The plugin fiber is gone (or the seat moved): leave DSH's own flow alone.
          shadow = null
        }
        return
      }
      var disposers = shadow
      shadow = null
      releaseAll(disposers)
    }
    scope.effect(function () {
      // Subscribe first: when the settings page or the workbench already answered
      // in this page session, the stored value wins immediately and the default
      // below never installs a chooser the user had switched off.
      var unsubscribe = watchPluginConfig(function (config) {
        setFlowShadow((config === null || config === undefined || config.workspaceAddDialog === undefined)
          ? true : config.workspaceAddDialog === true)
      })
      // Nothing known yet: the default is on, so the chooser is in place from the
      // first paint rather than arriving one round trip later.
      if (!settled) setFlowShadow(true)
      readPluginConfig(function (method, payload) { return callRpc(connection, method, payload) })
      return function () { unsubscribe(); setFlowShadow(false) }
    }, 'git: workspace add dialog setting')
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

import { navigate } from './navigation.js'
import { React } from './runtime.js'

/**
 * A tiny shared store for the floating window's presentation.
 *
 * The window is opened from the Git controls but rendered in
 * `shell.overlay` — two different slots, so they cannot share React state.
 * A module-level store with subscriptions bridges them without either half
 * needing to reach into the other's tree.
 */
var windowState = {
  mode: 'closed',
  tab: 'changes',
  historyPath: '',
  /** `{ ref }` handed to the Compare tab when a "compare with" action asks. */
  compareWith: '',
  /**
   * The session the window was opened from.
   *
   * The launcher lives in a session-scoped slot and knows its `sessionId`,
   * but the window renders in the frame-wide `shell.overlay` slot, which is
   * root-scoped and receives no session binding at all. This store is the
   * bridge: the panel sends the id with every repository call, so the Host
   * opens the repository of the conversation the user is actually looking at
   * instead of guessing from the workspace registry's first entry.
   */
  sessionId: '',
  /** Explicit selected workspace directory, independent of repository discovery. */
  directory: '',
  /**
   * The repository root the header chips resolved.
   *
   * The chips and the workbench window are separate components with no
   * shared ancestor, and the window's own title needs the repository name.
   * Like `sessionId`, the fact travels through this store.
   */
  workspace: '',
  /** Incremented after a commit so the header and workbench reload together. */
  refreshToken: 0,
  /**
   * Explicit size for the workbench window, or `null` while its default
   * applies. The window is a centred dialog, so this is size only — there is
   * no position to remember.
   */
  size: null,
  /** Plugin window position; null uses the centered default. */
  position: null,
  /** Where the resize started, captured on pointer-down. */
  resize: null,
  /** Whether the minimized pill is showing instead of the window. */
  minimized: false,
  /** Plugin-only expansion; the normal size is retained for restoration. */
  maximized: false,
  listeners: new Set(),
}


/**
 * Update the window state and notify subscribers.
 * @param patch - partial state.
 */
function setWindowState(patch, approved) {
  if (!approved && (patch.mode === 'closed' || (patch.tab !== undefined && patch.tab !== windowState.tab) || (patch.workspace !== undefined && patch.workspace !== windowState.workspace) || (patch.directory !== undefined && patch.directory !== windowState.directory) || (patch.sessionId !== undefined && patch.sessionId !== windowState.sessionId))) {
    navigate(function () { setWindowState(patch, true) }); return
  }
  windowState = Object.assign({}, windowState, patch)
  for (const listener of [...windowState.listeners]) listener()
}


/**
 * Subscribe to window-state changes.
 * @param listener - called on every change.
 * @returns an unsubscribe function.
 */
function subscribeWindow(listener) {
  windowState.listeners.add(listener)
  return function () { windowState.listeners.delete(listener) }
}


/** Read the current window state. */
function getWindowState() {
  return windowState
}

/** Every launcher supplies its own context; never inherit another directory. */
function openGitWindow(context, options) {
  var directory = context.directory || ''
  setWindowState(Object.assign({ mode: 'full', minimized: false, tab: 'changes', historyPath: '', compareWith: '' }, options, {
    sessionId: context.sessionId || '', directory: directory, workspace: context.workspace || directory,
  }))
}

/** Close portalled dropdowns when their owning workbench is hidden. */
function useCloseOnWindowHide(ref, setOpen) {
  React.useEffect(function () {
    return subscribeWindow(function () {
      var state = getWindowState()
      if ((state.mode === 'closed' || state.minimized) && ref.current?.closest?.('.dshgit-workbench')) setOpen(false)
    })
  }, [setOpen])
}


// Share the setting between the workbench and header commit forms.
var pluginConfig = null

var pluginConfigRead = null

var pluginConfigListeners = new Set()

/** Watchers outside the React tree — see {@link watchPluginConfig}. */
var pluginConfigWatchers = new Set()

function publishPluginConfig(config) {
  pluginConfig = config
  pluginConfigListeners.forEach(function (listener) { listener(config) })
  for (const watcher of [...pluginConfigWatchers]) {
    try {
      watcher(config)
    } catch (failure) {
      // One broken watcher must not stop the others, or the settings page's own
      // subscribers, from seeing the value it just saved.
      console.error('[git] plugin config watcher failed:', failure)
    }
  }
}

/**
 * Observe the plugin configuration from outside a component tree.
 *
 * The workspace-add shadow is a slot registration made from the plugin context,
 * so there is no React ancestor whose `usePluginConfig` it could share state
 * with. The value it needs is the same one the settings page writes, so it
 * listens on the published store instead of issuing a second read.
 *
 * @param listener - called now (when a config is already known) and on every publish.
 * @returns an unsubscribe function.
 */
function watchPluginConfig(listener) {
  pluginConfigWatchers.add(listener)
  if (pluginConfig !== null) listener(pluginConfig)
  return function () { pluginConfigWatchers.delete(listener) }
}

/**
 * Read the configuration once, so a switch that lives outside any component
 * (the workspace-add shadow) knows where it stands on a fresh page load.
 *
 * Shares the in-flight read with {@link usePluginConfig}: the plugin's own
 * activation read and a component mounting at the same time must not ask the
 * Host for the same settings twice.
 *
 * @param run - the caller's RPC helper.
 * @returns the published settings, or null when the Host could not answer.
 */
function readPluginConfig(run) {
  if (pluginConfig !== null) return Promise.resolve(pluginConfig)
  if (!pluginConfigRead) pluginConfigRead = Promise.resolve(run('config', {}, { silent: true, silentError: true }))
    .then(function (config) { publishPluginConfig(config); return config })
    .finally(function () { pluginConfigRead = null })
  return pluginConfigRead.catch(function () { return null })
}

function usePluginConfig(run) {
  var state = React.useState(pluginConfig)
  React.useEffect(function () {
    var active = true
    pluginConfigListeners.add(state[1])
    if (pluginConfig !== null) state[1](pluginConfig)
    else readPluginConfig(run).then(function (config) { if (active) state[1](config) })
    return function () { active = false; pluginConfigListeners.delete(state[1]) }
  }, [run])
  return state[0]
}

export { getWindowState, openGitWindow, publishPluginConfig, readPluginConfig, setWindowState, subscribeWindow, useCloseOnWindowHide, usePluginConfig, watchPluginConfig, windowState }

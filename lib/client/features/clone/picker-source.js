/**
 * Directory request order for the workspace flow.
 *
 * Two choosers can exist at once, and which one should answer depends on the
 * platform rather than on preference alone:
 *
 * - **macOS Desktop**: the Host's `osascript` panel is an `NSOpenPanel`, which is
 *   the same kind of panel the rest of the app shows and what this flow used
 *   before the Desktop bridge existed. Electron's sheet is the fallback.
 * - **Windows Desktop**: the Electron bridge is the lighter path; the Host's
 *   chooser spawns a koffi/COM child process for every pick.
 * - **Ordinary Web**: there is no bridge, and the Host chooser is the only
 *   native surface. Browsing is the last resort because a browse-only Host
 *   rejects `pick` outright.
 *
 * Whatever the order, every branch still ends in exactly one answer, and one
 * broken chooser never strands the button.
 */

/**
 * The Desktop renderer's local chooser, when this page runs in the app shell.
 *
 * @param target - the global object; injectable so tests need no browser.
 * @returns the bridge, or null outside Desktop.
 */
export function desktopChooser(target) {
  var scope = target === undefined ? globalThis : target
  var bridge = scope?.__DSH_DIRECTORY_PICKER__
  return bridge !== null && bridge !== undefined && typeof bridge === 'object' && typeof bridge.pick === 'function' ? bridge : null
}

/**
 * The host platform, as the Desktop preload publishes it.
 *
 * `process.platform` is only reachable from the preload, which mirrors it onto
 * `<html data-platform>`; the attribute is absent in an ordinary browser. It is
 * deliberately not read from `navigator`: a remote DSH session renders in a
 * browser on one machine while the chooser opens on another, so the browser's
 * own platform says nothing about which panel is being asked for.
 *
 * @param target - the global object; injectable so tests need no browser.
 * @returns the platform string, or null when this is not the Desktop shell.
 */
export function desktopPlatform(target) {
  var scope = target === undefined ? globalThis : target
  var value = scope?.document?.documentElement?.dataset?.platform
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * One chooser answer as a path.
 *
 * Every source can answer with a cancel, an empty line, or a non-string; all of
 * them mean "nothing was chosen". Normalizing here keeps the caller from
 * treating `''` as a directory and asking the Host to adopt it.
 *
 * @param value - whatever the chooser returned.
 * @returns the path, or null when nothing was chosen.
 */
function selectedPath(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Present the in-app browser as the final answer.
 *
 * @param source - the chooser source.
 * @param fallbackError - the error to report when browsing is unavailable too.
 * @returns `{ listing }` for the caller to render.
 */
async function browseOrFail(source, fallbackError) {
  var listing
  try { listing = await source.browse() } catch (browseFailure) { throw fallbackError }
  return { listing: listing }
}

/**
 * Resolve one directory request in the platform's own order.
 *
 * A cancel is a path of `null`, not an error, and it always settles immediately:
 * falling through after a cancel would open a second panel the operator did not
 * ask for.
 *
 * Cancellation stops waiting and prevents a late failure from opening another
 * chooser. It cannot dismiss a native panel already owned by the Host.
 *
 * @param source - `{ native, browse, target, platform, signal }`. `native()` opens the
 *   Host chooser (a path, or null when cancelled) and `browse()` lists the first
 *   browsable level. `target` defaults to the global object; `platform`
 *   defaults to what the Desktop preload published.
 * @returns `{ path }` when a chooser answered, or `{ listing }` when the caller
 *   has to present the browse dialog.
 */
export function chooseDirectory(source) {
  var signal = source.signal
  var invoke = function (action) {
    if (signal?.aborted) throw signal.reason
    return action()
  }
  var guarded = Object.assign({}, source, {
    native: function () { return invoke(source.native) },
    browse: function () { return invoke(source.browse) },
  })
  if (signal?.aborted) return Promise.reject(signal.reason)
  return new Promise(function (resolve, reject) {
    var abort = function () { reject(signal.reason) }
    signal?.addEventListener('abort', abort, { once: true })
    resolveDirectory(guarded, invoke).then(resolve, reject).finally(function () {
      signal?.removeEventListener('abort', abort)
    })
  })
}

async function resolveDirectory(source, invoke) {
  var local = desktopChooser(source.target)
  var platform = source.platform === undefined ? desktopPlatform(source.target) : source.platform

  // macOS Desktop: lead with the Host's NSOpenPanel.
  if (local !== null && platform === 'darwin') {
    try { return { path: selectedPath(await source.native()) } }
    catch (hostFailure) {
      try { return { path: selectedPath(await invoke(function () { return local.pick() })) } }
      catch (localFailure) { return await browseOrFail(source, hostFailure) }
    }
  }

  if (local !== null) {
    try { return { path: selectedPath(await invoke(function () { return local.pick() })) } }
    catch (failure) {
      // Deliberately ignored: the Host chooser below is the next answer.
    }
  }

  var native
  try { native = await source.native() }
  catch (nativeFailure) { return await browseOrFail(source, nativeFailure) }
  return { path: selectedPath(native) }
}

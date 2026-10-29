import { watchOperation } from '../../core/operations.js'

/** Derive a suggestion only; an edited directory name always belongs to the user. */
export function cloneFolderName(address) {
  return String(address).trim().replace(/[?#].*$/, '').replace(/[\\/]+$/, '').split(/[\\/:]/).pop().replace(/\.git$/i, '')
}

/**
 * Why a directory/name pair cannot be used as a destination.
 *
 * `cloneDestination` answers with `null`, which is all the submit guard needs.
 * The dialogs need more than that: a button that is merely disabled leaves the
 * operator guessing, and the common macOS mistake (`~/projects`) is invisible
 * because the field looks filled in. Naming the reason lets the form say what to
 * type instead of only refusing to continue.
 *
 * @param parent - the parent directory field.
 * @param name - the new folder name field.
 * @returns the locale key for the first problem, or null when the pair is fine.
 */
export function cloneDestinationProblem(parent, name) {
  var directory = String(parent === undefined || parent === null ? '' : parent).trim(), folder = String(name === undefined || name === null ? '' : name).trim()
  // Path problems come first. A path the form rejects is usually the thing the
  // operator just typed, and it is often what is blocking them from knowing the
  // folder name at all (`~/projects` cannot suggest anything). Reporting an empty
  // folder name while the path is also wrong points at the wrong field.
  if (directory === '') return 'clone.problem.parentEmpty'
  // `~` is a shell convenience, not a filesystem concept: the Host receives the
  // literal string, so `~/projects` would create a directory actually named `~`.
  if (/^~/.test(directory)) return 'clone.problem.tilde'
  if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(directory)) return 'clone.problem.relative'
  if (/[\0\r\n]/.test(directory)) return 'clone.problem.control'
  if (folder === '') return 'clone.problem.nameEmpty'
  if (folder === '.' || folder === '..') return 'clone.problem.nameReserved'
  if (/[\\/\x00-\x1f]/.test(folder)) return 'clone.problem.nameSeparator'
  if (/^[A-Za-z]:|^\\\\/.test(directory) && (/[<>:"|?*]|[. ]$/.test(folder) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(folder))) return 'clone.problem.nameWindows'
  return null
}

export function cloneDestination(parent, name) {
  if (cloneDestinationProblem(parent, name) !== null) return null
  var directory = String(parent).trim(), folder = String(name).trim()
  return directory.replace(/[\\/]+$/, '') + (/^[A-Za-z]:|^\\\\/.test(directory) ? '\\' : '/') + folder
}

/** Start or reconnect an idempotent clone job. */
export async function cloneWorkspace(call, parameters, onJob, alive, existingJob) {
  var requestId = globalThis.crypto?.randomUUID?.() || 'clone-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
  var job = existingJob || { root: parameters.directory, method: 'cloneWorkspace', state: 'running', id: null, requestId: requestId }
  // Publish the request identity before sending: a lost acknowledgement does
  // not turn an accepted clone into an untracked operation.
  onJob(job)
  if (!job.id) {
    try {
      job = await call('operationStart', { root: parameters.directory, method: 'cloneWorkspace', parameters: parameters, requestId: job.requestId })
      if (alive()) onJob(job)
    } catch (failure) {
      // Definitive Host validation failures did not start this request. A
      // transport failure is ambiguous; keep its identity for an idempotent retry.
      if (failure.code?.startsWith('git/') && alive()) onJob(null)
      throw failure
    }
  }
  return watchOperation(call, job, { alive: alive, onUpdate: onJob, message: function (state) { return 'clone.' + state } })
}

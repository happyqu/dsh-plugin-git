import { watchOperation } from '../../core/operations.js'

/** Derive a suggestion only; an edited directory name always belongs to the user. */
export function cloneFolderName(address) {
  return String(address).trim().replace(/[?#].*$/, '').replace(/[\\/]+$/, '').split(/[\\/:]/).pop().replace(/\.git$/i, '')
}

export function cloneDestination(parent, name) {
  if (!String(parent).trim() || !name.trim() || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) return null
  var directory = parent.trim()
  if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(directory) || /[\0\r\n]/.test(directory)) return null
  if (/^[A-Za-z]:|^\\\\/.test(directory) && (/[<>:"|?*]|[. ]$/.test(name) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))) return null
  return directory.replace(/[\\/]+$/, '') + (/^[A-Za-z]:|^\\\\/.test(directory) ? '\\' : '/') + name
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

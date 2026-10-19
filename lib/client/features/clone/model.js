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

/** No legacy fallback: old clone handlers changed the global repository setting. */
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
  var failures = 0
  while (alive()) {
    onJob(job)
    if (job.state !== 'running') {
      if (job.state === 'complete' && job.result?.ok) return job.result.value
      if (job.state === 'cancelled') throw new Error('clone.cancelled')
      throw new Error(job.result?.error?.message || 'clone.' + job.state)
    }
    await new Promise(function (resolve) { setTimeout(resolve, 600) })
    if (!alive()) return null
    try { job = await call('operationStatus', { root: job.root, id: job.id }); failures = 0 }
    catch (error) {
      // Keep the job identity for reconnecting; never restart an uncertain clone.
      if (error.code === 'git/unknown-method' || ++failures >= 5) throw error
    }
  }
  return null
}

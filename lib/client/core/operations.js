/** Wait for a Host job without restarting an operation after a transport failure. */
export async function watchOperation(call, initial, options = {}) {
  var job = initial, failures = 0
  var alive = function () { return !options.signal?.aborted && (!options.alive || options.alive()) }
  var wait = function (milliseconds) {
    return new Promise(function (resolve) {
      var finish = function () { clearTimeout(timer); options.signal?.removeEventListener('abort', finish); resolve() }
      var timer = setTimeout(finish, milliseconds)
      options.signal?.addEventListener('abort', finish, { once: true })
      if (options.signal?.aborted) finish()
    })
  }
  while (alive()) {
    if (!failures) options.onUpdate?.(job)
    if (job.state !== 'running') {
      if (options.returnJob) return job
      if (job.state === 'complete' && job.result?.ok) return job.result.value
      var failure = new Error(job.result?.error?.message || (options.message ? options.message(job.state) : 'Git operation ' + job.state))
      failure.code = job.result?.error?.code; failure.details = job.result?.error?.details
      throw failure
    }
    await wait(failures ? options.retryDelay ?? 2000 : options.interval ?? 600)
    if (!alive()) return null
    try {
      job = await call('operationStatus', { root: job.root, id: job.id })
      failures = 0
    } catch (error) {
      if (!alive()) return null
      if (error.code === 'git/unknown-method' || ++failures >= (options.maxFailures ?? 5)) throw error
      // Retry the status request without restarting the operation.
      continue
    }
  }
  return null
}

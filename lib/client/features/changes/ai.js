/** Prepare bounded context before generation, keeping both requests cancellable. */
async function requestCommitMessage(run, payload, options) {
  var settings = { silent: true, silentError: true, signal: options.signal }
  var context = await run('ai.prepareCommitMessage', payload, settings)
  options.signal.throwIfAborted()
  if (context && (context.available === false || context.empty)) return context
  var value = await run('ai.commitMessage', Object.assign({}, payload, context?.id ? { contextId: context.id } : {}), settings)
  options.signal.throwIfAborted()
  if (context?.prepareMs !== undefined && value?.timings) value.timings.prepareMs += context.prepareMs
  if (context) value.cacheHit = context.cacheHit
  return value
}

export { requestCommitMessage }

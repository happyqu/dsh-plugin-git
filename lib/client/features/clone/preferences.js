/** Keep preference reads/writes ordered across dialog closing and reopening. */
export function queueWorkspacePreference(request, task) {
  var next = (request.preferenceQueue || Promise.resolve()).then(task)
  request.preferenceQueue = next.catch(function () {})
  return next
}

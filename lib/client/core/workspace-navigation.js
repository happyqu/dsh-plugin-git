// The Host updates the Hero label before its asynchronous navigation completes.
// Track the public navigation call synchronously so old dialogs cannot write.
var snapshot = null, listeners = new Set()
export function getWorkspaceNavigation() { return snapshot }
export function subscribeWorkspaceNavigation(listener) {
  listeners.add(listener)
  return function () { listeners.delete(listener) }
}
function publish(value) {
  snapshot = value
  listeners.forEach(function (listener) { listener() })
}
export function acknowledgeWorkspaceNavigation(sessionId) {
  if (snapshot && !snapshot.connecting && snapshot.sessionId === sessionId) publish(null)
}

/** Observe the public method; preserve its receiver, callback, errors and lifetime. */
export function observeWorkspaceNavigation(navigation) {
  var original = navigation.openWorkspace, descriptor = Object.getOwnPropertyDescriptor(navigation, 'openWorkspace')
  var active = true, owner = {}
  var wrapped = function (workspaceId, beforeOpen) {
    if (!active) return original.apply(this, arguments)
    var request = { owner: owner, workspaceId: workspaceId, sessionId: null, connecting: true }
    publish(request)
    var settle = function (success) {
      if (!active || snapshot !== request) return
      if (success && request.sessionId) publish(Object.assign({}, request, { connecting: false }))
      else publish(null)
    }
    try {
      return Promise.resolve(original.call(this, workspaceId, function (sessionId) {
        request.sessionId = sessionId
        beforeOpen?.(sessionId)
      })).then(function (value) { settle(true); return value }, function (error) { settle(false); throw error })
    } catch (error) { settle(false); throw error }
  }
  navigation.openWorkspace = wrapped
  return function () {
    active = false
    if (navigation.openWorkspace === wrapped) {
      if (descriptor) Object.defineProperty(navigation, 'openWorkspace', descriptor)
      else delete navigation.openWorkspace
    }
    if (snapshot?.owner === owner) publish(null)
  }
}

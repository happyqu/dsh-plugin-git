import { React } from './runtime.js'

// Shared by the header and full workbench, so one generator protects both.
var owners = new Map(), listeners = new Set()
var keyFor = function (root) {
  var key = String(root || '').replace(/\\/g, '/').replace(/\/$/, '')
  return /^[A-Za-z]:\//.test(key) || key.startsWith('//') ? key.toLowerCase() : key
}
function isCommitMessageBusy(root) { return owners.has(keyFor(root)) }
function acquireCommitMessage(root) {
  var key = keyFor(root)
  if (!key || owners.has(key)) return null
  var owner = {}; owners.set(key, owner)
  listeners.forEach(function (listener) { listener() })
  return function () {
    if (owners.get(key) !== owner) return
    owners.delete(key); listeners.forEach(function (listener) { listener() })
  }
}
function useCommitMessageBusy(root) {
  var refresh = React.useState(0)[1]
  React.useEffect(function () {
    var changed = function () { refresh(function (value) { return value + 1 }) }
    listeners.add(changed); changed()
    return function () { listeners.delete(changed) }
  }, [root])
  return isCommitMessageBusy(root)
}

export { acquireCommitMessage, isCommitMessageBusy, useCommitMessageBusy }

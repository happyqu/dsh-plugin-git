// Public workspace services are owned by the root integration, not a Git tab.
import { touchWorktree, worktreePathKey } from './preferences.js'
var context = { items: [], byId: {}, available: false }, listeners = new Set()
export function publishWorktreeContext(workspaces, sessions) {
  context = !workspaces && !sessions ? { items: [], byId: {}, available: false } : {
    items: workspaces ? workspaces.items || [] : context.items,
    byId: sessions ? sessions.byId || {} : context.byId, available: !!workspaces || context.available,
  }
  listeners.forEach(function (listener) { listener() })
}
export function getWorktreeContext() { return context }
export function subscribeWorktreeContext(listener) { listeners.add(listener); return function () { listeners.delete(listener) } }
export function worktreeAssociations(path, snapshot) {
  var source = snapshot || context, key = worktreePathKey(path)
  return source.items.filter(function (item) { return worktreePathKey(item.path) === key }).map(function (item) {
    var ids = new Set(item.sessionIds || [])
    Object.keys(source.byId).forEach(function (id) { if (worktreePathKey(source.byId[id]?.cwd) === key) ids.add(id) })
    return Object.assign({}, item, { sessions: Array.from(ids).map(function (id) { return Object.assign({ id: id }, source.byId[id] || {}) }) })
  })
}
export function worktreeSessions(path, snapshot) {
  var source = snapshot || context, key = worktreePathKey(path), ids = new Set()
  source.items.filter(function (item) { return worktreePathKey(item.path) === key }).forEach(function (item) { (item.sessionIds || []).forEach(function (id) { ids.add(id) }) })
  Object.keys(source.byId).forEach(function (id) { if (worktreePathKey(source.byId[id]?.cwd) === key) ids.add(id) })
  return Array.from(ids).map(function (id) { return Object.assign({ id: id }, source.byId[id] || {}) })
}
var services = null
export function registerWorktreeWorkspace(value) {
  var workspaces = new Map()
  var registered = {
    pickDirectory: value.pickDirectory,
    open: async function (path, common, workspaceId) {
      var key = worktreePathKey(path)
      var existing = worktreeAssociations(path).find(function (item) { return !workspaceId || item.workspaceId === workspaceId })
      if (workspaceId && !existing) throw new Error('关联工作区已变化，请刷新后重试')
      var task = workspaces.get(key)
      if (existing) task = Promise.resolve(existing)
      if (!task) {
        task = Promise.resolve().then(function () { return value.workspaces.create({ path: path }) })
        workspaces.set(key, task)
        task.catch(function () { if (workspaces.get(key) === task) workspaces.delete(key) })
      }
      var workspace = await task
      if (services !== registered) return
      if (!workspace?.workspaceId) { workspaces.delete(key); throw new Error('Host 未返回有效的工作区，请重试') }
      var remember = function (sessionId) {
        var latest = context.items.find(function (item) { return item.workspaceId === workspace.workspaceId })
        var item = Object.assign({}, workspace, { path: path, sessionIds: Array.from(new Set([...(workspace.sessionIds || []), ...(latest?.sessionIds || []), ...(sessionId ? [sessionId] : [])])) })
        publishWorktreeContext({ items: context.items.filter(function (entry) { return entry.workspaceId !== workspace.workspaceId }).concat(item) }, null)
      }
      remember()
      // Completed creations live in the observable context. Keep only pending
      // creations here so an authoritative workspace deletion can take effect.
      workspaces.delete(key)
      await value.navigation.openWorkspace(workspace.workspaceId, function (sessionId) { if (services === registered) remember(sessionId) })
      if (common) { try { touchWorktree(common, path) } catch (error) { /* Navigation succeeded; recent history is optional. */ } }
    },
  }
  services = registered
  return function () { if (services === registered) { services = null; publishWorktreeContext(null, null) } }
}
export function worktreeWorkspace() { return services }

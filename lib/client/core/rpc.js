import { getWindowState } from './state.js'
import { RPC_CHANNEL, RPC_ENDPOINT } from './runtime.js'
import { isUnstaged } from './files.js'

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

/**
 * Attach the current session identity to a repository request.
 *
 * The Host cannot work out which conversation the panel is rendering: an
 * HTTP request carries no Agent initiator boundary, and the workspace
 * registry lists every workspace, not the active one. So the id travels with
 * the request and the Host prefers it over its own inference.
 *
 * An explicit `root`/`path` still chooses the repository. The session id
 * independently identifies the model for AI calls, even with that root.
 *
 * @param payload - the caller's payload.
 * @returns the payload with `sessionId`, when there is one to add.
 */
function withSession(payload) {
  var body = payload === undefined || payload === null ? {} : payload
  if (body.sessionId !== undefined) return body
  var sessionId = getWindowState().sessionId
  if (typeof sessionId !== 'string' || sessionId === '') return body
  return Object.assign({}, body, { sessionId: sessionId })
}


/**
 * Attach an EXPLICIT session identity to a repository request.
 *
 * {@link withSession} answers "which conversation is on screen?" from the
 * window store, and only the header cluster can publish that — from an
 * effect. React commits a child's passive effects BEFORE its parent's, so
 * the chips, being a child of that cluster, would still read the previous
 * id at the moment they reload for a switch. The request then resolves
 * against the conversation the user just left, and nothing re-runs it
 * afterwards: the header stays one session behind.
 *
 * A component that already knows its own id states it instead of asking a
 * store that has not caught up yet.
 *
 * @param payload - the caller's payload.
 * @param sessionId - the id the calling component was rendered for.
 * @returns the payload with `sessionId`, when there is one to add.
 */
function withExplicitSession(payload, sessionId) {
  var body = payload === undefined || payload === null ? {} : payload
  if (body.sessionId !== undefined) return body
  if (typeof sessionId !== 'string' || sessionId === '') return body
  return Object.assign({}, body, { sessionId: sessionId })
}


/**
 * Call one Host method over Connection RPC.
 *
 * @param connection - the Connection service.
 * @param method - the RPC method name.
 * @param payload - its payload.
 * @param signal - cancellation.
 * @returns the unwrapped value.
 */
var rpcFailureLog = [], rpcFailureSequence = 0

function rpcLogRoot(value) {
  var root = String(value || '').replace(/\\/g, '/').replace(/\/$/, '')
  return /^[A-Za-z]:\//.test(root) || root.startsWith('//') ? root.toLowerCase() : root
}

function mergeRpcFailures(entries, root) {
  return entries.concat(rpcFailureLog.filter(function (entry) { return !root || rpcLogRoot(entry.cwd) === rpcLogRoot(root) }))
    .sort(function (a, b) { return b.at - a.at }).slice(0, 300)
}

function rpcDiagnosticText(value) {
  return String(value || '').replace(/(\w+:\/\/)([^/\s:@]+):([^/\s@]+)@/g, '$1$2:***@')
    .replace(/(\w+:\/\/)([^/\s@]+)@/g, '$1***@').replace(/(?:ghp_|github_pat_|glpat-|sk-)[A-Za-z0-9_-]{10,}/g, '[redacted]')
    .replace(/(Authorization:\s*)[^\r\n]+/gi, '$1***')
}

function callRpc(connection, method, payload, signal) {
  return connection.rpc.call(RPC_CHANNEL, RPC_ENDPOINT, { method: method, payload: withSession(payload) }, signal)
    .then(function (result) {
      if (result && result.ok === true) {
        if (method === 'gitOutput') return Object.assign({}, result.value, { entries: mergeRpcFailures(result.value.entries || [], payload?.root) })
        if (method === 'clearGitOutput') rpcFailureLog = rpcFailureLog.filter(function (entry) { return payload?.root && rpcLogRoot(entry.cwd) !== rpcLogRoot(payload.root) })
        return result.value
      }
      var error = (result && result.error) || {}, wrapped = new Error(error.message || 'git 调用失败')
      wrapped.code = error.code; wrapped.details = error.details
      throw wrapped
    }).catch(function (failure) {
      if ((method.startsWith('write.') || method === 'operationStart') && failure.code !== 'git/needs-confirmation') {
        var raw = rpcDiagnosticText(failure.message), parts = [raw, 'RPC: ' + method]
        if (failure.code) parts.push('错误代码：' + failure.code)
        var paths = payload?.paths || (payload?.path ? [payload.path] : [])
        if (paths.length) parts.push('文件：\n' + paths.slice(0, 20).map(rpcDiagnosticText).join('\n'))
        if (failure.details?.stderr) parts.push(rpcDiagnosticText(failure.details.stderr))
        if (failure.details?.stdout) parts.push(rpcDiagnosticText(failure.details.stdout))
        if (failure.code === 'git/unknown-method') parts.push('Git Host 未识别该接口，请更新或重新加载插件 Host。')
        failure.message = parts.filter(function (part, index, all) { return all.indexOf(part) === index }).join('\n')
        rpcFailureLog.push({ id: 'rpc-' + (++rpcFailureSequence), at: Date.now(), cwd: payload?.root || payload?.directory || '',
          source: 'rpc', command: 'RPC ' + method, code: null, durationMs: null, stdout: '', stderr: failure.message.slice(0, 16000), error: null })
        if (rpcFailureLog.length > 100) rpcFailureLog.shift()
        if (method === 'write.discardPaths' && failure.code === 'git/unknown-method' && payload?.confirm === true) return discardWithLegacyHost(connection, payload, signal)
      }
      throw failure
    })
}

function startOperationCompatible(call, payload) {
  return call('operationStart', payload).catch(function (failure) {
    if (failure.code !== 'git/unknown-method' || !['clone', 'write.fetch', 'write.push', 'write.pull', 'write.lfsTransfer'].includes(payload.method)) throw failure
    return call(payload.method, payload.parameters).then(function (value) { return { legacy: true, value: value } })
  })
}

async function discardWithLegacyHost(connection, payload, signal) {
  var paths = Array.from(new Set(payload.paths || [])), expected = new Set(payload.untrackedPaths || []), completed = [], skipped = []
  if (!paths.length) throw new Error('请选择要丢弃的文件')
  var status = await callRpc(connection, 'status', { root: payload.root, force: true }, signal)
  var files = new Map((status.files || []).map(function (file) { return [file.path, file] }))
  for (var pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    var path = paths[pathIndex]
    if (signal?.aborted) throw new Error('Git 操作已取消')
    var file = files.get(path), untracked = file?.kind === 'untracked'
    if (/[*?\[\]]/.test(path) || /^[-:]/.test(path)) { skipped.push(path + '：旧 Host 无法安全处理此路径，请更新插件'); continue }
    if (!file || file.kind === 'unmerged' || file.kind === 'ignored' || file.submodule?.startsWith('S') || (!untracked && !isUnstaged(file)) || (Array.isArray(payload.untrackedPaths) && expected.has(path) !== untracked)) {
      skipped.push(path + '：状态已变化或需单独处理'); continue
    }
    try {
      await callRpc(connection, 'write.discardPath', { root: payload.root, path: path, untracked: untracked, confirm: true }, signal)
      completed.push(path)
    } catch (failure) { skipped.push(path + '：' + failure.message); paths.slice(pathIndex + 1).forEach(function (pending) { skipped.push(pending + '：前一项失败，尚未执行') }); break }
  }
  var after = await callRpc(connection, 'status', { root: payload.root, force: true }, signal)
  var remaining = (after.files || []).filter(function (file) { return completed.includes(file.path) && (isUnstaged(file) || expected.has(file.path)) })
  for (var completedPath of completed) {
    if (!expected.has(completedPath) || remaining.some(function (file) { return file.path === completedPath })) continue
    var blob = await callRpc(connection, 'fileContent', { root: payload.root, path: completedPath }, signal)
    if (blob.exists) remaining.push({ path: completedPath })
  }
  remaining.forEach(function (file) { skipped.push(file.path + '：丢弃后改动仍存在') })
  var message = '兼容旧 Host：已丢弃 ' + Math.max(0, completed.length - remaining.length) + ' 个文件'
  if (skipped.length) { var error = new Error(message + '；未完成的项目：\n' + skipped.join('\n')); error.code = 'git/discard-incomplete'; throw error }
  return { ok: true, message: message }
}

export { callRpc, mergeRpcFailures, startOperationCompatible, withExplicitSession }

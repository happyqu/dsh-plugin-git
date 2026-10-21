import { getWindowState } from './state.js'
import { RPC_CHANNEL, RPC_ENDPOINT } from './runtime.js'
import { isCommitMessageBusy } from './ai-commit.js'
import { getWorkspaceNavigation } from './workspace-navigation.js'

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

/** Explicit workspace selection must win over Host/session fallback inference. */
export function withWorkspace(payload, sessionId, directory, method) {
  var body = withExplicitSession(payload, sessionId)
  if (!directory) return body
  body = Object.assign({}, body, { sessionId: sessionId || '' })
  if (method === 'repos' && !body.path) body.path = directory
  if (method === 'initRepository' && !body.directory) body.directory = directory
  return body
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
  if (getWorkspaceNavigation() && (method.startsWith('write.') || method === 'operationStart' || method === 'initRepository' || method === 'updateChangelist')) {
    return Promise.reject(new Error('工作区正在切换，请等待切换完成'))
  }
  if (isCommitMessageBusy(payload?.root) && (method.startsWith('write.') || method === 'operationStart')) {
    return Promise.reject(new Error('AI 正在生成提交信息，请先取消或等待完成'))
  }
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
      }
      throw failure
    })
}

export { callRpc, mergeRpcFailures, withExplicitSession }

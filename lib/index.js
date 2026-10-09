/**
 * dsh-plugin-git — Host half.
 *
 * Wires the git core, durable settings, and the RPC endpoint used by the UI.
 * Every optional service is taken through a dynamic injection, so this bundle
 * still activates on a headless profile that has no `connection`, no `llm`, and
 * no workspace registry — it simply contributes less.
 *
 * ## Why the git executable is resolved once, eagerly
 *
 * The resolved path is the identity of the whole plugin. A machine carrying four
 * gits must not silently answer from a different one between two
 * RPC calls, and the settings page has to be able to show which one ran. So it
 * is resolved at activation, cached, and re-resolved only when the setting
 * changes.
 *
 * Repository operations are available through the browser UI. Destructive
 * operations require confirmation; no tools or prompt sections are registered
 * with the conversation agent.
 */
import { redact } from './git/commandLog.js'
import { ConfigStore } from './config.js'
import { RepoRegistry } from './git/repo.js'
import { createRpc } from './rpc.js'
import { createLlm } from './ai.js'

export const name = 'git'

/**
 * Hard requirements only.
 *
 * `connection`, `llm`, `agentDefaultModel`, `agents`
 * and `workspaceRegistry` are all taken through dynamic injections inside
 * `apply`. Declaring any of them as a static inject would leave this plugin
 * permanently pending on a profile that lacks it, which fails the whole profile
 * with "plugin tree failed to load".
 */
export const inject = []

/** RPC endpoint name and route, shared with the Client half. */
export const RPC_ENDPOINT = 'git'
export const RPC_PATH = '/api/git'

/**
 * Activate the plugin.
 * @param ctx - the Cordis plugin context.
 */
export function apply(ctx) {
  const logger = ctx.logger ?? console
  const config = new ConfigStore({ logger })

  /** Can the string be used as a workspace directory? */
  const usableCwd = (value) => (typeof value === 'string' && value !== '' ? value : undefined)

  /**
   * The directory a session is working in, by explicit session id.
   *
   * The panel names the session it is rendering, because an HTTP request carries
   * no Agent initiator boundary (`currentInitiator()` is only inside a turn) and
   * the workspace registry alone cannot say which conversation is on screen. The
   * session's own validated `header.cwd` is the authoritative answer, and the
   * workspace that accounts for that session is the fallback for an older or
   * differently-shaped session service.
   *
   * @param sessionId - the session to look up.
   * @returns its directory, or undefined when nothing is known.
   */
  const cwdOfSession = (sessionId) => {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    try {
      const session = ctx.get('sessions')?.get?.(sessionId)
      const direct = usableCwd(session?.header?.cwd)
      if (direct !== undefined) return direct
    } catch {
      // A session service that is present but unusable must not break `repos`.
    }
    try {
      const workspace = (ctx.get('workspaceRegistry')?.list?.() ?? [])
        .find((entry) => (entry?.sessionIds ?? []).includes(sessionId))
      return usableCwd(workspace?.path)
    } catch {
      // Same tolerance: a broken registry degrades the answer, not the plugin.
    }
    return undefined
  }

  /**
   * The active session directory, falling back to its workspace.
   *
   * @param sessionId - optional session to resolve; omitted asks the Host to
   *   infer the active one from the Agent initiator, then the workspace registry.
   */
  const sessionCwd = (sessionId) => {
    const named = cwdOfSession(sessionId)
    if (named !== undefined) return named
    // The session directory the Agent is working in is the best default: it is
    // what the user means by "my project" far more often than a stored path.
    // This path only works inside a turn (that is where the initiator boundary
    // exists), which is why an explicit `sessionId` is tried first.
    const agents = ctx.get('agents')
    try {
      const initiator = agents?.currentInitiator?.()
      const cwd = initiator?.session?.header?.cwd ?? initiator?.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') return cwd
    } catch {
      // An agent service that is present but not usable must not break `repos`.
    }
    const registry = ctx.get('workspaceRegistry')
    try {
      const workspace = (registry?.list?.() ?? []).find((entry) => typeof entry?.path === 'string' && entry.path !== '')
      if (workspace) return workspace.path
    } catch {
      // Same tolerance: a broken registry degrades the list, not the plugin.
    }
    return undefined
  }

  /** Repository discovery examines only the active directory. */
  const candidateDirectories = () => {
    const cwd = sessionCwd()
    return cwd ? [cwd] : []
  }

  let gitPathCache = null
  const registry = new RepoRegistry({
    logger,
    // The configured path is read on every resolution so a settings change is
    // picked up without reloading the plugin.
    resolveGitPath: async () => {
      const { resolveGitPath } = await import('./git/exec.js')
      await config.load()
      const configured = config.get().gitPath
      if (gitPathCache?.configured !== configured) {
        gitPathCache = { configured, promise: resolveGitPath({ configured }) }
      }
      return gitPathCache.promise
    },
  })

  /** Lazily resolved services, so a missing one degrades instead of failing. */
  const llm = createLlm({
    logger,
    getConfig: () => config.get(),
    getLlm: () => ctx.get('llm'),
    getSessionSelection: (sessionId) => {
      if (typeof sessionId !== 'string' || sessionId === '') return undefined
      const session = ctx.get('sessions')?.get?.(sessionId)
      if (!session) return undefined
      // Read the same selection as the session controller, without resuming an
      // Agent or creating a conversation turn. A pending choice wins over the
      // model used by the last request.
      try {
        const pending = ctx.get('sessionProjections')?.stateOf?.(session, 'modelSelection')?.pending
        if (pending?.provider && pending?.model) return pending
      } catch {
        // Older profiles may not register this projection; the last request
        // header still carries the session's model choice.
      }
      const header = session.requestHeader?.()
      const selection = header?.config
      if (!selection?.provider || !selection?.model) return undefined
      return { provider: selection.provider, model: selection.model,
        ...(selection.reasoningEffort === undefined || header.adapterDefaults?.reasoningEffort === true
          ? {} : { reasoningEffort: selection.reasoningEffort }) }
    },
    getDefaultSelection: () => {
      try {
        return ctx.get('agentDefaultModel')?.currentSelection?.()
      } catch {
        return undefined
      }
    },
  })

  const rpc = createRpc({
    registry,
    config,
    logger,
    llm,
    candidateDirectories,
    sessionCwd,
  })

  // Settings must be loaded before the first call that reads them; doing it here
  // rather than per-request keeps the RPC path synchronous-ish and makes a
  // corrupt file a startup log line instead of a per-call failure.
  config.load().then(
    (loaded) => logger.info?.('[git] settings loaded'),
    (error) => logger.warn?.(`[git] settings load failed: ${String(error)}`),
  )

  // ---- HTTP endpoint for the browser panel -------------------------------
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.connection ?? connectionCtx.get('connection')
    if (connection === undefined || typeof connection.fetch?.register !== 'function') {
      logger.warn?.('[git] connection.fetch unavailable; the panel RPC endpoint is not registered')
      return
    }
    connection.fetch.register({
      path: RPC_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        if (request.method !== 'POST') {
          return new Response('method not allowed', { status: 405 })
        }
        const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          return new Response('content type must be application/json', { status: 415 })
        }
        let message
        try {
          message = await request.json()
        } catch {
          return new Response('body is not JSON', { status: 400 })
        }
        const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request'
        const call = message?.payload
        if (
          message?.type !== 'client-request' ||
          typeof message.rpcId !== 'string' ||
          message.method !== RPC_ENDPOINT ||
          call === null ||
          typeof call !== 'object' ||
          typeof call.method !== 'string'
        ) {
          return reply(rpcId, {
            ok: false,
            error: { code: 'git/bad-request', message: 'Invalid git plugin request.' },
          })
        }
        try {
          // Cancellation is wired to the request: closing the panel must not
          // leave a 60-second `git blame` running against the machine.
          const result = await rpc.call(call.method, call.payload ?? {}, request.signal)
          return reply(rpcId, result)
        } catch (error) {
          const text = redact(error instanceof Error ? error.message : String(error))
          logger.warn?.(`[git] ${String(call.method)} failed: ${text}`)
          return reply(rpcId, { ok: false, error: { code: 'git/handler-failed', message: text } })
        }
      },
    })
    logger.info?.(`[git] RPC endpoint registered at ${RPC_PATH}`)
  })

  logger.info?.('[git] host ready')
}

/**
 * Build the JSON-RPC reply envelope the browser client understands.
 *
 * A `{ ok: false }` result must carry a `details` object even when empty: the
 * client's error path reads it, and omitting it surfaces as "clicking does
 * nothing" rather than as the message we actually produced.
 *
 * @param rpcId - the correlation id echoed from the request.
 * @param result - the `{ ok, value }` or `{ ok: false, error }` payload.
 * @returns an HTTP response carrying the envelope.
 */
function reply(rpcId, result) {
  const value =
    typeof result === 'object' && result !== null && result.ok === false
      ? { ...result, error: { ...result.error, details: result.error?.details ?? {} } }
      : result
  return Response.json({ type: 'server-response', rpcId, result: value })
}

/**
 * dsh-plugin-git — Host half.
 *
 * Wires four things: the git core (bound to one resolved executable), a durable
 * settings store, the RPC endpoint the browser panel calls, and the Agent tools.
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
 * ## Why reads and writes are so unevenly treated
 *
 * Reads are freely exposed as tools. Writes are NOT registered with the Agent as
 * tools unless explicitly enabled, and the browser UI must carry an explicit
 * confirmation for anything destructive. The reason is structural: DSH's file
 * sandbox governs DSH's own file operations and cannot constrain a git process
 * this plugin spawns, so `git checkout` here would rewrite the user's working
 * tree regardless of the session's file policy. Confirmation and a single write
 * module are the only defences available, which is why they are not optional.
 */
import { redact } from './git/commandLog.js'
import { ConfigStore } from './config.js'
import { RepoRegistry } from './git/repo.js'
import { createRpc } from './rpc.js'
import { createLlm } from './ai.js'
import { createTools, createWriteTools } from './tools.js'

export const name = 'git'

/**
 * Hard requirements only.
 *
 * `connection`, `llm`, `tools`, `agentDefaultModel`, `systemPrompt`, `agents`
 * and `workspaceRegistry` are all taken through dynamic injections inside
 * `apply`. Declaring any of them as a static inject would leave this plugin
 * permanently pending on a profile that lacks it, which fails the whole profile
 * with "plugin tree failed to load".
 */
export const inject = []

/** RPC endpoint name and route, shared with the Client half. */
export const RPC_ENDPOINT = 'git'
export const RPC_PATH = '/api/git'

/** Order for this plugin's system-prompt section. */
const PROMPT_SECTION_ORDER = 610

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

  // ---- Agent tools --------------------------------------------------------
  ctx.inject(['tools'], (toolsCtx) => {
    const tools = toolsCtx.tools ?? toolsCtx.get('tools')
    if (tools === undefined || typeof tools.register !== 'function') return
    for (const definition of createTools({ rpc, logger })) {
      ctx.effect(() => tools.register(definition), `git: tool ${definition.name}`)
    }

    // Write tools stay unregistered unless the user asks for them; a model that
    // can discard uncommitted work without a human in the loop is not a feature.
    //
    // This decision is ASYNC because the setting is read from disk. Reading
    // `config.get()` synchronously here would consult whatever the defaults were
    // at activation time — the load would still be in flight — so the switch
    // would appear to do nothing until the next restart. Awaiting the load first
    // is what makes the checkbox take effect immediately.
    ctx.effect(() => {
      let disposed = false
      let registered = []
      const removeAll = () => {
        for (const disposer of registered) {
          try {
            disposer()
          } catch (error) {
            logger.warn?.(`[git] could not unregister a write tool: ${String(error)}`)
          }
        }
        registered = []
      }

      config.load().then(
        () => {
          if (disposed) return
          if (config.get().enableWriteTools !== true) {
            logger.info?.('[git] write tools stay disabled (enableWriteTools=false)')
            return
          }
          for (const definition of createWriteTools({ rpc, logger })) {
            registered.push(tools.register(definition))
          }
          logger.info?.(`[git] ${registered.length} write tools registered`)
        },
        (error) => logger.warn?.(`[git] write-tool setup failed: ${String(error)}`),
      )

      return () => {
        disposed = true
        removeAll()
      }
    }, 'git: write tools (opt-in)')

    logger.info?.('[git] agent tools registered')
  })

  // ---- Prompt section -----------------------------------------------------
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const systemPrompt = promptCtx.systemPrompt ?? promptCtx.get('systemPrompt')
    if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') return
    ctx.effect(
      () =>
        systemPrompt.section({
          name: 'git-tools',
          order: PROMPT_SECTION_ORDER,
          text: [
            '## Git',
            '本会话可用 `git_*` 工具读取仓库信息：`git_repos`、`git_status`、`git_log`、`git_show`、',
            '`git_diff`、`git_blame`、`git_line_history`、`git_commit_graph`，以及 `git_ai_commit_message`、',
            '`git_ai_explain_commit`。',
            '这些都是只读的，不会改动工作区。要判断「这行代码谁改的、为什么改」时优先用 `git_blame` +',
            '`git_line_history`（后者会追踪重命名）；要看某个文件怎么演变成现在这样用 `git_log` 带 `path`。',
            '注意：本插件默认不向模型开放写操作（提交、切换分支、丢弃改动），需要用户自己在 Git 面板里执行。',
          ].join('\n'),
        }),
      'git: prompt section',
    )
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

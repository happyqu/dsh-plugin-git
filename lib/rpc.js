/**
 * dsh-plugin-git — RPC surface.
 *
 * This dispatcher is the single definition of what the plugin can do. The
 * browser panel calls it over Connection RPC and the Agent tools call the very
 * same handler functions in-process, so a capability cannot drift between the
 * two entry points and a failure reason is written once.
 *
 * Read methods live in `readMethods`; write methods are named in
 * `WRITE_METHODS` and require an explicit confirmation token, because the file
 * sandbox cannot constrain a git process we spawn (see write.js).
 */
import { blame, blameStream, lineHistory } from './git/blame.js'
import { diff, fileContent, imageDiff, diffSummary, diffstat, splitDiffByFile, diffResult } from './git/diff.js'
import { commitGraph } from './git/graph.js'
import { exportRevisionFile } from './git/export.js'
import { exportRevisionZip } from './git/archive.js'
import { openInEditor } from './editor.js'
import { localIgnoreRules } from './git/localIgnore.js'
import { repositoryVersion, repositoryPreviewVersions } from './git/watch.js'
import { conflictToolResult } from './git/conflictTool.js'
import { operationReview } from './git/operationReview.js'
import { conflictFile, repoIdentity } from './git/conflicts.js'
import { lfsStatus, lfsDetails, lfsBranches, lfsFiles, lfsMigrationPreview } from './git/lfs.js'
import { hostingAccounts, hostingRepositories } from './git/hosting.js'
import { changelists, readChangelistCommitPolicy } from './git/changelists.js'
import { blockedChangelistCommitPaths } from './shared/changelistCommitPolicy.js'
import { changelistDiff } from './git/scopedCommit.js'
import { createCommitContextCache } from './git/aiContextCache.js'
import { workbenchPreview, checkWorkbenchIdentity, resolveCommit, reflog } from './git/workbench.js'
import { rewritePreview } from './git/rewrite.js'
import { normalizeSlashes } from './git/capability.js'
import { isSafePath, riskOf, WRITE_METHODS } from './git/write.js'
import { reclaimAbandonedIndexLock } from './git/indexLock.js'
import { readCommandLog, clearCommandLog, recordCommand, formatCommand, redact } from './git/commandLog.js'
import * as writes from './git/write.js'
import { commonDirectory, worktreeDetails, worktreeManagementPreview, worktreeCreatePreview, worktreeRemovalPreview } from './git/worktrees.js'
import { createWorktreeComparisonStore } from './git/worktreeCompare.js'
import { mkdir, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { git, observeGitProgress } from './git/exec.js'
import { randomUUID } from 'node:crypto'


/**
 * Build the RPC dispatcher.
 *
 * @param deps - plugin dependencies (registry, config store, llm, logger).
 * @returns `{ methods, call, riskOf }`.
 */
export function createRpc(deps) {
  const worktreeComparisons = createWorktreeComparisonStore()
  const { registry, config, logger, llm } = deps
  const commitContexts = createCommitContextCache()
  const projectRequests = new Map()
  const writeLocks = new Map()
  const autoFetches = new Map()
  const autoFetchValue = state => ({ running: state?.running === true, error: state?.error || null,
    lastSuccess: state?.lastSuccess || null, revision: state?.revision || 0 })
  const jobs = new Map()

  /**
   * Resolve the directory to open when a request names no repository.
   *
   * Precedence is: the directory of the session the caller named (`sessionCwd`
   * takes an explicit `sessionId`), else whatever the Host can infer by itself
   * (the Agent initiator inside a turn, then the first workspace), else the
   * configured default. The named session wins over inference because only the
   * client knows which conversation the user has in front of them.
   *
   * Every step is attempted with its own guard: a session service that throws
   * (or a profile that has none) must degrade to the next source, never fail the
   * request — "which repo" is a preference, not an invariant.
   *
   * @param payload - the request payload.
   * @returns an absolute directory, or undefined when nothing is known.
   */
  const targetDirectory = (payload) => {
    const sessionId = typeof payload?.sessionId === 'string' && payload.sessionId !== ''
      ? payload.sessionId
      : undefined
    for (const source of [
      () => (sessionId === undefined ? undefined : deps.sessionCwd?.(sessionId)),
      () => deps.sessionCwd?.(),
      () => config.get().defaultRepo,
    ]) {
      try {
        const candidate = source()
        if (typeof candidate === 'string' && candidate !== '') return candidate
      } catch (error) {
        logger?.warn?.(`[git] repository resolution fell through: ${redact(String(error))}`)
      }
    }
    return undefined
  }

  /**
   * Resolve the repository a request targets.
   *
   * Every method that needs a repo goes through here, so the "which repo" rule
   * is one function: an explicit `root`, else the request's `path`, else the
   * directory of the session the request names, else the session the Host can
   * see, else the configured default.
   *
   * The explicit `sessionId` matters and is not belt-and-braces. An HTTP request
   * from the panel has NO Agent initiator boundary around it — that boundary
   * only exists inside a turn — so `sessionCwd()` cannot tell which conversation
   * the user is looking at and degrades to "the first workspace in the registry".
   * That is a different repository as soon as a second workspace exists, which is
   * exactly the bug this ordering fixes: the panel opens the current session's
   * repository because the panel says which session it is.
   *
   * @param payload - the request payload.
   * @returns `{ repo }` or `{ error }`.
   */
  const gitUnavailableError = () => {
    const configured = typeof config.get().gitPath === 'string' ? config.get().gitPath.trim() : ''
    return configured
      ? { code: 'git/invalid-path', message: `配置的 Git 路径无法执行：${configured}。请检查路径，或清空后自动检测。`, details: { gitPath: configured } }
      : { code: 'git/not-found', message: '未找到 Git。请安装 Git 后点击重试；已安装时可在设置里填写 git 可执行文件的完整路径。' }
  }
  const needRepo = async (payload) => {
    const target = payload?.root ?? payload?.path ?? targetDirectory(payload)
    if (typeof target !== 'string' || target === '') {
      return { error: { code: 'git/no-target', message: '没有可用的仓库目录，请先在设置里指定或打开一个 git 仓库' } }
    }
    const opened = await registry.open(target, {})
    if (opened.session === null) {
      if (opened.reason === 'git-not-found') return { error: gitUnavailableError() }
      return {
        error: {
          code: `git/${opened.reason}`,
          message: reasonMessage(opened.reason),
          details: { target },
        },
      }
    }
    return { repo: opened.session }
  }

  /** Wrap a handler so repository resolution and error shaping happen once. */
  const withRepo = (handler) => async (payload, signal) => {
    const resolved = await needRepo(payload ?? {})
    if (resolved.error !== undefined) return { ok: false, error: resolved.error }
    try {
      const value = await handler(resolved.repo, payload ?? {}, signal)
      return { ok: true, value }
    } catch (error) {
      logger?.warn?.(`[git] ${redact(String(error))}`)
      return {
        ok: false,
        error: {
          code: error.code === 'git/worktree-snapshot-expired' ? error.code : 'git/failed',
          message: redact(error instanceof Error ? error.message : String(error)),
        },
      }
    }
  }

  /** Wrap a write handler: risk is attached, failures become messages. */
  const withWrite = (method, handler) => async (payload, signal, operationRepo) => {
    // Only operationStart supplies this third argument, after resolving the
    // repository for this job. RPC payloads cannot provide a session object.
    const resolved = operationRepo ? { repo: operationRepo } : await needRepo(payload ?? {})
    if (resolved.error !== undefined) return { ok: false, error: resolved.error }
    const repo = resolved.repo

    // Reject unsafe path arguments up front.
    //
    // This is not belt-and-braces. The path filters inside write.js DROP unsafe
    // entries, and an empty `paths` array means "everything" to `git add` — so a
    // request naming only `../../etc/passwd` used to end up staging the entire
    // working tree. Silently doing something far larger than asked is the worst
    // possible failure mode, so it is an explicit refusal instead.
    const unsafe = findUnsafePath(payload, method)
    if (unsafe !== null) {
      return {
        ok: false,
        error: {
          code: 'git/unsafe-path',
          message: `拒绝执行：路径不安全（${unsafe}）`,
          details: { path: unsafe },
        },
      }
    }

    // A confirmation token is required for anything that discards content or
    // rewrites history; it is the UI's (or the Agent's) proof that a human saw
    // what was about to happen. Callers pass it through `confirm`.
    //
    // The PAYLOAD is passed too, because for some methods the risk depends on
    // the arguments rather than the name: a plain push is fast-forward-only and
    // harmless, while `--force-with-lease` rewrites published history.
    const risk = riskOf(method, payload)
    if (risk !== 'safe' && payload?.confirm !== true) {
      const consequence = method === 'manageWorktree' ? '修改工作树锁定、目录或关联记录'
        : method === 'removeWorktree' ? '删除工作树目录及关联记录'
          : risk === 'destructive' ? '丢弃未提交的改动' : '改写已发布的历史'
      return {
        ok: false,
        error: {
          code: 'git/needs-confirmation',
          message: `${method} 会${consequence}，需要显式确认`,
          details: { risk },
        },
      }
    }
    const backgroundFetch = autoFetches.get(repo.root)
    if (backgroundFetch?.running) { backgroundFetch.controller?.abort(); await backgroundFetch.task }
    const lockKey = commonDirectory(repo)
    const running = writeLocks.get(lockKey) || writeLocks.get(repo.root)
    if (running) {
      const elapsedMs = Math.max(0, Date.now() - running.startedAt)
      const label = { commitPaths: '提交', commit: '提交', stage: '暂存', unstage: '取消暂存', fetch: '获取远端分支',
        backgroundFetch: '后台 Fetch', push: '推送', pull: '拉取', rewriteCommits: '改写提交', stashChangelist: '储藏' }[running.method] || running.method
      return { ok: false, error: { code: 'git/busy', message: `该仓库正在执行${label}，已运行 ${Math.floor(elapsedMs / 1000)} 秒，请等待该操作结束后再试`,
        details: { method: running.method, startedAt: running.startedAt, elapsedMs } } }
    }
    const operation = { method, startedAt: Date.now() }
    writeLocks.set(lockKey, operation)
    try {
      await checkWorkbenchIdentity(repo, payload?.guard, { signal })
      // A lock this plugin abandoned (its Host was killed mid-commit) would make
      // this very write fail with Git's own "another git process" text. Reclaim it
      // first, but only when its owner is provably gone.
      // Scoped commits acquire/recover this same lock themselves; probing it
      // here would add a redundant Git process before every commit.
      if (method !== 'commitPaths') {
        try { await reclaimAbandonedIndexLock(repo, { signal }) } catch { /* best effort: the write reports the real problem */ }
      }
      const result = await handler(repo, payload ?? {}, { signal, ...(method === 'launchConflictTool' ? { executable: config.get().editorPath } : {}) })
      if (result?.ok && result.worktreeChange && ['move', 'repair', 'prune'].includes(result.worktreeChange.action)) {
        // A moved directory must be rediscovered with its new Git identity.
        for (const [key, session] of registry.sessions) if (commonDirectory(session) === lockKey && session.root !== repo.root) registry.sessions.delete(key)
      }
      if (method === 'fetch' && result?.ok !== false && result?.code === 0) {
        const state = autoFetches.get(repo.root)
        let fetchedAll = payload?.all === true && !payload?.name && !payload?.branch
        if (state && !fetchedAll && !payload?.name && !payload?.branch && !payload?.updateLocal) {
          // A plain fetch covers the full scope only in a single-remote repo.
          // Failure to read this auxiliary scope must not turn a successful
          // fetch into a reported failure; retain the background state instead.
          const remotes = await repo.remotes({ signal }).catch(() => null)
          fetchedAll = remotes?.length === 1 && (!payload?.remote || payload.remote === remotes[0].name)
        }
        if (state && fetchedAll) { state.attemptedAt = Date.now(); state.nextAt = state.attemptedAt + config.get().autoFetchInterval * 60000;
          state.error = null; state.failures = 0; state.lastSuccess = Date.now(); state.revision++ }
      }
      if (result) {
        // Any successful write invalidates at least the status and refs; a
        // commit also invalidates the log. Being generous here is correct:
        // a stale status after a mutation is the worst possible UI bug.
        for (const session of registry.list()) if (commonDirectory(session) === lockKey) session.cache.invalidate()
      }
      return result?.ok === false
        ? { ok: false, error: { code: 'git/write-failed', message: redact(result.message), details: { stdout: redact(result.stdout), code: result.code, recovery: result.recovery, commitDiagnostics: result.commitDiagnostics } } }
        : { ok: true, value: publicWriteValue(result) }
    } catch (error) {
      for (const session of registry.list()) if (commonDirectory(session) === lockKey) session.cache.invalidate()
      return {
        ok: false,
        error: { code: 'git/write-threw', message: redact(error instanceof Error ? error.message : String(error)), details: { recovery: error.recovery } },
      }
    } finally { if (writeLocks.get(lockKey) === operation) writeLocks.delete(lockKey) }
  }

  // Frequent scheduler polls reuse an open session without spawning rev-parse.
  const withCachedRepo = handler => async (payload, signal) => {
    const root = typeof payload?.root === 'string' ? resolve(payload.root) : null
    const repo = root && [...registry.sessions.values()].find(session => resolve(session.root) === root)
    if (!repo) return withRepo(handler)(payload, signal)
    try { return { ok: true, value: await handler(repo, payload ?? {}, signal) } }
    catch (error) { return { ok: false, error: { code: 'git/failed', message: redact(error instanceof Error ? error.message : String(error)) } } }
  }
  const methods = {
    // Called only by visible subscribers. The host owns scheduling and the write
    // lock, so multiple windows never launch duplicate background fetches.
    'write.backgroundFetch': withCachedRepo(async repo => {
      const settings = config.get()
      let state = autoFetches.get(repo.root)
      if (!settings.autoFetch) return autoFetchValue(null)
      if (!state) { state = { attemptedAt: 0, nextAt: 0, running: false, error: null, failures: 0, revision: 0 }; autoFetches.set(repo.root, state) }
      const interval = settings.autoFetchInterval * 60000
      if (state.interval !== interval) {
        state.interval = interval
        state.nextAt = state.attemptedAt + interval * (state.failures ? 2 ** Math.min(state.failures, 3) : 1)
      }
      if (state.running || writeLocks.has(commonDirectory(repo)) || writeLocks.has(repo.root) || Date.now() < Math.max(state.nextAt, state.attemptedAt + interval)) return autoFetchValue(state)
      const operation = { method: 'backgroundFetch', startedAt: Date.now() }
      const lockKey = commonDirectory(repo)
      state.running = true; state.revision++; writeLocks.set(lockKey, operation)
      state.controller = new AbortController()
      state.task = (async () => {
        try {
          if (await repo.operation({ signal: state.controller.signal })) { state.nextAt = Date.now() + 60000; return }
          if (!config.get().autoFetch || state.controller.signal.aborted) return
          state.attemptedAt = Date.now(); state.nextAt = state.attemptedAt + interval
          const remotes = await repo.remotes({ signal: state.controller.signal })
          if (!remotes.length) { state.error = null; return }
          const result = await git({ gitPath: repo.gitPath, cwd: repo.root,
            args: ['-c', 'credential.interactive=false', 'fetch', '--all', '--no-recurse-submodules', '--quiet'],
            env: { GCM_INTERACTIVE: 'Never', GIT_ASKPASS: 'true', SSH_ASKPASS_REQUIRE: 'never' }, timeoutMs: 30000, signal: state.controller.signal })
          if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Fetch 退出码 ${result.code}`)
          state.error = null; state.failures = 0; state.lastSuccess = Date.now()
        } catch (error) {
          if (!state.controller.signal.aborted) {
            state.error = redact(error instanceof Error ? error.message : String(error)).slice(0, 1200)
            state.failures++
            state.nextAt = Date.now() + Math.min(interval * 2 ** Math.min(state.failures, 3), 30 * 60000)
          }
        } finally {
          for (const session of registry.list()) if (commonDirectory(session) === lockKey) session.cache.invalidate('status', 'refs', 'log', 'fileLog')
          state.running = false; state.revision++; state.controller = null
          if (writeLocks.get(lockKey) === operation) writeLocks.delete(lockKey)
        }
      })()
      return autoFetchValue(state)
    }),
    repositoryVersion: async payload => {
      const root = typeof payload?.root === 'string' ? resolve(payload.root) : null
      const cached = root && [...registry.sessions.values()].find(repo => resolve(repo.root) === root)
      const paths = [...new Set(Array.isArray(payload?.paths) ? payload.paths.filter(isSafePath).slice(0, 20) : [])]
      const version = async repo => ({ ...repositoryVersion(repo), previews: await repositoryPreviewVersions(repo, paths) })
      if (cached) return { ok: true, value: await version(cached) }
      return withRepo(version)(payload)
    },
    conflictToolResult: withRepo((repo, payload, signal) => conflictToolResult(repo, payload, { signal })),
    operationReview: withRepo((repo, payload, signal) => operationReview(repo, payload, { signal })),
    conflictFile: withRepo((repo, payload, signal) => conflictFile(repo, payload, { signal })),
    repoIdentity: withRepo((repo, payload, signal) => repoIdentity(repo, payload, { signal })),
    lfsStatus: withRepo((repo, payload, signal) => lfsStatus(repo, payload, { signal, activeMigration: [...jobs.values()].some(job => job.root === repo.root && job.method === 'write.lfsMigrate' && job.state === 'running') })),
    lfsDetails: withRepo((repo, payload, signal) => lfsDetails(repo, payload, { signal, activeMigration: [...jobs.values()].some(job => job.root === repo.root && job.method === 'write.lfsMigrate' && job.state === 'running') })),
    lfsBranches: withRepo((repo, payload, signal) => lfsBranches(repo, payload, { signal })),
    lfsFiles: withRepo((repo, payload, signal) => lfsFiles(repo, payload, { signal })),
    lfsMigrationPreview: withRepo((repo, payload, signal) => lfsMigrationPreview(repo, payload, { signal })),
    /** Liveness plus the facts the settings page shows. */
    ping: async () => ({
      ok: true,
      value: {
        name: 'dsh-plugin-git',
        version: '0.1.0',
        gitPath: registry.gitPath || null,
        capabilities: { lfsImageFetch: true, exportRevisionFile: true, exportRevisionZip: true },
        config: config.get(),
      },
    }),

    /** Repositories known to this Host, plus whether git was found at all. */
    repos: async (payload) => {
      const gitPath = await registry.gitExecutable({ force: payload?.force === true })
      if (gitPath === null) return { ok: false, error: gitUnavailableError() }
      // The panel sends the session it is rendering, so discovery looks at THAT
      // conversation's workspace rather than at whichever one the Host happens
      // to list first.
      const sessionDirectory = targetDirectory(payload) ?? null
      const directory = typeof payload?.path === 'string' && payload.path !== ''
        ? payload.path
        : sessionDirectory ?? deps.candidateDirectories?.()[0] ?? null

      const repos = []
      if (directory !== null) {
        const opened = await registry.open(directory, {})
        if (opened.session !== null) repos.push(describeRepo(opened.session))
      }
      return { ok: true, value: { gitPath, repos, directory, canInitialize: directory !== null && repos.length === 0, config: config.get() } }
    },

    /**
     * Initialize a repository for the session the caller names.
     *
     * The target is the payload's explicit `directory`, else the named session's
     * workspace, else the Host's inferred session directory. The explicit
     * `directory` exists because a client that knows exactly which folder the
     * user opened must not be overruled by inference.
     */
    initRepository: async (payload, signal) => {
      const explicit = typeof payload?.directory === 'string' && payload.directory !== ''
        ? payload.directory
        : null
      const directory = explicit ?? targetDirectory(payload ?? {})
      if (typeof directory !== 'string' || !isAbsolute(directory)) {
        return { ok: false, error: { code: 'git/no-target', message: '当前会话没有可用的工作目录' } }
      }
      const target = resolve(directory)
      try {
        if (!(await stat(target)).isDirectory()) throw new Error('工作目录不是文件夹')
      } catch {
        return { ok: false, error: { code: 'git/no-target', message: '当前会话工作目录不存在' } }
      }
      const gitPath = await registry.gitExecutable()
      if (gitPath === null) return { ok: false, error: gitUnavailableError() }
      const existing = await registry.open(target, { signal })
      if (existing.session !== null) {
        return { ok: true, value: { directory: existing.session.root, alreadyInitialized: true } }
      }
      if (existing.reason !== 'not-a-repository') {
        return { ok: false, error: { code: `git/${existing.reason}`, message: reasonMessage(existing.reason) } }
      }
      const result = await git({ gitPath, cwd: target, args: ['init'], timeoutMs: 30_000, signal })
      if (result.code !== 0) {
        return { ok: false, error: { code: 'git/init-failed', message: result.stderr.trim() || `git init 退出码 ${result.code}` } }
      }
      return { ok: true, value: { directory: target, alreadyInitialized: false } }
    },

    status: withRepo(async (repo, payload, signal) => {
      const status = await repo.status({ force: payload.force === true, signal })
      return { repo: describeRepo(repo), ...status }
    }),

    refs: withRepo(async (repo, payload, signal) => repo.refs({
      force: payload.force === true,
      kind: payload.kind,
      signal,
    })),

    /**
     * Configured remotes with URLs.
     *
     * Separate from `refs` because a remote exists before any branch has been
     * fetched from it, so the refs view cannot show a newly added one.
     */
    remotes: withRepo(async (repo, payload, signal) => (await repo.remotes({ signal })).map((remote) => ({ ...remote, fetchUrl: remote.fetchUrl ? redact(remote.fetchUrl) : null, pushUrl: remote.pushUrl ? redact(remote.pushUrl) : null }))),

    stashes: withRepo((repo, payload, signal) => repo.stashes({ signal })),

    stashDiff: withRepo(async (repo, payload, signal) => {
      const ref = typeof payload.ref === 'string' ? payload.ref : ''
      if (!/^stash@\{\d+\}$/.test(ref)) throw new Error('无效的储藏引用')
      const target = typeof payload.expectedSha === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(payload.expectedSha) ? payload.expectedSha : ref
      if (payload.summaryOnly === true) {
        const text = await repo.runOrThrow(['stash', 'show', '--name-status', '-z', '--include-untracked', target],
          { timeoutMs: 45_000, signal })
        const fields = text.split('\0')
        const files = []
        for (let i = 0; i < fields.length && fields[i];) {
          const status = fields[i++]
          const originalPath = fields[i++]
          const renamed = /^[RC]/.test(status)
          const path = renamed ? fields[i++] : originalPath
          if (path) files.push({ status: status[0], path, from: renamed ? originalPath : null })
        }
        const counts = await repo.runOrThrow(['stash', 'show', '--numstat', '-z', '--include-untracked', target],
          { timeoutMs: 45_000, signal })
        const countFields = counts.split('\0')
        const byPath = new Map()
        for (let i = 0; i < countFields.length && countFields[i];) {
          const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(countFields[i++])
          if (!match) continue
          let path = match[3]
          if (!path) { i++; path = countFields[i++] }
          byPath.set(path, { added: match[1] === '-' ? null : Number(match[1]),
            deleted: match[2] === '-' ? null : Number(match[2]), binary: match[1] === '-' })
        }
        const primary = files.map(file => ({ ...file, ...(byPath.get(file.path) || {}) }))
        const staged = await diffstat(repo, [target + '^1', target + '^2'], { signal, throwOnError: true })
        for (const file of staged) if (!primary.some(entry => entry.path === file.path)) primary.push({ ...file, indexOnly: true })
        return { files: primary }
      }
      let text
      if (typeof payload.path === 'string' && payload.path !== '') {
        if (!isSafePath(payload.path)) throw new Error('无效的文件路径')
        // stash show does not accept a pathspec. Read the tracked snapshot and
        // the optional untracked parent separately, limiting both to one file.
        const paths = [payload.path]
        if (typeof payload.originalPath === 'string' && payload.originalPath !== '') {
          if (!isSafePath(payload.originalPath)) throw new Error('无效的文件路径')
          if (payload.originalPath !== payload.path) paths.push(payload.originalPath)
        }
        text = await repo.runOrThrow(['diff', '--find-renames=50%', target + '^1', target, '--', ...paths],
          { timeoutMs: 45_000, signal })
        if (!text.trim()) text = await repo.runOrThrow(['diff', '--find-renames=50%', target + '^1', target + '^2', '--', ...paths], { timeoutMs: 45_000, signal })
        const untracked = await repo.run(['rev-parse', '--verify', target + '^3'], { timeoutMs: 15_000, signal })
        if (untracked.code === 0) {
          text += await repo.runOrThrow(['show', '--format=', '--patch', target + '^3', '--', payload.path],
            { timeoutMs: 45_000, signal })
        }
      } else {
        text = await repo.runOrThrow(['stash', 'show', '--patch', '--include-untracked', target],
          { timeoutMs: 45_000, signal })
      }
      return diffResult(text)
    }),

    worktrees: withRepo((repo, payload, signal) => repo.worktrees({ signal })),
    worktreeDetails: withRepo((repo, payload, signal) => worktreeDetails(repo, payload, { signal })),
    worktreeCreatePreview: withRepo((repo, payload, signal) => worktreeCreatePreview(repo, payload, { signal })),
    worktreeRemovalPreview: withRepo((repo, payload, signal) => worktreeRemovalPreview(repo, payload, { signal })),
    worktreeManagementPreview: withRepo((repo, payload, signal) => worktreeManagementPreview(repo, payload, { signal })),
    worktreeCompare: withRepo((repo, payload, signal) => worktreeComparisons.compare(repo, payload, { signal })),
    worktreeCompareFile: withRepo((repo, payload, signal) => worktreeComparisons.file(repo, payload, { signal })),

    commits: withRepo(async (repo, payload, signal) => ({
      commits: await repo.commits({
        limit: payload.limit,
        skip: payload.skip,
        ref: payload.ref,
        path: payload.path,
        author: payload.author,
        grep: payload.grep,
        pickaxe: payload.pickaxe,
        pickaxeRegex: payload.pickaxeRegex,
        since: payload.since,
        until: payload.until,
        mergesOnly: payload.mergesOnly,
        noMerges: payload.noMerges,
        ordering: payload.ordering,
        signal,
      }),
    })),

    commit: withRepo((repo, payload, signal) => repo.commit(payload.sha, {
      force: payload.force === true,
      signal,
    })),

    commitGraph: withRepo((repo, payload, signal) => commitGraph(repo, {
      limit: payload.limit,
      all: payload.all,
      path: payload.path,
      refs: payload.refs,
      ordering: payload.ordering,
      showRemote: payload.showRemote,
    }, { signal })),
    workbenchPreview: withRepo((repo, payload, signal) => workbenchPreview(repo, payload, { signal })),
    hostingAccounts: withRepo((repo, payload, signal) => hostingAccounts(repo, { signal })),
    hostingRepositories: withRepo((repo, payload, signal) => hostingRepositories(repo, payload, { signal })),
    changelists: withRepo((repo, payload, signal) => changelists(repo, {}, { signal })),
    updateChangelist: withRepo((repo, payload, signal) => changelists(repo, { ...payload, internal: false }, { signal })),
    changelistDiff: withRepo(async (repo, payload, signal) => {
      const result = await changelistDiff(repo, payload, { signal })
      // Same cap as `diff`: this is the other path that turns git patch text into
      // a panel payload, and an uncapped one here would reintroduce the freeze.
      return { ...result, ...diffResult(result.text) }
    }),
    commitScopePreview: withRepo(async (repo, payload, signal) => {
      const status = await repo.status({ force: true, signal })
      if (status.files.some(file => file.kind === 'unmerged')) throw new Error('请先解决文件冲突')
      const staged = status.files.filter(file => file.index && ![' ', '.', '?'].includes(file.index))
      const scope = staged.length ? staged : status.files
      const policy = await readChangelistCommitPolicy(repo, { signal })
      if (blockedChangelistCommitPaths(policy, scope.flatMap(file => [file.path, ...(file.originalPath ? [file.originalPath] : [])])).length) throw new Error('提交范围包含已屏蔽提交的改动列表，请先调整范围')
      if (staged.length) return diff(repo, { staged: true, contextLines: 3 }, { signal })
      const result = await changelistDiff(repo, { paths: status.files.map(file => file.path) }, { signal })
      return { ...result, ...diffResult(result.text) }
    }),
    reflog: withRepo((repo, payload, signal) => reflog(repo, payload, { signal })),
    /**
     * Plan a message rewrite of unpushed commits.
     *
     * A read, deliberately: it changes nothing and refuses anything already
     * pushed, so the panel can call it to populate the confirmation dialog
     * without needing a confirmation token of its own.
     */
    rewritePreview: withRepo((repo, payload, signal) => rewritePreview(repo, {
      mode: payload.mode,
      sha: payload.sha,
      shas: payload.shas,
      message: payload.message,
    }, { signal })),

    blame: withRepo(async (repo, payload, signal) => blame(repo, {
      path: payload.path,
      rev: payload.rev,
      startLine: payload.startLine,
      endLine: payload.endLine,
      ignoreWhitespace: payload.ignoreWhitespace,
    }, { force: payload.force === true, signal })),

    lineHistory: withRepo((repo, payload, signal) => lineHistory(repo, {
      path: payload.path,
      line: payload.line,
      rev: payload.rev,
    }, { maxDepth: payload.maxDepth, signal })),

    diff: withRepo(async (repo, payload, signal) => diff(repo, {
      commit: payload.commit,
      from: payload.from,
      to: payload.to,
      path: payload.path,
      originalPath: payload.originalPath,
      previewOnly: payload.previewOnly === true,
      reverse: payload.reverse,
      staged: payload.staged,
      contextLines: payload.contextLines,
      ignoreWhitespace: payload.ignoreWhitespace,
      similarityThreshold: payload.similarityThreshold ?? config.get().similarityThreshold,
    }, { signal })),

    fileContent: withRepo((repo, payload, signal) => fileContent(repo, {
      path: payload.path,
      rev: payload.rev,
    }, { signal })),

    exportRevisionFile: withRepo((repo, payload, signal) => exportRevisionFile(repo, {
      path: payload.path, rev: payload.rev,
    }, { signal })),
    exportRevisionZip: withRepo((repo, payload, signal) => exportRevisionZip(repo, payload, { signal })),
    openInEditor: withRepo((repo, payload, signal) => openInEditor(repo, payload, { signal, executable: config.get().editorPath })),
    localIgnoreRules: withRepo((repo, payload, signal) => localIgnoreRules(repo, payload, { signal })),

    /**
     * Both sides of an image change.
     *
     * A separate method rather than a field on `diff`, because the bytes are
     * only wanted when the user is actually looking at an image — `diff` runs on
     * every file selection and must stay cheap.
     */
    imageDiff: withRepo((repo, payload, signal) => imageDiff(repo, {
      path: payload.path,
      oldPath: payload.originalPath,
      from: payload.from,
      to: payload.to,
    }, { signal })),

    diffSummary: withRepo((repo, payload, signal) => diffSummary(repo, payload.targets ?? ['HEAD'], { signal })),

    contributors: withRepo((repo, payload, signal) => repo.contributors({
      limit: payload.limit,
      signal,
    })),

    /**
     * Working-tree status for a single ref's tracking position.
     *
     * Powers the `main ⇄ origin/main` row: it answers "am I ahead of or behind
     * the upstream" without the UI having to diff anything itself.
     */
    branchTracking: withRepo(async (repo, payload, signal) => {
      const ref = typeof payload?.ref === 'string' && payload.ref !== '' ? payload.ref : 'HEAD'
      const upstream = await repo.run(
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${ref}@{upstream}`],
        { timeoutMs: 15_000, signal },
      )
      const upstreamName = upstream.code === 0 ? upstream.stdout.trim() : null
      if (upstreamName === null) {
        return { ref, upstream: null, ahead: 0, behind: 0 }
      }
      const counts = await repo.run(
        ['rev-list', '--left-right', '--count', `${upstreamName}...${ref}`],
        { timeoutMs: 20_000, signal },
      )
      let behind = 0
      let ahead = 0
      if (counts.code === 0) {
        const parts = counts.stdout.trim().split(/\s+/)
        behind = Number(parts[0] ?? 0) || 0
        ahead = Number(parts[1] ?? 0) || 0
      }
      return { ref, upstream: upstreamName, ahead, behind }
    }),

    /** Lightweight file index with resolved commit coordinates for later reads. */
    compareFiles: withRepo(async (repo, payload, signal) => {
      const from = await resolveCommit(repo, payload.from || 'HEAD', { signal })
      const to = await resolveCommit(repo, payload.to || 'HEAD', { signal })
      return { from, to, files: await diffstat(repo, [from, to], { signal, throwOnError: true }) }
    }),

    /**
     * `git log` for a ref range, used by "Compare with Branch".
     *
     * Distinct from `diff` because the comparison view wants the commits that
     * differ, not just the file hunks — that is what makes `main ⇄ origin/main`
     * show "3 commits behind" rather than an unexplained diff.
     */
    compareCommits: withRepo(async (repo, payload, signal) => {
      const left = typeof payload?.left === 'string' && payload.left !== '' ? payload.left : 'HEAD'
      const right = typeof payload?.right === 'string' && payload.right !== '' ? payload.right : 'HEAD'
      const commits = await repo.commits({
        ref: `${left}...${right}`,
        limit: payload?.limit ?? 100,
        signal,
      })
      const stat = await repo.run(['diff', '--shortstat', left, right], { timeoutMs: 30_000, signal })
      return { left, right, commits, shortstat: stat.code === 0 ? stat.stdout.trim() : '' }
    }),

    /** Local identity and the actual last FETCH_HEAD modification time. */
    repoMeta: withRepo(async (repo, payload, signal) => {
      const [fetchHead, total, user, email] = await Promise.all([
        repo.run(['rev-parse', '--git-path', 'FETCH_HEAD'], { timeoutMs: 10_000, signal }),
        repo.commitCount('HEAD', { signal }),
        repo.run(['config', '--get', 'user.name'], { timeoutMs: 10_000, signal }),
        repo.run(['config', '--get', 'user.email'], { timeoutMs: 10_000, signal }),
      ])
      let lastFetchedAt = null
      if (fetchHead.code === 0 && fetchHead.stdout.trim()) {
        try { lastFetchedAt = (await stat(resolve(repo.root, fetchHead.stdout.trim()))).mtimeMs }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      return {
        lastFetchedAt,
        commitCount: total,
        userName: user.code === 0 ? user.stdout.trim() : null,
        userEmail: email.code === 0 ? email.stdout.trim() : null,
      }
    }),

    /** Read the writable plugin configuration. */
    config: async () => ({ ok: true, value: config.get() }),

    /**
     * Update the plugin configuration.
     *
     * Runs in the read table because it touches only this plugin's own JSON
     * file, never the repository — the write-confirmation rule exists to protect
     * the user's code, not the plugin's preferences.
     */
    setConfig: async (payload) => {
      const patch = payload?.patch
      if (patch === null || typeof patch !== 'object') {
        return { ok: false, error: { code: 'git/bad-request', message: 'patch 必须是对象' } }
      }
      const next = await config.update(patch)
      if (!next.autoFetch) for (const state of autoFetches.values()) { state.controller?.abort(); state.error = null; state.revision++ }
      // A changed git path invalidates every open session: they are bound to the
      // executable they were opened with.
      if (Object.prototype.hasOwnProperty.call(patch, 'gitPath')) {
        for (const state of autoFetches.values()) state.controller?.abort()
        await Promise.all([...autoFetches.values()].map(state => state.task))
        autoFetches.clear()
        for (const session of registry.list()) session.cache.capability.clear()
        registry.sessions.clear()
      }
      return { ok: true, value: next }
    },

    /** Cache and capability facts, for the settings page. */
    diagnostics: async () => {
      const gitPath = await registry.gitExecutable()
      const sessions = registry.list().map((session) => ({
        root: session.root,
        version: session.capabilities?.versionText ?? null,
        ignoreRevsFile: session.ignoreRevsFile,
        cache: session.cache.stats(),
      }))
      return {
        ok: true,
        value: {
          gitPath,
          node: process.version,
          platform: process.platform,
          sessions,
        },
      }
    },

    /** Drop cached data. */
    invalidate: async (payload) => {
      if (typeof payload?.root === 'string' && payload.root !== '') {
        registry.invalidate(normalizeSlashes(payload.root), ...(payload.kinds ?? []))
      } else {
        for (const session of registry.list()) session.cache.invalidate(...(payload?.kinds ?? []))
      }
      return { ok: true, value: { ok: true } }
    },

    /**
     * The plugin's own git output, newest first.
     *
     * This is the `Show Git Output` view: the argv, exit code, duration and the
     * real stderr, which is what a user needs when a push is rejected. Credentials
     * are already masked by commandLog on the way in.
     */
    gitOutput: withRepo((repo, payload) => {
      const log = readCommandLog({ cwd: repo.root, limit: payload.limit, sinceId: payload.sinceId })
      return {
          total: log.total,
          entries: log.entries.map((entry) => ({
            id: entry.id,
            at: entry.at,
            cwd: entry.cwd,
            command: formatCommand(entry),
            ...(entry.source === 'rpc' ? { source: 'rpc' } : {}),
            code: entry.code,
            durationMs: entry.durationMs,
            stdout: entry.stdout,
            stderr: entry.stderr,
            error: entry.error,
          })),
      }
    }),

    /** Empty only this repository's output log. */
    clearGitOutput: withRepo((repo) => {
      clearCommandLog({ cwd: repo.root })
      return { ok: true }
    }),

    /** Remember project fields on this Host, independently of repository settings. */
    projectPreferences: async (payload) => {
      const patch = {}
      if (typeof payload?.parent === 'string') patch.projectParent = payload.parent
      if (typeof payload?.name === 'string') patch.projectFolder = payload.name
      const saved = Object.keys(patch).length ? await config.update(patch) : config.get()
      return { ok: true, value: { parent: saved.projectParent || '', name: saved.projectFolder || '' } }
    },

    /** Create one empty project directory; never adopt or overwrite an existing one. */
    createProject: async (payload) => {
      const parent = typeof payload?.parent === 'string' ? payload.parent.trim() : ''
      const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
      const requestId = payload?.requestId
      const qualified = isAbsolute(parent) && (process.platform !== 'win32' || /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(parent))
      if (!qualified || !name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)
        || (process.platform === 'win32' && (/[<>:"|?*]|[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)))) {
        return { ok: false, error: { code: 'git/bad-request', message: '请选择绝对目录并填写有效的项目文件夹名称' } }
      }
      if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{16,128}$/.test(requestId)) return { ok: false, error: { code: 'git/bad-request', message: '无效的项目创建请求标识' } }
      const directory = join(resolve(parent), name), previous = projectRequests.get(requestId)
      if (previous) return previous.directory === directory ? previous.task : { ok: false, error: { code: 'git/bad-request', message: '项目创建请求标识已用于其他目录' } }
      // Bound receipts without discarding an in-flight creation.
      for (const [id, receipt] of projectRequests) if (receipt.complete && projectRequests.size >= 100) projectRequests.delete(id)
      if (projectRequests.size >= 100) return { ok: false, error: { code: 'git/busy', message: '请等待已有项目创建操作完成' } }
      const receipt = { directory, complete: false, task: null }
      receipt.task = (async () => {
        try {
          if (!(await stat(parent)).isDirectory()) throw new Error('保存位置不是目录')
          await config.update({ projectParent: parent, projectFolder: name })
          await mkdir(directory)
          receipt.complete = true
          return { ok: true, value: { directory } }
        } catch (failure) {
          projectRequests.delete(requestId)
          return { ok: false, error: { code: failure.code === 'EEXIST' ? 'git/project-exists' : 'git/project-failed',
            message: failure.code === 'EEXIST' ? '项目文件夹已存在，请更换名称或通过本地目录打开。' : failure.message } }
        }
      })()
      projectRequests.set(requestId, receipt)
      return receipt.task
    },

    /** Clone outside any active repository, using an explicit absolute destination. */
    clone: async (payload, signal) => {
      const gitPath = await registry.gitExecutable()
      if (gitPath === null) {
        return { ok: false, error: gitUnavailableError() }
      }
      const directory = typeof payload?.directory === 'string' ? payload.directory.trim() : ''
      const url = typeof payload?.url === 'string' ? payload.url.trim() : ''
      if (url === '') {
        return { ok: false, error: { code: 'git/bad-request', message: '请填写仓库地址' } }
      }
      if (directory === '') {
        return { ok: false, error: { code: 'git/bad-request', message: '请填写目标目录' } }
      }
      if (!/^([A-Za-z]:[\\/]|[\\/]{2}|[\\/])/.test(directory)) {
        return {
          ok: false,
          error: { code: 'git/bad-request', message: '目标目录请使用绝对路径' },
        }
      }
      const result = await writes.clone({
        gitPath,
        url,
        directory,
        depth: Number.isInteger(payload.depth) ? payload.depth : undefined,
        branch: payload.branch,
        recursive: payload.recursive === true,
        signal,
      })
      if (result.ok !== true) {
        return {
          ok: false,
          error: { code: 'git/clone-failed', message: redact(result.message), details: { stdout: result.stdout } },
        }
      }
      return { ok: true, value: { directory: result.directory, message: result.message } }
    },
  }

  // AI-backed methods, present only when a model provider is composed.
  //
  // They resolve the repository themselves rather than going through
  // `withRepo`, because that wrapper turns ANY thrown error into an RPC failure
  // — including "this profile has no model service", which is a normal state
  // that the panel must render as a disabled button with an explanation, not as
  // an error toast.
  methods['ai.models'] = async () => {
    try { return { ok: true, value: await llm?.models?.() || { supported: false, models: [] } } }
    catch (error) { return { ok: false, error: { code: 'git/ai-failed', message: redact(error instanceof Error ? error.message : String(error)) } } }
  }

  methods['ai.modelInfo'] = async (payload, signal) => {
    try { return { ok: true, value: await llm?.modelInfo?.(payload || {}, signal) || { supported: false, reasoning: null } } }
    catch (error) { return { ok: false, error: { code: 'git/ai-failed', message: redact(error instanceof Error ? error.message : String(error)) } } }
  }

  methods['ai.prepareCommitMessage'] = async (payload, signal) => {
    const readiness = llm?.available?.({ sessionId: payload?.sessionId }) ?? { available: false, reason: '没有模型服务' }
    if (!readiness.available) return { ok: true, value: { available: false, message: readiness.reason } }
    const resolved = await needRepo(payload ?? {})
    if (resolved.error) return { ok: false, error: resolved.error }
    try {
      const started = Date.now()
      const entry = await commitContexts.prepare(resolved.repo, payload, { signal, excludePatterns: config.get().aiExcludePatterns })
      return { ok: true, value: { available: true, empty: entry.context.empty, id: entry.id,
        reason: entry.context.empty ? '没有可提交的改动' : undefined, context: entry.context.summary,
        cacheHit: entry.cacheHit, prepareMs: Date.now() - started } }
    } catch (error) { return { ok: false, error: { code: 'git/ai-failed', message: redact(error.message) } } }
  }

  methods['ai.commitMessage'] = async (payload, signal) => {
    const readiness = llm?.available?.({ sessionId: payload?.sessionId }) ?? { available: false, reason: '没有模型服务' }
    if (readiness.available !== true) {
      return { ok: true, value: { available: false, message: readiness.reason } }
    }
    const resolved = await needRepo(payload ?? {})
    if (resolved.error !== undefined) return { ok: false, error: resolved.error }
    const repo = resolved.repo
    try {
      const started = Date.now()
      const contextOptions = { signal, excludePatterns: config.get().aiExcludePatterns }
      const entry = payload?.contextId ? await commitContexts.read(payload.contextId, repo, payload, contextOptions)
        : await commitContexts.prepare(repo, payload, contextOptions)
      const scope = entry.context
      const prepared = Date.now()
      if (scope.empty) return { ok: true, value: { available: true, message: '', empty: true, reason: '没有可提交的改动' } }
      const message = await llm.generateCommitMessage({
        sessionId: payload?.sessionId,
        diff: redact(scope.diff),
        files: scope.files.map(redact),
        recentSubjects: [],
        hint: typeof payload?.hint === 'string' ? truncate(redact(payload.hint), 2000) : undefined,
        signal,
      })
      const generatedAt = Date.now()
      await commitContexts.validate(entry, repo, payload, { signal, excludePatterns: config.get().aiExcludePatterns })
      return { ok: true, value: { available: true, message, empty: false, context: scope.summary,
        cacheHit: entry.cacheHit, timings: { prepareMs: prepared - started, generateMs: generatedAt - prepared } } }
    } catch (error) {
      return { ok: false, error: { code: 'git/ai-failed', message: redact(error instanceof Error ? error.message : String(error)) } }
    }
  }

  methods['ai.rewriteMessage'] = withRepo(async (repo, payload, signal) => {
    const readiness = llm?.available?.({ sessionId: payload.sessionId }) ?? { available: false, reason: '没有模型服务' }
    if (!readiness.available) return { available: false, message: readiness.reason }
    const plan = await rewritePreview(repo, payload, { signal })
    await checkWorkbenchIdentity(repo, payload.guard, { signal })
    const oldest = plan.commits[0].sha, newest = plan.commits.at(-1).sha
    const ancestry = (await repo.runOrThrow(['rev-list', '--parents', '-n', '1', oldest], { signal })).trim().split(/\s+/)
    const parent = ancestry[1] || (await repo.runOrThrow(['hash-object', '-t', 'tree', '--stdin'], { signal, input: '' })).trim()
    const scope = await diff(repo, { from: parent, to: newest, contextLines: 3 }, { signal })
    if (scope.tooLarge) throw new Error('所选提交的差异过大，请减少选择的提交后再生成')
    const message = await llm.generateCommitMessage({
      sessionId: payload.sessionId, signal,
      diff: truncate(redact(scope.text), 60_000),
      files: scope.files.map(file => `${file.status} ${file.path}`),
      recentSubjects: [],
      hint: truncate('请整合以下所选提交，生成一条提交信息；以累计差异为准，已撤销的改动不要描述为最终成果。\n'
        + plan.commits.map(commit => commit.message).join('\n\n'), 20_000),
    })
    return { available: true, message }
  })

  methods['ai.explainCommit'] = async (payload, signal) => {
    const readiness = llm?.available?.({ sessionId: payload?.sessionId }) ?? { available: false, reason: '没有模型服务' }
    if (readiness.available !== true) {
      return { ok: true, value: { available: false, message: readiness.reason } }
    }
    if (typeof payload?.sha !== 'string' || payload.sha === '') {
      return { ok: false, error: { code: 'git/bad-request', message: '缺少提交 sha' } }
    }
    const resolved = await needRepo(payload ?? {})
    if (resolved.error !== undefined) return { ok: false, error: resolved.error }
    const repo = resolved.repo
    const detail = await repo.commit(payload.sha, { signal })
    const shown = await diff(repo, { from: `${payload.sha}^`, to: payload.sha, contextLines: 2 }, { signal })
    try {
      const text = await llm.explainCommit({
        sessionId: payload?.sessionId,
        subject: detail.subject,
        message: detail.message,
        date: detail.authorDate,
        diff: truncate(redact(shown.text), 60_000),
        signal,
      })
      return { ok: true, value: { available: true, text } }
    } catch (error) {
      return { ok: false, error: { code: 'git/ai-failed', message: redact(error instanceof Error ? error.message : String(error)) } }
    }
  }

  methods['ai.summarizeDiff'] = async (payload, signal) => {
    const readiness = llm?.available?.({ sessionId: payload?.sessionId }) ?? { available: false, reason: '没有模型服务' }
    if (readiness.available !== true) {
      return { ok: true, value: { available: false, message: readiness.reason } }
    }
    const resolved = await needRepo(payload ?? {})
    if (resolved.error !== undefined) return { ok: false, error: resolved.error }
    const repo = resolved.repo
    const scope = await diff(repo, {
      from: payload?.from,
      to: payload?.to,
      staged: payload?.staged === true,
      path: payload?.path,
      contextLines: 2,
    }, { signal })
    if (scope.text.trim() === '') {
      return { ok: true, value: { available: true, text: '', empty: true } }
    }
    try {
      const text = await llm.summarizeDiff({
        sessionId: payload?.sessionId,
        diff: truncate(redact(scope.text), 60_000),
        files: scope.files.map((file) => `${file.status} ${file.path}`),
        signal,
      })
      return { ok: true, value: { available: true, text } }
    } catch (error) {
      return { ok: false, error: { code: 'git/ai-failed', message: redact(error instanceof Error ? error.message : String(error)) } }
    }
  }

  // Write methods, generated from one table so a new write cannot be added
  // without also declaring its risk.
  //
  // They live under a `write.` prefix, and that is load-bearing rather than
  // cosmetic: `commit` is both a READ method (show one commit) and a WRITE
  // operation (create a commit). Registering the writes last silently replaced
  // the reader, so `commit {sha}` answered "提交信息不能为空" — a namespace
  // collision that presented as a nonsense validation error. The guard below
  // makes any future collision fail loudly at startup instead.
  for (const method of WRITE_METHODS) {
    const handler = writes[method]
    if (typeof handler !== 'function') continue
    const key = writeMethodName(method)
    if (Object.prototype.hasOwnProperty.call(methods, key)) {
      throw new Error(`dsh-plugin-git: write method "${key}" collides with a read method`)
    }
    methods[key] = withWrite(method, handler)
  }

  // Separate capability name: older Hosts must refuse this flow rather than
  // silently changing their global defaultRepo after cloning.
  methods.cloneWorkspace = methods.clone
  const backgroundMethods = new Set(['clone', 'cloneWorkspace', 'lfsMigrationPreview', 'write.lfsTransfer', 'write.lfsMigrate', 'write.lfsRestore', 'write.fetch', 'write.push', 'write.pull', 'write.commit', 'write.commitPaths'])
  const publicJob = job => ({ id: job.id, requestId: job.requestId, root: job.root, method: job.method, state: job.state, startedAt: job.startedAt, command: job.command, step: job.step, progress: job.progress, phase: job.phase, phaseDetail: job.phaseDetail, result: job.result })
  methods.operationStart = async (payload, signal) => {
    if (!backgroundMethods.has(payload.method)) return { ok: false, error: { code: 'git/bad-request', message: '此操作不支持后台执行' } }
    const resolved = ['clone', 'cloneWorkspace'].includes(payload.method) && typeof payload.parameters?.directory === 'string' && isAbsolute(payload.parameters.directory)
      ? { repo: { root: resolve(payload.parameters.directory) } } : await needRepo(payload)
    if (resolved.error) return { ok: false, error: resolved.error }
    const requestId = payload.method === 'cloneWorkspace' ? payload.requestId : undefined
    let cloneRequest
    if (requestId !== undefined) {
      if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{16,128}$/.test(requestId)) return { ok: false, error: { code: 'git/bad-request', message: '无效的克隆请求标识' } }
      const params = payload.parameters || {}
      cloneRequest = JSON.stringify({ root: resolved.repo.root, url: params.url, branch: params.branch, depth: params.depth, recursive: params.recursive === true })
      const previous = [...jobs.values()].find(job => job.method === 'cloneWorkspace' && job.requestId === requestId)
      if (previous) {
        if (previous.cloneRequest !== cloneRequest) return { ok: false, error: { code: 'git/bad-request', message: '克隆请求标识已用于其他参数' } }
        return { ok: true, value: publicJob(previous) }
      }
    }
    if ([...jobs.values()].some(job => job.root === resolved.repo.root && job.state === 'running')) return { ok: false, error: { code: 'git/busy', message: '该仓库已有后台操作' } }
    for (const [id, job] of jobs) if (job.state !== 'running' && Date.now() - job.startedAt > 60 * 60_000) jobs.delete(id)
    if (jobs.size >= 100) return { ok: false, error: { code: 'git/busy', message: '请等待已有操作完成' } }
    const controller = new AbortController(), id = randomUUID()
    const job = { id, requestId, cloneRequest, root: resolved.repo.root, method: payload.method, state: 'running', startedAt: Date.now(), command: '', step: '', progress: '', controller }
    let primarySeen = false
    const isPrimary = args => {
      const command = args[0] === '--no-optional-locks' ? args.slice(1) : args
      switch (payload.method) {
        case 'write.commit': case 'write.commitPaths': return command[0] === 'commit' || (command[0] === '-c' && command[2] === 'commit')
        case 'clone': case 'cloneWorkspace': return command[0] === 'clone'
        case 'write.fetch': return command[0] === 'fetch'
        case 'write.push': return command[0] === 'push'
        case 'write.pull': return ['pull', 'fetch'].includes(command[0])
        case 'lfsMigrationPreview': return command[0] === 'lfs' && command[1] === 'migrate' && command[2] === 'info'
        case 'write.lfsMigrate': return command[0] === 'lfs' && command[1] === 'migrate' && ['import', 'export'].includes(command[2])
        case 'write.lfsRestore': return ['update-ref', 'reset'].includes(command[0])
        case 'write.lfsTransfer': return command[0] === 'lfs' && command[1] === payload.parameters?.action
        default: return false
      }
    }
    const stop = observeGitProgress(controller.signal, value => {
      if (value.command) {
        job.step = redact(formatCommand({ args: value.command }))
        if (isPrimary(value.command)) { primarySeen = true; job.command = job.step }
        else if (!primarySeen) job.command = job.step
      }
      if (value.text) job.progress = redact(value.text)
      if (value.phase) { job.phase = value.phase; job.phaseDetail = value.detail || '' }
    })
    jobs.set(id, job)
    Promise.resolve().then(() => methods[payload.method]({ ...(payload.parameters || {}), root: resolved.repo.root }, controller.signal,
      payload.method.startsWith('write.') ? resolved.repo : undefined)).then(result => {
      if (result?.error) result.error = redactDiagnostics(result.error)
      // Cancelling a slow post-commit hook may still leave a verified, restored
      // commit. Confirmed success must reach the UI so it never retries it.
      const committed = ['write.commit', 'write.commitPaths'].includes(payload.method) && result.ok
      job.result = result; job.state = committed ? 'complete' : controller.signal.aborted ? 'cancelled' : result.ok ? 'complete' : 'failed'
    }).catch(error => { job.result = { ok: false, error: { message: redact(error.message), details: { recovery: error.recovery } } }; job.state = controller.signal.aborted ? 'cancelled' : 'failed' }).finally(stop)
    return { ok: true, value: publicJob(job) }
  }
  const jobFor = async payload => {
    const root = typeof payload.root === 'string' && isAbsolute(payload.root) ? resolve(payload.root) : null
    const job = payload.id ? jobs.get(payload.id) : [...jobs.values()].reverse().find(job => resolve(job.root) === root
      && (!payload.requestId || (job.method === 'cloneWorkspace' && job.requestId === payload.requestId)))
    if (!root || !job || resolve(job.root) !== root) throw new Error('操作不存在或不属于当前仓库')
    return job
  }
  methods.operationStatus = async payload => ({ ok: true, value: publicJob(await jobFor(payload)) })
  methods.operationCancel = async payload => {
    const job = await jobFor(payload)
    if (['write.lfsMigrate', 'write.lfsRestore'].includes(job.method)) throw new Error('历史迁移或恢复执行后不能中途取消，请等待完成并使用备份恢复')
    if (job.state === 'running') job.controller.abort()
    return { ok: true, value: publicJob(job) }
  }
  return {
    methods,
    /**
     * Dispatch one call.
     * @param method - the method name.
     * @param payload - the payload.
     * @param signal - cancellation.
     * @returns the `{ ok, value }` / `{ ok: false, error }` envelope.
     */
    async call(method, payload, signal) {
      if (!Object.prototype.hasOwnProperty.call(methods, method)) {
        const message = `Unknown Git operation: ${String(method)}`
        recordCommand({ source: 'rpc', cwd: payload?.root || payload?.directory || '', args: [String(method)], code: null, durationMs: 0, stderr: message })
        return { ok: false, error: { code: 'git/unknown-method', message, details: { method: String(method), phase: 'dispatch' } } }
      }
      const unsafe = method === 'repos' ? null : findUnsafePath(payload, method)
      if (unsafe !== null) return { ok: false, error: { code: 'git/unsafe-path', message: 'Invalid repository-relative path' } }
      for (const key of ['sha', 'ref', 'from', 'to', 'rev', 'startPoint', 'left', 'right', 'target']) {
        const value = payload?.[key]
        if (typeof value === 'string' && (/^-/.test(value) || /[\0\r\n]/.test(value))) return { ok: false, error: { code: 'git/bad-request', message: 'Invalid revision' } }
      }
      for (const key of ['refs', 'targets']) {
        const values = payload?.[key]
        if (values !== undefined && (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value || /^-|[\0\r\n]/.test(value)))) return { ok: false, error: { code: 'git/bad-request', message: 'Invalid revisions' } }
      }
      if (payload?.ordering && !['date', 'author-date', 'topo'].includes(payload.ordering)) return { ok: false, error: { code: 'git/bad-request', message: 'Invalid history ordering' } }
      const handler = methods[method]
      if (typeof handler !== 'function') {
        return { ok: false, error: { code: 'git/unknown-method', message: `未知方法：${String(method)}` } }
      }
      const result = await handler(payload, signal)
      if (result?.error) result.error = redactDiagnostics(result.error)
      return result
    },
    riskOf,
  }
}

function redactDiagnostics(value) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(redactDiagnostics)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDiagnostics(item)]))
  return value
}

/** The wire name of a write method, namespaced away from the read methods. */
export function writeMethodName(method) {
  return `write.${method}`
}

/**
 * Find the first unsafe path argument in a write payload.
 *
 * Both spellings are checked because the write API accepts a single `path` (for
 * discard-style operations) and an array `paths` (for staging-style ones), and a
 * check that covers only one of them is a hole rather than a guard.
 *
 * @param payload - the request payload.
 * @returns the offending path, or null when every path is safe.
 */
export function findUnsafePath(payload, method) {
  const safe = path => isSafePath(path, { allowLeadingDash: ['discardPath', 'discardPaths', 'discardAll'].includes(method?.replace(/^write\./, '')) })
  if (payload === null || typeof payload !== 'object') return null
  if (typeof payload.path === 'string' && !safe(payload.path)) return payload.path
  if (typeof payload.originalPath === 'string' && !safe(payload.originalPath)) return payload.originalPath
  if (Array.isArray(payload.paths)) {
    for (const path of payload.paths) {
      if (!safe(path)) return typeof path === 'string' ? path : String(path)
    }
  }
  return null
}

/** Human-facing message for a repository-resolution failure. */
function reasonMessage(reason) {
  switch (reason) {
    case 'git-not-found':
      return '未找到 git 可执行文件。请在设置里填写完整路径。'
    case 'not-a-repository':
      return '该目录不是 git 仓库。'
    default:
      return `无法打开仓库：${String(reason)}`
  }
}

/** Trim a large text and say so, rather than silently truncating. */
function truncate(text, limit) {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n\n…（已截断，原文 ${value.length} 字符）`
}

/** Strip internals out of a write result before it crosses the wire. */
function publicWriteValue(result) {
  if (result === null || typeof result !== 'object') return { ok: true }
  return {
    ok: true,
    code: result.code ?? 0,
    ...(result.repository ? { repository: { name: result.repository.name, url: result.repository.url, private: result.repository.private } } : {}),
    message: redact(result.message ?? '完成'),
    // stdout is useful for `git fetch`/`push` progress summaries and is small.
    stdout: typeof result.stdout === 'string' ? redact(result.stdout).slice(0, 8000) : '',
    recovery: result.recovery,
    ...(result.worktreeChange ? { worktreeChange: result.worktreeChange } : {}),
    ...(result.commitDiagnostics ? { commitDiagnostics: result.commitDiagnostics } : {}),
    // A history rewrite reports what it moved. The panel needs these to tell the
    // user which SHAs changed and where the backup lives; without them the write
    // would succeed invisibly.
    ...(typeof result.backup === 'string'
      ? { backup: result.backup, before: result.before ?? null, after: result.after ?? null, rewritten: result.rewritten ?? [] }
      : {}),
  }
}

/** The public shape of one repository, as the UI sees it. */
export function describeRepo(session) {
  return {
    root: session.root,
    gitDir: session.identity?.gitDir ?? null,
    commonDir: session.identity?.commonDir ? commonDirectory(session) : null,
    bare: session.identity?.bare === true,
    gitPath: session.gitPath,
    version: session.capabilities?.versionText ?? null,
    ignoreRevsFile: session.ignoreRevsFile,
  }
}

export { blameStream, splitDiffByFile }

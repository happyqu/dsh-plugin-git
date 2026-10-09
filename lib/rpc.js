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
import { diff, fileContent, diffSummary, diffstat, splitDiffByFile } from './git/diff.js'
import { parseUnifiedDiff } from './git/parse.js'
import { commitGraph } from './git/graph.js'
import { hostingAccounts, hostingRepositories } from './git/hosting.js'
import { changelists } from './git/changelists.js'
import { changelistDiff } from './git/scopedCommit.js'
import { workbenchPreview, checkWorkbenchIdentity, resolveCommit, reflog } from './git/workbench.js'
import { normalizeSlashes } from './git/capability.js'
import { isSafePath, riskOf, WRITE_METHODS } from './git/write.js'
import { readCommandLog, clearCommandLog, formatCommand, redact } from './git/commandLog.js'
import * as writes from './git/write.js'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { git } from './git/exec.js'

/** Methods that only read. Everything else must be a declared write. */
export const READ_METHODS = [
  'ping',
  'repos',
  'status',
  'refs',
  'remotes',
  'hostingAccounts',
  'hostingRepositories',
  'changelists',
  'updateChangelist',
  'changelistDiff',
  'stashes',
  'stashDiff',
  'worktrees',
  'commits',
  'commit',
  'commitGraph',
  'workbenchPreview',
  'reflog',
  'blame',
  'lineHistory',
  'diff',
  'fileContent',
  'diffSummary',
  'contributors',
  'branchTracking',
  'compareCommits',
  'compareFiles',
  'repoMeta',
  'config',
  'setConfig',
  'diagnostics',
  'invalidate',
  'gitOutput',
  'clearGitOutput',
  'clone',
  'initRepository',
  'ai.commitMessage',
  'ai.explainCommit',
  'ai.summarizeDiff',
]

/** Methods that mutate the repository. */
export const WRITE_METHOD_NAMES = WRITE_METHODS

/**
 * Build the RPC dispatcher.
 *
 * @param deps - plugin dependencies (registry, config store, llm, logger).
 * @returns `{ methods, call, riskOf }`.
 */
export function createRpc(deps) {
  const { registry, config, logger, llm } = deps
  const writeLocks = new Set()

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
  const needRepo = async (payload) => {
    const target = payload?.root ?? payload?.path ?? targetDirectory(payload)
    if (typeof target !== 'string' || target === '') {
      return { error: { code: 'git/no-target', message: '没有可用的仓库目录，请先在设置里指定或打开一个 git 仓库' } }
    }
    const opened = await registry.open(target, {})
    if (opened.session === null) {
      return {
        error: {
          code: `git/${opened.reason}`,
          message: reasonMessage(opened.reason, opened.error),
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
          code: 'git/failed',
          message: redact(error instanceof Error ? error.message : String(error)),
        },
      }
    }
  }

  /** Wrap a write handler: risk is attached, failures become messages. */
  const withWrite = (method, handler) => async (payload, signal) => {
    const resolved = await needRepo(payload ?? {})
    if (resolved.error !== undefined) return { ok: false, error: resolved.error }
    const repo = resolved.repo

    // Reject unsafe path arguments up front.
    //
    // This is not belt-and-braces. The path filters inside write.js DROP unsafe
    // entries, and an empty `paths` array means "everything" to `git add` — so a
    // request naming only `../../etc/passwd` used to end up staging the entire
    // working tree. Silently doing something far larger than asked is the worst
    // possible failure mode, so it is an explicit refusal instead.
    const unsafe = findUnsafePath(payload)
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
      return {
        ok: false,
        error: {
          code: 'git/needs-confirmation',
          message: `${method} 会${
            risk === 'destructive' ? '丢弃未提交的改动' : '改写已发布的历史'
          }，需要显式确认`,
          details: { risk },
        },
      }
    }
    if (writeLocks.has(repo.root)) return { ok: false, error: { code: 'git/busy', message: '该仓库有正在执行的操作' } }
    writeLocks.add(repo.root)
    try {
      await checkWorkbenchIdentity(repo, payload?.guard, { signal })
      const result = await handler(repo, payload ?? {}, { signal })
      if (result) {
        // Any successful write invalidates at least the status and refs; a
        // commit also invalidates the log. Being generous here is correct:
        // a stale status after a mutation is the worst possible UI bug.
        repo.cache.invalidate()
      }
      return result?.ok === false
        ? { ok: false, error: { code: 'git/write-failed', message: redact(result.message), details: { stdout: redact(result.stdout), code: result.code, recovery: result.recovery } } }
        : { ok: true, value: publicWriteValue(result) }
    } catch (error) {
      repo.cache.invalidate()
      return {
        ok: false,
        error: { code: 'git/write-threw', message: redact(error instanceof Error ? error.message : String(error)), details: { recovery: error.recovery } },
      }
    } finally { writeLocks.delete(repo.root) }
  }

  const methods = {
    /** Liveness plus the facts the settings page shows. */
    ping: async () => ({
      ok: true,
      value: {
        name: 'dsh-plugin-git',
        version: '0.1.0',
        gitPath: registry.gitPath || null,
        config: config.get(),
      },
    }),

    /** Repositories known to this Host, plus whether git was found at all. */
    repos: async (payload) => {
      const gitPath = await registry.gitExecutable()
      if (gitPath === null) {
        return {
          ok: false,
          error: {
            code: 'git/not-found',
            message: '未找到 git。请安装 git，或在设置里填写 git 可执行文件的完整路径。',
          },
        }
      }
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
      return { ok: true, value: { gitPath, repos, directory, canInitialize: sessionDirectory !== null && repos.length === 0, config: config.get() } }
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
      if (gitPath === null) return { ok: false, error: { code: 'git/not-found', message: '未找到 git，无法初始化仓库' } }
      const existing = await registry.open(target, { signal })
      if (existing.session !== null) {
        return { ok: true, value: { directory: existing.session.root, alreadyInitialized: true } }
      }
      if (existing.reason !== 'not-a-repository') {
        return { ok: false, error: { code: `git/${existing.reason}`, message: reasonMessage(existing.reason, existing.error) } }
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
      return { text, hunks: parseUnifiedDiff(text), files: splitDiffByFile(text) }
    }),

    worktrees: withRepo((repo, payload, signal) => repo.worktrees({ signal })),

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
      return { ...result, hunks: parseUnifiedDiff(result.text), files: splitDiffByFile(result.text) }
    }),
    reflog: withRepo((repo, payload, signal) => reflog(repo, payload, { signal })),

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
      // A changed git path invalidates every open session: they are bound to the
      // executable they were opened with.
      if (Object.prototype.hasOwnProperty.call(patch, 'gitPath')) {
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
        features: session.capabilities?.features ?? {},
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

    /**
     * Clone a repository.
     *
     * Unlike every other write this one has no repository to resolve, so it
     * takes the git executable from the registry directly. The destination is
     * validated as an absolute path: a relative one would resolve against the
     * Host's own cwd, which is never what the user typed it into the dialog for.
     */
    clone: async (payload, signal) => {
      const gitPath = await registry.gitExecutable()
      if (gitPath === null) {
        return { ok: false, error: { code: 'git/not-found', message: '未找到 git，无法克隆' } }
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
        cwd: config.get().defaultRepo || undefined,
        signal,
      })
      if (result.ok !== true) {
        return {
          ok: false,
          error: { code: 'git/clone-failed', message: redact(result.message), details: { stdout: result.stdout } },
        }
      }
      // A fresh clone should become the repository the panel shows.
      await config.update({ defaultRepo: result.directory })
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
  methods['ai.commitMessage'] = async (payload, signal) => {
    const readiness = llm?.available?.() ?? { available: false, reason: '没有模型服务' }
    if (readiness.available !== true) {
      return { ok: true, value: { available: false, message: readiness.reason } }
    }
    const resolved = await needRepo(payload ?? {})
    if (resolved.error !== undefined) return { ok: false, error: resolved.error }
    const repo = resolved.repo
    const selected = Array.isArray(payload?.paths)
    const staged = selected ? await changelistDiff(repo, payload, { signal }) : await diff(repo, { staged: true, contextLines: 3 }, { signal })
    if (selected) staged.files = splitDiffByFile(staged.text)
    const scope = !selected && staged.text.trim() === ''
      ? await diff(repo, { to: 'HEAD', contextLines: 3 }, { signal })
      : staged
    if (scope.text.trim() === '') {
      return { ok: true, value: { available: true, message: '', empty: true, reason: '没有可提交的改动' } }
    }
    try {
      const message = await llm.generateCommitMessage({
        diff: truncate(redact(scope.text), 60_000),
        files: scope.files.map((file) => `${file.status} ${file.path}`),
        recentSubjects: [],
        hint: payload?.hint,
        signal,
      })
      return { ok: true, value: { available: true, message, empty: false } }
    } catch (error) {
      return { ok: false, error: { code: 'git/ai-failed', message: redact(error instanceof Error ? error.message : String(error)) } }
    }
  }

  methods['ai.explainCommit'] = async (payload, signal) => {
    const readiness = llm?.available?.() ?? { available: false, reason: '没有模型服务' }
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
    const readiness = llm?.available?.() ?? { available: false, reason: '没有模型服务' }
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
      if (!Object.prototype.hasOwnProperty.call(methods, method)) return { ok: false, error: { code: 'git/unknown-method', message: 'Unknown Git operation' } }
      const unsafe = method === 'repos' ? null : findUnsafePath(payload)
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
export function findUnsafePath(payload) {
  if (payload === null || typeof payload !== 'object') return null
  if (typeof payload.path === 'string' && !isSafePath(payload.path)) return payload.path
  if (typeof payload.originalPath === 'string' && !isSafePath(payload.originalPath)) return payload.originalPath
  if (Array.isArray(payload.paths)) {
    for (const path of payload.paths) {
      if (!isSafePath(path)) return typeof path === 'string' ? path : String(path)
    }
  }
  return null
}

/** Human-facing message for a repository-resolution failure. */
function reasonMessage(reason, error) {
  switch (reason) {
    case 'git-not-found':
      return '未找到 git 可执行文件。请在设置里填写完整路径。'
    case 'not-a-repository':
      return '该目录不是 git 仓库。'
    case 'git-unusable':
      return `git 无法使用：${error ?? '未知原因'}`
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
  }
}

/** The public shape of one repository, as the UI sees it. */
export function describeRepo(session) {
  return {
    root: session.root,
    gitDir: session.identity?.gitDir ?? null,
    commonDir: session.identity?.commonDir ?? null,
    bare: session.identity?.bare === true,
    gitPath: session.gitPath,
    version: session.capabilities?.versionText ?? null,
    features: session.capabilities?.features ?? {},
    ignoreRevsFile: session.ignoreRevsFile,
  }
}

export { blameStream, splitDiffByFile }

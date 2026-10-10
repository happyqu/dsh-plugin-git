/**
 * dsh-plugin-git — git process layer.
 *
 * Every git invocation in this plugin goes through `git()` here, so exactly one
 * place owns: executable resolution, the `-c` configuration we force, output
 * decoding, stderr classification, timeouts, and cancellation.
 *
 * Three decisions are load-bearing and are documented where they are applied:
 *
 * 1. `core.quotepath=false` — without it git escapes non-ASCII paths
 *    (`docs/中文 说明.md` becomes `"docs/\344\270\255..."`), so every path we
 *    show or match would be wrong.
 * 2. stderr is NOT failure. On Windows `core.autocrlf` makes git write
 *    `warning: ... LF will be replaced by CRLF` to stderr on a perfectly
 *    successful `add`. Only a non-zero exit code is a failure.
 * 3. `--no-optional-locks` on read commands keeps `git status` from taking the
 *    index lock, so the plugin never fights the user's own git commands.
 */
import { execFile, spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { recordCommand } from './commandLog.js'

/** Upper bound on how much stdout one git call may produce (16 MiB). */
const MAX_BUFFER = 16 * 1024 * 1024

/** Default per-call timeout; long history walks raise it explicitly. */
const DEFAULT_TIMEOUT_MS = 20_000

/**
 * Configuration forced on every invocation.
 *
 * `color.ui=false` and `core.pager=cat` keep stdout parseable; a user with a
 * global `color.ui=always` or a pager would otherwise get ANSI escapes and a
 * hanging process.
 */
const FORCED_CONFIG = [
  '-c', 'core.quotepath=false',
  '-c', 'color.ui=false',
  '-c', 'core.pager=cat',
  '-c', 'advice.detachedHead=false',
]

/** stderr lines that are warnings, not failures. */
const BENIGN_STDERR = [
  /^warning: /i,
  /^hint: /i,
  /LF will be replaced by CRLF/i,
  /CRLF will be replaced by LF/i,
]

/** A git failure carrying the command, exit code, and classified stderr. */
export class GitError extends Error {
  /**
   * @param message - human-facing message.
   * @param detail - machine-readable failure facts.
   */
  constructor(message, detail) {
    super(message)
    this.name = 'GitError'
    this.detail = detail
  }
}

/**
 * Strip benign git chatter from stderr, leaving only real diagnostics.
 * @param stderr - raw stderr text.
 * @returns the non-benign remainder, trimmed.
 */
export function meaningfulStderr(stderr) {
  const text = String(stderr ?? '')
  if (text.trim() === '') return ''
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .filter((line) => !BENIGN_STDERR.some((pattern) => pattern.test(line)))
    .join('\n')
    .trim()
}

/** Candidate git locations probed when PATH lookup fails (Windows first). */
const WINDOWS_GIT_CANDIDATES = [
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  'C:\\Program Files\\Git\\bin\\git.exe',
]

/** POSIX candidates, used only when the platform is not Windows. */
const POSIX_GIT_CANDIDATES = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git']

/**
 * Resolve a usable git executable.
 *
 * Order: explicit setting, then PATH, then well-known install locations. The
 * order matters on machines carrying several gits (TortoiseGit, Laragon, a
 * bundled one): a bare `git` would silently pick whichever PATH entry wins, and
 * the settings page needs to show the user which one actually ran.
 *
 * @param options - resolution inputs.
 * @returns the resolved absolute path, or null when no git was found.
 */
export async function resolveGitPath(options = {}) {
  const configured = typeof options.configured === 'string' ? options.configured.trim() : ''
  if (configured !== '') {
    const probed = await probeExecutable(configured)
    if (probed !== null) return probed
    // A configured-but-broken path is reported by the caller; falling back to
    // PATH here would hide the user's mistake.
    return null
  }

  const fromPath = await probeExecutable(process.platform === 'win32' ? 'git.exe' : 'git')
  if (fromPath !== null) return fromPath

  const candidates = process.platform === 'win32' ? WINDOWS_GIT_CANDIDATES : POSIX_GIT_CANDIDATES
  for (const candidate of candidates) {
    const probed = await probeExecutable(candidate)
    if (probed !== null) return probed
  }
  return null
}

/**
 * Run `<command> --version` and return the executable's absolute path when it
 * answers.
 *
 * The returned path is always absolute even when the input was a bare PATH
 * name: a relative result would break as soon as a git call ran with a
 * different `cwd`, and the settings page has to display a path the user can act
 * on.
 *
 * @param command - a bare name (resolved through PATH) or an absolute path.
 * @returns the resolved absolute command on success, else null.
 */
function probeExecutable(command) {
  return new Promise((resolve) => {
    execFile(command, ['--version'], { timeout: 8000, windowsHide: true }, async (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      if (!String(stdout).trim().startsWith('git version')) {
        resolve(null)
        return
      }
      resolve(await absolutize(command))
    })
  })
}

/**
 * Turn a possibly-bare command name into an absolute path.
 *
 * `where`/`which` is asked first because it reproduces the shell's own PATH
 * order exactly — which is the whole point on a machine with four gits
 * installed. Falls back to the input when lookup fails, so a working-but-
 * unlocatable git is still usable.
 *
 * @param command - the command to locate.
 * @returns an absolute path when one can be determined.
 */
function absolutize(command) {
  return new Promise((resolve) => {
    if (isAbsolute(command)) {
      resolve(command)
      return
    }
    const locator = process.platform === 'win32' ? 'where' : 'which'
    execFile(locator, [command], { timeout: 8000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(command)
        return
      }
      const first = String(stdout)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line !== '')
      resolve(first === undefined ? command : first)
    })
  })
}

/**
 * Run one git command.
 *
 * @param spec - the invocation.
 * @returns exit facts plus decoded stdout/stderr.
 * @throws {GitError} when the process cannot start at all (no git, bad cwd).
 */
const progressListeners = new WeakMap()
export function observeGitProgress(signal, listener) { progressListeners.set(signal, listener); return () => progressListeners.delete(signal) }
export function reportGitProgress(signal, text) { if (signal) progressListeners.get(signal)?.({ text }) }

export function git(spec) {
  if (typeof spec.onStdout === 'function') return gitStream(spec)
  const { gitPath, cwd, args, timeoutMs, signal, maxBuffer, input } = spec
  // Binary payloads (image blobs) must not be decoded as UTF-8: the decode is
  // lossy, so the bytes that come back are not the bytes git wrote. Callers that
  // need the raw content ask for `encoding: 'buffer'` and get a Buffer back.
  const binary = spec.encoding === 'buffer'
  const argv = [...FORCED_CONFIG, ...args]

  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const progress = signal ? progressListeners.get(signal) : null
    if (progress) progress({ command: args })
    if (signal?.aborted) { resolve({ stdout: binary ? Buffer.alloc(0) : '', stderr: '操作已取消', code: 1, killed: true, timedOut: false }); return }
    var abortTree, cancelTimer
    const child = execFile(
      gitPath,
      argv,
      {
        cwd,
        timeout: typeof timeoutMs === 'number' ? timeoutMs : DEFAULT_TIMEOUT_MS,
        maxBuffer: typeof maxBuffer === 'number' ? maxBuffer : MAX_BUFFER,
        windowsHide: true,
        // git writes UTF-8; decoding as anything else mangles Chinese commit
        // messages and author names.
        encoding: binary ? 'buffer' : 'utf8',
        signal: process.platform === 'win32' ? undefined : signal,
        env: {
          ...process.env,
          ...spec.env,
          // Keep output stable and machine-readable regardless of user config.
          GIT_PAGER: 'cat',
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          // Force English plumbing messages so classifiers below keep working
          // even on a localized git.
          LC_ALL: 'C',
          // Never launch an editor. This is not a convenience: git spawns the
          // editor on paths a GUI reaches with no terminal attached —
          // `rebase --continue`, `rebase -i`, `commit` without `-m`,
          // `merge`/`cherry-pick` that need a message — and a spawned `vi`
          // blocks forever on a stdin that will never yield a keystroke. The
          // symptom is not an error but a request that never returns.
          //
          // `true` is a program that exits 0 and writes nothing, so git accepts
          // the message already prepared (MERGE_MSG, or the commit being
          // replayed) and proceeds. The sequence editor is set too, because
          // `rebase -i` reads it from a DIFFERENT variable and would otherwise
          // still open the configured editor for the todo list.
          GIT_EDITOR: 'true',
          GIT_SEQUENCE_EDITOR: 'true',
        },
      },
      (error, stdout, stderr) => {
        clearTimeout(cancelTimer)
        if (abortTree) signal.removeEventListener('abort', abortTree)
        if (error && error.code === undefined && error.errno !== undefined) {
          // Spawn failure: ENOENT, EACCES, invalid cwd.
          recordCommand({
            cwd,
            args,
            code: null,
            durationMs: Date.now() - startedAt,
            error: error.message,
          })
          reject(new GitError(`无法执行 git：${error.message}`, {
            kind: 'spawn',
            gitPath,
            errno: error.errno,
            argv,
          }))
          return
        }
        const decode = value => (binary ? (Buffer.isBuffer(value) ? value : Buffer.from(value ?? '')) : String(value ?? ''))
        const outcome = {
          stdout: decode(stdout),
          // stderr is diagnostics, so it stays text even on a binary read:
          // nothing downstream expects a Buffer there.
          stderr: String(stderr ?? ''),
          code: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
          killed: error?.killed === true,
          timedOut: error?.killed === true && error?.signal === 'SIGTERM',
        }
        recordCommand({
          cwd,
          args,
          code: outcome.code,
          durationMs: Date.now() - startedAt,
          stderr: outcome.stderr,
        })
        resolve(outcome)
      },
    )
    if (process.platform === 'win32' && signal) {
      abortTree = () => {
        if (progress) progress({ text: 'Cancelling Git operation…' })
        if (child.pid && child.exitCode === null) {
          execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => { if (child.exitCode === null) child.kill() })
          // Some Windows installations stall taskkill's tree enumeration. Stop
          // Git itself and release inherited pipes instead of hanging the UI.
          cancelTimer = setTimeout(() => { if (child.exitCode === null) child.kill(); child.stdout?.destroy(); child.stderr?.destroy() }, 2000)
        }
      }
      signal.addEventListener('abort', abortTree, { once: true })
      if (signal.aborted) abortTree()
    }
    if (progress) {
      const report = chunk => { const lines = String(chunk).split(/[\r\n]+/).filter(Boolean); if (lines.length) progress({ text: lines.at(-1).slice(-1000) }) }
      child.stdout?.on('data', report); child.stderr?.on('data', report)
    }
    if (typeof input === 'string' && child.stdin !== null) {
      child.stdin.end(input)
    }
  })
}

/** Bounded-memory read output; the consumer can stop after filling a page. */
function gitStream(spec) {
  const { gitPath, cwd, args, signal } = spec
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { resolve({ stdout: '', stderr: '操作已取消', code: 1, killed: true }); return }
    const startedAt = Date.now()
    let stopped = false, aborted = false, timedOut = false, failure, stderr = '', killTimer
    const child = spawn(gitPath, [...FORCED_CONFIG, ...args], {
      cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...spec.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' },
    })
    const terminate = () => {
      if (child.exitCode !== null) return
      if (process.platform === 'win32' && child.pid) {
        execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => {})
        killTimer ??= setTimeout(() => { child.kill(); child.stdout.destroy(); child.stderr.destroy() }, 2000)
      } else child.kill()
    }
    const abort = () => { aborted = true; terminate() }
    const timer = setTimeout(() => { timedOut = true; terminate() }, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', text => {
      if (stopped || aborted || failure || timedOut) return
      try { if (spec.onStdout(text) === false) { stopped = true; terminate() } }
      catch (error) { failure = error; terminate() }
    })
    child.stderr.on('data', text => { stderr = (stderr + text).slice(-65536) })
    child.on('error', error => { failure = error })
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort)
      const outcome = { stdout: '', stderr: aborted ? '操作已取消' : timedOut ? 'Git 读取超时' : stderr,
        code: aborted || timedOut || failure ? 1 : stopped ? 0 : code ?? 1,
        stopped, killed: stopped || aborted || timedOut, timedOut }
      recordCommand({ cwd, args, code: outcome.code, durationMs: Date.now() - startedAt, stderr: outcome.stderr })
      if (failure) reject(failure); else resolve(outcome)
    })
    child.stdin.end(typeof spec.input === 'string' ? spec.input : undefined)
  })
}

/**
 * Run git and treat a non-zero exit as failure.
 *
 * @param spec - the invocation; `allowFailure` opts out.
 * @returns stdout plus exit facts.
 * @throws {GitError} on a non-zero exit, carrying only *meaningful* stderr.
 */
export async function gitOrThrow(spec) {
  const result = await git(spec)
  if (result.code !== 0) {
    const detail = meaningfulStderr(result.stderr)
    throw new GitError(
      detail !== '' ? detail : `git ${spec.args[0] ?? ''} 退出码 ${result.code}`,
      { kind: 'exit', code: result.code, argv: spec.args, stderr: result.stderr, cwd: spec.cwd },
    )
  }
  return result
}

/** Parse `git version 2.50.1.windows.1` into comparable numbers. */
export function parseGitVersion(text) {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text ?? ''))
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    text: String(text).trim(),
  }
}

/**
 * Compare a parsed version against a `major.minor[.patch]` requirement.
 * @param version - output of {@link parseGitVersion}.
 * @param requirement - e.g. `'2.11'` or `'2.17.0'`.
 * @returns true when the version is at least the requirement.
 */
export function meetsVersion(version, requirement) {
  if (version === null) return false
  const parts = String(requirement).split('.').map((n) => Number(n))
  const have = [version.major, version.minor, version.patch]
  for (let i = 0; i < 3; i++) {
    const want = parts[i] ?? 0
    if (have[i] > want) return true
    if (have[i] < want) return false
  }
  return true
}

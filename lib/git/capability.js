/** Git executable version and repository identity helpers. */
import { git, gitOrThrow, assertGitVersion } from './exec.js'

export async function readGitVersion({ gitPath, cwd, signal }) {
  const result = await gitOrThrow({ gitPath, cwd, args: ['--version'], timeoutMs: 8000, signal })
  const version = assertGitVersion(result.stdout)
  return { versionText: version.text, version }
}

/**
 * Read `.git-blame-ignore-revs` support facts.
 *
 * Git ignores the file unless `blame.ignoreRevsFile` points at it OR the caller
 * passes `--ignore-revs-file`. GitLens resolves this per repository and caches
 * the answer for 72 hours; we resolve per call and let the repo cache hold it,
 * because a wrong answer here changes *which author a line is attributed to*.
 *
 * @param options - resolution inputs.
 * @returns the usable ignore-revs path, or null.
 */
export async function resolveIgnoreRevsFile(options) {
  const { gitPath, cwd, signal } = options
  try {
    const configured = await git({
      gitPath,
      cwd,
      args: ['config', '--get', 'blame.ignoreRevsFile'],
      timeoutMs: 8_000,
      signal,
    })
    const value = configured.stdout.trim()
    if (configured.code === 0 && value !== '') return value
  } catch {
    // A missing config is the normal case; fall through to the default name.
  }

  // git's own default candidate when nothing is configured.
  const probe = await git({
    gitPath,
    cwd,
    args: ['cat-file', '-e', 'HEAD:.git-blame-ignore-revs'],
    timeoutMs: 8_000,
    signal,
  })
  return probe.code === 0 ? '.git-blame-ignore-revs' : null
}

/**
 * Resolve the repository root containing a directory.
 *
 * The stderr is classified rather than collapsed into "not a repository",
 * because three different situations arrive here with three different fixes:
 *
 * - `not a git repository …`  — nothing to open; offer `git init`.
 * - `this operation must be run in a work tree` — a bare repository. It IS a
 *   repository, and the panel can show its refs; only a working tree is missing.
 * - a `.git` file/link that points nowhere — a broken checkout, not an empty
 *   directory. Git words this two ways and the wording is NOT version-independent
 *   (see {@link classifyRepoProbeFailure}), and telling the user to `git init`
 *   there would be destructive advice.
 *
 * Everything else stays unclassified and is reported as a plain failure with
 * git's own words attached.
 *
 * @param options - resolution inputs.
 * @returns `{ root, reason, message }`; `root` is null on every failure.
 * @throws {GitError} when git could not be started at all — that is NOT the same
 *   answer as "this directory is not a repository", and callers must be able to
 *   tell the user which of the two happened.
 */
export async function resolveRepoRoot(options) {
  const { gitPath, cwd, signal } = options
  const result = await git({
    gitPath,
    cwd,
    args: ['rev-parse', '--show-toplevel'],
    timeoutMs: 10_000,
    signal,
  })
  if (result.code === 0) {
    const value = result.stdout.trim()
    return value === ''
      ? { root: null, reason: 'bare-repository', message: '' }
      : { root: normalizeSlashes(value), reason: null, message: '' }
  }
  const stderr = String(result.stderr ?? '')
  return { root: null, reason: classifyRepoProbeFailure(stderr), message: stderr.trim() }
}

/**
 * Classify the stderr of a failed `rev-parse --show-toplevel`.
 *
 * The broken-checkout wording is version-dependent, which is why this is a named
 * helper with a test rather than one inline regex:
 *
 * - Git ≤ 2.55: `fatal: not a git repository: <path>`
 * - Git ≥ 2.56: `fatal: gitfile does not point to a valid repository: <path>`
 *
 * Matching only the first form made every modern runner report a moved/deleted
 * checkout as `not-a-repository`, which offers `git init` — advice that would
 * create a nested repository instead of repairing the link. The empty-folder form
 * carries no `: <path>`, so it cannot collide with either.
 *
 * @param stderr - git's stderr for the failed probe.
 * @returns one of `bare-repository`, `broken-git-link`, `not-a-repository`.
 */
export function classifyRepoProbeFailure(stderr) {
  const text = String(stderr ?? '')
  if (/this operation must be run in a work tree/i.test(text)) return 'bare-repository'
  if (/gitfile does not point to a valid repository|not a git repository:/i.test(text)) {
    return 'broken-git-link'
  }
  return 'not-a-repository'
}

/**
 * Read the repository's common dir and current branch facts.
 *
 * `--git-common-dir` distinguishes a linked worktree from its main worktree,
 * which the UI needs in order to label them.
 *
 * @param options - resolution inputs.
 * @returns identity facts for the repository.
 */
export async function resolveRepoIdentity(options) {
  const { gitPath, cwd, signal } = options
  const result = await gitOrThrow({
    gitPath,
    cwd,
    args: ['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir', '--is-bare-repository'],
    timeoutMs: 10_000,
    signal,
  })
  const [toplevel = '', gitDir = '', commonDir = '', bare = 'false'] = result.stdout
    .split('\n')
    .map((line) => line.trim())
  return {
    root: normalizeSlashes(toplevel),
    gitDir: normalizeSlashes(gitDir),
    commonDir: normalizeSlashes(commonDir),
    bare: bare === 'true',
  }
}

/**
 * Convert backslashes to forward slashes.
 *
 * Every user-facing path goes through here so the UI, the RPC payloads, and the
 * `--` arguments all speak one dialect. git accepts forward slashes on Windows,
 * and mixed separators are what make path comparison bugs.
 *
 * @param value - a path.
 * @returns the path with forward slashes.
 */
export function normalizeSlashes(value) {
  return String(value ?? '').replace(/\\/g, '/')
}

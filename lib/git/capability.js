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
 * @param options - resolution inputs.
 * @returns the absolute toplevel path, or null when `cwd` is not in a repo.
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
  if (result.code !== 0) return null
  const value = result.stdout.trim()
  return value === '' ? null : normalizeSlashes(value)
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

/**
 * dsh-plugin-git — git capability probing.
 *
 * GitLens maintains an explicit table of "which git version introduced this
 * feature" and gates calls on it. Read out of its bundle:
 *
 *     ["git:status:find-renames","2.18"], ["git:status:porcelain-v2","2.11"],
 *     ["git:untrackedCache","2.8"], ["git:worktrees","2.17.0"],
 *     ["git:sparse-index","2.34"], ["git:stash:push:staged","2.35.0"],
 *     ["git:stash:push:pathspecs","2.13.2"], ["git:stash:push:stdin","2.30.0"],
 *     ["git:signing:x509","2.19.0"]
 *
 * We keep the table small — only what this plugin actually varies on — but we
 * keep the *mechanism*, because the alternative is a hard failure on an older
 * git: a user on git 2.7 must get a v1 status parse, not an error page.
 */
import { git, gitOrThrow, parseGitVersion, meetsVersion } from './exec.js'

/**
 * Feature keys this plugin gates on, with the git version that introduced them.
 * Kept in the same `git:<area>:<feature>` shape GitLens uses.
 */
export const FEATURE_REQUIREMENTS = {
  'git:status:porcelain-v2': '2.11',
  'git:status:find-renames': '2.18',
  'git:worktrees': '2.17.0',
  'git:stash:push:staged': '2.35.0',
  'git:log:format-atom': '1.7.2',
}

/**
 * Probe one repository for its git version and supported features.
 *
 * The version comes from the *resolved executable*, not from a guess, so the
 * settings page can show the user exactly which git is in play — which matters
 * on machines carrying several (see `resolveGitPath`).
 *
 * @param options - probe inputs.
 * @returns version facts plus a feature support map.
 */
export async function probeCapabilities(options) {
  const { gitPath, cwd, signal } = options

  let versionText = ''
  let version = null
  try {
    const result = await git({ gitPath, cwd, args: ['--version'], timeoutMs: 8_000, signal })
    versionText = result.stdout.trim() || result.stderr.trim()
    version = parseGitVersion(versionText)
  } catch (error) {
    return {
      ok: false,
      versionText,
      version: null,
      features: {},
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const features = {}
  for (const [feature, requirement] of Object.entries(FEATURE_REQUIREMENTS)) {
    features[feature] = meetsVersion(version, requirement)
  }
  // `--porcelain=v2` also needs a git that is not ancient beyond the version
  // string; a probe settles it.
  if (features['git:status:porcelain-v2'] === true) {
    const probe = await git({
      gitPath,
      cwd,
      args: ['status', '--porcelain=v2', '--branch', '-u'],
      timeoutMs: 10_000,
      signal,
    })
    features['git:status:porcelain-v2'] = probe.code === 0
  }

  return { ok: true, versionText, version, features, error: null }
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

/**
 * dsh-plugin-git — diff and file-content reads.
 *
 * The hunks produced here use the exact shape DSH already speaks for workspace
 * changes (`{ oldStart, oldLines, newStart, newLines, lines }`), so the panel can
 * reuse one renderer for "what the agent changed" and "what git shows".
 */
import { git } from './exec.js'
import { parseUnifiedDiff } from './parse.js'

/**
 * Build the git arguments for a diff request.
 *
 * @param request - the diff coordinates.
 * @returns a COMPLETE argv including the `diff` subcommand, which is what
 *   {@link RepoSession.run} expects. Returning a subcommand-less suffix here
 *   once produced `git --find-renames=50% HEAD`, i.e. a top-level option error —
 *   so the contract is now stated and guarded in one place.
 */
export function diffArgs(request) {
  // No `--no-color`: `git diff` has no such option (it is a `git log`/`git show`
  // option), and passing it makes git refuse the whole command. Colour is
  // instead disabled through the forced `-c color.ui=false` in exec.js.
  //
  // `--find-renames` needs a value on `git diff` — a bare flag is rejected.
  // GitLens passes a percentage too (`--find-renames${n}%`, gated on the
  // `git:status:find-renames` capability), and the threshold is
  // user-configurable there for the same reason it is here: 50% is too eager
  // for some codebases and too strict for others.
  const similarity = Number.isFinite(request.similarityThreshold)
    ? Math.min(Math.max(Math.round(request.similarityThreshold), 1), 100)
    : 50
  const args = ['diff', '--no-ext-diff', '--no-textconv', `--find-renames=${similarity}%`]
  if (Number.isInteger(request.contextLines)) args.push(`-U${request.contextLines}`)
  if (request.ignoreWhitespace === true) args.push('-w')
  if (request.ignoreAllSpace === true) args.push('-b')
  if (request.reverse === true) args.push('-R')
  if (request.staged === true) args.push('--cached')

  const from = typeof request.from === 'string' && request.from !== '' ? request.from : null
  const to = typeof request.to === 'string' && request.to !== '' ? request.to : null
  if (from !== null) args.push(from)
  if (to !== null) args.push(to)
  if (typeof request.path === 'string' && request.path !== '') {
    args.push('--', request.path)
    if (typeof request.originalPath === 'string' && request.originalPath !== '' && request.originalPath !== request.path) {
      args.push(request.originalPath)
    }
  }
  return args
}

/**
 * Produce a unified diff.
 *
 * @param repo - the repository session.
 * @param request - diff coordinates.
 * @param options - cancellation.
 * @returns the diff text plus per-file hunks.
 */
export async function diff(repo, request, options = {}) {
  if (typeof request.commit === 'string' && request.commit !== '') {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(request.commit)) throw new Error('Invalid commit SHA')
    const ancestry = await repo.run(['rev-list', '--parents', '-n', '1', request.commit, '--'], { signal: options.signal })
    if (ancestry.code !== 0 || ancestry.stdout.trim() === '') throw new Error(ancestry.stderr.trim() || 'Commit not found')
    const ids = ancestry.stdout.trim().split(/\s+/)
    let parent = ids[1]
    if (!parent) {
      const empty = await repo.run(['hash-object', '-t', 'tree', '--stdin'], { input: '', signal: options.signal })
      if (empty.code !== 0) throw new Error(empty.stderr.trim() || 'Cannot resolve empty tree')
      parent = empty.stdout.trim()
    }
    request = { ...request, from: parent, to: ids[0] }
  }
  const args = diffArgs(request)
  const result = await repo.run(args, { timeoutMs: 45_000, signal: options.signal })
  if (result.code !== 0 && result.stdout.trim() === '') {
    throw new Error(result.stderr.trim() || `git diff 退出码 ${result.code}`)
  }
  return {
    text: result.stdout,
    hunks: parseUnifiedDiff(result.stdout),
    files: splitDiffByFile(result.stdout),
    trimmed: result.code !== 0,
  }
}

/**
 * Split a unified diff into per-file sections.
 *
 * `git diff` emits `diff --git a/<path> b/<path>` headers; relying on those
 * rather than on our own path tracking is what makes renames and mode changes
 * come out right.
 *
 * @param text - a unified diff.
 * @returns one entry per file.
 */
export function splitDiffByFile(text) {
  const out = []
  let current = null
  for (const raw of String(text ?? '').split('\n')) {
    const header = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(raw)
    if (header !== null) {
      if (current !== null) out.push(current)
      current = {
        from: header[1] === header[2] ? null : header[1],
        path: header[2],
        status: 'M',
        binary: false,
        hunks: [],
        text: raw,
      }
      continue
    }
    if (current === null) continue
    current.text += `\n${raw}`
    if (raw.startsWith('new file mode')) current.status = 'A'
    else if (raw.startsWith('deleted file mode')) current.status = 'D'
    else if (raw.startsWith('rename from')) current.status = 'R'
    else if (raw.startsWith('Binary files')) current.binary = true
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw)
    if (hunk !== null) {
      current.hunks.push({
        oldStart: Number(hunk[1]),
        oldLines: hunk[2] === undefined ? 1 : Number(hunk[2]),
        newStart: Number(hunk[3]),
        newLines: hunk[4] === undefined ? 1 : Number(hunk[4]),
        lines: [],
      })
      continue
    }
    const last = current.hunks[current.hunks.length - 1]
    if (last !== undefined && (raw.startsWith('+') || raw.startsWith('-') || raw.startsWith(' '))) {
      last.lines.push(raw)
    }
  }
  if (current !== null) out.push(current)
  return out
}

/**
 * Diff one file between two revisions.
 * @param repo - the repository session.
 * @param request - `{ path, from, to }`.
 * @param options - cancellation.
 * @returns the file's diff, or null for a binary/oversized file.
 */
export async function fileDiff(repo, request, options = {}) {
  const result = await diff(repo, { ...request, contextLines: request.contextLines ?? 3 }, options)
  return result.files[0] ?? null
}

/**
 * Read a file's content at a revision, or from the working tree.
 *
 * @param repo - the repository session.
 * @param request - `{ path, rev }`; a null/`'WORKTREE'` rev reads disk.
 * @param options - cancellation.
 * @returns the text, plus whether it existed at all.
 */
export async function fileContent(repo, request, options = {}) {
  const rev = typeof request.rev === 'string' && request.rev !== '' ? request.rev : null
  if (rev === null || rev === 'WORKTREE' || rev === ':0') {
    return readWorktreeFile(repo, request.path, options)
  }
  // INDEX reads `:<path>` from the staging area; `<rev>:<path>` reads the blob without touching the working tree. Paths are
  // used verbatim (no leading `./`) because git resolves them from the repo root.
  const result = await repo.run(['show', rev === 'INDEX' ? `:${request.path}` : `${rev}:${request.path}`], {
    timeoutMs: 20_000,
    signal: options.signal,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.code !== 0) {
    return { exists: false, text: '', binary: false, truncated: false, error: result.stderr.trim() }
  }
  const binary = result.stdout.includes('\0')
  return {
    exists: true,
    text: binary ? '' : result.stdout,
    binary,
    truncated: false,
    error: null,
  }
}

/** Read the current on-disk file, guarding against leaving the repository. */
async function readWorktreeFile(repo, path, options) {
  const { readFile, lstat, readlink, realpath } = await import('node:fs/promises')
  const { join, resolve, relative, isAbsolute, dirname } = await import('node:path')
  const absolute = resolve(join(repo.root, path))
  const rootResolved = resolve(repo.root)
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + (process.platform === 'win32' ? '\\' : '/'))) {
    return { exists: false, text: '', binary: false, truncated: false, error: 'path escapes the repository' }
  }
  try {
    const realRoot = await realpath(rootResolved)
    const parent = await realpath(dirname(absolute))
    const parentRelative = relative(realRoot, parent)
    if (parentRelative === '..' || parentRelative.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(parentRelative)) {
      return { exists: false, text: '', binary: false, truncated: false, error: 'path escapes the repository' }
    }
    const info = await lstat(absolute)
    if (info.isSymbolicLink()) {
      return { exists: true, text: await readlink(absolute), binary: false, truncated: false, error: null }
    }
    if (info.size > 4 * 1024 * 1024) {
      return { exists: true, text: '', binary: false, truncated: true, error: 'file exceeds 4 MiB' }
    }
    const buffer = await readFile(absolute, { signal: options.signal })
    const binary = buffer.includes(0)
    return {
      exists: true,
      text: binary ? '' : buffer.toString('utf8'),
      binary,
      truncated: false,
      error: null,
    }
  } catch (error) {
    const code = error?.code
    if (code === 'ENOENT') return { exists: false, text: '', binary: false, truncated: false, error: null }
    return {
      exists: false,
      text: '',
      binary: false,
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Per-file diffstat for a set of diff coordinates.
 * @param repo - the repository session.
 * @param targets - e.g. `['HEAD']`, or `['main','feature']`.
 * @param options - cancellation.
 * @returns diffstat records.
 */
export async function diffstat(repo, targets, options = {}) {
  const result = await repo.run(['diff', '--no-ext-diff', '--no-textconv', '--find-renames=50%', '--numstat', '-z', ...targets], {
    timeoutMs: 30_000,
    signal: options.signal,
  })
  if (result.code !== 0) {
    if (options.throwOnError) throw new Error(result.stderr.trim() || '无法加载比较文件')
    return []
  }
  const tokens = result.stdout.split('\0'), files = []
  for (let index = 0; index < tokens.length; index++) {
    if (!tokens[index]) continue
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(tokens[index])
    if (!match) continue
    const originalPath = match[3] === '' ? tokens[++index] : null
    const path = originalPath === null ? match[3] : tokens[++index]
    files.push({ path, originalPath, from: originalPath, status: originalPath ? 'R' : 'M', binary: match[1] === '-',
      added: match[1] === '-' ? null : Number(match[1]), deleted: match[2] === '-' ? null : Number(match[2]) })
  }
  return files
}

/**
 * Count how many files two revisions differ in, without producing the diff.
 * @param repo - the repository session.
 * @param targets - diff targets.
 * @param options - cancellation.
 * @returns `{ files, added, deleted }`.
 */
export async function diffSummary(repo, targets, options = {}) {
  const stats = await diffstat(repo, targets, options)
  let added = 0
  let deleted = 0
  let binary = 0
  for (const file of stats) {
    if (file.binary) binary++
    else {
      added += file.added ?? 0
      deleted += file.deleted ?? 0
    }
  }
  return { files: stats.length, added, deleted, binary }
}

/**
 * Check whether a path is ignored by gitignore rules.
 * @param repo - the repository session.
 * @param paths - paths to test.
 * @param options - cancellation.
 * @returns a map of path to ignored-ness.
 */
export async function checkIgnore(repo, paths, options = {}) {
  if (paths.length === 0) return new Map()
  const result = await git({
    gitPath: repo.gitPath,
    cwd: repo.root,
    args: ['check-ignore', '--stdin', '-z'],
    input: paths.join('\0') + '\0',
    timeoutMs: 15_000,
    signal: options.signal,
  })
  const ignored = new Set(result.stdout.split('\0').filter((token) => token !== ''))
  return new Map(paths.map((path) => [path, ignored.has(path)]))
}

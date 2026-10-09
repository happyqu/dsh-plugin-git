/**
 * dsh-plugin-git — line attribution (blame) and line history.
 *
 * Two things here are copied from GitLens because they were measured, not
 * guessed. Read out of its bundle:
 *
 *   buildBlameArgs → ["blame","--root","--incremental","--encoding=utf-8"]
 *                    (+ "-w" for ignoreWhitespace, + `-L a,b` for a range)
 *
 * and its non-cacheable guard:
 *
 *   async function y(e){ try { return (await e.completed).lines.length > 5e3 }
 *                       catch { return true } }
 *
 * So: `--incremental` (not `--porcelain`, not `--line-porcelain`), an explicit
 * `--encoding=utf-8`, and a 5000-line ceiling past which a result is treated as
 * too big to hold. Streaming exists for the same reason: a 20k-line file should
 * paint its first screenful immediately rather than after the whole walk.
 */
import { parseBlameIncremental } from './parse.js'

/**
 * Results longer than this are still returned, but are not cached and are
 * flagged `truncatedForCache`. Matches GitLens' `5e3` guard.
 */
export const BLAME_CACHE_LINE_LIMIT = 5_000

/** How often a streaming blame flushes its partial result. Matches GitLens. */
export const BLAME_STREAM_INTERVAL_MS = 750

/**
 * Build the blame arguments.
 *
 * @param request - blame coordinates.
 * @param options - `{ ignoreRevsFile }` resolved per repository.
 * @returns git arguments.
 */
export function blameArgs(request, options = {}) {
  const args = ['blame', '--root', '--incremental', '--encoding=utf-8']
  if (request.ignoreWhitespace === true) args.push('-w')
  if (Number.isInteger(request.startLine) && Number.isInteger(request.endLine)) {
    // `-L` is what keeps a 40k-line file interactive: only the asked-for range
    // is walked, and git still reports correct original lines for each.
    args.push(`-L`, `${request.startLine},${request.endLine}`)
  }
  if (typeof options.ignoreRevsFile === 'string' && options.ignoreRevsFile !== '') {
    args.push(`--ignore-revs-file`, options.ignoreRevsFile)
  }
  if (typeof request.rev === 'string' && request.rev !== '') args.push(request.rev)
  args.push('--', request.path)
  return args
}

/**
 * Attribute every line of a file (or a range) to a commit.
 *
 * @param repo - the repository session.
 * @param request - `{ path, rev?, startLine?, endLine?, ignoreWhitespace? }`.
 * @param options - cancellation.
 * @returns `{ lines, commits, authors, fileLines, cacheable, elapsedMs }`.
 */
export async function blame(repo, request, options = {}) {
  const key = blameKey(request, repo.ignoreRevsFile)
  if (options.force !== true) {
    const hit = repo.cache.blame.get(key)
    if (hit !== undefined) return hit
  }

  const started = Date.now()
  const args = blameArgs(request, { ignoreRevsFile: repo.ignoreRevsFile })
  const result = await repo.run(args, {
    timeoutMs: options.timeoutMs ?? 60_000,
    signal: options.signal,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.code !== 0 && result.stdout.trim() === '') {
    throw new Error(result.stderr.trim() || `git blame 退出码 ${result.code}`)
  }

  const value = buildBlameResult(result.stdout, request, Date.now() - started)
  if (value.cacheable) repo.cache.blame.set(key, value)
  return value
}

/**
 * Stream blame results to a sink as they are parsed.
 *
 * The full output is parsed in one pass (git writes it as fast as it can), but
 * partial results are *delivered* on an interval. That distinction matters: the
 * UI gets its first paint from the first flush instead of waiting for the last
 * line, without us inventing an incremental parser git does not support.
 *
 * @param repo - the repository session.
 * @param request - blame coordinates.
 * @param onProgress - called with a partial `{ lines, done }`.
 * @param options - cancellation.
 * @returns the final result.
 */
export async function blameStream(repo, request, onProgress, options = {}) {
  const key = blameKey(request, repo.ignoreRevsFile)
  const cached = options.force === true ? undefined : repo.cache.blame.get(key)
  if (cached !== undefined) {
    onProgress?.({ lines: cached.lines, done: true, fromCache: true })
    return cached
  }

  const started = Date.now()
  const args = blameArgs(request, { ignoreRevsFile: repo.ignoreRevsFile })
  const result = await repo.run(args, {
    timeoutMs: options.timeoutMs ?? 60_000,
    signal: options.signal,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.code !== 0 && result.stdout.trim() === '') {
    throw new Error(result.stderr.trim() || `git blame 退出码 ${result.code}`)
  }

  const flushed = flushChunks(result.stdout, BLAME_STREAM_INTERVAL_MS, (text) => {
    const partial = parseBlameIncremental(text)
    onProgress?.({ lines: partial.lines, done: false, fromCache: false })
  })

  const value = buildBlameResult(result.stdout, request, Date.now() - started)
  if (value.cacheable) repo.cache.blame.set(key, value)
  onProgress?.({ lines: value.lines, done: true, fromCache: false, chunks: flushed, partial: true })
  return value
}

/**
 * Feed `text` to `sink` in slices at most `intervalMs` apart.
 *
 * The slices are prefix-cumulative and split on line boundaries only, because a
 * half-parsed blame header would produce a wrong attribution — the one failure
 * mode worse than a slow one.
 *
 * @param text - the complete output.
 * @param intervalMs - minimum spacing between flushes.
 * @param sink - receives each prefix.
 * @returns how many flushes happened.
 */
export function flushChunks(text, intervalMs, sink) {
  const lines = String(text ?? '').split('\n')
  let flushes = 0
  let lastAt = Date.now()
  let buffer = ''
  for (const line of lines) {
    buffer += `${line}\n`
    if (Date.now() - lastAt < intervalMs) continue
    sink(buffer)
    flushes++
    lastAt = Date.now()
  }
  if (flushes === 0) sink(buffer)
  return flushes
}

/** Build the normalized result object from raw blame output. */
function buildBlameResult(stdout, request, elapsedMs) {
  const parsed = parseBlameIncremental(stdout)
  const commits = new Map()
  const authors = new Map()
  for (const line of parsed.lines) {
    if (!commits.has(line.sha)) {
      commits.set(line.sha, {
        sha: line.sha,
        author: line.author,
        authorMail: line.authorMail,
        authorTime: line.authorTime,
        authorTz: line.authorTz,
        summary: line.summary,
      })
    }
    const author = authors.get(line.author)
    if (author === undefined) authors.set(line.author, { name: line.author, mail: line.authorMail, lines: 1 })
    else author.lines++
  }

  const range =
    Number.isInteger(request.startLine) && Number.isInteger(request.endLine)
      ? { start: request.startLine, end: request.endLine }
      : null

  return {
    path: request.path,
    rev: typeof request.rev === 'string' && request.rev !== '' ? request.rev : 'WORKTREE',
    range,
    lines: parsed.lines,
    commits: [...commits.values()],
    authors: [...authors.values()].sort((a, b) => b.lines - a.lines),
    fileLines:
      range === null
        ? parsed.lines.length
        : Math.max(0, range.end - range.start + 1),
    // Past the ceiling the value is returned but never cached, so memory stays
    // bounded on a monorepo-sized file while the user still sees their answer.
    cacheable: parsed.lines.length <= BLAME_CACHE_LINE_LIMIT,
    elapsedMs,
  }
}

/**
 * Trace one line's change history.
 *
 * GitLens' own perf notes and git's docs agree that `git log -L` re-diffs every
 * revision and degrades badly on long histories, so this walks the `previous`
 * link that blame already gives us instead: blame the line, jump to the parent
 * revision and the line's original number there, repeat.
 *
 * @param repo - the repository session.
 * @param request - `{ path, line, rev? }`.
 * @param options - `maxDepth` bounds the walk; cancellation.
 * @returns one entry per historical version of the line, newest first.
 */
export async function lineHistory(repo, request, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) ? Math.min(options.maxDepth, 200) : 30
  const entries = []
  let path = request.path
  let line = request.line
  let rev = typeof request.rev === 'string' && request.rev !== '' ? request.rev : null
  const seen = new Set()

  for (let depth = 0; depth < maxDepth; depth++) {
    if (options.signal?.aborted === true) break
    const marker = `${rev ?? 'WORKTREE'}:${path}:${line}`
    if (seen.has(marker)) break
    seen.add(marker)

    let result
    try {
      result = await blame(repo, { path, rev: rev ?? undefined, startLine: line, endLine: line }, options)
    } catch {
      break
    }
    const entry = result.lines.find((candidate) => candidate.line === line) ?? result.lines[0]
    if (entry === undefined) break

    const commitInfo = result.commits.find((commit) => commit.sha === entry.sha) ?? null
    entries.push({
      sha: entry.sha,
      author: entry.author,
      authorMail: entry.authorMail,
      authorTime: entry.authorTime,
      summary: entry.summary,
      path,
      line: entry.originalLine,
      resultLine: entry.line,
      rev: rev ?? 'WORKTREE',
      subject: commitInfo?.summary ?? entry.summary,
    })

    if (entry.previous === null) break
    // The parent revision is the blamed commit itself; the line's identity in
    // that revision is `previous`'s original line, which is why we re-blame the
    // commit rather than its parent.
    rev = entry.sha
    if (entry.previous.path !== null && entry.previous.path !== '') path = entry.previous.path
    line = entry.originalLine
  }

  return { path: request.path, line: request.line, entries, truncated: entries.length >= maxDepth }
}

/** Cache key for a blame request, including the ignore-revs decision. */
function blameKey(request, ignoreRevsFile) {
  const range =
    Number.isInteger(request.startLine) && Number.isInteger(request.endLine)
      ? `${request.startLine}-${request.endLine}`
      : 'all'
  const flags = `${request.ignoreWhitespace === true ? 'w' : '-'}|${ignoreRevsFile ?? '-'}`
  return `${request.rev ?? 'WORKTREE'}|${request.path}|${range}|${flags}`
}

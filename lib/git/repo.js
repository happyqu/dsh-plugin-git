/**
 * dsh-plugin-git — repository service layer.
 *
 * One `RepoSession` per (repository root, resolved git executable). It owns the
 * caches, the capability answer, and the ignore-revs decision, and it is the
 * only object that other modules use to reach git. That single choke point is
 * deliberate: it means cache invalidation, capability gating, and the forced
 * `-c` configuration cannot be forgotten at a call site.
 */
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import { git, gitOrThrow, resolveGitPath } from './exec.js'
import { probeCapabilities, resolveIgnoreRevsFile, resolveRepoRoot, resolveRepoIdentity, normalizeSlashes } from './capability.js'
import { RepoCache } from './cache.js'
import { parseStatusV2, parseForEachRef, parseStashList, parseWorktrees, parseLogRecords, buildLogFormat, FIELD_SEP } from './parse.js'

/**
 * Reject an argv that does not begin with a git subcommand.
 *
 * This guard exists because of a real bug: a helper returned the *suffix* of a
 * `git diff` argv, so the call became `git --find-renames=50% HEAD` and git
 * answered "unknown option". That failure is confusing precisely because it
 * looks like a wrong flag rather than a wrong argv shape. Failing loudly at the
 * boundary turns it into an obvious contract violation.
 *
 * @param args - the argv about to be run.
 * @param where - caller name, for the message.
 */
function assertSubcommand(args, where) {
  const first = args[0]
  if (typeof first !== 'string' || first === '' || first.startsWith('-')) {
    throw new Error(
      `${where} requires a complete argv starting with a git subcommand (e.g. ['diff', ...]); got ${JSON.stringify(args)}`,
    )
  }
}

/** Field specs reused across commands, matching GitLens' own field sets. */
export const COMMIT_FIELDS = {
  sha: '%H',
  shortSha: '%h',
  author: '%aN',
  authorEmail: '%aE',
  authorDate: '%at',
  committer: '%cN',
  committerEmail: '%cE',
  committerDate: '%ct',
  parents: '%P',
  tips: '%D',
  subject: '%s',
  message: '%B',
}

/** Field spec for ref enumeration. */
export const REF_FIELDS = {
  ref: '%(refname)',
  short: '%(refname:short)',
  sha: '%(objectname)',
  type: '%(objecttype)',
  subject: '%(subject)',
  // The branch picker shows "author · sha · subject" per row, the way VS Code's
  // does. The author is the committer of the ref's tip, which is the fact a user
  // is actually scanning for when they cannot remember which branch is whose.
  author: '%(authorname)',
  committerDate: '%(committerdate:unix)',
  upstream: '%(upstream:short)',
  upstreamRef: '%(upstream)',
  head: '%(HEAD)',
  symbolic: '%(symref)',
  tracking: '%(upstream:track)',
  peeled: '%(*objectname)',
}

/** Field spec for stash entries. */
export const STASH_FIELDS = {
  ref: '%gd',
  sha: '%H',
  message: '%gs',
  date: '%ct',
  author: '%aN',
}

/**
 * One repository, bound to one resolved git executable.
 *
 * Construct through {@link openRepo}, which performs discovery and probing.
 */
export class RepoSession {
  /**
   * @param options - session identity.
   */
  constructor(options) {
    this.root = options.root
    this.identity = options.identity
    this.gitPath = options.gitPath
    this.capabilities = options.capabilities
    this.ignoreRevsFile = options.ignoreRevsFile ?? null
    this.cache = new RepoCache()
    this.logger = options.logger ?? null
  }

  /**
   * Run a read-only git command in this repository.
   *
   * `--no-optional-locks` is applied so a status read never takes the index
   * lock and never fights the user's own git process.
   *
   * @param args - git arguments.
   * @param options - timeout, cancellation, stdin.
   * @returns exit facts.
   */
  run(args, options = {}) {
    assertSubcommand(args, 'RepoSession.run')
    return git({
      gitPath: this.gitPath,
      cwd: this.root,
      args: ['--no-optional-locks', ...args],
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      maxBuffer: options.maxBuffer,
      input: options.input,
    })
  }

  /**
   * Run a git command that is expected to succeed.
   * @param args - git arguments.
   * @param options - timeout and cancellation.
   * @returns stdout.
   */
  async runOrThrow(args, options = {}) {
    assertSubcommand(args, 'RepoSession.runOrThrow')
    const result = await gitOrThrow({
      gitPath: this.gitPath,
      cwd: this.root,
      args: ['--no-optional-locks', ...args],
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      maxBuffer: options.maxBuffer,
    })
    return result.stdout
  }

  /**
   * Run a git command that WRITES to the repository.
   *
   * Kept separate from {@link run} so that a permission review has one obvious
   * place to look: every call here can change the working tree or refs, and
   * none of them carry `--no-optional-locks` (a write needs the lock).
   *
   * @param args - git arguments.
   * @param options - timeout, cancellation, stdin.
   * @returns exit facts.
   */
  runWrite(args, options = {}) {
    return git({
      gitPath: this.gitPath,
      cwd: this.root,
      args,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      maxBuffer: options.maxBuffer,
      input: options.input,
      env: options.env,
    })
  }

  /** Whether a probed capability is available. */
  supports(feature) {
    return this.capabilities?.features?.[feature] === true
  }

  /**
   * Read `git status`, cached briefly.
   * @param options - `force` bypasses the cache.
   * @returns branch facts and changed files.
   */
  async status(options = {}) {
    const key = 'status'
    return this.cache.status.through(key, async () => {
      const v2 = this.supports('git:status:porcelain-v2')
      const args = v2
        ? ['status', '--porcelain=v2', '--branch', '-u', '--find-renames']
        : ['status', '--porcelain', '--branch', '-u']
      const result = await this.run(args, { timeoutMs: 30_000, signal: options.signal })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || `git status 退出码 ${result.code}`)
      }
      const parsed = v2 ? parseStatusV2(result.stdout) : parseStatusV1(result.stdout)
      // Line counts ride the same cache entry: they come from numstat, and
      // recomputing them on every status poll would defeat the cache entirely.
      const counts = await this.diffNumstat(
        this.statusDiffArgs(parsed),
        { signal: options.signal },
      )
      const lfsPaths = new Set()
      if (parsed.files.length) {
        const attributes = await this.run(['check-attr', '-z', '--stdin', 'filter'], { signal: options.signal, input: parsed.files.map(file => file.path).join('\0') + '\0' })
        if (attributes.code === 0) { const fields = attributes.stdout.split('\0'); for (let i = 0; i + 2 < fields.length; i += 3) if (fields[i + 2] === 'lfs') lfsPaths.add(fields[i]) }
      }
      const files = parsed.files.map((file) => {
        const count = counts.get(file.path) ?? counts.get(file.originalPath ?? '')
        return { ...file, lfs: lfsPaths.has(file.path), added: count?.added ?? null, deleted: count?.deleted ?? null, binary: count?.binary ?? false }
      })
      const value = { branch: parsed.branch, files, total: files.length, operation: await this.operation(options) }
      return value
    }, { force: options.force === true, signal: options.signal })
  }

  /**
   * Which multi-step git operation is mid-flight, if any.
   *
   * Git records these as sentinel files in the git dir, and they are the only
   * reliable signal: `git status` reports the same conflicted file for a merge, a
   * rebase, a cherry-pick and a revert, so the file list alone cannot tell a user
   * what they are in the middle of — or which command finishes it. A conflicted
   * working tree with no visible way out is the worst state to strand someone in,
   * so this drives a banner with continue/abort actions.
   *
   * `--absolute-git-dir` rather than `<root>/.git`: in a linked worktree the
   * state files live in `.git/worktrees/<name>/`, and in a submodule the `.git`
   * entry is a file, not a directory. Asking git is both shorter and correct.
   *
   * Order matters: `git am` also uses `rebase-apply`, and a rebase can leave a
   * `MERGE_HEAD` behind, so the rebase checks come first.
   *
   * @param options - `{ signal }`.
   * @returns `{ kind, step, total }` or null when nothing is in progress.
   */
  async operation(options = {}) {
    const result = await this.run(['rev-parse', '--absolute-git-dir'], {
      timeoutMs: 10_000,
      signal: options.signal,
    })
    if (result.code !== 0) return null
    const dir = result.stdout.trim()
    if (dir === '') return null

    const has = async (name) => {
      try {
        await access(path.join(dir, name))
        return true
      } catch {
        return false
      }
    }
    /** Read a small counter file, tolerating its absence. */
    const counter = async (name) => {
      try {
        const value = Number.parseInt((await readFile(path.join(dir, name), 'utf8')).trim(), 10)
        return Number.isInteger(value) ? value : null
      } catch {
        return null
      }
    }

    if (await has('rebase-merge')) {
      return { kind: 'rebase', step: await counter('rebase-merge/msgnum'), total: await counter('rebase-merge/end') }
    }
    if (await has('rebase-apply')) {
      // `rebase-apply/rebasing` exists only for a rebase; without it this is a
      // `git am` in progress, which `git rebase --continue` cannot finish.
      const isRebase = await has('rebase-apply/rebasing')
      return {
        kind: isRebase ? 'rebase' : 'am',
        step: await counter('rebase-apply/next'),
        total: await counter('rebase-apply/last'),
      }
    }
    if (await has('MERGE_HEAD')) return { kind: 'merge', step: null, total: null }
    const sequenced = async kind => {
      let noCommit = false
      try {
        const opts = await readFile(path.join(dir, 'sequencer/opts'), 'utf8')
        const todo = await readFile(path.join(dir, 'sequencer/todo'), 'utf8')
        noCommit = /\bno-commit\s*=\s*true\b/.test(opts) && todo.split('\n').filter(line => /^(pick|revert)\s/.test(line.trim())).length === 1
      } catch {}
      return { kind, step: null, total: null, noCommit }
    }
    if (await has('CHERRY_PICK_HEAD')) return sequenced('cherry-pick')
    if (await has('REVERT_HEAD')) return sequenced('revert')
    // --no-commit cherry-pick has a sequencer but no CHERRY_PICK_HEAD marker.
    try {
      const todo = await readFile(path.join(dir, 'sequencer/todo'), 'utf8')
      const command = todo.split('\n').map(line => line.trim()).find(line => /^(pick|revert)\s/.test(line))
      if (command) return sequenced(command.startsWith('revert ') ? 'revert' : 'cherry-pick')
    } catch {}
    return null
  }

  /**
   * Choose the `git diff` coordinates that describe the current working tree.
   * @param status - parsed status.
   * @returns git diff arguments without the leading `diff`.
   */
  statusDiffArgs(status) {
    // `HEAD` covers staged + unstaged tracked changes in one call. Untracked
    // files have no diff at all, so they are reported with null counts.
    return ['HEAD']
  }

  /**
   * Read `--numstat` for the given diff coordinates.
   * @param targets - git diff targets, e.g. `['HEAD']`.
   * @param options - cancellation.
   * @returns a map of path to counts.
   */
  async diffNumstat(targets, options = {}) {
    const result = await this.run(['diff', '--numstat', '-z', ...targets], {
      timeoutMs: 30_000,
      signal: options.signal,
    })
    const map = new Map()
    if (result.code !== 0) return map
    // -z form: `<add>\t<del>\t<path>\0` with the *original* path as a second
    // NUL-terminated token for renames.
    const tokens = result.stdout.split('\0')
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (token === '') continue
      const parts = token.split('\t')
      if (parts.length < 3) continue
      const added = parts[0] === '-' ? null : Number(parts[0])
      const deleted = parts[1] === '-' ? null : Number(parts[1])
      map.set(parts[2], { added, deleted, binary: parts[0] === '-' })
    }
    return map
  }

  /**
   * Enumerate refs (branches, tags, remotes).
   * @param options - `force` bypasses the cache; `kind` filters the namespace.
   * @returns ref records grouped for the tree UI.
   */
  async refs(options = {}) {
    const kind = options.kind ?? 'all'
    const key = `refs:${kind}`
    if (options.force !== true) {
      const hit = this.cache.refs.get(key)
      if (hit !== undefined) return hit
    }
    const patterns = kind === 'branches'
      ? ['refs/heads', 'refs/remotes']
      : kind === 'tags'
        ? ['refs/tags']
        : ['refs/heads', 'refs/remotes', 'refs/tags']
    const format = Object.values(REF_FIELDS).join(FIELD_SEP)
    const stdout = await this.runOrThrow(
      ['for-each-ref', '--format=' + format, ...patterns],
      { timeoutMs: 20_000, signal: options.signal },
    )
    const records = parseForEachRef(stdout, Object.keys(REF_FIELDS))
    const mergedResult = kind === 'tags' ? null : await this.run(
      ['for-each-ref', '--merged=HEAD', '--format=%(refname)', 'refs/heads', 'refs/remotes'],
      { timeoutMs: 20_000, signal: options.signal },
    )
    const merged = mergedResult?.code === 0 ? new Set(mergedResult.stdout.trim().split('\n').filter(Boolean)) : null
    const branches = []
    const tags = []
    const remotes = []
    for (const record of records) {
      const entry = {
        name: record.ref.replace(/^refs\/(heads|remotes|tags)\//, ''),
        ref: record.ref,
        sha: record.sha,
        commitSha: record.peeled || record.sha,
        type: record.type,
        subject: record.subject,
        author: record.author === '' ? null : record.author,
        committerDate: record.committerDate === '' ? null : Number(record.committerDate),
        upstream: record.upstream === '' ? null : record.upstream,
        upstreamRef: record.upstreamRef || null,
        head: record.head === '*',
        symbolic: record.symbolic || null,
        tracking: record.tracking || '',
        ahead: Number(/ahead (\d+)/.exec(record.tracking || '')?.[1] || 0),
        behind: Number(/behind (\d+)/.exec(record.tracking || '')?.[1] || 0),
        merged: merged === null ? null : merged.has(record.ref),
      }
      if (record.ref.startsWith('refs/heads/')) branches.push(entry)
      else if (record.ref.startsWith('refs/remotes/')) remotes.push(entry)
      else if (record.ref.startsWith('refs/tags/')) tags.push(entry)
    }
    const value = { branches, tags, remotes }
    this.cache.refs.set(key, value)
    return value
  }

  /**
   * List configured remotes with their URLs.
   *
   * Distinct from the `refs/remotes/*` entries in {@link refs}: a remote exists
   * as soon as it is configured, while its remote-tracking branches only appear
   * after a fetch. Enumerating refs alone therefore made a freshly added remote
   * invisible in the UI — the exact case a user checks after `git remote add`.
   *
   * @param options - cancellation.
   * @returns `{ name, fetchUrl, pushUrl }` per remote.
   */
  async remotes(options = {}) {
    const result = await this.run(['remote', '-v'], { timeoutMs: 15_000, signal: options.signal })
    if (result.code !== 0) return []
    const byName = new Map()
    for (const line of result.stdout.split('\n')) {
      if (line.trim() === '') continue
      // `<name>\t<url> (fetch|push)`
      const match = /^(\S+)\s+(.+?)\s+\((fetch|push)\)$/.exec(line)
      if (match === null) continue
      const name = match[1]
      const entry = byName.get(name) ?? { name, fetchUrl: null, pushUrl: null }
      if (match[3] === 'fetch') entry.fetchUrl = match[2]
      else entry.pushUrl = match[2]
      byName.set(name, entry)
    }
    return [...byName.values()]
  }

  /**
   * List stash entries.
   * @param options - cancellation.
   * @returns stash records.
   */
  async stashes(options = {}) {    const format = Object.values(STASH_FIELDS).join(FIELD_SEP)
    const result = await this.run(['stash', 'list', '--format=' + format], {
      timeoutMs: 15_000,
      signal: options.signal,
    })
    if (result.code !== 0) return []
    return parseStashList(result.stdout, Object.keys(STASH_FIELDS)).map((entry) => ({
      ...entry,
      date: entry.date === '' ? null : Number(entry.date),
    }))
  }

  /**
   * List worktrees.
   * @param options - cancellation.
   * @returns worktree records.
   */
  async worktrees(options = {}) {
    if (!this.supports('git:worktrees')) return []
    const result = await this.run(['worktree', 'list', '--porcelain'], {
      timeoutMs: 15_000,
      signal: options.signal,
    })
    if (result.code !== 0) return []
    return parseWorktrees(result.stdout)
  }

  /**
   * List commits.
   * @param options - limit, skip, ref range, path, grep filters.
   * @returns commit records with their changed files.
   */
  async commits(options = {}) {
    const limit = Number.isInteger(options.limit) ? Math.min(options.limit, 500) : 50
    const skip = Number.isInteger(options.skip) ? options.skip : 0
    const args = ['log', '--format=' + buildLogFormat(COMMIT_FIELDS), '--summary', `-n${limit}`]
    if (skip > 0) args.push(`--skip=${skip}`)
    if (typeof options.since === 'string' && options.since !== '') args.push(`--since=${options.since}`)
    if (typeof options.until === 'string' && options.until !== '') args.push(`--until=${options.until}`)
    if (typeof options.author === 'string' && options.author !== '') args.push(`--author=${options.author}`)
    if (typeof options.grep === 'string' && options.grep !== '') args.push(`--grep=${options.grep}`, '-i')
    if (typeof options.pickaxe === 'string' && options.pickaxe !== '') args.push(`-S${options.pickaxe}`)
    if (typeof options.pickaxeRegex === 'string' && options.pickaxeRegex !== '') args.push(`-G${options.pickaxeRegex}`)
    if (typeof options.ordering === 'string' && options.ordering !== '') args.push(`--${options.ordering}-order`)
    if (options.mergesOnly === true) args.push('--merges')
    if (options.noMerges === true) args.push('--no-merges')
    args.push(typeof options.ref === 'string' && options.ref !== '' ? options.ref : 'HEAD')
    if (typeof options.path === 'string' && options.path !== '') {
      args.push('--follow', '--', options.path)
    }
    const [stdout, unpublished] = await Promise.all([this.runOrThrow(args, {
      timeoutMs: options.timeoutMs ?? 45_000,
      signal: options.signal,
    }), this.unpublished(args, options)])
    return parseLogRecords(stdout, Object.keys(COMMIT_FIELDS)).map(normalizeCommit).map(commit => ({ ...commit, unpublished: unpublished.has(commit.sha) }))
  }

  /** Match this bounded history query against locally known remote history. */
  async unpublished(args, options = {}) {
    const skip = Number(args.find(arg => /^--skip=\d+$/.test(arg))?.slice(7) || 0)
    const probe = args.filter(arg => arg !== '--summary' && !arg.startsWith('--skip=')).map(arg =>
      arg.startsWith('--format=') ? '--format=%H' : /^-n\d+$/.test(arg) ? '-n' + Math.min(Number(arg.slice(2)) + skip, 10_000) : arg)
    const separator = probe.indexOf('--')
    probe.splice(separator < 0 ? probe.length : separator, 0, '--not', '--remotes')
    try {
      const text = await this.runOrThrow(probe, { timeoutMs: 45_000, signal: options.signal })
      return new Set(text.trim().split('\n').filter(Boolean))
    } catch (error) {
      if (options.signal?.aborted) throw error
      return new Set()
    }
  }

  /**
   * Read one commit's metadata and per-file diffstat.
   * @param sha - the commit.
   * @param options - cancellation.
   * @returns the commit plus its files.
   */
  async commit(sha, options = {}) {
    const key = `commit:${sha}`
    if (options.force !== true) {
      const hit = this.cache.log.get(key)
      if (hit !== undefined) return hit
    }
    const args = [
      'show',
      '--format=' + buildLogFormat(COMMIT_FIELDS),
      '--numstat',
      '--diff-merges=first-parent',
      '-z',
      '--find-renames',
      sha,
    ]
    const stdout = await this.runOrThrow(args, { timeoutMs: 30_000, signal: options.signal })
    const value = parseShowWithNumstat(stdout)
    this.cache.log.set(key, value)
    return value
  }

  /**
   * Count commits reachable from a ref.
   * @param ref - the ref, defaulting to HEAD.
   * @param options - cancellation.
   * @returns the count, or null when it cannot be determined.
   */
  async commitCount(ref, options = {}) {
    const result = await this.run(['rev-list', '--count', ref ?? 'HEAD'], {
      timeoutMs: 30_000,
      signal: options.signal,
    })
    if (result.code !== 0) return null
    return Number(result.stdout.trim())
  }

  /**
   * Read the repository's contributors, ranked by commit count.
   * @param options - limit and cancellation.
   * @returns contributor records.
   */
  async contributors(options = {}) {
    const limit = Number.isInteger(options.limit) ? options.limit : 50
    const result = await this.run(
      ['shortlog', '-sne', '--all', '--no-merges', 'HEAD'],
      { timeoutMs: 30_000, signal: options.signal },
    )
    if (result.code !== 0) return []
    const out = []
    for (const line of result.stdout.split('\n')) {
      const match = /^\s*(\d+)\t(.+?)\s*<([^>]*)>\s*$/.exec(line)
      if (match === null) continue
      out.push({ commits: Number(match[1]), name: match[2], email: match[3] })
      if (out.length >= limit) break
    }
    return out
  }
}

/** Normalize a raw log record into the shape the UI consumes. */
export function normalizeCommit(record) {
  return {
    sha: record.sha,
    shortSha: record.shortSha,
    author: record.author,
    authorEmail: record.authorEmail,
    authorDate: record.authorDate === '' ? null : Number(record.authorDate),
    committer: record.committer,
    committerEmail: record.committerEmail,
    committerDate: record.committerDate === '' ? null : Number(record.committerDate),
    parents: record.parents === '' ? [] : record.parents.split(' '),
    tips: normalizeTips(record.tips),
    subject: record.subject,
    message: record.message.replace(/\n+$/, ''),
    files: record.files ?? [],
  }
}

/**
 * Normalize a `%D` ref-decoration string into bare ref names.
 *
 * git emits `HEAD -> main, tag: v0.1.0, origin/main` — with a type prefix on
 * tags and an arrow for the checked-out branch. A UI that filters or colors by
 * ref name needs the names, not the decorations, and comparing against
 * `'tag: v0.1.0'` is exactly the kind of bug that looks like a missing tag.
 *
 * @param tips - the raw `%D` value, or a pre-split array.
 * @returns bare ref names, in git's order, without duplicates.
 */
export function normalizeTips(tips) {
  const parts = Array.isArray(tips)
    ? tips
    : String(tips ?? '')
        .split(', ')
  /** @type {string[]} */
  const out = []
  for (const raw of parts) {
    let name = String(raw).trim()
    if (name === '') continue
    if (name.startsWith('HEAD -> ')) name = name.slice('HEAD -> '.length).trim()
    if (name.startsWith('tag: ')) name = name.slice('tag: '.length).trim()
    if (name !== '' && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * Parse `git show --numstat -z` output.
 *
 * The `-z` form interleaves the format output, the numstat records, and the
 * commit message in a way that depends on git's internal ordering, so this
 * parser is anchored on the record separator rather than line positions.
 *
 * @param text - raw stdout.
 * @returns the commit plus its changed files.
 */
export function parseShowWithNumstat(text) {
  const keys = Object.keys(COMMIT_FIELDS)
  const records = parseLogRecords(text, keys)
  const commit = records[0] ?? {}
  const files = []
  // After the format fields the stdout carries `--numstat -z` records:
  // `<add>\t<del>\t<path>\0` and, for renames, `<origPath>\0` follows.
  const afterFormat = text.split('\x1e').slice(1).join('\x1e')
  const tokens = afterFormat.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const match = /(\d+|-)\t(\d+|-)\t([^\n]*)$/.exec(token)
    if (match === null) continue
    let path = match[3]
    let originalPath = null
    // Renames use an empty path followed by two NUL-delimited paths.
    if (path === '') {
      originalPath = tokens[i + 1]
      path = tokens[i + 2]
      if (!originalPath || !path) continue
      i += 2
    }
    files.push({
      path,
      originalPath,
      status: originalPath ? 'R' : 'M',
      added: match[1] === '-' ? null : Number(match[1]),
      deleted: match[2] === '-' ? null : Number(match[2]),
      binary: match[1] === '-',
    })
  }
  return { ...normalizeCommit({ ...commit, files: [] }), files }
}

/**
 * Parse the v1 `git status --porcelain` fallback for ancient gits.
 * @param text - raw stdout.
 * @returns branch facts and changed files.
 */
export function parseStatusV1(text) {
  const result = {
    branch: { oid: null, head: null, upstream: null, ahead: 0, behind: 0, detached: false },
    files: [],
  }
  for (const raw of String(text ?? '').split('\n')) {
    if (raw === '') continue
    if (raw.startsWith('## ')) {
      const body = raw.slice(3)
      const match = /^(?:No commits yet on )?([^.\s]+)(?:\.\.\.([^\s]+))?(?: \[(.+)\])?$/.exec(body)
      if (match !== null) {
        result.branch.head = match[1]
        result.branch.detached = match[1] === 'HEAD (no branch)'
        result.branch.upstream = match[2] ?? null
        const ab = match[3] ?? ''
        const ahead = /ahead (\d+)/.exec(ab)
        const behind = /behind (\d+)/.exec(ab)
        result.branch.ahead = ahead === null ? 0 : Number(ahead[1])
        result.branch.behind = behind === null ? 0 : Number(behind[1])
      }
      continue
    }
    const index = raw[0]
    const worktree = raw[1]
    const path = raw.slice(3)
    const kind = index === '?' ? 'untracked' : index === '!' ? 'ignored' : 'ordinary'
    result.files.push({
      path,
      originalPath: null,
      index,
      worktree,
      staged: index !== ' ' && index !== '?' && index !== '!',
      submodule: 'N...',
      score: null,
      kind,
    })
  }
  return result
}

/**
 * Discover or reuse a {@link RepoSession}.
 *
 * Sessions are cached per (root, gitPath) so capability probing and warm caches
 * survive across RPC calls — without this, every panel interaction would pay a
 * `git --version` plus a status probe.
 */
export class RepoRegistry {
  /**
   * @param options - registry wiring.
   */
  constructor(options = {}) {
    /** @type {Map<string, RepoSession>} */
    this.sessions = new Map()
    this.resolveGitPath = options.resolveGitPath ?? (() => resolveGitPath({ configured: options.gitPath }))
    this.logger = options.logger ?? null
    this.gitPath = options.gitPath ?? ''
  }

  /**
   * Resolve the git executable once and memoize it.
   * @returns the resolved path, or null.
   */
  async gitExecutable() {
    const resolved = await this.resolveGitPath()
    if (typeof resolved === 'string' && resolved !== '') {
      this.gitPath = resolved
      return resolved
    }
    return null
  }

  /**
   * Open the repository containing a directory.
   *
   * @param path - any directory inside (or equal to) a repository.
   * @param options - cancellation.
   * @returns the session, plus a reason when there is none.
   */
  async open(path, options = {}) {
    const gitPath = await this.gitExecutable()
    if (gitPath === null) {
      return { session: null, reason: 'git-not-found' }
    }
    const root = await resolveRepoRoot({ gitPath, cwd: path, signal: options.signal })
    if (root === null) {
      return { session: null, reason: 'not-a-repository' }
    }
    const key = `${gitPath}\u0000${root}`
    const existing = this.sessions.get(key)
    if (existing !== undefined) return { session: existing, reason: null }

    const [capabilities, identity, ignoreRevsFile] = await Promise.all([
      probeCapabilities({ gitPath, cwd: root, signal: options.signal }),
      resolveRepoIdentity({ gitPath, cwd: root, signal: options.signal }),
      resolveIgnoreRevsFile({ gitPath, cwd: root, signal: options.signal }),
    ])
    if (capabilities.ok !== true) {
      return { session: null, reason: 'git-unusable', error: capabilities.error }
    }
    const session = new RepoSession({
      root,
      identity,
      gitPath,
      capabilities,
      ignoreRevsFile,
      logger: this.logger,
    })
    this.sessions.set(key, session)
    this.logger?.info?.(`[git] repository opened (${capabilities.versionText})`)
    return { session, reason: null }
  }

  /**
   * Drop cached data for one repository, or every repository.
   * @param root - a repository root; omitted means all.
   * @param kinds - cache kinds to drop; omitted means all data caches.
   */
  invalidate(root, ...kinds) {
    for (const [key, session] of this.sessions) {
      if (root !== undefined && !key.endsWith(`\u0000${normalizeSlashes(root)}`)) continue
      session.cache.invalidate(...kinds)
    }
  }

  /** Every open session. */
  list() {
    return [...this.sessions.values()]
  }
}

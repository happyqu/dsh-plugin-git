/**
 * dsh-plugin-git — pure parsers for git plumbing output.
 *
 * Every function here is a pure `string -> data` transform with no I/O, so the
 * whole layer is unit-testable against captured git output. That matters: a
 * parser bug shows up as *wrong blame attribution*, which looks plausible and
 * is therefore worse than a crash.
 *
 * The blame parser follows `git blame --incremental`, which is what GitLens
 * itself uses (`git blame --root --incremental --encoding=utf-8`). Verified
 * shape on git 2.50.1:
 *
 *     5f3a1c… 2 2 3          <- sha originalLine resultLine [linesInGroup]
 *     author 张三
 *     author-mail <a@b>
 *     author-time 1790741262
 *     author-tz +0800
 *     committer …
 *     summary fix: 修改第二行
 *     previous 9a8b7c… src/old-name.js
 *     filename src/new-name.js
 *     5f3a1c… 4 4 1          <- same commit, later hunk: header repeats
 *
 * Unlike `--porcelain`, `--incremental` emits NO leading tab line, and a commit
 * header is repeated for each of its hunks (not only once). `previous` and
 * `filename` appear only when they carry information beyond the defaults.
 */

/** ASCII record/field separators, matching GitLens' own log protocol. */
export const RECORD_SEP = '\x1e'
export const FIELD_SEP = '\x1d'

/** The blame commit header line: `<sha> <orig> <result> [<count>]`. */
const BLAME_HEADER = /^([0-9a-f]{4,64}) (\d+) (\d+)(?: (\d+))?$/

/**
 * Parse `git blame --incremental` output into per-line attributions.
 *
 * @param text - raw stdout.
 * @returns one entry per attributed line, in result-line order.
 */
export function parseBlameIncremental(text) {
  const lines = String(text ?? '').split('\n')
  /** Commit metadata keyed by sha, so repeated hunks reuse one object. */
  const commits = new Map()
  const out = []
  let current = null

  for (const raw of lines) {
    if (raw === '') continue
    const header = BLAME_HEADER.exec(raw)
    if (header !== null) {
      const sha = header[1]
      let meta = commits.get(sha)
      if (meta === undefined) {
        meta = {
          sha,
          author: '',
          authorMail: '',
          authorTime: null,
          authorTz: '',
          committer: '',
          committerMail: '',
          committerTime: null,
          summary: '',
          previous: null,
          filename: null,
        }
        commits.set(sha, meta)
      }
      current = {
        sha,
        originalLine: Number(header[2]),
        resultLine: Number(header[3]),
        groupLines: Number(header[4] ?? 1),
      }
      // The header carries the FIRST line of the group; git then emits no more
      // headers until that group is exhausted. `--incremental` still repeats a
      // header for each later hunk of the same commit, which is exactly why we
      // key metadata by sha instead of rebuilding it.
      out.push(current)
      continue
    }

    if (current === null) continue
    const meta = commits.get(current.sha)

    const space = raw.indexOf(' ')
    if (space === -1) continue
    const key = raw.slice(0, space)
    const value = raw.slice(space + 1)

    switch (key) {
      case 'author': meta.author = value; break
      case 'author-mail': meta.authorMail = stripAngles(value); break
      case 'author-time': meta.authorTime = Number(value); break
      case 'author-tz': meta.authorTz = value; break
      case 'committer': meta.committer = value; break
      case 'committer-mail': meta.committerMail = stripAngles(value); break
      case 'committer-time': meta.committerTime = Number(value); break
      case 'summary': meta.summary = value; break
      case 'previous': {
        const at = value.indexOf(' ')
        if (at === -1) meta.previous = { sha: value, path: null }
        else meta.previous = { sha: value.slice(0, at), path: value.slice(at + 1) }
        break
      }
      case 'filename': meta.filename = value; break
      case 'boundary': break
      default: break
    }
  }

  const group = new Map()
  const result = []
  for (const entry of out) {
    const meta = commits.get(entry.sha)
    // Expand a multi-line group: git emits one header for `groupLines` lines.
    for (let i = 0; i < entry.groupLines; i++) {
      result.push({
        line: entry.resultLine + i,
        originalLine: entry.originalLine + i,
        sha: entry.sha,
        author: meta.author,
        authorMail: meta.authorMail,
        authorTime: meta.authorTime,
        authorTz: meta.authorTz,
        summary: meta.summary,
        previous: meta.previous,
        filename: meta.filename,
      })
    }
    group.set(entry.sha, (group.get(entry.sha) ?? 0) + entry.groupLines)
  }

  result.sort((a, b) => a.line - b.line)
  return { lines: result, byCommit: group }
}

/** Remove the angle brackets git puts around emails. */
function stripAngles(value) {
  const text = String(value ?? '')
  return text.startsWith('<') && text.endsWith('>') ? text.slice(1, -1) : text
}

/**
 * Parse `git status --porcelain=v2 --branch`.
 *
 * Line kinds (from git-status(1)): `#` header, `1` ordinary, `2` rename/copy,
 * `u` unmerged, `?` untracked, `!` ignored.
 *
 * @param text - raw stdout.
 * @returns branch facts plus one entry per changed path.
 */
export function parseStatusV2(text) {
  const result = {
    branch: { oid: null, head: null, upstream: null, ahead: 0, behind: 0, detached: false },
    files: [],
  }

  for (const raw of String(text ?? '').split('\n')) {
    if (raw === '') continue

    if (raw.startsWith('# ')) {
      const body = raw.slice(2)
      const space = body.indexOf(' ')
      const key = space === -1 ? body : body.slice(0, space)
      const value = space === -1 ? '' : body.slice(space + 1)
      if (key === 'branch.oid') {
        result.branch.oid = value === '(initial)' ? null : value
      } else if (key === 'branch.head') {
        result.branch.detached = value === '(detached)'
        result.branch.head = value
      } else if (key === 'branch.upstream') {
        result.branch.upstream = value
      } else if (key === 'branch.ab') {
        const match = /\+(\d+) -(\d+)/.exec(value)
        if (match !== null) {
          result.branch.ahead = Number(match[1])
          result.branch.behind = Number(match[2])
        }
      }
      continue
    }

    const kind = raw[0]
    if (kind === '1') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = raw.split(' ')
      if (parts.length < 9) continue
      result.files.push({
        path: parts.slice(8).join(' '),
        originalPath: null,
        index: parts[1][0],
        worktree: parts[1][1],
        staged: parts[1][0] !== '.',
        submodule: parts[2],
        score: null,
        kind: 'ordinary',
      })
      continue
    }
    if (kind === '2') {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>
      const parts = raw.split(' ')
      if (parts.length < 10) continue
      const tail = parts.slice(9).join(' ')
      const tab = tail.indexOf('\t')
      result.files.push({
        path: tab === -1 ? tail : tail.slice(0, tab),
        originalPath: tab === -1 ? null : tail.slice(tab + 1),
        index: parts[1][0],
        worktree: parts[1][1],
        staged: parts[1][0] !== '.',
        submodule: parts[2],
        score: parts[8],
        kind: 'renamed',
      })
      continue
    }
    if (kind === 'u') {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = raw.split(' ')
      if (parts.length < 11) continue
      result.files.push({
        path: parts.slice(10).join(' '),
        originalPath: null,
        index: parts[1][0],
        worktree: parts[1][1],
        staged: true,
        submodule: parts[2],
        score: null,
        kind: 'unmerged',
      })
      continue
    }
    if (kind === '?' || kind === '!') {
      result.files.push({
        path: raw.slice(2),
        originalPath: null,
        index: kind === '?' ? '?' : '!',
        worktree: kind === '?' ? '?' : '!',
        staged: false,
        submodule: 'N...',
        score: null,
        kind: kind === '?' ? 'untracked' : 'ignored',
      })
    }
  }

  return result
}

/**
 * Build the `--format` string for {@link parseLogRecords}.
 *
 * Field order is fixed by the caller's spec object, and the separators are
 * ASCII control characters rather than `|` because `%B` (a full commit
 * message) contains newlines and `--summary` emits file names — any printable
 * separator can occur inside the data.
 *
 * @param fields - ordered map of output key to git placeholder.
 * @returns a `--format=` value.
 */
export function buildLogFormat(fields) {
  let out = RECORD_SEP
  for (const placeholder of Object.values(fields)) {
    out += `${placeholder}${FIELD_SEP}`
  }
  return out
}

/**
 * Parse `git log` output produced with {@link buildLogFormat}.
 *
 * @param text - raw stdout.
 * @param keys - the same key order used to build the format.
 * @returns one record per commit; `files` is filled from `--summary` lines.
 */
export function parseLogRecords(text, keys) {
  const records = []
  for (const chunk of String(text ?? '').split(RECORD_SEP)) {
    if (chunk.trim() === '') continue
    const fields = chunk.split(FIELD_SEP)
    const record = {}
    for (let i = 0; i < keys.length; i++) record[keys[i]] = fields[i] ?? ''
    // Everything past the declared fields is the --summary block, terminated by
    // the NUL or newline git appends after the format.
    const trailing = fields.slice(keys.length).join(FIELD_SEP)
    record.files = parseNameStatusSummary(trailing)
    records.push(record)
  }
  return records
}

/**
 * Parse the `--summary` block that follows `--format` output.
 *
 * Lines look like ` create mode 100644 src/new.js`, ` rename src/{old => new}.js (98%)`,
 * or a bare path list depending on the command. We read the structural
 * `create`/`delete`/`rename`/`mode change` forms and ignore anything else.
 *
 * @param text - the trailing block.
 * @returns parsed file summaries.
 */
export function parseNameStatusSummary(text) {
  const files = []
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const create = /^create mode (\d+) (.+)$/.exec(line)
    if (create !== null) {
      files.push({ path: create[2], status: 'A', from: null })
      continue
    }
    const del = /^delete mode (\d+) (.+)$/.exec(line)
    if (del !== null) {
      files.push({ path: del[2], status: 'D', from: null })
      continue
    }
    const rename = /^rename (.+?)(?: \((\d+)%\))?$/.exec(line)
    if (rename !== null) {
      const parsed = splitBraceRename(rename[1])
      files.push({ path: parsed.to, status: 'R', from: parsed.from })
    }
  }
  return files
}

/**
 * Expand git's brace rename notation `src/{old => new}.js`.
 * @param text - the path expression.
 * @returns the two absolute paths.
 */
export function splitBraceRename(text) {
  const open = text.indexOf('{')
  const close = text.indexOf('}', open + 1)
  if (open === -1 || close === -1) {
    const arrow = text.indexOf(' => ')
    if (arrow === -1) return { from: text, to: text }
    return { from: text.slice(0, arrow), to: text.slice(arrow + 4) }
  }
  const prefix = text.slice(0, open)
  const middle = text.slice(open + 1, close)
  const suffix = text.slice(close + 1)
  const arrow = middle.indexOf(' => ')
  const from = arrow === -1 ? middle : middle.slice(0, arrow)
  const to = arrow === -1 ? middle : middle.slice(arrow + 4)
  return { from: `${prefix}${from}${suffix}`, to: `${prefix}${to}${suffix}` }
}

/**
 * Parse `git log --name-status` output where the format ends each record with
 * `RECORD_SEP` and the status lines follow.
 *
 * @param text - raw stdout.
 * @param keys - declared field keys, in format order.
 * @returns records with a `files` array of `{ path, from, status }`.
 */
export function parseLogWithNameStatus(text, keys) {
  const records = []
  for (const chunk of String(text ?? '').split(RECORD_SEP)) {
    if (chunk.trim() === '') continue
    const fields = chunk.split(FIELD_SEP)
    const record = {}
    for (let i = 0; i < keys.length; i++) record[keys[i]] = fields[i] ?? ''
    const trailing = fields.slice(keys.length).join(FIELD_SEP)
    record.files = []
    for (const raw of trailing.split('\n')) {
      const line = raw.replace(/\r$/, '')
      if (line.trim() === '') continue
      const match = /^([A-Z])(\d*)\t(.*)$/.exec(line)
      if (match === null) continue
      const rest = match[3]
      const tab = rest.indexOf('\t')
      if (match[1] === 'R' || match[1] === 'C') {
        record.files.push({
          status: match[1],
          from: tab === -1 ? null : rest.slice(0, tab),
          path: tab === -1 ? rest : rest.slice(tab + 1),
        })
      } else {
        record.files.push({ status: match[1], from: null, path: rest })
      }
    }
    records.push(record)
  }
  return records
}

/**
 * Parse `git diff --numstat` / `git diff --numstat -z` output.
 * @param text - raw stdout.
 * @returns per-file added/deleted counts; `-` counts mean binary.
 */
export function parseNumstat(text) {
  const out = []
  for (const raw of String(text ?? '').split('\n')) {
    if (raw.trim() === '') continue
    const parts = raw.split('\t')
    if (parts.length < 3) continue
    out.push({
      added: parts[0] === '-' ? null : Number(parts[0]),
      deleted: parts[1] === '-' ? null : Number(parts[1]),
      path: parts.slice(2).join('\t'),
      binary: parts[0] === '-',
    })
  }
  return out
}

/**
 * Parse a unified diff into hunks.
 *
 * @param text - raw `git diff` output.
 * @returns hunks with 1-based line coordinates and raw ` `, `+`, `-` lines.
 */
export function parseUnifiedDiff(text) {
  const hunks = []
  let current = null
  for (const raw of String(text ?? '').split('\n')) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw)
    if (header !== null) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      }
      hunks.push(current)
      continue
    }
    if (current === null) continue
    if (raw.startsWith('\\')) continue // "\ No newline at end of file"
    if (raw.startsWith('+') || raw.startsWith('-') || raw.startsWith(' ')) {
      current.lines.push(raw)
    }
  }
  return hunks
}

/**
 * Parse `git for-each-ref` output built from record/field separators.
 * @param text - raw stdout.
 * @param keys - declared field keys, in format order.
 * @returns one record per ref.
 */
export function parseForEachRef(text, keys) {
  const out = []
  for (const raw of String(text ?? '').split('\n')) {
    if (raw.trim() === '') continue
    const parts = raw.split(FIELD_SEP)
    const record = {}
    for (let i = 0; i < keys.length; i++) record[keys[i]] = parts[i] ?? ''
    out.push(record)
  }
  return out
}

/**
 * Parse `git worktree list --porcelain`.
 * @param text - raw stdout.
 * @returns one entry per worktree.
 */
export function parseWorktrees(text) {
  const out = []
  let current = null
  for (const raw of String(text ?? '').split('\n')) {
    if (raw.startsWith('worktree ')) {
      current = { path: raw.slice('worktree '.length), head: null, branch: null, bare: false, detached: false }
      out.push(current)
      continue
    }
    if (current === null) continue
    if (raw.startsWith('HEAD ')) current.head = raw.slice(5)
    else if (raw.startsWith('branch ')) current.branch = raw.slice(7)
    else if (raw === 'bare') current.bare = true
    else if (raw === 'detached') current.detached = true
  }
  return out
}

/**
 * Parse `git stash list --format=…` output.
 * @param text - raw stdout.
 * @param keys - declared field keys.
 * @returns one record per stash entry.
 */
export function parseStashList(text, keys) {
  const out = []
  for (const raw of String(text ?? '').split('\n')) {
    if (raw.trim() === '') continue
    const parts = raw.split(FIELD_SEP)
    const record = {}
    for (let i = 0; i < keys.length; i++) record[keys[i]] = parts[i] ?? ''
    out.push(record)
  }
  return out
}

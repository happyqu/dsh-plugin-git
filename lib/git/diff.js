/**
 * dsh-plugin-git — diff and file-content reads.
 *
 * The hunks produced here use the exact shape DSH already speaks for workspace
 * changes (`{ oldStart, oldLines, newStart, newLines, lines }`), so the panel can
 * reuse one renderer for "what the agent changed" and "what git shows".
 */
import { git } from './exec.js'
import { parseUnifiedDiff } from './parse.js'
import { readLfsObject } from './lfsObjects.js'
import { withHunkFingerprint } from './hunkFingerprint.js'

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
  // Colour is disabled in exec.js. An explicit similarity threshold keeps
  // rename detection stable across repositories with different configuration.
  const similarity = Number.isFinite(request.similarityThreshold)
    ? Math.min(Math.max(Math.round(request.similarityThreshold), 1), 100)
    : 50
  const args = ['diff', '--no-ext-diff', '--no-textconv', `--find-renames=${similarity}%`]
  if (Number.isInteger(request.contextLines)) args.push(`-U${request.contextLines}`)
  if (request.ignoreAllSpace === true) args.push('-w')
  else if (request.ignoreWhitespace === true) args.push('-b')
  if (request.wordDiff === true) args.push('--word-diff=plain')
  if (request.algorithm === 'histogram' || request.algorithm === 'patience') args.push(`--diff-algorithm=${request.algorithm}`)
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
 * The largest diff, in bytes of unified-diff text, this plugin will produce.
 *
 * Output is stopped at 2 MiB or 20,000 lines, before parsing or sending it.
 * History previews omit duplicate raw text and top-level hunks; callers that
 * copy patches still receive the text. Oversized output is explicitly refused,
 * never shown as a complete patch or as an empty difference.
 */
export const DIFF_MAX_BYTES = 2 * 1024 * 1024
export const DIFF_MAX_LINES = 20000
const FILE_MAX_BYTES = 4 * 1024 * 1024

/** Stop reading oversized output before buffering or serialising it to the UI. */
export async function boundedRead(repo, args, options, maxBytes, maxLines = Infinity) {
  let text = '', bytes = 0, lines = 0, tooLarge = false
  const accept = chunk => {
    bytes += Buffer.byteLength(chunk, 'utf8')
    for (let index = 0; index < chunk.length; index++) if (chunk.charCodeAt(index) === 10) lines++
    if (bytes > maxBytes || lines > maxLines) { tooLarge = true; text = ''; return false }
    text += chunk
    return true
  }
  const result = await repo.run(args, { ...options, onStdout: accept })
  // Accommodate runners that return buffered output instead of streaming it.
  if (result.stdout) accept(result.stdout)
  if (options.signal?.aborted) throw new Error('Git read cancelled')
  return { ...result, stdout: text, tooLarge, bytes, lineLimit: lines > maxLines }
}

/**
 * The result shape for a diff too large to send.
 *
 * Exported so every path that turns git output into a panel payload applies the
 * same cap. The panel distinguishes "no differences" from "too large" by
 * `tooLarge`, and would otherwise show an oversized diff as an empty one.
 *
 * @param bytes - the size of the diff that was refused.
 * @returns the refused-diff result.
 */
export function tooLargeDiff(bytes) {
  return { text: '', hunks: [], files: [], truncated: true, tooLarge: true, bytes, trimmed: true }
}

/**
 * Drop the per-file copy of the patch text.
 *
 * `splitDiffByFile` accumulates each file's raw section, so a diff crosses the
 * wire THREE times over: as the top-level `text`, as the top-level `hunks`, and
 * again inside every `files[]` entry. Measured on a 19 MB diff that produced a
 * 78 MB JSON payload — a 4x amplification that the panel then has to receive,
 * parse and hold.
 *
 * The top-level `text` must stay (copy-patch reads it) and the top-level `hunks`
 * must stay (the diff viewer falls back to it). The per-file `text` is read by
 * nothing: every consumer of `files[]` uses path/status/from/binary/hunks.
 *
 * @param files - the parsed file entries.
 * @returns the same entries without their `text` field.
 */
function withoutFileText(files) {
  return files.map((file) => {
    const { text, ...rest } = file
    return rest
  })
}

/**
 * Cap a diff result that was assembled outside {@link diff}.
 *
 * The stash reader builds its patch by concatenating several git calls, so it
 * cannot go through `diff()`; this keeps the two paths from diverging.
 *
 * @param text - the assembled unified diff.
 * @returns the same shape `diff()` returns.
 */
export function diffResult(text) {
  const value = String(text ?? '')
  const bytes = Buffer.byteLength(value, 'utf8')
  if (bytes > DIFF_MAX_BYTES) return tooLargeDiff(bytes)
  let lines = 0
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) === 10 && ++lines > DIFF_MAX_LINES) return { ...tooLargeDiff(bytes), lineLimit: true }
  }
  return {
    text: value,
    hunks: parseUnifiedDiff(value).map(withHunkFingerprint),
    files: withoutFileText(splitDiffByFile(value)),
    truncated: false,
    trimmed: false,
  }
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
  // Bound streamed output before parsing it, including tiny-line files whose
  // object count would otherwise dwarf their byte size.
  const result = await boundedRead(repo, args, {
    timeoutMs: 45_000,
    signal: options.signal,
    maxBuffer: DIFF_MAX_BYTES + 4 * 1024 * 1024,
  }, DIFF_MAX_BYTES, DIFF_MAX_LINES)
  if (result.tooLarge) return { ...tooLargeDiff(result.bytes), lineLimit: result.lineLimit }
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git diff 退出码 ${result.code}`)
  }
  const text = result.stdout
  if (text.length > DIFF_MAX_BYTES) return tooLargeDiff(text.length)
  const files = withoutFileText(splitDiffByFile(text, { wordDiff: request.wordDiff === true }))
  return {
    text: request.previewOnly === true ? '' : text,
    hunks: request.previewOnly === true ? [] : request.wordDiff === true
      ? files.flatMap(file => file.hunks) : parseUnifiedDiff(text).map(withHunkFingerprint),
    files,
    truncated: false,
    trimmed: result.code !== 0,
  }
}

/**
 * Decode one side of a `diff --git` header, quoted or not.
 *
 * `core.quotepath=false` only stops git escaping NON-ASCII names. A path
 * containing a quote, a tab, a newline, a backslash or a control character is
 * still C-quoted — `"tab\tchar.txt"` — because there is no other way to write it
 * on one line. The header regex used to strip just the surrounding quotes and
 * keep the escapes, so the parsed path was the literal text `tab\tchar.txt`:
 * it matched no status entry, no `--` filter, and no stageable file.
 *
 * C-quoting uses `\a \b \t \n \v \f \r \" \\` and three-digit OCTAL for
 * everything else, so the decode is a single pass with no lookahead games.
 *
 * @param raw - the quoted or bare path, as git wrote it.
 * @returns the real path.
 */
function unquoteGitPath(raw) {
  const value = String(raw ?? '')
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value
  const body = value.slice(1, -1)
  const simple = { a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r', '"': '"', '\\': '\\' }
  let out = ''
  for (let index = 0; index < body.length; index++) {
    const char = body[index]
    if (char !== '\\') { out += char; continue }
    const next = body[index + 1]
    if (next !== undefined && simple[next] !== undefined) { out += simple[next]; index += 1; continue }
    // Octal escapes are always three digits, so the window is unambiguous.
    const octal = body.slice(index + 1, index + 4)
    if (/^[0-7]{3}$/.test(octal)) { out += String.fromCharCode(Number.parseInt(octal, 8)); index += 3; continue }
    // An unknown escape is left as written rather than dropped: silently
    // deleting characters from a path is worse than showing the escape.
    out += char
  }
  return out
}

/**
 * Split one `diff --git` header into its two sides.
 *
 * The line is `diff --git <a> <b>` where either side may be C-quoted, and a
 * quoted side can itself contain the space that would otherwise be the
 * separator. Scanning for the closing quote is therefore the only reliable way
 * to find the boundary; a `"?a\/(.+?)"?` regex cannot do it once the path holds
 * an escaped quote.
 *
 * Exported because chunk splitting parses the same headers, and a second copy of
 * this logic would eventually disagree with the renderer about which file a
 * section belongs to.
 *
 * @param line - the header line.
 * @returns `{ from, to }` decoded paths, or null when the line is not a header.
 */
export function parseDiffHeader(line) {
  const prefix = 'diff --git '
  if (!line.startsWith(prefix)) return null
  const rest = line.slice(prefix.length)
  const readSide = (text) => {
    if (text.startsWith('"')) {
      // Walk to the closing quote, skipping escaped characters.
      for (let index = 1; index < text.length; index++) {
        if (text[index] === '\\') { index += 1; continue }
        if (text[index] === '"') return { value: text.slice(0, index + 1), end: index + 1 }
      }
      return null
    }
    const space = text.indexOf(' ')
    const end = space === -1 ? text.length : space
    return { value: text.slice(0, end), end }
  }
  const left = readSide(rest)
  if (left === null) return null
  const remainder = rest.slice(left.end).replace(/^\s+/, '')
  const right = readSide(remainder)
  if (right === null) return null
  const strip = (side) => unquoteGitPath(side).replace(/^[ab]\//, '')
  return { from: strip(left.value), to: strip(right.value) }
}

/**
 * The path on a `--- a/<path>` / `+++ b/<path>` line, decoded and un-prefixed.
 *
 * These lines are the authoritative source for a section's path, and they exist
 * precisely because the `diff --git` line is ambiguous: git writes that line
 * WITHOUT quoting a name that merely contains a space, so
 * `diff --git a/plain file.txt b/plain file.txt` has no parseable boundary — it
 * could equally be `a/plain` → `file.txt b/plain file.txt`. `---`/`+++` end the
 * path with a TAB (or the line end), which is unambiguous.
 *
 * @param line - the raw `--- ` or `+++ ` line.
 * @returns the path, or null for `/dev/null` and anything unusable.
 */
function diffBodyPath(line) {
  const marker = line.slice(0, 4)
  if (marker !== '--- ' && marker !== '+++ ') return null
  // Strip the trailing tab git appends when the name itself may contain spaces.
  let value = line.slice(4).replace(/\t$/, '')
  if (value === '/dev/null') return null
  value = unquoteGitPath(value)
  return value.replace(/^[ab]\//, '')
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
export function splitDiffByFile(text, options = {}) {
  const out = []
  let current = null
  const lines = String(text ?? '').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    const header = parseDiffHeader(raw)
    if (header !== null) {
      if (current !== null) out.push(current)
      current = {
        from: header.from === header.to ? null : header.from,
        path: header.to,
        status: 'M',
        binary: false,
        hunks: [],
        text: raw,
      }
      continue
    }
    if (current === null) continue
    current.text += `\n${raw}`
    // `+++` wins over the header line whenever it is present: it is the only
    // form git cannot make ambiguous, and a binary or pure-mode section that has
    // no `+++` simply keeps the header's answer.
    const bodyPath = diffBodyPath(raw)
    if (bodyPath !== null && raw.startsWith('+++ ')) {
      current.path = bodyPath
      current.from = bodyPath === current.from ? null : current.from
    } else if (bodyPath !== null) {
      current.from = bodyPath === current.path ? null : bodyPath
    }
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
        ...(options.wordDiff ? { wordDiff: true } : {}),
      })
      continue
    }
    const last = current.hunks[current.hunks.length - 1]
    if (last !== undefined && options.wordDiff) {
      // Plain word diffs omit unified-diff prefixes. Preserve their inline markers
      // and blank lines; they are display text, never an applicable patch.
      if (!/^\\ No newline at end of file\r?$/.test(raw) && !(index === lines.length - 1 && raw === '')) last.lines.push(' ' + raw)
    } else if (last !== undefined && (raw.startsWith('+') || raw.startsWith('-') || raw.startsWith(' '))) {
      last.lines.push(raw)
    }
  }
  if (current !== null) out.push(current)
  for (const file of out) file.hunks = file.hunks.map(withHunkFingerprint)
  return out
}

/**
 * Image formats the preview can render, keyed by extension.
 *
 * SVG is deliberately absent: it is XML, so it already previews as highlighted
 * text, and inlining it as a data URL would let a repository's markup execute
 * script in the panel's origin. The raster formats below cannot.
 */
const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

/** Upper bound on an inlined image; base64 inflates this by ~4/3. */
const IMAGE_MAX_BYTES = 8 * 1024 * 1024

/** The MIME type for a path when it is a previewable raster image. */
export function imageMimeFor(path) {
  const name = String(path ?? '')
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return IMAGE_MIME[name.slice(dot + 1).toLowerCase()] ?? null
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
  const object = rev === 'INDEX' ? `:${request.path}` : `${rev}:${request.path}`
  const mime = imageMimeFor(request.path)
  if (mime !== null) return readImage(repo, object, mime, options)
  const result = await boundedRead(repo, ['show', object], {
    timeoutMs: 20_000,
    signal: options.signal,
    maxBuffer: 8 * 1024 * 1024,
  }, FILE_MAX_BYTES, DIFF_MAX_LINES)
  if (result.tooLarge) return { exists: true, text: '', binary: false, truncated: true, size: result.bytes, error: null }
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

/** Matches a Git LFS pointer file, whose "content" is metadata, not pixels. */
const LFS_POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\n(?:ext-[^\n]*\r?\n)*oid sha256:[a-f0-9]{64}\r?\nsize \d+\s*$/

/** Resolve pointers from the local object cache; preview never downloads. */
async function readLfsImage(repo, pointer, mime, options) {
  const object = await readLfsObject(repo, pointer, IMAGE_MAX_BYTES, options)
  const missing = { exists: true, text: pointer, binary: false, truncated: false, lfsOid: object?.oid, size: object?.size, error: object?.error || null }
  if (!object) return missing
  if (object.tooLarge) return { ...missing, text: '', binary: true, truncated: true, image: null }
  if (!object.bytes) return missing
  return { ...missing, text: '', binary: true, image: `data:${mime};base64,${object.bytes.toString('base64')}` }
}
/**
 * Read an image blob and return it as a data URL the panel can render.
 *
 * Reading bytes rather than text is the whole point: a PNG contains NUL bytes,
 * so the text path classified every image as "binary" and the viewer could only
 * apologise. The bytes are inlined as a data URL because the panel has no
 * authenticated file route of its own, and a `blob:` URL would leak across the
 * panel's lifetime. `data:image/*` cannot carry a script, so this is safe for
 * the raster formats {@link IMAGE_MIME} allows.
 *
 * @param repo - the repository session.
 * @param object - the git object to read, e.g. `HEAD:logo.png`.
 * @param mime - the image MIME type for the path.
 * @param options - cancellation.
 * @returns the data URL under `image`, plus size facts.
 */
async function readImage(repo, object, mime, options) {
  const result = await repo.run(['show', object], {
    timeoutMs: 20_000,
    signal: options.signal,
    maxBuffer: IMAGE_MAX_BYTES + 1024 * 1024,
    encoding: 'buffer',
  })
  if (result.code !== 0) {
    return { exists: false, text: '', binary: false, truncated: false, error: result.stderr.trim() }
  }
  const buffer = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '')
  if (buffer.length === 0) {
    return { exists: false, text: '', binary: false, truncated: false, error: null }
  }
  // Resolve pixels from the local LFS cache. Keep the pointer when missing so
  // the viewer can offer to download the content without showing a broken image.
  const head = buffer.subarray(0, 512).toString('utf8')
  if (LFS_POINTER.test(head)) {
    return readLfsImage(repo, head, mime, options)
  }
  if (buffer.length > IMAGE_MAX_BYTES) {
    return { exists: true, text: '', binary: true, truncated: true, image: null, error: 'image exceeds 8 MiB' }
  }
  return {
    exists: true,
    text: '',
    binary: true,
    truncated: false,
    image: `data:${mime};base64,${buffer.toString('base64')}`,
    size: buffer.length,
    error: null,
  }
}

/**
 * Read both sides of an image change, for a side-by-side comparison.
 *
 * `git diff` reports an image as "Binary files differ" and nothing else, which
 * is why an image change used to be unreadable in the panel. Both sides are read
 * as bytes so the viewer can put them next to each other.
 *
 * A missing side is not an error: an added or deleted image legitimately has
 * only one, and the caller renders it against an empty slot.
 *
 * @param repo - the repository session.
 * @param request - `{ path, oldPath, from, to }`; a null rev means the working tree.
 * @param options - cancellation.
 * @returns `{ image: false }` for a non-image, else both sides plus a changed flag.
 */
export async function imageDiff(repo, request, options = {}) {
  const mime = imageMimeFor(request.path)
  if (mime === null) return { image: false }
  const from = typeof request.from === 'string' && request.from !== '' ? request.from : null
  const to = typeof request.to === 'string' && request.to !== '' ? request.to : null
  // A rename shows the two sides under different names.
  const beforePath = typeof request.oldPath === 'string' && request.oldPath !== '' ? request.oldPath : request.path
  const side = async (path, rev) => {
    if (rev === 'EMPTY') return { exists: false, image: null, size: null, pointer: false }
    try {
      const value = await fileContent(repo, { path, rev: rev === null ? undefined : rev }, options)
      if (value.exists !== true) return { exists: false, image: null, size: null, pointer: false }
      // A side that came back as text is an LFS pointer whose pixels were never
      // downloaded; saying so is far more useful than an empty frame.
      const pointer = value.image === undefined && LFS_POINTER.test(String(value.text ?? '').trim())
      return { exists: true, image: value.image ?? null, size: value.size ?? null, truncated: value.truncated === true, pointer, oid: value.lfsOid || null, error: value.error || null }
    } catch (error) {
      if (options.signal?.aborted) throw error
      return { exists: false, image: null, size: null, pointer: false, error: error.message }
    }
  }
  const [before, after] = await Promise.all([side(beforePath, from), side(request.path, to)])
  if (before.exists !== true && after.exists !== true) {
    return { image: true, exists: false, before, after, changed: false }
  }
  // Compare the encoded bytes: identical images produce identical data URLs, and
  // a re-encode that changes nothing pixel-wise still legitimately differs.
  const changed = before.image && after.image ? before.image !== after.image
    : before.exists !== after.exists || before.image !== after.image || before.oid !== after.oid
  return { image: true, exists: true, before, after, changed }
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
    const mime = imageMimeFor(path)
    // An image is read as bytes and inlined; only other files are decoded as
    // text, where a NUL byte really does mean "cannot be shown".
    if (mime !== null) {
      if (info.size > IMAGE_MAX_BYTES) {
        return { exists: true, text: '', binary: true, truncated: true, image: null, error: 'image exceeds 8 MiB' }
      }
      const bytes = await readFile(absolute, { signal: options.signal })
      // A worktree pointer can still have pixels in the local LFS cache.
      const head = bytes.subarray(0, 512).toString('utf8')
      if (LFS_POINTER.test(head)) {
        return await readLfsImage(repo, head, mime, options)
      }
      return {
        exists: true,
        text: '',
        binary: true,
        truncated: false,
        image: `data:${mime};base64,${bytes.toString('base64')}`,
        size: bytes.length,
        error: null,
      }
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

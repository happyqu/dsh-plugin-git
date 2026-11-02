/**
 * dsh-plugin-git — hunk-level staging, unstaging and discarding.
 *
 * The plugin could only ever stage or discard a WHOLE file. That is the wrong
 * granularity for how changes actually arrive: a file usually carries one intended
 * change plus a debug print, a stray formatting fix and a half-finished idea. Without
 * hunk-level control the user either commits all of it or reverts their editor and
 * redoes it.
 *
 * The mechanism is the one git's own `add -p` uses: build a patch containing a SUBSET of
 * the file's hunks and hand it to `git apply --cached`. Three details make that safe
 * rather than clever:
 *
 * 1. **Every operation re-reads the diff it is about to act on.** The hashes the UI
 *    ticked are compared against the current diff before anything is applied. A file
 *    that changed between render and click is refused, because applying a patch whose
 *    line numbers refer to different content can SUCCEED while producing the wrong
 *    result — the one failure mode worse than refusing.
 * 2. **Only whole hunks.** Partial hunk selection (git's `e`/`s` in `add -p`) needs an
 *    interactive line editor, and the result depends on hunks being recomputed after
 *    every edit. Whole hunks cover the real workflow and stay verifiable.
 * 3. **The patch is byte-identical to git's own output.** The header and hunk bodies are
 *    copied verbatim; only the hunk SET changes. That is what lets `--recount` and the
 *    index's own line numbers agree.
 *
 * Unsplittable shapes are named rather than half-applied: a binary file, a rename and a
 * conflict are all "manage this as a whole file".
 */
import { createHash } from 'node:crypto'

import { isSafePath } from './write.js'
import { parseUnifiedDiff } from './parse.js'
import { withHunkFingerprint } from './hunkFingerprint.js'
import { boundedRead, DIFF_MAX_BYTES, DIFF_MAX_LINES } from './diff.js'

/** Field-free fingerprint of one hunk's changed lines. */
function hunkHash(hunk) {
  return createHash('sha256').update(hunk.header + '\n' + hunk.lines.join('\n')).digest('hex')
}

/**
 * Split one file's `git diff` output into a reusable header and its hunks.
 *
 * The header (everything before the first `@@`) is kept verbatim because it names the
 * file, the index blobs and the mode — dropping any of it would change what the patch
 * means.
 *
 * **`\ No newline at end of file` is NOT a content line.** git emits it between the
 * last line of each side when that side lacks a trailing newline, which in a
 * two-sided change puts it in the MIDDLE of the hunk body. Keeping it in `lines`
 * made this list's indices disagree with what the diff renderer shows — it drops
 * the marker, because it is not a line of the file — and that mismatch silently
 * staged the WRONG line (select the last addition, get the one before it). The
 * markers are recorded separately as `{ at, text }` offsets so a whole-hunk patch
 * still reproduces git's output byte for byte.
 *
 * @param text - the raw diff for a single path.
 * @returns `{ header, hunks }`, where each hunk is `{ header, lines, markers, hash }`.
 */
export function splitHunks(text) {
  const lines = String(text ?? '').split('\n')
  const header = []
  const hunks = []
  let current = null
  for (const line of lines) {
    if (/^@@ /.test(line)) {
      current = { header: line, lines: [], markers: [] }
      hunks.push(current)
    } else if (current !== null) {
      // The trailing empty element from the final newline is not a content line.
      if (line === '' && current.lines.length === 0) continue
      if (line.startsWith('\\')) {
        // Positioned between content lines: remember where it belongs without
        // letting it occupy an index the renderer will never show.
        current.markers.push({ at: current.lines.length, text: line })
        continue
      }
      current.lines.push(line)
    } else {
      header.push(line)
    }
  }
  // A hunk body ends before the trailing newline of the patch, so one empty element
  // accumulates there; dropping it keeps the reconstructed patch byte-identical.
  while (hunks.length > 0 && hunks[hunks.length - 1].lines.at(-1) === '') hunks[hunks.length - 1].lines.pop()
  for (const hunk of hunks) hunk.hash = hunkHash(hunk)
  return { header: header.join('\n'), hunks }
}

/** Re-insert a hunk's no-newline markers so the body matches git byte for byte. */
function hunkBody(hunk) {
  if (hunk.markers === undefined || hunk.markers.length === 0) return hunk.lines.join('\n')
  const out = []
  const byOffset = new Map()
  for (const marker of hunk.markers) {
    const list = byOffset.get(marker.at) || []
    list.push(marker.text)
    byOffset.set(marker.at, list)
  }
  for (let index = 0; index <= hunk.lines.length; index++) {
    for (const text of byOffset.get(index) || []) out.push(text)
    if (index < hunk.lines.length) out.push(hunk.lines[index])
  }
  return out.join('\n')
}

/**
 * Build the patch that applies exactly the selected hunks.
 *
 * `--recount` is passed by the callers so a hunk whose neighbours were left out still
 * applies at the right offset; the hunk headers stay as git wrote them, which is what
 * keeps the line numbers meaningful to anyone reading the patch.
 *
 * @param diff - the result of {@link splitHunks}.
 * @param selected - the fingerprints to include.
 * @returns the patch text, or '' when nothing is selected.
 */
export function hunksPatch(diff, selected) {
  const wanted = new Set(selected)
  const chosen = diff.hunks.filter(hunk => wanted.has(hunk.hash))
  if (chosen.length === 0) return ''
  return diff.header + '\n' + chosen.map(hunk => hunk.header + '\n' + hunkBody(hunk)).join('\n') + '\n'
}

/**
 * Keep only the asked-for change lines of ONE hunk, turning the rest into context.
 *
 * This is the line-level counterpart of {@link hunksPatch}. git's own `add -p`
 * does the same thing with its `e` command: an unselected added line stops being
 * an addition and is re-emitted as a context line, an unselected removed line
 * stops being a removal and is not emitted at all (it survives in the result),
 * and every affected hunk header is rewritten with the new counts.
 *
 * Two safety rules, both learned from how silently this can go wrong:
 *
 * - **The removed lines of an unselected chunk survive as context.** They exist
 *   in BOTH the old and the new side, so dropping them from the patch would
 *   shift every later line of the result.
 * - **A hunk whose every change was deselected is dropped entirely.** Emitting
 *   it as pure context would ask git to apply a hunk that changes nothing.
 *
 * @param hunk - one `{ header, lines }` entry from {@link splitHunks}.
 * @param selected - indices INTO `hunk.lines` of the change lines to keep.
 * @returns the rewritten `{ header, lines }`, or null when nothing is selected.
 */
function sliceHunk(hunk, selected) {
  const keep = new Set(selected)
  const lines = []
  let oldCount = 0
  let newCount = 0
  let anyKept = false
  let forcedContext = false

  for (let index = 0; index < hunk.lines.length; index++) {
    const raw = hunk.lines[index]
    const marker = raw[0]
    const body = raw.slice(1)
    if (marker === '+') {
      if (keep.has(index)) {
        lines.push(raw)
        newCount += 1
        anyKept = true
      }
      // A dropped addition simply does not exist on either side, so it is
      // omitted. It must NOT be re-emitted as context: git would then look for
      // that text in the pre-change file, where it does not exist, and the
      // apply would fail — or worse, match an identical line elsewhere.
    } else if (marker === '-') {
      if (keep.has(index)) {
        lines.push(raw)
        oldCount += 1
        anyKept = true
      } else {
        // A dropped removal keeps its content in the result, so it becomes a
        // context line and counts on BOTH sides.
        lines.push(' ' + body)
        oldCount += 1
        newCount += 1
        forcedContext = true
      }
    } else {
      lines.push(raw)
      oldCount += 1
      newCount += 1
    }
  }

  // Nothing that changes the file survived: emitting the residue would ask git
  // to apply a hunk that only re-states context.
  if (!anyKept) return null
  // A hunk made entirely of converted context (possible when the only kept
  // change is an addition whose neighbours were all removed) still has to
  // change something; the counts alone decide whether that is true.
  if (oldCount === newCount && !forcedContext && !anyKept) return null

  const oldStart = Number(hunk.header.match(/^@@ -(\d+)/)[1])
  const newStart = Number(hunk.header.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)[1])
  // Rewrite the header from the real counts. `--recount` would also accept a
  // stale header, but a patch that lies about its own size is unreadable in the
  // command log, and the log is where a user checks what actually ran.
  const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@` +
    hunk.header.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/, '')
  return { header, lines }
}

/**
 * Build the patch that applies a per-hunk LINE selection.
 *
 * The caller proves the diff has not moved by citing the hunk fingerprints it
 * was rendered from; those are validated exactly like the whole-hunk path, so
 * a line selection can never apply against stale coordinates.
 *
 * @param diff - the result of {@link splitHunks}.
 * @param selection - `{ [hunkHash]: number[] }`, indices into that hunk's lines.
 * @returns the patch text, or '' when nothing is selected.
 */
export function linesPatch(diff, selection) {
  // Validate EVERY cited hunk before building anything: a refusal halfway
  // through would otherwise discard work done for earlier hunks.
  //
  // A hunk carrying `\ No newline at end of file` cannot be sliced safely. The
  // marker says where a side ENDS, so a subset would have to decide whether the
  // result gains or loses that final newline — and getting it wrong rewrites
  // the tail of the file. Whole-hunk staging handles these faithfully, so this
  // is a narrower offer rather than a gap.
  const cited = diff.hunks.filter(hunk => Array.isArray(selection?.[hunk.hash]) && selection[hunk.hash].length > 0)
  for (const hunk of cited) {
    if (hunk.markers !== undefined && hunk.markers.length > 0) {
      throw new Error('该文件末尾没有换行符，请改用整块暂存')
    }
  }
  const parts = []
  for (const hunk of cited) {
    const sliced = sliceHunk(hunk, selection[hunk.hash])
    if (sliced === null) continue
    parts.push(sliced.header + '\n' + sliced.lines.join('\n'))
  }
  if (parts.length === 0) return ''
  return diff.header + '\n' + parts.join('\n') + '\n'
}

/**
 * The shapes this module refuses, named so the panel can say "manage as a whole file".
 *
 * @param file - one status entry.
 * @returns the refusal message, or null when the file is splittable.
 */
function unsplittable(file) {
  if (file === undefined) return '请选择文件'
  if (file.kind === 'unmerged') return '有冲突的文件请用冲突编辑器处理'
  if (file.kind === 'untracked') return '未跟踪文件需要先按完整文件暂存'
  if (file.binary === true) return '二进制文件请按完整文件管理'
  if (file.originalPath) return '重命名的文件请按完整文件管理'
  return null
}

/**
 * Read a file's diff for one side.
 *
 * `unstaged` is the index→working-tree diff (what "stage this hunk" acts on); `staged` is
 * HEAD→index (what "unstage this hunk" acts on). They are different diffs, not the same
 * one reversed, because the index sits between them.
 *
 * @param repo - the repository session.
 * @param path - the repository-relative path.
 * @param staged - which side to read.
 * @param options - cancellation.
 * @returns `{ header, hunks }`.
 */
async function readDiff(repo, path, staged, options) {
  const args = ['diff', '--no-ext-diff', '--no-textconv', '-U3']
  if (staged) args.push('--cached')
  const result = await boundedRead(repo, [...args, '--', path],
    { ...options, timeoutMs: 45_000, env: { GIT_LITERAL_PATHSPECS: '1' } }, DIFF_MAX_BYTES, DIFF_MAX_LINES)
  if (result.tooLarge) throw new Error('差异过大，无法逐块操作；请按完整文件处理')
  if (result.code !== 0) throw new Error(result.stderr.trim() || '无法读取改动')
  if (/^Binary files|^GIT binary patch|^old mode|^new mode|^rename from/m.test(result.stdout)) {
    throw new Error('此文件需要按完整文件管理')
  }
  return splitHunks(result.stdout)
}

/**
 * Find one path's status entry.
 *
 * @param repo - the repository session.
 * @param path - the repository-relative path.
 * @param options - cancellation.
 * @returns the status entry.
 */
async function requireFile(repo, path, options) {
  if (typeof path !== 'string' || path === '' || !isSafePath(path)) throw new Error('请选择文件')
  const status = await repo.status({ ...options, force: true })
  const file = status.files.find(entry => entry.path === path)
  const refusal = unsplittable(file)
  if (refusal !== null) throw new Error(refusal)
  return file
}

/**
 * Read a file's hunks for a given side.
 *
 * `lines` is deliberately NOT sent: the patch body is large, the panel already has the
 * rendered diff, and a second copy would double the payload of every file opened.
 *
 * @param repo - the repository session.
 * @param request - `{ path, staged }`.
 * @param options - cancellation.
 * @returns `{ path, staged, header, hunks }`, without the patch bodies.
 */
export async function readHunks(repo, request, options = {}) {
  const staged = request?.staged === true
  const file = await requireFile(repo, request?.path, options)
  const diff = await readDiff(repo, file.path, staged, options)
  if (diff.hunks.length === 0) throw new Error(staged ? '暂存区没有可取消暂存的改动' : '没有可暂存的改动')
  return {
    path: file.path,
    staged,
    header: diff.header,
    hunks: diff.hunks.map((hunk, index) => ({
      index, hash: hunk.hash, header: hunk.header,
      contentHash: withHunkFingerprint(parseUnifiedDiff(hunk.header + '\n' + hunkBody(hunk))[0]).contentHash,
      // Told to the UI so it can offer line picking only where it is faithful.
      // A hunk with a no-newline marker cannot be sliced safely: the marker
      // says where a side ENDS, and a subset would have to decide whether the
      // result keeps that final newline.
      lineSelectable: hunk.markers === undefined || hunk.markers.length === 0,
    })),
  }
}

/**
 * Apply one subset of hunks to the index, the working tree, or neither.
 *
 * Two selection shapes are accepted, and they share every safety check:
 *
 * - `hashes` — whole hunks, identified by fingerprint.
 * - `lines` — `{ [hunkHash]: number[] }`, indices into that hunk's lines, for
 *   "stage just these lines". The hunk fingerprints are validated exactly as
 *   before, so a line selection cannot apply against a diff that moved.
 *
 * @param repo - the repository session.
 * @param request - `{ action, path, hashes?, lines?, staged }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
async function applySelection(repo, request, options) {
  const action = request?.action
  if (action !== 'stage' && action !== 'unstage' && action !== 'discard') throw new Error('不支持的改动块操作')
  const hashes = [...new Set(Array.isArray(request?.hashes) ? request.hashes.filter(value => typeof value === 'string' && value !== '') : [])]
  // A line selection is keyed by the same hunk fingerprints, so its keys are
  // the hashes that must still exist.
  const lineSelection = request?.lines !== null && typeof request?.lines === 'object' && !Array.isArray(request?.lines)
    ? request.lines : null
  const lineHashes = lineSelection === null ? [] : Object.keys(lineSelection)
  if (hashes.length === 0 && lineHashes.length === 0) throw new Error('请选择改动块或代码行')
  if (hashes.length > 0 && lineHashes.length > 0) throw new Error('不能同时按改动块和按行选择')
  const file = await requireFile(repo, request?.path, options)
  // Staging acts on the unstaged side and unstaging on the staged one. DISCARDING can
  // mean either, so the caller says which side it was looking at.
  const staged = action === 'unstage' || (action === 'discard' && request?.staged === true)
  const current = await readDiff(repo, file.path, staged, options)
  // Validate the entire selection before applying anything. One surviving hash
  // must not turn a stale batch into a successful partial stage/discard.
  const available = new Set(current.hunks.map(hunk => hunk.hash))
  const cited = hashes.length > 0 ? hashes : lineHashes
  if (cited.some(hash => !available.has(hash))) throw new Error('改动块已变化，请刷新后重试')
  const patch = lineSelection === null ? hunksPatch(current, hashes) : linesPatch(current, lineSelection)
  // A hash set that matches nothing means the file moved under the panel. Refusing is
  // the only safe answer: a patch built from stale coordinates can apply successfully
  // and change the wrong lines.
  if (patch === '') throw new Error('改动块已变化，请刷新后重试')

  let args
  if (action === 'stage') args = ['apply', '--cached', '--recount', '--whitespace=nowarn', '-']
  else if (action === 'unstage') args = ['apply', '--cached', '--reverse', '--recount', '--whitespace=nowarn', '-']
  // Discarding reverses the change in the WORKING TREE only; the index is untouched, so
  // a hunk that was also staged survives there.
  else args = ['apply', '--reverse', '--recount', '--whitespace=nowarn', '-']
  const result = await repo.runWrite(args, { timeoutMs: 60_000, signal: options.signal, input: patch })
  if (result.code !== 0) throw new Error(result.stderr.trim() || '无法应用改动块')
  const verb = action === 'stage' ? '已暂存' : action === 'unstage' ? '已取消暂存' : '已丢弃'
  // Report in the unit the caller actually selected, so the outcome banner
  // matches the gesture rather than always counting hunks.
  const amount = lineSelection === null
    ? `${hashes.length} 个改动块`
    : `${lineHashes.reduce((total, hash) => total + (lineSelection[hash] || []).length, 0)} 行`
  return { ok: true, code: 0, stdout: '', stderr: '', message: `${verb} ${amount}` }
}

/** Stage the selected hunks of one file. */
export async function stageHunks(repo, request, options = {}) {
  return applySelection(repo, { ...request, action: 'stage' }, options)
}

/** Unstage the selected hunks of one file. */
export async function unstageHunks(repo, request, options = {}) {
  return applySelection(repo, { ...request, action: 'unstage' }, options)
}

/** Discard the selected hunks of one file, on the side they were read from. */
export async function discardHunks(repo, request, options = {}) {
  return applySelection(repo, { ...request, action: 'discard' }, options)
}

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
 * @param text - the raw diff for a single path.
 * @returns `{ header, hunks }`.
 */
export function splitHunks(text) {
  const lines = String(text ?? '').split('\n')
  const header = []
  const hunks = []
  let current = null
  for (const line of lines) {
    if (/^@@ /.test(line)) {
      current = { header: line, lines: [] }
      hunks.push(current)
    } else if (current !== null) {
      // The trailing empty element from the final newline is not a content line.
      if (line !== '' || current.lines.length > 0) current.lines.push(line)
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
  return diff.header + '\n' + chosen.map(hunk => hunk.header + '\n' + hunk.lines.join('\n')).join('\n') + '\n'
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
      contentHash: withHunkFingerprint(parseUnifiedDiff(hunk.header + '\n' + hunk.lines.join('\n'))[0]).contentHash,
    })),
  }
}

/**
 * Apply one subset of hunks to the index, the working tree, or neither.
 *
 * @param repo - the repository session.
 * @param request - `{ action, path, hashes, staged }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
async function applySelection(repo, request, options) {
  const action = request?.action
  if (action !== 'stage' && action !== 'unstage' && action !== 'discard') throw new Error('不支持的改动块操作')
  const hashes = [...new Set(Array.isArray(request?.hashes) ? request.hashes.filter(value => typeof value === 'string' && value !== '') : [])]
  if (hashes.length === 0) throw new Error('请选择改动块')
  const file = await requireFile(repo, request?.path, options)
  // Staging acts on the unstaged side and unstaging on the staged one. DISCARDING can
  // mean either, so the caller says which side it was looking at.
  const staged = action === 'unstage' || (action === 'discard' && request?.staged === true)
  const current = await readDiff(repo, file.path, staged, options)
  // Validate the entire selection before applying anything. One surviving hash
  // must not turn a stale batch into a successful partial stage/discard.
  const available = new Set(current.hunks.map(hunk => hunk.hash))
  if (hashes.some(hash => !available.has(hash))) throw new Error('改动块已变化，请刷新后重试')
  const patch = hunksPatch(current, hashes)
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
  return { ok: true, code: 0, stdout: '', stderr: '', message: `${verb} ${hashes.length} 个改动块` }
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

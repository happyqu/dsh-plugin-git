/**
 * dsh-plugin-git — undo points for history rewrites.
 *
 * `rewrite.js` already created a ref under `refs/dsh-rewrite/` before moving a
 * branch, but that ref was write-only: nothing could enumerate, inspect, restore
 * or prune it. An undo point a user cannot find is not an undo point, so this
 * module is the read half of that contract.
 *
 * Three decisions carry the whole design:
 *
 * 1. **One namespace, one message format.** `refs/dsh-rewrite/<time>-<rand>-<action>-<branch>`
 *    names the branch it shadows and the operation that moved it, so the list reads
 *    without a second database. The reflog message carries `dsh: <action>|<ref>|<note>`.
 * 2. **Reflogs are what survive `git gc`.** `core.logAllRefUpdates` only covers
 *    `refs/heads/*`, so a backup created as a plain ref becomes garbage the moment
 *    the ref itself is deleted. Creating it with `--create-reflog` anchors the
 *    commits it points at.
 * 3. **Restoring never silently moves a branch.** Two modes are offered: create a
 *    branch (cannot lose anything) and `reset --keep` (refuses rather than overwrite
 *    uncommitted work). `--hard` is not exposed here; it lives behind the separate,
 *    explicitly destructive reset action.
 *
 * Nothing in this module is ever created by a read: only a write that is about to
 * move a branch calls {@link createUndoPoint}.
 */
import { randomUUID } from 'node:crypto'

/** The namespace every undo point lives in. */
export const UNDO_PREFIX = 'refs/dsh-rewrite/'

/**
 * Field and record separators for the `--format` reads below.
 *
 * NUL is not usable as a format separator here: the format string travels as a
 * process argument, and no argument can contain NUL. `\x1f` / `\x1e` are the pair
 * the rest of this plugin already uses, and neither can occur in a ref name, a sha
 * or a reflog message this module wrote.
 */
const FIELD = '\x1f'
const RECORD = '\x1e'

/** How many entries one listing returns by default, and its ceiling. */
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * Make a user-provided fragment safe for a ref component.
 *
 * Slashes are legal in ref names but would turn `feature/x` into a directory tree,
 * which makes `refs/dsh-rewrite/*` matching and deletion ambiguous. Percent
 * encoding keeps the original readable while staying one component.
 *
 * @param value - the fragment.
 * @returns a single-component, ref-safe string.
 */
function refComponent(value) {
  // Encode dots too: truncating a valid name can otherwise introduce a trailing
  // dot or .lock suffix. ASCII output also makes the length limit a byte limit.
  return encodeURIComponent(String(value ?? ''))
    .replace(/[!'()*~.]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())
    .slice(0, 80) || 'unknown'
}

/**
 * Build the reflog message that records what an undo point is for.
 *
 * @param action - the operation that created it, e.g. `reword` or `rebase`.
 * @param ref - the branch whose tip was captured.
 * @param note - optional human-readable detail.
 * @returns the message.
 */
export function undoMessage(action, ref, note = '') {
  return `dsh: ${action}|${ref ?? ''}|${note}`
}

/**
 * Parse an undo-point reflog message, tolerating anything else.
 *
 * @param message - the raw `%gs`.
 * @returns `{ action, ref, note }`, or null when the message is not ours.
 */
function parseMessage(message) {
  const match = /^dsh: ([^|]*)\|([^|]*)\|(.*)$/.exec(String(message ?? '').trim())
  if (match === null) return null
  return { action: match[1], ref: match[2], note: match[3] }
}

/**
 * Record the current tip of a branch as an undo point.
 *
 * Called BEFORE the branch moves, with the value it is about to leave behind. The
 * reflog is created explicitly: without `--create-reflog` the entry would be a
 * single ref with no history, and `git gc` could then discard the commits it points
 * at once the ref itself was deleted.
 *
 * @param repo - the repository session.
 * @param spec - `{ sha, action, ref, note }`.
 * @param options - cancellation.
 * @returns `{ ref, sha }`.
 */
export async function createUndoPoint(repo, spec, options = {}) {
  const sha = typeof spec?.sha === 'string' ? spec.sha.trim() : ''
  if (!/^[a-f0-9]{40,64}$/i.test(sha)) throw new Error('无法创建恢复点：提交无效')
  const action = typeof spec.action === 'string' && spec.action !== '' ? spec.action : 'rewrite'
  const ref = typeof spec.ref === 'string' ? spec.ref : ''
  const name = `${UNDO_PREFIX}${Date.now()}-${randomUUID().slice(0, 8)}`
    + `-${refComponent(action)}-${refComponent(ref.replace(/^refs\/heads\//, ''))}`
  const result = await repo.runWrite(
    ['update-ref', '--create-reflog', '-m', undoMessage(action, ref, spec.note ?? ''), name, sha],
    { timeoutMs: 30_000, signal: options.signal },
  )
  if (result.code !== 0) throw new Error(result.stderr.trim() || '无法创建恢复点引用')
  return { ref: name, sha }
}

/**
 * List the undo points that still exist, newest first.
 *
 * Two commands, one process each: `for-each-ref` decides what is alive (a reflog
 * outlives its own ref, so it cannot answer this alone) and one `reflog show --all`
 * supplies the messages. Doing this per ref would spawn one process per entry and
 * make the recovery dialog the slowest screen in the plugin.
 *
 * The `--all` reflog output starts with a newline, so records are trimmed before
 * the selector is compared against the `for-each-ref` key. Without that trim the
 * message lookup misses and every entry falls back to the default action.
 *
 * @param repo - the repository session.
 * @param request - `{ limit }`.
 * @param options - cancellation.
 * @returns `[{ ref, sha, shortSha, action, origin, note, at }]`.
 */
export async function listUndoPoints(repo, request = {}, options = {}) {
  const requested = Number.isInteger(request.limit) ? request.limit : DEFAULT_LIMIT
  const limit = Math.min(Math.max(requested, 1), MAX_LIMIT)
  const alive = await repo.run(
    ['for-each-ref', `--format=%(refname)${FIELD}%(objectname)${RECORD}`, UNDO_PREFIX],
    { timeoutMs: 20_000, signal: options.signal },
  )
  // No undo points is the ordinary answer for a repository nobody has rewritten.
  if (alive.code !== 0 || alive.stdout.trim() === '') return []

  const refs = new Map()
  for (const record of alive.stdout.split(RECORD)) {
    if (record.trim() === '') continue
    const [ref, sha] = record.split(FIELD)
    if (typeof ref !== 'string' || ref === '') continue
    const name = ref.trim()
    const timestamp = /^(\d{10}|\d{13})-/.exec(name.slice(UNDO_PREFIX.length))?.[1]
    // Legacy names used epoch seconds; new names retain millisecond precision.
    const at = timestamp ? Number(timestamp) * (timestamp.length === 10 ? 1000 : 1) : 0
    refs.set(name, { sha: (sha ?? '').trim(), at })
  }
  if (refs.size === 0) return []

  const messages = new Map()
  // `%gD` is the FULL selector (`refs/dsh-rewrite/…@{0}`); `%gd` shortens it to
  // `dsh-rewrite/…@{0}` by stripping the leading `refs/`. Using the short form made
  // every entry fail the namespace check, so the whole list fell back to the default
  // action and the recovery panel could not say what any entry was for.
  const reflog = await repo.run(
    ['reflog', 'show', '--all', '--format=%gD' + FIELD + '%gs', `--max-count=${MAX_LIMIT * 4}`],
    { timeoutMs: 20_000, signal: options.signal },
  )
  if (reflog.code === 0) {
    for (const raw of reflog.stdout.split(/[\n\r]+/)) {
      const line = raw.trim()
      if (line === '') continue
      const [selector, message] = line.split(FIELD)
      if (typeof selector !== 'string' || !selector.startsWith(UNDO_PREFIX)) continue
      messages.set(selector.split('@{')[0].trim(), message ?? '')
    }
  }

  const out = []
  for (const [ref, entry] of refs) {
    const parsed = parseMessage(messages.get(ref) ?? '')
    out.push({
      ref,
      sha: entry.sha,
      shortSha: entry.sha.slice(0, 8),
      // An entry whose message is gone still lists: the ref is alive, which is the
      // fact that matters, and "rewrite" is the truthful default for "unknown".
      action: parsed?.action || 'rewrite',
      origin: parsed?.ref || '',
      note: parsed?.note || '',
      at: entry.at,
    })
  }
  out.sort((left, right) => right.at - left.at)
  return out.slice(0, limit)
}

/**
 * Resolve one undo point to its commit, refusing anything outside the namespace.
 *
 * @param repo - the repository session.
 * @param ref - the full ref name.
 * @param options - cancellation.
 * @returns the commit sha.
 */
async function resolveUndoPoint(repo, ref, options) {
  const name = typeof ref === 'string' ? ref.trim() : ''
  // These values reach `update-ref` and `reset`, so a leading `-` would be parsed
  // as a flag and anything outside our namespace is not a backup we own.
  if (!name.startsWith(UNDO_PREFIX) || name.startsWith('-') || /[\0\r\n ~^:?*[\\]/.test(name)) {
    throw new Error('无效的恢复点')
  }
  const result = await repo.run(['rev-parse', '--verify', `${name}^{commit}`], options)
  if (result.code !== 0) throw new Error('恢复点已不存在，请刷新列表')
  return result.stdout.trim()
}

/**
 * Restore an undo point, either as a new branch or by moving the current branch.
 *
 * `branch` is the always-safe mode: it cannot overwrite anything, because a name
 * that already exists is refused. `reset` moves the checked-out branch back with
 * `--keep`, which is the mode that fails instead of discarding uncommitted work —
 * a recovery action must never be the thing that loses the user's files.
 *
 * @param repo - the repository session.
 * @param request - `{ ref, mode: 'branch'|'reset', name? }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function restoreUndoPoint(repo, request, options = {}) {
  const sha = await resolveUndoPoint(repo, request?.ref, options)
  const mode = request?.mode === 'reset' ? 'reset' : 'branch'

  if (mode === 'branch') {
    const name = typeof request.name === 'string' && request.name.trim() !== ''
      ? request.name.trim()
      : `recovery/${sha.slice(0, 8)}`
    const valid = await repo.run(['check-ref-format', `refs/heads/${name}`], options)
    if (valid.code !== 0) throw new Error('恢复分支名称无效')
    const exists = await repo.run(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], options)
    if (exists.code === 0) throw new Error('同名分支已存在，请换一个名称')
    const created = await repo.runWrite(['branch', name, sha], { timeoutMs: 30_000, signal: options.signal })
    if (created.code !== 0) return writeFailure(created)
    return {
      ok: true,
      code: 0,
      stdout: '',
      stderr: '',
      message: `已从恢复点创建分支 ${name}`,
      branch: name,
      sha,
    }
  }

  // Moving the checked-out branch needs one; a detached HEAD has nothing to move.
  const head = await repo.run(['symbolic-ref', '--quiet', 'HEAD'], options)
  const branch = head.code === 0 ? head.stdout.trim() : ''
  if (branch === '') throw new Error('处于分离 HEAD 状态，请先切换到分支再移动')
  const current = await repo.run(['rev-parse', '--verify', 'HEAD'], options)
  if (current.code === 0 && current.stdout.trim() === sha) throw new Error('分支已经在这个位置')
  // --keep protects the worktree but still replaces the index. Refuse staged
  // changes, whose content may exist nowhere else (including in the worktree).
  const staged = await repo.run(['diff', '--cached', '--quiet', '--exit-code'], options)
  if (staged.code === 1) return { ok: false, code: 1, stdout: '', stderr: '',
    message: '暂存区有改动，已停止；请先提交或储藏后再移动' }
  if (staged.code !== 0) return writeFailure(staged)
  const result = await repo.runWrite(['reset', '--keep', sha], { timeoutMs: 60_000, signal: options.signal })
  if (result.code !== 0) {
    // `--keep` refuses when the move would have to overwrite local changes, and that
    // refusal is the whole reason this mode exists. Two different git messages mean
    // it — "Entry '<path>' not uptodate. Cannot merge." and the older "would be
    // overwritten" wording — so both are recognised and translated into one
    // instruction instead of being passed through as an opaque fatal.
    return {
      ok: false,
      code: result.code,
      message: /not uptodate|local changes|would be overwritten|Please commit or stash/i.test(result.stderr)
        ? '本地改动会被覆盖，已停止；请先提交或储藏后再移动'
        : (result.stderr.trim() || '无法移动分支'),
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }
  return { ok: true, code: 0, stdout: result.stdout, stderr: '', message: `已把 ${branch.replace(/^refs\/heads\//, '')} 移回该恢复点`, sha }
}

/**
 * Delete one undo point.
 *
 * Only the marker is removed: the commits stay reachable through the reflog until
 * Git prunes them, so this cannot lose content by itself. That is why it is not
 * classified as a destructive write.
 *
 * @param repo - the repository session.
 * @param request - `{ ref }`.
 * @param options - cancellation.
 * @returns the write outcome.
 */
export async function deleteUndoPoint(repo, request, options = {}) {
  const ref = typeof request?.ref === 'string' ? request.ref.trim() : ''
  if (!ref.startsWith(UNDO_PREFIX) || ref.startsWith('-') || /[\0\r\n ~^:?*[\\]/.test(ref)) throw new Error('无效的恢复点')
  const result = await repo.runWrite(['update-ref', '-d', ref], { timeoutMs: 30_000, signal: options.signal })
  if (result.code !== 0) return writeFailure(result)
  return { ok: true, code: 0, stdout: '', stderr: '', message: '已删除该恢复点' }
}

/** Shape one failed git invocation as a write outcome. */
function writeFailure(result) {
  return {
    ok: false,
    code: result.code,
    message: result.stderr.trim() || '操作失败',
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

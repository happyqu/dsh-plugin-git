import { createHash, randomUUID } from 'node:crypto'
import { parseDiffHeader } from './diff.js'

export function chunkFingerprint(lines) {
  return createHash('sha256').update(lines.filter(line => /^[+-]/.test(line)).join('\n')).digest('hex')
}

/**
 * Resolve HEAD once for a batch of {@link readChunks} calls.
 *
 * Each `readChunks` would otherwise spawn its own `rev-parse`, which measured at
 * two Git processes per file. Reconciling a twenty-file changelist therefore paid
 * forty process launches to re-read one unchanged fact.
 *
 * @param repo - the repository session.
 * @param options - cancellation.
 * @returns the HEAD sha, or null when the repository has no commit yet.
 */
export async function resolveChunkHead(repo, options = {}) {
  const head = await repo.run(['rev-parse', '--verify', 'HEAD'], options)
  return head.code === 0 ? head.stdout.trim() : null
}

/**
 * Exact change-content matching; ambiguous or edited blocks require reassignment.
 *
 * `resolvedHead` lets a caller iterating over many files pass a HEAD it already
 * resolved. `undefined` means "resolve it yourself"; `null` means "there is no
 * HEAD", which this operation cannot work with. Reading the diff goes through
 * `run`, not `runWrite`: it only reads, so it must not take the index lock —
 * `commitPaths` calls this while holding `.git/index.lock` itself, and a read
 * that wanted the same lock would deadlock against its own caller.
 */
export async function readChunks(repo, file, options = {}, resolvedHead) {
  if (unsupported(file)) throw new Error('此文件需要按完整文件管理')
  const headSha = resolvedHead === undefined ? await resolveChunkHead(repo, options) : resolvedHead
  if (headSha === null) throw new Error('首次提交请按完整文件管理')
  const diff = await repo.run(['diff', '--no-ext-diff', '--no-textconv', '-U3', headSha, '--', file.path], {
    ...options, env: { GIT_LITERAL_PATHSPECS: '1' },
  })
  if (diff.code !== 0) throw new Error(diff.stderr.trim() || '无法读取代码块')
  if (/^Binary files|^GIT binary patch|^old mode|^new mode/m.test(diff.stdout)) throw new Error('二进制或文件模式变更需要按完整文件管理')
  const record = chunksOf(diff.stdout)
  if (record === null) throw new Error('没有可拆分的文本改动')
  return record
}

/**
 * Read the hunks of several files in ONE `git diff`.
 *
 * Reconciliation used to call {@link readChunks} per file, which is one git
 * process per file: a twenty-file changelist paid twenty launches, and each one
 * re-read the whole working tree to find its own path. One diff over all the
 * paths produces identical per-file hunks — git emits a `diff --git` section per
 * path, which is exactly the split this reconstructs.
 *
 * A path git reports nothing for is absent from the map, so the caller can tell
 * "no text change" from "unreadable"; a path whose section looks binary or
 * mode-only is absent too, matching what {@link readChunks} refuses.
 *
 * @param repo - the repository session.
 * @param files - status entries for the paths to read.
 * @param options - cancellation.
 * @param resolvedHead - a HEAD already resolved, or undefined to resolve here.
 * @returns a map of path → `{ header, parts }`, omitting unsupported paths.
 */
export async function readChunksBatch(repo, files, options = {}, resolvedHead) {
  const usable = files.filter((file) => file && !unsupported(file))
  if (usable.length === 0) return new Map()
  const headSha = resolvedHead === undefined ? await resolveChunkHead(repo, options) : resolvedHead
  if (headSha === null) return new Map()
  const diff = await repo.run(['diff', '--no-ext-diff', '--no-textconv', '-U3', headSha, '--', ...usable.map((file) => file.path)], {
    ...options, env: { GIT_LITERAL_PATHSPECS: '1' },
  })
  if (diff.code !== 0) throw new Error(diff.stderr.trim() || '无法读取代码块')
  return splitChunkSections(diff.stdout)
}

/** Why a status entry cannot be handled as text chunks, or null when it can. */
function unsupported(file) {
  return !file || file.kind === 'untracked' || file.kind === 'unmerged' || file.originalPath
    || file.binary === true || file.index === 'D' || file.worktree === 'D'
}

/**
 * Split a multi-file diff into per-path chunk records.
 *
 * @param text - a unified diff, possibly covering several paths.
 * @returns a map of path → `{ header, parts }`.
 */
function splitChunkSections(text) {
  const value = String(text ?? '')
  const sections = new Map()
  let path = null, buffer = []
  const finish = () => {
    if (path === null) return
    const body = buffer.join('\n')
    buffer = []
    // The same refusals `readChunks` applies, now decided from the section it
    // would have read on its own.
    if (!body || /^Binary files|^GIT binary patch|^old mode|^new mode/m.test(body)) return
    const record = chunksOf(body)
    if (record !== null) sections.set(path, record)
  }
  for (const line of value.split('\n')) {
    if (line.startsWith('diff --git ')) {
      finish()
      // The same decoder the diff renderer uses, so a quoted path resolves to
      // the real file name here too. A rename is still refused: chunks are keyed
      // by the destination path, and a rename cannot be split anyway.
      const header = parseDiffHeader(line)
      path = header !== null && header.from === header.to ? header.to : null
      if (path !== null) buffer.push(line)
      continue
    }
    if (path !== null) buffer.push(line)
  }
  finish()
  return sections
}

/** Parse one file's diff section into its reusable header and hunks. */
function chunksOf(text) {
  const lines = text.split('\n'), parts = [], header = []
  let current = null
  for (const line of lines) {
    if (/^@@ /.test(line)) {
      current = { header: line, lines: [] }; parts.push(current)
    } else if (current) { if (line || current.lines.length) current.lines.push(line) }
    else header.push(line)
  }
  for (const part of parts) {
    if (part.lines[part.lines.length - 1] === '') part.lines.pop()
    part.hash = chunkFingerprint(part.lines)
    part.id = randomUUID()
  }
  return parts.length ? { header: header.join('\n'), parts } : null
}

export function reconcileChunks(previous, current) {
  const oldCount = new Map(), newCount = new Map()
  for (const part of previous.parts) oldCount.set(part.hash, (oldCount.get(part.hash) || 0) + 1)
  for (const part of current.parts) newCount.set(part.hash, (newCount.get(part.hash) || 0) + 1)
  return { parts: current.parts.map(part => {
    const old = oldCount.get(part.hash) === 1 && newCount.get(part.hash) === 1 ? previous.parts.find(entry => entry.hash === part.hash) : null
    return { id: old?.id || part.id, hash: part.hash, list: old?.list || null, selected: old?.selected === true }
  }) }
}

export function chunkPatch(current, record) {
  const chosen = current.parts.filter((part, index) => record.parts[index]?.hash === part.hash && record.parts[index]?.selected)
  return chosen.length ? current.header + '\n' + chosen.map(part => part.header + '\n' + part.lines.join('\n')).join('\n') + '\n' : ''
}

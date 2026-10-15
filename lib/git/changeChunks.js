import { createHash, randomUUID } from 'node:crypto'

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
  if (!file || file.kind === 'untracked' || file.kind === 'unmerged' || file.originalPath || file.binary || file.index === 'D' || file.worktree === 'D') throw new Error('此文件需要按完整文件管理')
  const headSha = resolvedHead === undefined ? await resolveChunkHead(repo, options) : resolvedHead
  if (headSha === null) throw new Error('首次提交请按完整文件管理')
  const diff = await repo.run(['diff', '--no-ext-diff', '--no-textconv', '-U3', headSha, '--', file.path], {
    ...options, env: { GIT_LITERAL_PATHSPECS: '1' },
  })
  if (diff.code !== 0) throw new Error(diff.stderr.trim() || '无法读取代码块')
  if (/^Binary files|^GIT binary patch|^old mode|^new mode/m.test(diff.stdout)) throw new Error('二进制或文件模式变更需要按完整文件管理')
  const lines = diff.stdout.split('\n'), parts = [], header = []
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
  if (!parts.length) throw new Error('没有可拆分的文本改动')
  return { header: header.join('\n'), parts }
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

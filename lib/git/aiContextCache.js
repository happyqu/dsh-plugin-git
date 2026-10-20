/** Cache only input context; every click still asks the currently selected model. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { commitMessageContext, commitContextIndexPath } from './aiContext.js'
import { readChangelistCommitPolicy } from './changelists.js'
import { repositoryPreviewVersions } from './watch.js'

const staleMessage = '仓库或提交范围已变化，请重新生成提交信息'
const indexIdentities = new WeakMap()

/** Ignore index stat/cache extensions while retaining staged blobs, modes and flags. */
async function indexIdentity(repo, indexPath, run) {
  const read = () => readFile(indexPath).catch(error => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error })
  let bytes = await read()
  for (let attempt = 0; attempt < 3; attempt++) {
    const digest = createHash('sha256').update(bytes).digest('hex')
    const previous = indexIdentities.get(repo)
    if (previous?.path === indexPath && previous.digest === digest) return previous.value
    const value = await run(['ls-files', '--stage', '-v', '-z'])
    const after = await read()
    if (bytes.equals(after)) {
      indexIdentities.set(repo, { path: indexPath, digest, value })
      return value
    }
    bytes = after
  }
  throw new Error(staleMessage)
}

async function fingerprint(repo, request, options) {
  options.signal?.throwIfAborted()
  const run = async (args, extra = {}) => {
    const result = await repo.run(args, { signal: options.signal, ...extra })
    if (result.code !== 0) throw new Error(result.stderr.trim() || '无法检查 AI 提交范围')
    return result.stdout
  }
  // Independent checks start together; each validation still reads fresh state.
  const [status, config, indexPath, policy] = await Promise.all([
    repo.status({ signal: options.signal, force: true, details: false }),
    run(['config', '--null', '--list']),
    commitContextIndexPath(repo, options),
    request.changelistVersion === undefined ? null : readChangelistCommitPolicy(repo, options),
  ])
  const explicit = Array.isArray(request.paths), byPath = new Map(status.files.map(file => [file.path, file]))
  const staged = status.files.filter(file => file.staged)
  const stagedOnly = !explicit && staged.length > 0
  const paths = [...new Set(explicit ? request.paths : (staged.length ? staged : status.files).map(file => file.path))].sort()
  const files = paths.map(path => {
    const file = byPath.get(path)
    if (!file) throw new Error(staleMessage)
    return file
  })
  // A staged rename is sampled as deletion + addition; both attribute sets
  // must participate, even though status reports only the destination path.
  const attributePaths = [...new Set(files.flatMap(file => [file.path, file.originalPath]).filter(Boolean))].sort()
  if (request.changelistVersion !== undefined && policy?.version !== request.changelistVersion) throw new Error(staleMessage)
  const [versions, attributes, index] = await Promise.all([
    stagedOnly ? {} : repositoryPreviewVersions(repo, paths.length ? paths : ['.'], { includeIndex: false }),
    attributePaths.length ? run(['check-attr', ...(stagedOnly ? ['--cached'] : []), '-z', '--stdin', 'linguist-generated', 'filter'], { input: attributePaths.join('\0') + '\0' }) : '',
    indexIdentity(repo, indexPath, run),
  ])
  options.signal?.throwIfAborted()
  const key = createHash('sha256').update(index).update(JSON.stringify([
    repo.root, repo.gitPath, status.branch, explicit, paths, stagedOnly ? files.map(file => [file.path, file.index]) : files, versions, config, attributes,
    indexPath, request.changelistVersion, paths.map(path => policy?.chunks?.[path]), options.excludePatterns,
  ])).digest('hex')
  return { key, status, indexPath, attributes }
}

export function createCommitContextCache() {
  const entries = new Map(), ttl = 60_000, maximum = 32
  const prune = () => {
    for (const [key, value] of entries) if (Date.now() - value.createdAt > ttl) entries.delete(key)
    while (entries.size > maximum) entries.delete(entries.keys().next().value)
  }
  const validate = async (entry, repo, request, options) => {
    if (entry.repo !== repo || entry.key !== (await fingerprint(repo, request, options)).key) throw new Error(staleMessage)
  }
  return {
    async prepare(repo, request, options) {
      prune()
      const prepared = await fingerprint(repo, request, options), { key } = prepared
      const previous = entries.get(key)
      if (previous?.repo === repo) {
        entries.delete(key); entries.set(key, previous)
        return { ...previous, cacheHit: true }
      }
      const context = await commitMessageContext(repo, request, options, prepared)
      const entry = { repo, key, context, id: randomUUID(), createdAt: Date.now() }
      await validate(entry, repo, request, options)
      // Another caller can finish while we build/validate. Reuse its token so
      // a successful prepare response never loses its entry to a same-key write.
      const concurrent = entries.get(key)
      if (concurrent?.repo === repo) return { ...concurrent, cacheHit: true }
      entries.set(key, entry); prune()
      return { ...entry, cacheHit: false }
    },
    async read(id, repo, request, options) {
      prune()
      const entry = [...entries.values()].find(value => value.id === id && value.repo === repo)
      if (!entry) throw new Error('AI 上下文已过期，请重新生成提交信息')
      await validate(entry, repo, request, options)
      return { ...entry, cacheHit: true }
    },
    validate,
  }
}

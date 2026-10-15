import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function operationReview(repo, request = {}, options = {}) {
  const status = await repo.status({ ...options, force: true })
  const directory = (await repo.runOrThrow(['rev-parse', '--absolute-git-dir'], options)).trim()
  const identity = await Promise.all(['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge/orig-head', 'rebase-apply/orig-head'].map(async name => {
    try { return await readFile(join(directory, name), 'utf8') } catch (error) { if (error.code === 'ENOENT') return ''; throw error }
  }))
  const staged = await repo.runOrThrow(['diff', '--cached', '--raw', '-z', '--no-abbrev', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none'], options)
  const hash = createHash('sha256').update(JSON.stringify([status.branch?.oid, status.operation, identity])).update(staged).digest('hex')
  return { hash, operation: status.operation, conflicts: status.files.filter(file => file.kind === 'unmerged').length,
    files: status.files.filter(file => file.kind !== 'untracked' && file.kind !== 'unmerged' && !['.', ' ', '?'].includes(file.index)).map(file => ({ path: file.path, status: file.index })) }
}

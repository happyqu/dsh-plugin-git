import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Git reports an untracked embedded repository as a directory, even with -uall.
 * Inspect only those entries; do not recursively scan the user's workspace.
 * A .git file also covers linked worktrees and submodules not registered here.
 */
export async function identifyNestedRepositories(root, files) {
  return Promise.all(files.map(async file => {
    if (file.kind !== 'untracked' || !file.path.endsWith('/')) return file
    const directory = resolve(root, file.path)
    try {
      const entry = await lstat(directory)
      if (!entry.isDirectory() || entry.isSymbolicLink()) return file
      const marker = await lstat(resolve(directory, '.git'))
      if (marker.isDirectory() || marker.isFile()) return { ...file, nestedRepository: { root: directory } }
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error
    }
    return file
  }))
}

import { watch } from 'node:fs'
import { resolve, relative, isAbsolute, sep } from 'node:path'

/** A shared, leased watcher: hidden/closed clients stop polling and release it. */
const watchers = new Map()
let generation = 0
export function repositoryVersion(repo) {
  let entry = watchers.get(repo.root)
  if (!entry) {
    entry = { version: 0, generation: ++generation, handles: [], timer: null, supported: true }
    const changed = (event, filename) => {
      const path = String(filename || '').replaceAll('\\', '/')
      if (/(?:^|\/)(?:node_modules|\.git\/(?:objects|lfs|dsh-lfs-migrations))(?:\/|$)/.test(path) || /\.lock$/.test(path)) return
      entry.version++
    }
    const add = (directory, recursive, externalGit = false) => {
      try {
        const handle = watch(directory, { recursive }, (event, filename) => changed(event, externalGit ? '.git/' + String(filename || '') : filename))
        handle.unref?.()
        handle.on('error', () => { entry.supported = false; entry.version++ })
        entry.handles.push(handle)
      } catch { entry.supported = false }
    }
    add(repo.root, true)
    const gitDir = repo.identity?.gitDir
    const commonDir = repo.identity?.commonDir
    for (const directory of new Set([gitDir, commonDir].filter(Boolean).map(path => resolve(repo.root, path)))) {
      const local = relative(resolve(repo.root), directory)
      if (local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) add(directory, true, true)
    }
    watchers.set(repo.root, entry)
  }
  clearTimeout(entry.timer)
  entry.timer = setTimeout(() => { entry.handles.forEach(handle => handle.close()); watchers.delete(repo.root) }, 30_000)
  entry.timer.unref?.()
  return { version: entry.version, generation: entry.generation, supported: entry.supported }
}

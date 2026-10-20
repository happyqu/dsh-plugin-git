import { watch } from 'node:fs'
import { stat, readFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep } from 'node:path'

/** A shared, leased watcher: hidden/closed clients stop polling and release it. */
const watchers = new Map()
const previewHeads = new Map()
let generation = 0
/** Metadata only: checking an open preview never reads its contents or diff. */
export async function repositoryPreviewVersions(repo, paths, options = {}) {
  if (!paths.length) return {}
  const gitDir = resolve(repo.root, repo.identity?.gitDir || '.git')
  const commonDir = resolve(repo.root, repo.identity?.commonDir || gitDir)
  const stamp = async path => {
    try { const value = await stat(path); return [value.size, value.mtimeMs, value.ctimeMs, value.ino] }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error }
  }
  let head = ''
  try { head = await readFile(resolve(gitDir, 'HEAD'), 'utf8') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const ref = /^ref: (refs\/[^\r\n]+)\s*$/.exec(head)?.[1]
  const refPath = ref && resolve(commonDir, ref)
  const local = refPath && relative(commonDir, refPath)
  const metadata = await Promise.all([options.includeIndex === false ? null : stamp(resolve(gitDir, 'index')), stamp(resolve(commonDir, 'packed-refs')),
    local && local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local) ? stamp(refPath) : null])
  const headKey = JSON.stringify([head, metadata[1], metadata[2]])
  let cachedHead = previewHeads.get(repo.root)
  if (!cachedHead || cachedHead.key !== headKey) {
    let revision = head.trim()
    if (ref && local && local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local)) {
      try { revision = (await readFile(refPath, 'utf8')).trim() }
      catch (error) {
        if (error.code !== 'ENOENT') throw error
        let packed = ''
        try { packed = await readFile(resolve(commonDir, 'packed-refs'), 'utf8') }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        revision = packed.split('\n').find(line => line.endsWith(' ' + ref))?.split(' ')[0] || head.trim()
      }
    }
    cachedHead = { key: headKey, revision }; previewHeads.set(repo.root, cachedHead)
    if (previewHeads.size > 100) previewHeads.delete(previewHeads.keys().next().value)
  }
  // Repacking remote refs leaves the preview baseline unchanged. Only reread
  // packed refs when their metadata changes, and compare the current HEAD.
  const base = [head.trim(), cachedHead.revision, metadata[0]]
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, JSON.stringify([await stamp(resolve(repo.root, path)), base])])))
}
export function repositoryVersion(repo) {
  let entry = watchers.get(repo.root)
  if (!entry) {
    entry = { version: 0, metadataVersion: 0, contentVersion: 0, generation: ++generation, handles: [], timer: null, supported: true }
    const changed = (event, filename) => {
      const path = String(filename || '').replaceAll('\\', '/')
      // Recursive Windows watches also report the parent directory when a Git
      // lock is created. The precise child notification carries the change.
      if (/^\.git\/?$/.test(path)) return
      if (/(?:^|\/)(?:node_modules|\.git\/(?:objects|lfs|dsh-lfs-migrations))(?:\/|$)/.test(path) || /(?:^|\/)\.git\/.*\.lock$/.test(path)) return
      // This plugin's own scratch files. `dsh-changelists.json` is metadata, and
      // `dsh-commit-*`/`dsh-diff-*`/`dsh-stash-*`/`dsh-apply-*` are temporary
      // directories created beside the index. None of them is a repository
      // change, so none may count as one: every scoped commit used to register
      // as a metadata change and make the panel re-read refs for nothing.
      if (/(?:^|\/)\.git\/dsh-[^/]*(?:\/|$)/.test(path)) return
      entry.version++
      if (/(?:^|\/)\.git(?:\/|$)/.test(path)) entry.metadataVersion++
      // Fetch updates FETCH_HEAD and remote refs without changing the working
      // file, index or HEAD used by the current-file preview.
      if (!/(?:^|\/)\.git(?:\/|$)/.test(path) || /^\.git\/(?:index|HEAD|packed-refs)$|^\.git\/(?:refs\/heads\/|logs\/HEAD$)/.test(path)) entry.contentVersion++
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
  return { version: entry.version, metadataVersion: entry.metadataVersion, contentVersion: entry.contentVersion, generation: entry.generation, supported: entry.supported }
}

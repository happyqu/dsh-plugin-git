import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

/** Read only the exact local object named by a validated LFS pointer. */
export async function readLfsObject(repo, pointer, maxBytes, options = {}) {
  const text = String(pointer).replace(/\r\n/g, '\n').trim()
  if (!/^version https:\/\/git-lfs\.github\.com\/spec\/v1\n(?:ext-[^\n]*\n)*oid sha256:[a-f0-9]{64}\nsize \d+\s*$/.test(text)) return null
  const oid = /^oid sha256:([a-f0-9]{64})$/m.exec(text)[1]
  const size = Number(/^size (\d+)$/m.exec(text)[1])
  const missing = { oid, size, bytes: null }
  if (!Number.isSafeInteger(size)) throw new Error('LFS 文件大小无效')
  if (size > maxBytes) return { ...missing, tooLarge: true }
  const common = resolve(repo.root, repo.identity?.commonDir || repo.identity?.gitDir || '.git')
  let media = join(common, 'lfs', 'objects')
  const objectPath = directory => join(directory, oid.slice(0, 2), oid.slice(2, 4), oid)
  let info
  try { info = await lstat(objectPath(media)) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!info) {
    const directory = await repo.cache.lfsInfo.through('preview-media-directory', async () => {
      const result = await repo.run(['lfs', 'env'], { signal: options.signal, timeoutMs: 15000 })
      return result.code === 0 ? /^LocalMediaDir=(.+)$/m.exec(result.stdout)?.[1]?.trim() || null : null
    }, { signal: options.signal })
    if (!directory) return missing
    media = resolve(repo.root, directory)
    try { info = await lstat(objectPath(media)) }
    catch (error) { if (error.code === 'ENOENT') return missing; throw error }
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size !== size) return { ...missing, error: 'LFS 本地缓存无效，请重新获取实际内容。' }
  const bytes = await readFile(objectPath(media), { signal: options.signal })
  if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== oid) return { ...missing, error: 'LFS 本地缓存校验失败，请重新获取实际内容。' }
  return { oid, size, bytes }
}

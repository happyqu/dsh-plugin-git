import { resolveCommit } from './workbench.js'
import { isSafePath } from './write.js'

/** Export the stored blob verbatim: no text decoding, checkout or LFS fetch. */
export async function exportRevisionFile(repo, request, options = {}) {
  if (!isSafePath(request.path)) throw new Error('无效的文件路径')
  const sha = await resolveCommit(repo, request.rev, options)
  const object = `${sha}:${request.path}`
  const oid = (await repo.runOrThrow(['rev-parse', '--verify', object], options)).trim()
  if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new Error('无效的文件对象')
  const type = (await repo.runOrThrow(['cat-file', '-t', oid], options)).trim()
  if (type !== 'blob') throw new Error('所选路径不是文件')
  const size = Number((await repo.runOrThrow(['cat-file', '-s', oid], options)).trim())
  const limit = 32 * 1024 * 1024
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('无效的文件大小')
  if (size > limit) return { tooLarge: true, size, limit }
  const result = await repo.run(['cat-file', 'blob', oid], {
    ...options, encoding: 'buffer', maxBuffer: limit + 1024, timeoutMs: 30_000,
  })
  if (result.code !== 0) throw new Error(result.stderr?.toString().trim() || '文件导出失败')
  const bytes = result.stdout
  if (!Buffer.isBuffer(bytes) || bytes.length !== size) throw new Error('文件读取不完整')
  return { base64: bytes.toString('base64'), size }
}

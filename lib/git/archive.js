import { exportRevisionFile } from './export.js'
import { resolveCommit } from './workbench.js'
import { isSafePath } from './write.js'

const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** A bounded, standard ZIP with UTF-8 names and uncompressed original bytes. */
export async function exportRevisionZip(repo, request, options = {}) {
  if (!Array.isArray(request.paths) || !request.paths.length || request.paths.length > 100) throw new Error('请选择 1–100 个文件导出')
  const paths = [...new Set(request.paths)]
  if (paths.some(path => !isSafePath(path) || path.split(/[\\/]/).includes('.') || path.endsWith('/'))) throw new Error('无效的文件路径')
  const sha = await resolveCommit(repo, request.rev, options), local = [], central = []
  let offset = 0, total = 0
  for (const path of paths) {
    if (options.signal?.aborted) throw new Error('操作已取消')
    const file = await exportRevisionFile(repo, { rev: sha, path }, options)
    if (file.tooLarge || (total += file.size) > 32 * 1024 * 1024) throw new Error('导出总大小超过 32 MiB，请减少所选文件')
    const bytes = Buffer.from(file.base64, 'base64'), name = Buffer.from(path.replace(/\\/g, '/'), 'utf8'), crc = crc32(bytes)
    if (name.length > 65535) throw new Error('文件路径过长')
    const header = Buffer.alloc(30), entry = Buffer.alloc(46)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26)
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8)
    entry.writeUInt16LE(33, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42)
    local.push(header, name, bytes); central.push(entry, name); offset += header.length + name.length + bytes.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(paths.length, 8); end.writeUInt16LE(paths.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return { base64: Buffer.concat([...local, directory, end]).toString('base64'), size: offset + directory.length + end.length }
}

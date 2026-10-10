import { createHash } from 'node:crypto'
import { readFile, writeFile, lstat, realpath, unlink } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'

async function targetFor(repo, path) {
  if (typeof path !== 'string' || !path || path.startsWith('-') || /[\0\r\n]/.test(path) || path.split(/[\\/]/).some(part => part === '..') || /^(?:[A-Za-z]:|[/\\])/.test(path)) throw new Error('文件路径不安全')
  const root = await realpath(repo.root), target = resolve(root, path)
  const parent = await realpath(dirname(target))
  if (parent !== root && !parent.startsWith(root + sep)) throw new Error('文件路径超出仓库')
  try { const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink()) throw new Error('此文件类型不能在冲突编辑器中保存') } catch (error) { if (error.code !== 'ENOENT') throw error }
  return target
}

export async function conflictFile(repo, request, options = {}) {
  const target = await targetFor(repo, request.path)
  const stage = await repo.run(['ls-files', '-u', '-z', '--', request.path], options)
  if (stage.code !== 0 || !stage.stdout) throw new Error('此文件已不处于冲突状态，请刷新')
  const versions = {}
  for (const record of stage.stdout.split('\0').filter(Boolean)) {
    const match = /^(\d+) ([a-f0-9]+) ([123])\t/.exec(record)
    if (!match || match[1] === '160000' || match[1] === '120000') throw new Error('子模块或符号链接冲突请使用外部工具解决')
    const value = await repo.run(['cat-file', 'blob', match[2]], { ...options, maxBuffer: 4 * 1024 * 1024 })
    if (value.code !== 0) throw new Error('无法读取冲突版本')
    const binary = value.stdout.includes('\0') || value.stdout.includes('\uFFFD')
    versions[match[3]] = { sha: match[2], text: binary ? '' : value.stdout, binary }
  }
  let bytes = Buffer.alloc(0), exists = true
  try { const info = await lstat(target); if (info.size > 4 * 1024 * 1024) throw new Error('文件过大，请使用外部工具解决冲突'); bytes = await readFile(target) } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error }
  const text = bytes.toString('utf8'), binary = bytes.includes(0) || !Buffer.from(text).equals(bytes) || Object.values(versions).some(version => version.binary)
  const hash = createHash('sha256').update(stage.stdout).update(exists ? 'exists' : 'missing').update(bytes).digest('hex')
  return { path: request.path, hash, exists, binary, text: binary ? '' : text, base: versions[1] || null, ours: versions[2] || null, theirs: versions[3] || null }
}

export async function resolveConflict(repo, request, options = {}) {
  const current = await conflictFile(repo, request, options)
  if (current.hash !== request.hash) throw new Error('冲突文件已变化，请重新加载后处理')
  if (!['ours', 'theirs', 'text'].includes(request.choice)) throw new Error('请选择解决方式')
  if (request.choice === 'text') {
    if (current.binary || typeof request.text !== 'string' || Buffer.byteLength(request.text) > 4 * 1024 * 1024) throw new Error('无法保存此冲突结果')
    if (/^(?:<{7,}|={7,}|>{7,}|\|{7,})(?:\s|$)/m.test(request.text)) throw new Error('仍有冲突标记，请处理后再标记已解决')
    await writeFile(await targetFor(repo, request.path), request.text, 'utf8')
  } else {
    const version = current[request.choice]
    if (!version) { try { await unlink(await targetFor(repo, request.path)) } catch (error) { if (error.code !== 'ENOENT') throw error } }
    else {
      const result = await repo.runWrite(['checkout', '--' + request.choice, '--', request.path], options)
      if (result.code !== 0) return { ...result, ok: false, message: result.stderr.trim() }
    }
  }
  const result = await repo.runWrite(['add', '-A', '--', request.path], options)
  return { ...result, ok: result.code === 0, message: result.code === 0 ? '已标记解决；可继续当前 Git 操作' : result.stderr.trim() }
}

export async function repoIdentity(repo, request = {}, options = {}) {
  const scope = request.scope === 'global' ? '--global' : '--local'
  const [name, email] = await Promise.all(['user.name', 'user.email'].map(key => repo.run(['config', scope, '--get', key], options)))
  return { name: name.code === 0 ? name.stdout.trim() : '', email: email.code === 0 ? email.stdout.trim() : '', scope: request.scope === 'global' ? 'global' : 'local' }
}

export async function setIdentity(repo, request, options = {}) {
  if (!['local', 'global'].includes(request.scope)) throw new Error('请选择仓库或全局配置范围')
  const name = typeof request.name === 'string' ? request.name.trim() : '', email = typeof request.email === 'string' ? request.email.trim() : ''
  if (!name || !email || /[\0\r\n]/.test(name + email) || name.length > 200 || email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('请输入有效的提交姓名和邮箱')
  for (const [key, value] of [['user.name', name], ['user.email', email]]) {
    const result = await repo.runWrite(['config', '--' + request.scope, key, value], options)
    if (result.code !== 0) return { ...result, ok: false, message: result.stderr.trim() }
  }
  return { ok: true, message: '提交身份已保存' }
}

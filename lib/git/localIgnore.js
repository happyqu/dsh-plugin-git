import { readFile, appendFile, lstat, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { resolve, dirname, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { retryFileOperation } from './fileRetry.js'

async function snapshot(repo, options) {
  const location = await repo.runOrThrow(['rev-parse', '--git-path', 'info/exclude'], options)
  const target = resolve(repo.root, location.trim())
  let mode, text = ''
  try {
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('本机忽略配置必须是普通文件')
    if (info.size > 1024 * 1024) throw new Error('本机忽略配置超过 1 MiB，请手动编辑')
    mode = info.mode
    text = await readFile(target, 'utf8')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || []
  const rules = []
  lines.forEach((line, index) => {
    const pattern = line.replace(/\r?\n$/, '').replace(/^\uFEFF/, '')
    if (pattern.trim() && !pattern.startsWith('#')) rules.push({ id: String(index), pattern })
  })
  return { target, mode, text, lines, rules, version: createHash('sha256').update(text).digest('hex') }
}

export async function localIgnoreRules(repo, request, options = {}) {
  const { rules, version } = await snapshot(repo, options)
  return { rules, version }
}

export async function removeLocalIgnoreRules(repo, request, options = {}) {
  const before = await snapshot(repo, options)
  if (request.version !== before.version) throw new Error('本机忽略规则已改变，请刷新后重试')
  const valid = new Set(before.rules.map(rule => rule.id))
  if (!Array.isArray(request.ids) || !request.ids.length || request.ids.some(id => typeof id !== 'string' || !valid.has(id))) throw new Error('请选择有效的本机忽略规则')
  const ids = new Set(request.ids)
  let text = before.lines.filter((line, index) => !ids.has(String(index))).join('')
  if (before.text.startsWith('\uFEFF') && !text.startsWith('\uFEFF')) text = '\uFEFF' + text
  const temporary = before.target + '.' + randomUUID() + '.tmp'
  try {
    options.signal?.throwIfAborted()
    await writeFile(temporary, text, { flag: 'wx', mode: before.mode })
    if ((await snapshot(repo, options)).version !== before.version) throw new Error('本机忽略规则已改变，请刷新后重试')
    options.signal?.throwIfAborted()
    await retryFileOperation(() => rename(temporary, before.target))
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  return { ok: true, code: 0, stdout: '', stderr: '' }
}

export async function ignoreLocalPath(repo, request, options = {}) {
  if (typeof request.path !== 'string' || !request.path || /^[-\\/]|^[A-Za-z]:|[\0\r\n]/.test(request.path) || isAbsolute(request.path) || request.path.split(/[\\/]/).includes('..')) throw new Error('路径不安全')
  const status = await repo.status({ ...options, force: true })
  if (!status.files.some(file => file.path === request.path && file.kind === 'untracked')) throw new Error('只能本机忽略未跟踪文件，请刷新列表')
  const location = await repo.runOrThrow(['rev-parse', '--git-path', 'info/exclude'], options)
  const target = resolve(repo.root, location.trim())
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error('本机忽略文件不能是符号链接') } catch (error) { if (error.code !== 'ENOENT') throw error }
  let text = ''
  try { text = await readFile(target, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const pattern = '/' + request.path.replace(/\\/g, '/').replace(/[\\*?\[\]#! ]/g, '\\$&')
  if (!text.split(/\r?\n/).includes(pattern)) {
    await mkdir(dirname(target), { recursive: true })
    await appendFile(target, (text && !text.endsWith('\n') ? '\n' : '') + pattern + '\n', 'utf8')
  }
  return { ok: true, code: 0, stdout: '', stderr: '' }
}

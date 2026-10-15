import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { conflictFile } from './conflicts.js'
import { launchCode } from '../editorLauncher.js'

// External editors work on isolated copies; only resolveConflict may apply/stage the result.
const jobs = new Map()
async function discard(token) {
  const job = jobs.get(token)
  if (!job) return
  jobs.delete(token); clearTimeout(job.timer)
  await rm(job.directory, { recursive: true, force: true })
}
export async function launchConflictTool(repo, request, options = {}) {
  const value = await conflictFile(repo, request, options)
  if (request.hash !== value.hash) throw new Error('冲突版本已变化，请刷新后重试')
  if (value.binary || !value.ours || !value.theirs) throw new Error('此类冲突请在插件中选择完整版本或接受删除')
  for (const [token, job] of jobs) if (job.root === repo.root && job.path === request.path) {
    if (!job.failed && !job.consumed && job.hash === value.hash) return { token, opened: true }
    if (!job.ready) throw new Error('请先关闭此文件已打开的外部合并编辑器')
    await discard(token)
  }
  for (const [token, job] of jobs) if (jobs.size >= 10 && job.ready && (job.consumed || job.failed)) await discard(token)
  if (jobs.size >= 10) throw new Error('外部合并会话已达上限，请先关闭并读取其他文件的结果')
  const resultText = typeof request.text === 'string' ? request.text : value.text
  if (Buffer.byteLength(resultText) > 4 * 1024 * 1024) throw new Error('合并结果过大，请使用外部工具处理')
  const directory = await mkdtemp(join(tmpdir(), 'dsh-git-merge-')), token = randomUUID()
  const name = basename(request.path), file = prefix => join(directory, prefix + '-' + name)
  const job = { root: repo.root, path: request.path, hash: value.hash, directory, result: file('result'), ready: false, consumed: false }
  jobs.set(token, job)
  try {
    await Promise.all([['base', value.base?.text || ''], ['current', value.ours.text], ['incoming', value.theirs.text], ['result', resultText]].map(([side, text]) => writeFile(file(side), text, 'utf8')))
    await launchCode(['--reuse-window', '--wait', '--merge', file('incoming'), file('current'), file('base'), file('result')], { ...options, onExit: (code, signal) => {
      job.ready = true; job.failed = code !== 0 || !!signal
      job.timer = setTimeout(() => { discard(token).catch(() => {}) }, 24 * 60 * 60_000); job.timer.unref?.()
    } })
    return { token, opened: true }
  } catch (error) { await discard(token); throw error }
}
export async function conflictToolResult(repo, request, options = {}) {
  const job = jobs.get(request.token)
  if (!job || job.root !== repo.root || job.path !== request.path) throw new Error('外部合并会话已失效，请重新打开')
  if (!job.ready) return { running: true }
  if (job.failed) throw new Error('外部合并编辑器未正常退出，请重新打开或手工编辑结果')
  const current = await conflictFile(repo, request, options)
  if (current.hash !== job.hash) throw new Error('工作区或冲突版本已变化，未导入外部结果，请先刷新核对')
  const info = await stat(job.result)
  if (info.size > 4 * 1024 * 1024) throw new Error('外部结果过大，请使用外部工具完成并暂存后刷新')
  const bytes = await readFile(job.result), text = bytes.toString('utf8')
  if (bytes.includes(0) || !Buffer.from(text).equals(bytes)) throw new Error('外部结果不是 UTF-8 文本，请使用外部工具处理')
  job.consumed = true
  return { hash: job.hash, text }
}

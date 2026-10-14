import { stat, realpath, access } from 'node:fs/promises'
import { resolve, relative, isAbsolute, join, delimiter } from 'node:path'
import { spawn } from 'node:child_process'
import { isSafePath } from './git/write.js'

export async function openInEditor(repo, request, options = {}) {
  if (!isSafePath(request.path)) throw new Error('无效的文件路径')
  const root = await realpath(repo.root), file = await realpath(resolve(root, request.path))
  const inside = relative(root, file)
  if (inside === '..' || inside.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(inside) || !(await stat(file)).isFile()) throw new Error('文件不在仓库内或不是普通文件')
  const configured = options.executable
  if (configured && !isAbsolute(configured)) throw new Error('请在设置中填写 VS Code 可执行文件的完整路径')
  const candidates = configured ? [configured] : [
    ...(process.platform === 'win32' ? [
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
      process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe'),
    ] : ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']),
    ...(process.env.PATH || '').split(delimiter).filter(Boolean).map(directory => join(directory, process.platform === 'win32' ? 'Code.exe' : 'code')),
  ].filter(Boolean)
  let executable
  for (const candidate of candidates) {
    try { await access(candidate); if ((await stat(candidate)).isFile()) { executable = candidate; break } } catch {}
  }
  if (!executable) throw new Error('未找到 VS Code，请在设置中填写 Code.exe（或 code）的完整路径')
  if (options.signal?.aborted) throw new Error('操作已取消')
  const line = Number.isSafeInteger(request.line) && request.line > 0 ? request.line : 1
  const launch = options.launch || spawn
  const env = { ...process.env }
  // DSH/Electron may run its Host with this flag. Inheriting it makes
  // Code.exe run as Node and reject editor CLI options without opening a UI.
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key]
  await new Promise((done, fail) => {
    const child = launch(executable, ['--reuse-window', '--goto', file + ':' + line], { shell: false, detached: true, stdio: ['ignore', 'ignore', 'pipe'], env })
    let timer, settled = false, stderr = ''
    const finish = error => {
      if (settled) return
      settled = true; clearTimeout(timer); child.stderr?.destroy(); child.unref()
      error ? fail(error) : done()
    }
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4096) })
    child.once('error', error => finish(new Error('VS Code 启动失败：' + error.message)))
    child.once('exit', (code, signal) => finish(code === 0 ? null : new Error('VS Code 启动失败（' + (signal || code) + '）：' + (stderr.trim() || '请检查可执行文件路径'))))
    child.once('spawn', () => { timer = setTimeout(() => finish(null), 1000) })
  })
  return { opened: true }
}

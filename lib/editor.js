import { stat, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { launchCode } from './editorLauncher.js'
import { isSafePath } from './git/write.js'

export async function openInEditor(repo, request, options = {}) {
  if (!isSafePath(request.path)) throw new Error('无效的文件路径')
  const root = await realpath(repo.root), file = await realpath(resolve(root, request.path))
  const inside = relative(root, file)
  if (inside === '..' || inside.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(inside) || !(await stat(file)).isFile()) throw new Error('文件不在仓库内或不是普通文件')
  const line = Number.isSafeInteger(request.line) && request.line > 0 ? request.line : 1
  return launchCode(['--reuse-window', '--goto', file + ':' + line], options)
}

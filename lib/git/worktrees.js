import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { RepoSession } from './repo.js'
import { resolveRepoIdentity } from './capability.js'

export function normalizedPath(path) {
  const value = resolve(path)
  return process.platform === 'win32' ? value.toLowerCase() : value
}

export function commonDirectory(repo) {
  return normalizedPath(resolve(repo.root, repo.identity?.commonDir || repo.identity?.gitDir || '.git'))
}

/** Resolve the actual target again: a stale list must not authorize another repo. */
export async function openWorktree(repo, directory, options = {}) {
  if (typeof directory !== 'string' || !directory) throw new Error('请选择工作树目录')
  const trees = await repo.worktrees(options)
  const index = trees.findIndex(tree => normalizedPath(tree.path) === normalizedPath(directory))
  if (index < 0) throw new Error('工作树已不存在，请刷新列表')
  const tree = trees[index]
  if (tree.bare) throw new Error('裸仓库没有可打开的工作目录')
  const info = await stat(tree.path)
  if (!info.isDirectory()) throw new Error('工作树路径不是目录')
  const identity = await resolveRepoIdentity({ gitPath: repo.gitPath, cwd: tree.path, signal: options.signal })
  const target = new RepoSession({ root: tree.path, identity, gitPath: repo.gitPath, capabilities: repo.capabilities })
  if (normalizedPath(await realpath(commonDirectory(repo))) !== normalizedPath(await realpath(commonDirectory(target))) ||
      normalizedPath(await realpath(identity.root)) !== normalizedPath(await realpath(tree.path))) {
    throw new Error('目录已不属于当前仓库，请刷新列表')
  }
  return { target, tree, main: index === 0 }
}

export async function worktreeDetails(repo, request, options = {}) {
  const { target, tree, main } = await openWorktree(repo, request.directory, options)
  const status = await target.status({ ...options, force: true, details: false })
  const ignored = await target.runOrThrow(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory', '-z'], options)
  return { ...tree, main, current: normalizedPath(tree.path) === normalizedPath(repo.root),
    branch: status.branch, operation: status.operation,
    counts: {
      staged: status.files.filter(file => !['.', ' ', '?', '!'].includes(file.index)).length,
      unstaged: status.files.filter(file => file.kind !== 'untracked' && !['.', ' ', '?', '!'].includes(file.worktree)).length,
      untracked: status.files.filter(file => file.kind === 'untracked').length,
      conflicts: status.files.filter(file => file.kind === 'unmerged').length,
      total: status.files.length,
      ignored: ignored.split('\0').filter(Boolean).length,
    } }
}

async function absent(path) {
  try { await lstat(path); return false } catch (error) { if (error.code === 'ENOENT') return true; throw error }
}

export function worktreeDirectory(value) {
  if (typeof value !== 'string' || !isAbsolute(value.trim()) || /[\0\r\n]/.test(value)) throw new Error('请输入工作树的绝对路径')
  return resolve(value.trim())
}

/** Management previews also work for offline/missing directories. */
export async function worktreeManagementPreview(repo, request, options = {}) {
  const action = request.action
  const trees = await repo.worktrees(options)
  let result = { action }, evidence = []
  if (action === 'prune') {
    const dryRun = await repo.run(['worktree', 'prune', '--dry-run', '--verbose', '--expire=now'], options)
    if (dryRun.code !== 0) throw new Error(dryRun.stderr || '无法预览失效工作树记录')
    const output = [dryRun.stdout, dryRun.stderr].filter(Boolean).join('\n').trim()
    result = { action, output, candidates: trees.filter(tree => tree.prunable && !tree.locked), empty: !output }
  } else {
    const directory = worktreeDirectory(request.directory)
    const index = trees.findIndex(tree => normalizedPath(tree.path) === normalizedPath(directory))
    if (index < 0) throw new Error('工作树已不存在，请刷新列表')
    const tree = trees[index]
    if (index === 0 || tree.bare) throw new Error('主工作树不支持此管理操作')
    result = { action, tree }
    if (action === 'lock') {
      if (tree.locked) throw new Error('工作树已锁定，请刷新列表')
      if (request.reason !== undefined && (typeof request.reason !== 'string' || request.reason.length > 1000 || request.reason.includes('\0'))) throw new Error('锁定原因不能超过 1000 字且不能包含空字符')
      result.reason = (request.reason || '').trim()
    } else if (action === 'unlock') {
      if (!tree.locked) throw new Error('工作树未锁定，请刷新列表')
    } else if (action === 'move' || action === 'repair') {
      if (tree.locked) throw new Error('工作树已锁定，请先解锁')
      if (normalizedPath(tree.path) === normalizedPath(repo.root)) throw new Error('请先在 Git 中打开其他工作树，再移动或修复此目录')
      const destination = worktreeDirectory(request.destination)
      if (trees.some(item => {
        const a = normalizedPath(destination), b = normalizedPath(item.path)
        return a === b || a.startsWith(b + sep) || b.startsWith(a + sep)
      })) throw new Error('请选择与现有工作树互不包含的新目录')
      const parent = await realpath(dirname(destination))
      if (trees.some(item => normalizedPath(parent).startsWith(normalizedPath(item.path) + sep) || normalizedPath(parent) === normalizedPath(item.path))) throw new Error('目标目录不能位于现有工作树内')
      result.destination = destination
      if (action === 'move') {
        if (!await absent(destination)) throw new Error('目标目录已存在，请选择不存在的新目录')
        const { target } = await openWorktree(repo, tree.path, options)
        const status = await target.status({ ...options, force: true, details: false })
        if (status.operation) throw new Error('请先完成或中止工作树中的 Git 操作')
        result.changes = status.files.length
        evidence = [status.branch, status.operation]
      } else {
        if (!await absent(tree.path)) throw new Error('原工作树目录仍存在，不能将其关联到其他目录')
        const destinationInfo = await lstat(destination)
        if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink()) throw new Error('请选择实际工作树目录，不能使用符号链接')
        const dotGit = join(destination, '.git'), info = await lstat(dotGit)
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('目标目录必须包含原工作树的 .git 文件')
        const text = await readFile(dotGit, 'utf8'), match = /^gitdir: (.+)\r?\n?$/.exec(text)
        if (!match) throw new Error('目标目录的 .git 文件无效')
        const admin = await realpath(resolve(destination, match[1].trim()))
        const adminParent = await realpath(join(commonDirectory(repo), 'worktrees'))
        if (normalizedPath(dirname(admin)) !== normalizedPath(adminParent)) throw new Error('目标目录不属于当前仓库')
        const backlink = (await readFile(join(admin, 'gitdir'), 'utf8')).trim()
        if (normalizedPath(resolve(admin, backlink)) !== normalizedPath(join(tree.path, '.git'))) throw new Error('目标目录与所选工作树记录不匹配')
        evidence = [text, backlink, admin]
      }
    } else throw new Error('不支持的工作树管理操作')
  }
  return { ...result, token: createHash('sha256').update(JSON.stringify([commonDirectory(repo), trees, result, evidence])).digest('hex') }
}

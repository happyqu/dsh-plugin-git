import { open, mkdtemp, copyFile, readFile, writeFile, rename, unlink, rm, lstat, readlink, link } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { changelists } from './changelists.js'
import { readChunks, chunkPatch } from './changeChunks.js'

async function fingerprint(path) {
  const stat = await lstat(path)
  if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('此未跟踪文件类型无法储藏')
  const content = stat.isSymbolicLink() ? await readlink(path) : await readFile(path)
  return createHash('sha256').update(content).digest('hex')
}

async function removeUntracked(path, expected) {
  // Moving into a unique sibling first makes the subsequent content check
  // apply to the exact file we remove. Never overwrite a newer replacement.
  const held = join(dirname(path), '.dsh-stash-' + randomUUID())
  await rename(path, held)
  try {
    if (await fingerprint(held) !== expected) throw new Error('未跟踪文件在储藏期间发生了变化，已保留最新内容')
    await unlink(held)
  } catch (error) {
    try { await link(held, path); await unlink(held) }
    catch { error.message += '；文件保留在：' + held }
    throw error
  }
}

/** Merge a task's staged snapshot into the existing index before touching files. */
export async function applyChangelistStash(repo, request, sha, options = {}) {
  const indexResult = await repo.run(['rev-parse', '--git-path', 'index'], options)
  if (indexResult.code !== 0) throw new Error('无法定位暂存区')
  const index = resolve(repo.root, indexResult.stdout.trim())
  let lock
  try { lock = await open(index + '.lock', 'wx') }
  catch (error) { if (error.code === 'EEXIST') throw new Error('暂存区正在被其他操作使用'); throw error }
  let directory, published = false, applied = false
  try {
    directory = await mkdtemp(join(dirname(index), 'dsh-apply-'))
    const working = join(directory, 'working-index'), staged = join(directory, 'staged-index')
    await copyFile(index, working); await copyFile(index, staged)
    const patch = await repo.run(['diff', '--binary', '--full-index', '--no-ext-diff', sha + '^1', sha + '^2'], options)
    if (patch.code !== 0) throw new Error('无法读取储藏的暂存版本')
    if (patch.stdout) {
      const prepared = await repo.runWrite(['apply', '--cached', '--3way', '--whitespace=nowarn', '-'], {
        ...options, env: { GIT_INDEX_FILE: staged }, input: patch.stdout,
      })
      if (prepared.code !== 0) return { ok: false, ...prepared, message: '暂存版本存在重叠，原内容已保留。可取消“恢复暂存状态”后应用：' + prepared.stderr.trim() }
    }
    const result = await repo.runWrite(['stash', 'apply', sha], { ...options, timeoutMs: 120000, env: { GIT_INDEX_FILE: working } })
    applied = true
    // A failed apply may have produced conflict stages. Publish that index so
    // Git and the UI see the same conflict state; keep the stash for recovery.
    await lock.writeFile(await readFile(result.code === 0 ? staged : working)); await lock.close(); lock = null
    await rename(index + '.lock', index); published = true
    if (result.code !== 0) return { ok: false, ...result, message: result.stderr.trim() || '应用储藏时发生冲突' }
    let message = '已应用储藏', dropped = false
    if (request.pop) {
      const identity = await repo.run(['rev-parse', '--verify', request.ref || 'refs/stash'], options)
      if (identity.code === 0 && identity.stdout.trim() === sha) {
        const drop = await repo.runWrite(['stash', 'drop', request.ref || 'stash@{0}'], { timeoutMs: 60000 })
        dropped = drop.code === 0
        message = dropped ? '已应用并移除储藏' : '储藏已应用，但删除失败；原储藏保留'
      } else message = '储藏已应用；列表已变化，原储藏保留'
    }
    return { ok: true, ...result, message, dropped }
  } catch (error) {
    if (applied) { error.message = '储藏应用后暂存区恢复失败，恢复文件保留在：' + directory + '。' + error.message; error.recovery = { stash: sha } }
    throw error
  } finally {
    await lock?.close()
    if (!published) await unlink(index + '.lock').catch(error => { if (error.code !== 'ENOENT') throw error })
    if (directory && (!applied || published)) await rm(directory, { recursive: true, force: true })
  }
}

/** A standard Git stash containing only the requested task, including split files. */
export async function stashChangelist(repo, request, options = {}) {
  const status = await repo.status({ ...options, force: true })
  if (status.operation || status.files.some(file => file.kind === 'unmerged')) throw new Error('请先完成当前 Git 操作并解决冲突')
  const state = await changelists(repo, {}, options), list = state.lists.find(entry => entry.id === request.id)
  if (!list || state.version !== request.changelistVersion) throw new Error('改动列表已变化，请刷新后重试')
  const files = status.files.filter(file => state.chunks[file.path]
    ? state.chunks[file.path].parts.some(part => part.list === list.id) : state.assignments[file.path] === list.id)
  if (!files.length) throw new Error('此列表没有需要储藏的改动')
  if (new Set(files.map(file => file.path)).size !== files.length) throw new Error('同一文件同时存在删除和未跟踪状态，请先调整暂存状态')
  if (files.some(file => String(file.submodule || '').startsWith('S'))) throw new Error('子模块改动请在子模块仓库中储藏')
  const head = await repo.run(['rev-parse', '--verify', 'HEAD'], options)
  if (head.code !== 0) throw new Error('首次提交前无法储藏，请先创建提交')
  const headSha = head.stdout.trim()
  const indexResult = await repo.run(['rev-parse', '--git-path', 'index'], options)
  if (indexResult.code !== 0) throw new Error('无法定位暂存区')
  const index = resolve(repo.root, indexResult.stdout.trim())
  let lock
  try { lock = await open(index + '.lock', 'wx') }
  catch (error) { if (error.code === 'EEXIST') throw new Error('暂存区正在被其他操作使用'); throw error }
  let directory, published = false, stored = null
  try {
    directory = await mkdtemp(join(dirname(index), 'dsh-stash-'))
    const privateIndex = join(directory, 'index'), restored = join(directory, 'restored-index'), originalIndex = join(directory, 'original-index')
    await copyFile(index, restored)
    await copyFile(index, originalIndex)
    const env = { GIT_INDEX_FILE: privateIndex, GIT_LITERAL_PATHSPECS: '1' }
    const run = async (args, extra = {}) => {
      const result = await repo.runWrite(args, { ...options, env, ...extra })
      if (result.code !== 0) throw new Error(result.stderr.trim() || '储藏失败')
      return result.stdout
    }
    const partial = files.filter(file => state.chunks[file.path]), full = files.filter(file => !state.chunks[file.path] && file.kind !== 'untracked')
    const untracked = files.filter(file => file.kind === 'untracked')
    const untrackedSnapshots = new Map()
    for (const file of untracked) untrackedSnapshots.set(file.path, await fingerprint(resolve(repo.root, file.path)))
    const fullPaths = Array.from(new Set(full.flatMap(file => file.originalPath ? [file.path, file.originalPath] : [file.path])))
    await run(['read-tree', headSha])
    if (fullPaths.length) await run(['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: fullPaths.join('\0') + '\0' })
    const partialRecords = []
    for (const file of partial) {
      const record = state.chunks[file.path]
      if (record.invalid || record.parts.some(part => !part.list)) throw new Error('请先重新分配已变化的代码块')
      const current = await readChunks(repo, file, options)
      if (record.parts.some((part, i) => part.hash !== current.parts[i]?.hash) || record.parts.length !== current.parts.length) throw new Error('代码块已变化，请刷新')
      const chosen = { parts: record.parts.map(part => ({ ...part, selected: part.list === list.id })) }
      await run(['apply', '--cached', '--recount', '--whitespace=nowarn', '-'], { input: chunkPatch(current, chosen) })
      partialRecords.push({ file, record, current })
    }
    const tree = (await run(['write-tree'])).trim()
    const patch = await run(['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', headSha])
    if (patch) await run(['apply', '--reverse', '--check', '--binary', '-'], { input: patch })
    if (fullPaths.length) await run(['reset', '-q', headSha, '--pathspec-from-file=-', '--pathspec-file-nul'], {
      env: { ...env, GIT_INDEX_FILE: restored }, input: fullPaths.join('\0') + '\0',
    })
    for (const { file, record, current } of partialRecords) {
      // Compute the index after removing this task while retaining staging for
      // other tasks in the same file; refuse overlapping staged versions.
      await run(['read-tree', headSha])
      await run(['add', '--', file.path])
      const total = (await run(['ls-files', '--stage', '--', file.path])).match(/^(\d+) ([a-f0-9]+) 0\t/)
      await run(['read-tree', headSha])
      const remaining = { parts: record.parts.map(part => ({ ...part, selected: part.list !== list.id })) }
      const remainingPatch = chunkPatch(current, remaining)
      if (remainingPatch) await run(['apply', '--cached', '--recount', '--whitespace=nowarn', '-'], { input: remainingPatch })
      const remainder = (await run(['ls-files', '--stage', '--', file.path])).match(/^(\d+) ([a-f0-9]+) 0\t/)
      const original = (await run(['ls-files', '--stage', '--', file.path], { env: { ...env, GIT_INDEX_FILE: restored } })).match(/^(\d+) ([a-f0-9]+) 0\t/)
      if (!total || !remainder || !original) throw new Error('该文件的暂存状态无法拆分储藏')
      const inputs = []
      for (const [i, sha] of [original[2], total[2], remainder[2]].entries()) {
        const path = join(directory, 'merge-' + i); await writeFile(path, await run(['cat-file', 'blob', sha])); inputs.push(path)
      }
      const merge = await repo.runWrite(['merge-file', '-p', ...inputs], { ...options, env })
      if (merge.code !== 0) throw new Error('代码块与已有暂存内容重叠，请先调整暂存区')
      const sha = (await run(['hash-object', '-w', '--stdin'], { input: merge.stdout })).trim()
      await run(['update-index', '--cacheinfo', original[1], sha, file.path], { env: { ...env, GIT_INDEX_FILE: restored } })
    }
    const originalEnv = { ...env, GIT_INDEX_FILE: originalIndex }, indexEnv = { ...env, GIT_INDEX_FILE: join(directory, 'stash-index') }
    await run(['read-tree', headSha], { env: indexEnv })
    if (fullPaths.length) {
      await run(['update-index', '--force-remove', '-z', '--stdin'], { env: indexEnv, input: fullPaths.join('\0') + '\0' })
      const scope = new Set(fullPaths)
      const entries = (await run(['ls-files', '--stage', '-z'], { env: originalEnv })).split('\0').filter(entry => scope.has(entry.slice(entry.indexOf('\t') + 1)))
      if (entries.length) await run(['update-index', '-z', '--index-info'], { env: indexEnv, input: entries.join('\0') + '\0' })
    }
    if (partialRecords.length) {
      const originalTree = (await run(['write-tree'], { env: originalEnv })).trim()
      const restoredTree = (await run(['write-tree'], { env: { ...env, GIT_INDEX_FILE: restored } })).trim()
      for (const { file } of partialRecords) {
        const difference = await run(['diff', '--binary', '--full-index', '--no-ext-diff', originalTree, restoredTree, '--', file.path])
        if (difference) await run(['apply', '--cached', '--reverse', '--recount', '--whitespace=nowarn', '-'], { env: indexEnv, input: difference })
      }
    }
    const indexTree = (await run(['write-tree'], { env: indexEnv })).trim()
    const indexCommit = (await run(['commit-tree', indexTree, '-p', headSha], { input: 'index: ' + list.name })).trim()
    const parents = ['-p', headSha, '-p', indexCommit]
    if (untracked.length) {
      await run(['read-tree', '--empty'])
      await run(['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: untracked.map(file => file.path).join('\0') + '\0' })
      const untrackedTree = (await run(['write-tree'])).trim()
      parents.push('-p', (await run(['commit-tree', untrackedTree], { input: 'untracked: ' + list.name })).trim())
      for (const file of untracked) if (await fingerprint(resolve(repo.root, file.path)) !== untrackedSnapshots.get(file.path)) throw new Error('未跟踪文件已变化，请重新储藏')
    }
    const sha = (await run(['commit-tree', tree, ...parents], { input: 'On ' + (status.branch?.head || 'HEAD') + ': ' + list.name })).trim()
    await changelists(repo, { action: 'stashCapture', id: list.id, sha, internal: true }, options)
    const currentHead = await repo.run(['rev-parse', '--verify', 'HEAD'], options)
    if (currentHead.stdout.trim() !== headSha) throw new Error('储藏期间分支已变化，工作区尚未修改')
    await run(['stash', 'store', '-m', 'On ' + (status.branch?.head || 'HEAD') + ': ' + list.name, sha])
    stored = sha
    if (patch) await run(['apply', '--reverse', '--binary', '-'], { input: patch, signal: undefined })
    for (const file of untracked) await removeUntracked(resolve(repo.root, file.path), untrackedSnapshots.get(file.path))
    await lock.writeFile(await readFile(restored)); await lock.close(); lock = null
    await rename(index + '.lock', index); published = true
    return { ok: true, code: 0, stdout: sha, stderr: '', message: '已储藏：' + list.name }
  } catch (error) {
    if (stored) { error.message = '储藏已保存，但工作区清理未完成，请先检查并恢复储藏。' + error.message; error.recovery = { stash: stored } }
    throw error
  } finally {
    await lock?.close()
    if (!published) await unlink(index + '.lock').catch(error => { if (error.code !== 'ENOENT') throw error })
    if (directory && (!stored || published)) await rm(directory, { recursive: true, force: true })
  }
}

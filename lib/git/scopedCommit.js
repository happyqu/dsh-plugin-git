import { open, readFile, writeFile, copyFile, rename, unlink, mkdtemp, mkdir, chmod, access, rm } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { changelists } from './changelists.js'
import { readChunks, chunkPatch } from './changeChunks.js'

const quote = value => "'" + value.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'"
const hooks = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-rewrite']

export async function changelistDiff(repo, request, options = {}) {
  if (!Array.isArray(request.paths) || !request.paths.length) return { text: '' }
  const status = await repo.status(options)
  const paths = new Set(request.paths)
  const state = request.changelistVersion === undefined ? null : await changelists(repo, {}, options)
  if (state && state.version !== request.changelistVersion) throw new Error('提交范围已变化，请重新生成提交信息')
  for (const path of request.paths) {
    const file = status.files.find(file => file.path === path)
    if (!file) throw new Error('文件状态已变化，请刷新后重试')
    if (file.originalPath) paths.add(file.originalPath)
  }
  const result = await repo.run(['rev-parse', '--git-path', 'index'], options)
  if (result.code !== 0) throw new Error('无法定位暂存区')
  const directory = await mkdtemp(join(dirname(resolve(repo.root, result.stdout.trim())), 'dsh-diff-'))
  try {
    const env = { GIT_INDEX_FILE: join(directory, 'index'), GIT_LITERAL_PATHSPECS: '1' }
    const invoke = async (args, extra = {}) => {
      const value = await repo.runWrite(args, { ...options, env, ...extra })
      if (value.code !== 0) throw new Error(value.stderr.trim() || '无法读取文件差异')
      return value
    }
    const head = await repo.run(['rev-parse', '--verify', 'HEAD'], options)
    await invoke(['read-tree', ...(head.code === 0 ? [head.stdout.trim()] : ['--empty'])])
    const partialPaths = request.paths.filter(path => state?.chunks?.[path])
    const fullPaths = Array.from(paths).filter(path => !partialPaths.includes(path))
    if (fullPaths.length) await invoke(['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: fullPaths.join('\0') + '\0' })
    for (const path of partialPaths) {
      const record = state.chunks[path]
      if (record.invalid || record.parts.some(part => !part.list)) throw new Error('代码块需要重新分配')
      const current = await readChunks(repo, status.files.find(file => file.path === path), options)
      if (record.parts.length !== current.parts.length || record.parts.some((part, index) => part.hash !== current.parts[index].hash)) throw new Error('代码块已变化，请刷新')
      await invoke(['apply', '--cached', '--recount', '--whitespace=nowarn', '-'], { input: chunkPatch(current, record) })
    }
    const diff = await invoke(['diff', '--cached', '--find-renames=50%', '-U3'])
    return { text: diff.stdout }
  } finally { await rm(directory, { recursive: true, force: true }) }
}

/** Commit full selected files with a private index; preserve every outside index entry. */
export async function commitPaths(repo, request, options = {}) {
  if (!Array.isArray(request.paths) || !request.paths.length) throw new Error('请勾选需要提交的文件')
  if (!String(request.message || '').trim()) throw new Error('提交信息不能为空')
  const status = await repo.status({ ...options, force: true })
  if (status.operation) throw new Error('请先完成当前 Git 操作，再使用改动列表提交')
  if (status.files.some(file => file.kind === 'unmerged' || file.conflict)) throw new Error('请先解决文件冲突')
  const paths = Array.from(new Set(request.paths))
  let selectionState = null
  if (request.changelistVersion !== undefined) {
    const state = await changelists(repo, {}, options)
    if (state.version !== request.changelistVersion || state.selected.length !== paths.length || paths.some(path => !state.selected.includes(path))) {
      throw new Error('改动列表或提交范围已变化，请刷新后重新提交')
    }
    selectionState = state
  }
  const allowed = new Set(paths)
  for (const path of paths) {
    const file = status.files.find(file => file.path === path)
    if (!file) throw new Error('提交范围中的文件状态已变化，请刷新后重试')
    if (file.originalPath) allowed.add(file.originalPath)
  }
  const version = await repo.run(['version'], options)
  const match = version.stdout.match(/(\d+)\.(\d+)/)
  if (!match || (+match[1] < 2 || (+match[1] === 2 && +match[2] < 29))) throw new Error('改动列表提交需要 Git 2.29 或更高版本')
  const indexResult = await repo.run(['rev-parse', '--git-path', 'index'], options)
  if (indexResult.code !== 0) throw new Error('无法定位 Git 暂存区')
  const index = resolve(repo.root, indexResult.stdout.trim())
  const headResult = await repo.run(['rev-parse', '--verify', 'HEAD'], options)
  const head = headResult.code === 0 ? headResult.stdout.trim() : null
  const hooksResult = await repo.run(['rev-parse', '--git-path', 'hooks'], options)
  if (hooksResult.code !== 0) throw new Error('无法定位 Git hooks')
  const originalHooks = resolve(repo.root, hooksResult.stdout.trim())
  let lock
  try { lock = await open(index + '.lock', 'wx') }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Git 暂存区正在被其他操作使用，请稍后重试'); throw error }
  let directory, published = false, landed = false
  try {
    directory = await mkdtemp(join(dirname(index), 'dsh-commit-'))
    const privateIndex = join(directory, 'index')
    const restoredIndex = join(directory, 'restored-index')
    const env = { GIT_INDEX_FILE: privateIndex, GIT_LITERAL_PATHSPECS: '1' }
    const invoke = (args, extra = {}) => repo.runWrite(args, { ...options, env, ...extra })
    const must = async (args, extra) => {
      const result = await invoke(args, extra)
      if (result.code !== 0) throw new Error(result.stderr.trim() || '准备提交失败')
      return result
    }
    try { await copyFile(index, restoredIndex) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    await must(['read-tree', ...(head ? [head] : ['--empty'])])
    const partialPaths = paths.filter(path => selectionState?.chunks?.[path])
    const fullPaths = Array.from(allowed).filter(path => !partialPaths.includes(path))
    if (fullPaths.length) await must(['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: fullPaths.join('\0') + '\0' })
    const expected = Object.create(null), preserved = []
    for (const path of partialPaths) {
      const record = selectionState.chunks[path]
      if (record.invalid || record.parts.some(part => !part.list)) throw new Error('代码块需要重新分配，请打开文件查看')
      const current = await readChunks(repo, status.files.find(file => file.path === path), options)
      if (record.parts.length !== current.parts.length || record.parts.some((part, index) => part.hash !== current.parts[index].hash)) throw new Error('文件内容已变化，请重新查看代码块')
      const patch = chunkPatch(current, record)
      if (!patch) throw new Error('没有勾选需要提交的代码块')
      await must(['apply', '--cached', '--recount', '--whitespace=nowarn', '-'], { input: patch })
      const staged = await must(['ls-files', '--stage', '-z', '--', path])
      const entry = staged.stdout.match(/^(\d+) ([a-f0-9]+) 0\t/)
      if (!entry) throw new Error('无法读取所选代码块版本')
      const base = await repo.run(['rev-parse', head + ':' + path], options)
      const original = await must(['ls-files', '--stage', '-z', '--', path], { env: { ...env, GIT_INDEX_FILE: restoredIndex } })
      const previous = original.stdout.match(/^(\d+) ([a-f0-9]+) 0\t/)
      if (base.code !== 0 || !previous) throw new Error('该文件的暂存状态不支持代码块提交，请使用暂存区模式')
      let merged = entry[2]
      if (previous[2] !== base.stdout.trim() && previous[2] !== entry[2]) {
        const mergeInputs = []
        for (const [i, sha] of [entry[2], base.stdout.trim(), previous[2]].entries()) {
          const blob = await must(['cat-file', 'blob', sha])
          const path = join(directory, 'merge-' + i)
          await writeFile(path, blob.stdout, 'utf8'); mergeInputs.push(path)
        }
        const merge = await invoke(['merge-file', '-p', ...mergeInputs])
        if (merge.code !== 0) throw new Error('所选代码块与此文件已有暂存版本重叠，请先调整暂存内容')
        merged = (await must(['hash-object', '-w', '--stdin'], { input: merge.stdout })).stdout.trim()
      }
      expected[path] = entry[2]
      preserved.push({ path, mode: entry[1], sha: merged })
    }

    // Preserve all normal hooks. A reference-transaction guard checks the final
    // commit tree AFTER pre-commit/commit-msg hooks, before HEAD can move.
    const guardedHooks = join(directory, 'hooks')
    await mkdir(guardedHooks)
    for (const hook of hooks) {
      const original = join(originalHooks, hook)
      try { await access(original) } catch { continue }
      const path = join(guardedHooks, hook)
      await writeFile(path, '#!/bin/sh\nexec ' + quote(original) + ' "$@"\n')
      await chmod(path, 0o755)
    }
    const guard = join(directory, 'guard.cjs')
    await writeFile(guard, `
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const spec=${JSON.stringify({ gitPath: repo.gitPath, root: repo.root, head, branch: status.branch?.detached ? null : 'refs/heads/' + status.branch?.head, paths: Array.from(allowed), expected })};
const input=fs.readFileSync(0,'utf8');
if(process.argv[2]!=='prepared')process.exit(0);
const allowed=new Set(spec.paths);
for(const line of input.trim().split('\\n')){
 const [oldSha,newSha,ref]=line.split(' ');
 if(ref!=='HEAD'&&!ref.startsWith('refs/heads/'))continue;
 if(ref!=='HEAD'&&ref!==spec.branch){console.error('提交期间当前分支已变化');process.exit(1)}
 if(/^0+$/.test(newSha))continue;
 if(oldSha!==(spec.head||'0'.repeat(oldSha.length))){console.error('提交期间分支已变化');process.exit(1)}
 const args=['diff-tree','-r','--no-commit-id','--name-only','--no-renames','-z',...(spec.head?[spec.head,newSha]:['--root',newSha])];
 const result=spawnSync(spec.gitPath,args,{cwd:spec.root,encoding:'utf8',windowsHide:true});
 if(result.status!==0){console.error('无法核对提交范围');process.exit(1)}
 if(result.stdout.split('\\0').filter(Boolean).some(path=>!allowed.has(path))){console.error('Git hook 修改了提交范围之外的文件，已阻止提交');process.exit(1)}
 for(const [path,sha] of Object.entries(spec.expected)){
  const actual=spawnSync(spec.gitPath,['rev-parse',newSha+':'+path],{cwd:spec.root,encoding:'utf8',windowsHide:true});
  if(actual.status!==0||actual.stdout.trim()!==sha){console.error('Git hook 改写了代码块提交范围，已阻止提交');process.exit(1)}
 }
}
`)
    const originalRefHook = join(originalHooks, 'reference-transaction')
    let originalRef = ''
    try { await access(originalRefHook); originalRef = 'printf \'%s\\n\' "$input" | ' + quote(originalRefHook) + ' "$@" || exit $?\n' } catch {}
    const refHook = join(guardedHooks, 'reference-transaction')
    await writeFile(refHook, '#!/bin/sh\ninput=$(cat)\n' + originalRef + 'printf \'%s\\n\' "$input" | ' + quote(process.execPath) + ' ' + quote(guard) + ' "$@"\n')
    await chmod(refHook, 0o755)
    const result = await invoke(['-c', 'core.hooksPath=' + guardedHooks, 'commit', '-m', request.message], { timeoutMs: 180000 })
    if (result.code !== 0) return { ok: false, ...result, message: result.stderr.trim() || '提交失败' }
    landed = true
    // Rebase only selected entries onto the new HEAD in a copy of the original
    // index. Other staged versions, including partial staging, remain intact.
    if (fullPaths.length) await must(['reset', '-q', 'HEAD', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      env: { ...env, GIT_INDEX_FILE: restoredIndex }, input: fullPaths.join('\0') + '\0', signal: undefined,
    })
    for (const entry of preserved) await must(['update-index', '--cacheinfo', entry.mode, entry.sha, entry.path], {
      env: { ...env, GIT_INDEX_FILE: restoredIndex }, signal: undefined,
    })
    await lock.writeFile(await readFile(restoredIndex))
    await lock.close(); lock = null
    await rename(index + '.lock', index); published = true
    return { ok: true, ...result, message: result.stdout.trim() || '提交完成' }
  } catch (error) {
    if (landed) error.message = '提交已生成，但暂存区恢复失败；原暂存区仍保留。恢复文件：' + directory + '。' + error.message
    throw error
  } finally {
    await lock?.close()
    if (!published) await unlink(index + '.lock').catch(error => { if (error.code !== 'ENOENT') throw error })
    if (directory && (!landed || published)) await rm(directory, { recursive: true, force: true })
  }
}

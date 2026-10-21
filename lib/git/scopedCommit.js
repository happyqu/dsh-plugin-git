import { readFile, writeFile, copyFile, mkdtemp, mkdir, chmod, access, rm } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { changelists, readChangelistCommitPolicy } from './changelists.js'
import { blockedChangelistCommitPaths } from '../shared/changelistCommitPolicy.js'
import { readChunks, chunkPatch } from './changeChunks.js'
import { retryFileOperation } from './fileRetry.js'
import { acquireIndexLock, publishIndexLock, releaseIndexLock } from './indexLock.js'
import { parseGitVersion, meetsVersion, reportGitPhase } from './exec.js'
import { runCommitWithDiagnostics } from './commitDiagnostics.js'

const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'"
const quote = value => shellQuote(value.replace(/\\/g, '/'))
// Match Git's line-oriented path output with core.quotepath=false. Control
// characters, double quotes and backslashes are C-quoted; Unicode stays UTF-8.
const quoteGitPath = path => {
  const escapes = { '\x07': '\\a', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\v': '\\v', '\f': '\\f', '\r': '\\r', '"': '\\"', '\\': '\\\\' }
  const value = path.replace(/[\x00-\x1f\x7f"\\]/g, char => escapes[char] || '\\' + char.charCodeAt(0).toString(8).padStart(3, '0'))
  return value === path ? path : '"' + value + '"'
}
const hooks = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-rewrite']

export async function changelistDiff(repo, request, options = {}, prepared = {}) {
  if (!Array.isArray(request.paths) || !request.paths.length) return { text: '' }
  const status = options.status || await repo.status(options)
  const paths = new Set(request.paths)
  const state = request.changelistVersion === undefined ? null : options.lightweight
    ? await readChangelistCommitPolicy(repo, options) : await changelists(repo, {}, options)
  if (request.changelistVersion !== undefined && state?.version !== request.changelistVersion) throw new Error('提交范围已变化，请重新生成提交信息')
  const byPath = new Map(status.files.map(file => [file.path, file]))
  for (const path of request.paths) {
    const file = byPath.get(path)
    if (!file) throw new Error('文件状态已变化，请刷新后重试')
    if (file.originalPath) paths.add(file.originalPath)
  }
  let indexPath = prepared.indexPath
  if (!indexPath) {
    const result = await repo.run(['rev-parse', '--git-path', 'index'], options)
    if (result.code !== 0) throw new Error('无法定位暂存区')
    indexPath = result.stdout.trim()
  }
  const directory = await mkdtemp(join(dirname(resolve(repo.root, indexPath)), 'dsh-diff-'))
  try {
    const env = { GIT_INDEX_FILE: join(directory, 'index'), GIT_LITERAL_PATHSPECS: '1' }
    const invoke = async (args, extra = {}) => {
      const value = await repo.runWrite(args, { ...options, env, ...extra })
      if (value.code !== 0) throw new Error(value.stderr.trim() || '无法读取文件差异')
      return value
    }
    const head = Object.hasOwn(prepared, 'head')
      ? { code: prepared.head ? 0 : 1, stdout: prepared.head || '' }
      : await repo.run(['rev-parse', '--verify', 'HEAD'], options)
    await invoke(['read-tree', ...(head.code === 0 ? [head.stdout.trim()] : ['--empty'])])
    const partialPaths = request.paths.filter(path => state?.chunks?.[path])
    const fullPaths = Array.from(paths).filter(path => !partialPaths.includes(path))
    if (fullPaths.length) {
      await invoke(['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: fullPaths.join('\0') + '\0' })
    }
    for (const path of partialPaths) {
      const record = state.chunks[path]
      // Unassigned changes outside the selected scope must remain untouched;
      // they do not prevent generating a message for the valid selected parts.
      if (record.invalid || record.parts.some(part => part.selected && !part.list)) throw new Error('所选代码块需要重新分配，请打开文件查看：' + path)
      // `head` is already resolved above; reuse the sha so this loop does not
      // re-spawn `rev-parse` once per file. A missing HEAD (no commit yet) stays
      // null, which `readChunks` rejects with its own explanation.
      const current = await readChunks(repo, byPath.get(path), options, head.code === 0 ? head.stdout.trim() : null)
      if (record.parts.length !== current.parts.length || record.parts.some((part, index) => part.hash !== current.parts[index].hash)) throw new Error('代码块已变化，请刷新')
      const patch = chunkPatch(current, record)
      if (!patch) throw new Error('没有勾选需要提交的代码块：' + path)
      await invoke(['apply', '--cached', '--recount', '--whitespace=nowarn', '-'], { input: patch })
    }
    if (options.readDiff) return { text: await options.readDiff(env, head.code === 0 ? head.stdout.trim() : null) }
    const diff = await invoke(['diff', '--cached', '--find-renames=50%', '-U3'])
    return { text: diff.stdout }
  } finally { await retryFileOperation(() => rm(directory, { recursive: true, force: true })) }
}

/** Commit full selected files with a private index; preserve every outside index entry. */
export async function commitPaths(repo, request, options = {}) {
  if (!Array.isArray(request.paths) || !request.paths.length) throw new Error('请勾选需要提交的文件')
  if (!String(request.message || '').trim()) throw new Error('提交信息不能为空')
  reportGitPhase(options.signal, 'commit.phase.validating')
  const status = await repo.status({ ...options, force: true, details: false })
  if (status.operation) throw new Error('请先完成当前 Git 操作，再使用改动列表提交')
  if (status.files.some(file => file.kind === 'unmerged' || file.conflict)) throw new Error('请先解决文件冲突')
  const paths = Array.from(new Set(request.paths))
  let selectionState = null
  if (request.changelistVersion !== undefined) {
    const state = await changelists(repo, {}, { ...options, details: false })
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
  const policy = selectionState || await readChangelistCommitPolicy(repo, options)
  const blocked = blockedChangelistCommitPaths(policy, Array.from(allowed), selectionState !== null)
  if (blocked.length) throw new Error('提交范围包含已屏蔽提交的改动列表，请先允许提交或调整范围。\n' + blocked.slice(0, 20).join('\n'))
  // The executable's version was already probed when the session opened, so
  // re-running `git version` on every commit is a redundant process launch. Using
  // the probed value ALSO routes this gate through the same capability mechanism
  // the rest of the plugin uses, instead of a second, independent version parse.
  const version = repo.capabilities?.version ?? parseGitVersion((await repo.run(['version'], options)).stdout)
  if (version === null || !meetsVersion(version, '2.29')) throw new Error('改动列表提交需要 Git 2.29 或更高版本')
  // Both paths must still be resolved by Git (linked worktrees, custom hooks
  // and GIT_INDEX_FILE), but one process can answer both questions.
  const locations = await repo.run(['rev-parse', '--git-path', 'index', '--git-path', 'hooks'], options)
  const [indexPath, hooksPath] = locations.stdout.trimEnd().split('\n').map(value => value.replace(/\r$/, ''))
  if (locations.code !== 0 || !indexPath || !hooksPath) throw new Error('无法定位 Git 暂存区或 hooks')
  const index = resolve(repo.root, indexPath)
  let head = status.branch?.oid
  if (head !== null && !/^[a-f0-9]{40,64}$/.test(head || '')) {
    const headResult = await repo.run(['rev-parse', '--verify', 'HEAD'], options)
    head = headResult.code === 0 ? headResult.stdout.trim() : null
  }
  const originalHooks = resolve(repo.root, hooksPath)
  await acquireIndexLock(index + '.lock')
  let directory, published = false, landed = false, uncertain = false, outcome, failure
  try {
    reportGitPhase(options.signal, 'commit.phase.preparing')
    directory = await mkdtemp(join(dirname(index), 'dsh-commit-'))
    const privateIndex = join(directory, 'index')
    const restoredIndex = join(directory, 'restored-index')
    const stageFile = join(directory, 'commit-stage')
    const env = { GIT_INDEX_FILE: privateIndex, GIT_LITERAL_PATHSPECS: '1' }
    const invoke = async (args, extra = {}) => {
      const commandOptions = { ...options, env, ...extra }
      const committing = args[0] === 'commit' || (args[0] === '-c' && args[2] === 'commit')
      const result = committing
        ? await runCommitWithDiagnostics(repo, args, commandOptions, { directory, stageFile })
        : await repo.runWrite(args, commandOptions)
      if (result.timedOut) {
        const stage = committing ? await readFile(stageFile, 'utf8').catch(() => 'git commit') : 'git ' + args[0]
        result.stderr = [result.stderr, '超时步骤：' + stage.trim()].filter(Boolean).join('\n')
      }
      return result
    }
    const must = async (args, extra) => {
      const result = await invoke(args, extra)
      if (result.code !== 0) throw new Error(result.stderr.trim() || '准备提交失败')
      return result
    }
    let hasIndex = false
    try { await copyFile(index, restoredIndex); hasIndex = true }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    // A fresh read-tree discards stat data for every tracked file. Git commit
    // then re-reads their contents to refresh the private index, even when only
    // one file is selected. Resetting a copy keeps matching stat entries while
    // resetting ALL staged content to HEAD, including partially staged files;
    // outside staged changes stay only in restoredIndex. Never use -u: the
    // worktree must remain untouched.
    if (head && hasIndex) {
      await copyFile(restoredIndex, privateIndex)
      await must(['read-tree', '--reset', head])
    } else await must(['read-tree', ...(head ? [head] : ['--empty'])])
    const partialPaths = paths.filter(path => selectionState?.chunks?.[path])
    const fullPaths = Array.from(allowed).filter(path => !partialPaths.includes(path))
    if (fullPaths.length) await must(['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: fullPaths.join('\0') + '\0' })
    const expected = Object.create(null), preserved = []
    for (const path of partialPaths) {
      const record = selectionState.chunks[path]
      if (record.invalid || record.parts.some(part => part.selected && !part.list)) throw new Error('所选代码块需要重新分配，请打开文件查看：' + path)
      const current = await readChunks(repo, status.files.find(file => file.path === path), options, head)
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
    const markStage = stage => 'printf \'%s\\n\' ' + quote(stage) + ' > ' + quote(stageFile) + '\n'
    for (const hook of hooks) {
      const original = join(originalHooks, hook)
      try { await access(original) } catch { continue }
      const path = join(guardedHooks, hook)
      await writeFile(path, '#!/bin/sh\n' + markStage('hook: ' + hook)
        + quote(original) + ' "$@"\nresult=$?\n' + markStage('git commit') + 'exit "$result"\n')
      await chmod(path, 0o755)
    }
    const guard = join(directory, 'guard.sh')
    const receipt = join(directory, 'commit-receipt')
    // Git already supplies a shell for hooks. Do not launch process.execPath:
    // in a desktop Host that starts another Electron runtime inside Git's ref
    // transaction, whose startup can hang the entire commit. Compare C-quoted
    // paths as complete lines, keeping filenames opaque to the shell and the
    // command line bounded even when thousands of paths are selected.
    const gitCommand = quote(repo.gitPath)
    const allowedFile = join(directory, 'allowed-paths')
    const changedFile = join(directory, 'changed-paths')
    await writeFile(allowedFile, Array.from(allowed, quoteGitPath).join('\n') + '\n')
    const branch = status.branch?.detached ? '' : 'refs/heads/' + status.branch?.head
    await writeFile(guard, [
      '#!/bin/sh',
      '[ "$1" = prepared ] || exit 0',
      'fail() { printf "%s\\n" "$1" >&2; exit 1; }',
      'unset GIT_LITERAL_PATHSPECS GIT_GLOB_PATHSPECS GIT_NOGLOB_PATHSPECS GIT_ICASE_PATHSPECS',
      'candidate=',
      'while read -r old new ref; do',
      '  case "$ref" in HEAD|refs/heads/*) ;; *) continue ;; esac',
      '  [ "$ref" = HEAD ] || [ "$ref" = ' + quote(branch) + ' ] || fail "提交期间当前分支已变化"',
      '  case "$new" in *[!0]*) ;; *) continue ;; esac',
      head ? '  [ "$old" = ' + quote(head) + ' ] || fail "提交期间分支已变化"'
        : '  case "$old" in *[!0]*) fail "提交期间分支已变化" ;; esac',
      // HEAD and its branch can occur in the same ref transaction. Validate
      // each old SHA/ref, then inspect their identical candidate tree once.
      '  [ "$new" != "$candidate" ] || continue',
      '  ' + gitCommand + ' -c core.quotepath=false diff-tree --no-ext-diff --no-textconv --ignore-submodules=none -r --no-commit-id --name-only --no-renames '
        + (head ? quote(head) + ' "$new"' : '--root "$new"') + ' > ' + quote(changedFile) + ' || fail "无法核对提交范围"',
      '  grep -F -x -v -f ' + quote(allowedFile) + ' ' + quote(changedFile) + ' > /dev/null',
      '  result=$?',
      '  [ "$result" = 1 ] || { [ "$result" = 0 ] && fail "Git hook 修改了提交范围之外的文件，已阻止提交"; fail "无法核对提交范围"; }',
      ...Object.entries(expected).flatMap(([path, sha]) => [
        '  actual=$(' + gitCommand + ' rev-parse --verify "$new":' + shellQuote(path) + ') || fail "无法核对代码块提交范围"',
        '  [ "$actual" = ' + quote(sha) + ' ] || fail "Git hook 改写了代码块提交范围，已阻止提交"',
      ]),
      '  candidate=$new',
      'done',
      '[ -z "$candidate" ] || printf "%s\\n" "$candidate" > ' + quote(receipt),
      '',
    ].join('\n'))
    const originalRefHook = join(originalHooks, 'reference-transaction')
    let originalRef = ''
    try { await access(originalRefHook); originalRef = 'printf \'%s\\n\' "$input" | ' + quote(originalRefHook) + ' "$@" || exit $?\n' } catch {}
    const refHook = join(guardedHooks, 'reference-transaction')
    // Preserve the original hook's notifications for every phase. Only the
    // prepared phase runs our scope validator.
    await writeFile(refHook, '#!/bin/sh\n' + (originalRef ? '' : '[ "$1" = prepared ] || exit 0\n')
      + markStage('hook: reference-transaction') + 'input=$(cat)\n' + originalRef
      + 'if [ "$1" = prepared ]; then\n'
      + markStage('校验提交范围')
      // Source the validator in Git's existing shell. A here-document feeds
      // the captured refs without another shell process or a printf pipeline.
      + '. ' + quote(guard) + ' <<DSHGIT_TRANSACTION_REFS\n$input\nDSHGIT_TRANSACTION_REFS\n'
      + 'result=$?\n[ "$result" = 0 ] || exit "$result"\n'
      + 'fi\n' + markStage('git commit'))
    await chmod(refHook, 0o755)
    await writeFile(stageFile, 'git commit\n')
    const result = await invoke(['-c', 'core.hooksPath=' + guardedHooks, 'commit', '-m', request.message], { timeoutMs: 180000 })
    let candidate = null
    try { candidate = (await readFile(receipt, 'utf8')).trim() }
    catch (error) { if (error.code !== 'ENOENT') { uncertain = true; throw error } }
    if (result.code !== 0) {
      // A post-commit hook can time out AFTER HEAD has moved. The receipt names
      // the exact commit whose scope the guard verified; never attribute some
      // unrelated concurrent HEAD update to this attempt.
      reportGitPhase(options.signal, 'commit.phase.confirming')
      const current = await repo.run(['rev-parse', '--verify', 'HEAD'], { ...options, signal: undefined }).catch(error => { uncertain = true; throw error })
      if (current.code === 0 && candidate && current.stdout.trim() === candidate) landed = true
      else if ((current.code === 0 ? current.stdout.trim() : null) !== head || (current.code !== 0 && head !== null)) {
        uncertain = true
        throw new Error('提交结果无法确认，请检查提交历史，勿重复提交')
      }
      if (!landed) {
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
        const empty = /nothing to commit|nothing added to commit|no changes added to commit/i.test(output)
        outcome = { ok: false, ...result, message: empty
          ? '没有可提交的实际改动，请刷新文件列表。'
          : result.stderr.trim() || result.stdout.trim() || `提交失败：退出码 ${result.code}` }
        return outcome
      }
    }
    landed = true
    reportGitPhase(options.signal, 'commit.phase.restoring')
    // Rebase only selected entries onto the new HEAD in a copy of the original
    // index. Other staged versions, including partial staging, remain intact.
    if (fullPaths.length) await must(['reset', '-q', candidate || 'HEAD', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      env: { ...env, GIT_INDEX_FILE: restoredIndex }, input: fullPaths.join('\0') + '\0', signal: undefined,
    })
    if (preserved.length) await must(['update-index', '-z', '--index-info'], {
      env: { ...env, GIT_INDEX_FILE: restoredIndex }, signal: undefined,
      input: preserved.map(entry => entry.mode + ' ' + entry.sha + ' 0\t' + entry.path + '\0').join(''),
    })
    // A stat-only change (e.g. LF rewritten as CRLF) can survive even
    // update-index --refresh: diff-files reports it but a full diff is empty.
    // Rehash only those entries in a disposable copy. Never publish that copy
    // if any staged mode/blob changed, including an edit racing with this step.
    let publishSource = restoredIndex
    try {
      const restoreOptions = { env: { ...env, GIT_INDEX_FILE: restoredIndex }, signal: undefined }
      const statChanges = await must(['diff-files', '--name-only', '-z', '--ignore-submodules=none'], restoreOptions)
      if (statChanges.stdout) {
        const diff = await must(['-c', 'diff.autoRefreshIndex=false', 'diff', '--numstat', '-z', '--no-renames',
          '--no-ext-diff', '--no-textconv', '--ignore-submodules=none'], restoreOptions)
        // --no-renames makes each NUL record add<TAB>del<TAB>path; paths may
        // themselves contain tabs or newlines, so split only the first two fields.
        const changed = new Set(diff.stdout.split('\0').filter(Boolean).map(record => record.split('\t').slice(2).join('\t')))
        const unchanged = statChanges.stdout.split('\0').filter(path => path && !changed.has(path))
        if (unchanged.length) {
          const beforeEntries = await must(['ls-files', '--stage', '-z'], restoreOptions)
          const refreshedIndex = join(directory, 'refreshed-index')
          await copyFile(restoredIndex, refreshedIndex)
          const refreshOptions = { env: { ...env, GIT_INDEX_FILE: refreshedIndex }, signal: undefined }
          await must(['add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
            ...refreshOptions, input: unchanged.join('\0') + '\0',
          })
          const afterEntries = await must(['ls-files', '--stage', '-z'], refreshOptions)
          if (afterEntries.stdout === beforeEntries.stdout) publishSource = refreshedIndex
        }
      }
    } catch (error) {
      // This is a metadata repair after HEAD moved. Its failure must not
      // prevent publication of the already restored, content-correct index.
      result.stderr = [result.stderr, '文件状态刷新未完成：' + error.message].filter(Boolean).join('\n')
    }
    // Publishing the prepared index and releasing the lock are one step: the
    // rename consumes the lock file, so a crash here leaves either the old index
    // (with a stale lock this module can reclaim) or the new one.
    await publishIndexLock(index + '.lock', index, await readFile(publishSource)); published = true
    outcome = { ...result, ok: true, code: 0, message: result.code === 0 ? result.stdout.trim() || '提交完成'
      : '提交已完成，暂存区已恢复；后续 hook ' + (result.timedOut ? '执行超时' : '未正常结束') + '，请勿重复提交。' }
    return outcome
  } catch (error) {
    failure = error
    if (landed) error.message = '提交已生成，但暂存区恢复失败；原暂存区仍保留。恢复文件：' + directory + '。' + error.message
    else if (uncertain) error.message += '；恢复文件保留在：' + directory
    throw error
  } finally {
    // A scanner or hook can briefly hold a temporary file open on Windows.
    // Cleanup must never turn a published commit into a failed commit, or hide
    // the original error (especially the index recovery directory).
    const cleanup = async operation => {
      try { await retryFileOperation(operation) }
      catch (error) {
        if (error.code === 'ENOENT') return
        const warning = '临时文件清理失败：' + error.message
        if (failure) failure.message += '\n' + warning
        else if (outcome) {
          outcome.stderr = [outcome.stderr, warning].filter(Boolean).join('\n')
          outcome.message += '\n' + (published ? '提交已完成，请勿重复提交。' : '') + warning
        }
      }
    }
    // The lock still exists only when the rename did not happen, so removing it
    // is what returns the repository to a usable state after a failure.
    if (!published) await cleanup(() => releaseIndexLock(index + '.lock'))
    if (directory && !uncertain && (!landed || published)) await cleanup(() => rm(directory, { recursive: true, force: true }))
  }
}

/**
 * dsh-plugin-git — the interactive rebase planner.
 *
 * `rewrite.js` rewords and squashes by rebuilding commits with `commit-tree`, and
 * the reason is documented there: that path cannot conflict, because no
 * working-tree content is ever re-applied. This module does the opposite on
 * purpose, because the operations users actually keep asking for — reorder, drop,
 * fold into an older commit, stop and edit one — cannot be expressed that way at
 * all. Reordering two commits means the later one no longer applies to the earlier
 * one's tree, and no amount of careful `commit-tree` calls changes that.
 *
 * So the trade is explicit: this module runs `git rebase -i` and accepts that a
 * conflict can happen. Everything here exists to make that acceptable:
 *
 * 1. **The plan is reviewed, then recomputed.** {@link previewPlan} produces the
 *    exact todo the user is shown; {@link applyPlan} recomputes it and refuses if
 *    the branch moved or a commit vanished. "The thing I confirmed" and "the thing
 *    that ran" stay the same operation.
 * 2. **No human is ever prompted.** The todo is installed by a script this module
 *    writes into its own temporary directory (the one documented exception to
 *    exec.js's never-open-an-editor rule), and messages are applied by an `exec`
 *    line that amends the commit git just created. That is deliberate: git's
 *    message editor is a COMBINED prompt for a run of squashes, so feeding it
 *    positionally lands messages on the wrong commits in exactly the case users
 *    care about. An `exec` fires once, right after the commit it belongs to.
 * 3. **A conflict is a result, not a failure.** The reply carries the undo point
 *    and a message that names the real cause; continue/skip/abort are reachable
 *    from the operation panel that already exists.
 * 4. **An undo point is created before the branch moves.**
 * 5. **A plan that can never work is refused before anything moves.** The set is
 *    taken from git's own `rev-list`, not from a client-supplied order, so the todo
 *    cannot name a commit outside the range; and a range containing a merge commit
 *    is refused at preview time, because `pick <merge>` fails only AFTER the rebase
 *    has started and left HEAD re-pointed.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'

import { createUndoPoint } from './undo.js'
import { publishedShas } from './rewrite.js'
import { retryFileOperation } from './fileRetry.js'
import { workbenchState } from './workbench.js'

/** The actions one todo line may carry. */
const ACTIONS = new Set(['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'])

/** The maximum commits one plan may carry. */
const MAX_PLAN = 200

/** Timeout for the rebase itself: a long replay on a large repository is slow. */
const REBASE_TIMEOUT_MS = 300_000

/**
 * Resolve a POSIX shell git can use to run our sequence editor.
 *
 * Git invokes an editor through the shell, so the editor value is a shell command.
 * On Windows `git.exe` ships its own `bin/sh.exe`; elsewhere git already requires a
 * POSIX shell and `/bin/sh` is the interpreter it would use itself. PATH is
 * consulted last, and only as a fallback, because a machine with several gits
 * installed must not have the todo written by a different toolchain than the one
 * running the rebase.
 *
 * The offsets below matter: `git.exe` lives in `<prefix>/cmd`, `<prefix>/bin` or
 * `<prefix>/mingw64/bin` depending on the distribution, so the shell is looked for
 * at every plausible distance from the executable actually in use. A hard-coded
 * `C:\Program Files\Git\bin\sh.exe` fails on any machine that installed Git
 * elsewhere.
 *
 * @param gitPath - the resolved git executable.
 * @returns an absolute shell path, or null when none can be found.
 */
export function resolveShell(gitPath) {
  if (typeof gitPath !== 'string' || gitPath === '') return null
  if (process.platform !== 'win32') {
    for (const candidate of ['/bin/sh', '/usr/bin/sh']) if (existsSync(candidate)) return candidate
    return null
  }
  const prefix = dirname(dirname(gitPath))
  const candidates = [
    join(prefix, 'bin', 'sh.exe'),
    join(prefix, 'usr', 'bin', 'sh.exe'),
    join(prefix, '..', 'bin', 'sh.exe'),
    join(prefix, '..', 'usr', 'bin', 'sh.exe'),
  ]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return resolvePath(candidate)
    } catch {
      // A path that cannot be stat'ed is simply not the shell.
    }
  }
  return null
}

/**
 * Quote one word for the shell commands git will run.
 *
 * The paths involved live under the user's temp directory, which on Windows
 * routinely contains spaces (`C:\Users\Some Name`). Single quotes with `'\''`
 * escaping is the one form `sh` handles uniformly.
 *
 * @param value - the word.
 * @returns a single-quoted shell word.
 */
function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/**
 * Build the todo lines for a plan.
 *
 * `reword` becomes `pick` plus an `exec` amend: the two produce the same commit,
 * but the amend is deterministic about which commit the message belongs to, whereas
 * git's `reword` prompt would need positional matching against git's own prompt
 * order — and for a run of squashes that order is a combined prompt, not one per
 * commit.
 *
 * A `squash`/`fixup` run folds everything into its last member, so the amend goes
 * after the LAST line of the run: that is the commit which ends up holding the
 * combined content and therefore the message. The last explicit message on a
 * squash/fixup row is carried forward, even when later folded rows leave it empty.
 *
 * @param plan - `{ commits: [{ action, sha }] }`.
 * @param messageFor - `sha => string | undefined`, the replacement message.
 * @param fileFor - `sha => string`, the file holding that message.
 * @returns the todo text.
 */
export function buildTodo(plan, messageFor = () => undefined, fileFor = sha => sha) {
  const lines = []
  const commits = plan.commits
  let foldedMessageSha = null
  for (let index = 0; index < commits.length; index++) {
    const entry = commits[index]
    const action = entry.action
    if (!ACTIONS.has(action)) throw new Error(`不支持的整理动作：${String(action)}`)
    if (action === 'drop') {
      lines.push(`drop ${entry.sha}`)
      continue
    }
    // Dropped rows do not interrupt Git's fold sequence.
    const next = commits.slice(index + 1).find(commit => commit.action !== 'drop')?.action
    const folds = action === 'squash' || action === 'fixup'
    const runContinues = next === 'squash' || next === 'fixup'
    if (!folds) foldedMessageSha = null
    lines.push(`${action === 'reword' ? 'pick' : action} ${entry.sha}`)
    const message = ['reword', 'squash', 'fixup'].includes(action) ? messageFor(entry.sha) : undefined
    const hasMessage = typeof message === 'string' && message.trim() !== ''
    if (folds && hasMessage) foldedMessageSha = entry.sha
    // Amend once the whole fold run has produced its surviving commit.
    if (folds && runContinues) continue
    const messageSha = folds ? foldedMessageSha : hasMessage ? entry.sha : null
    if (messageSha !== null) {
      lines.push(`exec git commit --amend --allow-empty --no-verify -F ${quote(fileFor(messageSha))}`)
    }
    foldedMessageSha = null
  }
  return lines.join('\n') + '\n'
}

/**
 * Order and validate a requested plan against the commits that really exist.
 *
 * @param repo - the repository session.
 * @param request - `{ base, commits }`.
 * @param options - cancellation.
 * @returns `{ base, head, branch, commits }`, in the caller's order.
 */
async function readPlan(repo, request, options) {
  const base = typeof request?.base === 'string' ? request.base.trim() : ''
  if (base === '') throw new Error('请选择变基的起点')
  const requested = Array.isArray(request?.commits) ? request.commits : []
  if (requested.length < 1) throw new Error('请至少选择一个提交')
  if (requested.length > MAX_PLAN) throw new Error(`一次最多整理 ${MAX_PLAN} 个提交`)

  const head = await repo.run(['rev-parse', '--verify', 'HEAD'], options)
  if (head.code !== 0) throw new Error('当前分支还没有提交')
  const headSha = head.stdout.trim()
  const baseResolved = await repo.run(['rev-parse', '--verify', `${base}^{commit}`], options)
  if (baseResolved.code !== 0) throw new Error('变基起点无效')
  const baseCommit = baseResolved.stdout.trim()

  const ancestor = await repo.run(['merge-base', '--is-ancestor', baseCommit, headSha], options)
  if (ancestor.code !== 0) throw new Error('变基起点必须是当前分支的祖先')

  const range = await repo.run(['rev-list', '--reverse', `${baseCommit}..${headSha}`], { timeoutMs: 60_000, signal: options.signal })
  if (range.code !== 0) throw new Error(range.stderr.trim() || '无法读取要整理的提交')
  const available = range.stdout.split('\n').map(line => line.trim()).filter(Boolean)
  if (available.length === 0) throw new Error('起点与当前分支之间没有提交')
  if (available.length > MAX_PLAN) throw new Error(`这段历史有 ${available.length} 个提交，超过一次 ${MAX_PLAN} 个的上限`)

  // A merge commit cannot be expressed as a todo line at all. `pick` refuses it
  // with "'pick' does not accept merge commits" — but only once the rebase has
  // STARTED, leaving `.git/rebase-merge` behind and HEAD already re-pointed. A plan
  // that can never work must be refused before anything moves, so the range is
  // checked here rather than discovered by git half-way through.
  //
  // Replaying a merge needs `merge -C` plus the label/reset dance that preserves
  // both sides; that is a different feature, so this refuses by name instead of
  // silently flattening the merge.
  const merges = await repo.run(
    ['rev-list', '--merges', '--count', `${baseCommit}..${headSha}`],
    { timeoutMs: 30_000, signal: options.signal },
  )
  if (merges.code === 0) {
    const mergeCount = Number.parseInt(merges.stdout.trim(), 10)
    if (Number.isInteger(mergeCount) && mergeCount > 0) {
      throw new Error(`这段历史里有 ${mergeCount} 个合并提交，暂不支持整理；请改用合并或逐个处理`)
    }
  }

  const bySha = new Map(requested.map(entry => [String(entry?.sha ?? '').trim(), String(entry?.action ?? '')]))
  if (bySha.size !== requested.length) throw new Error('计划中有重复的提交')
  // An empty or malformed sha would land in the todo as `pick `, which git reads as
  // "pick the next line" — a silently wrong plan. Refuse it by name.
  for (const sha of bySha.keys()) {
    if (!/^[a-f0-9]{7,64}$/i.test(sha)) throw new Error('计划中包含无效的提交标识')
  }
  // Omitting a commit from the todo would drop its changes, and git accepts that
  // silently, so completeness is enforced rather than assumed.
  for (const sha of available) {
    if (!bySha.has(sha)) throw new Error('计划必须包含起点与当前分支之间的每一个提交；漏掉一个就会丢掉它的改动')
  }
  for (const [sha, action] of bySha) {
    if (!available.includes(sha)) throw new Error(`提交不在这次变基范围内：${sha.slice(0, 8)}`)
    if (!ACTIONS.has(action)) throw new Error(`不支持的整理动作：${action || '（空）'}`)
  }
  // A leading fold has nothing to fold into; git rejects it with a message about a
  // file the user never saw.
  const firstKept = requested.find(entry => entry.action !== 'drop')
  if (firstKept?.action === 'squash' || firstKept?.action === 'fixup') {
    throw new Error('第一个提交不能被折叠，它没有可依附的前一个提交')
  }
  // Dropping everything would leave the branch with no commit of its own, which is
  // never what "整理" means.
  if (requested.every(entry => entry.action === 'drop')) throw new Error('不能丢弃全部提交')

  // The CALLER's order is the plan. Rebuilding it in `rev-list` order would make the
  // todo identical to the existing history and silently discard every reorder the
  // user just arranged — the one operation this module exists for. The SET is
  // validated above; the SEQUENCE is the request.
  const branch = await repo.run(['symbolic-ref', '--quiet', 'HEAD'], options)
  const branchName = branch.code === 0 ? branch.stdout.trim() : ''
  if (branchName === '') throw new Error('处于分离 HEAD 状态，请先切换到分支')
  return {
    base: baseCommit,
    head: headSha,
    branch: branchName,
    commits: requested.map(entry => ({ sha: String(entry.sha).trim(), action: String(entry.action) })),
  }
}

/**
 * The identity a plan was built against.
 *
 * Same shape the workbench uses: the RPC layer checks it before every write, and
 * {@link applyPlan} checks it again, so a commit landing from another terminal
 * between preview and apply fails the operation instead of being dropped from the
 * rewritten history.
 *
 * @param repo - the repository session.
 * @param plan - the ordered plan.
 * @param options - cancellation.
 * @returns `{ head, branch, state, references }`.
 */
async function buildGuard(repo, plan, options) {
  const state = await workbenchState(repo, options)
  const branch = await repo.run(['symbolic-ref', '--quiet', 'HEAD'], options)
  const name = branch.code === 0 ? branch.stdout.trim() : null
  return {
    head: plan.head,
    branch: name,
    state: state.state,
    references: name === null ? {} : { [name]: plan.head },
  }
}

/**
 * Report what a plan will do, without changing anything.
 *
 * The counts are the point: "3 kept, 1 folded, 1 dropped" is what a user checks
 * before agreeing, and deriving them from the same list the todo is built from means
 * the summary and the operation cannot disagree.
 *
 * @param repo - the repository session.
 * @param request - `{ base, commits }`.
 * @param options - cancellation.
 * @returns the plan, its subjects, a summary and the guard.
 */
export async function previewPlan(repo, request, options = {}) {
  const plan = await readPlan(repo, request, options)
  const details = await repo.run(
    ['log', '--no-walk=unsorted', '--format=%H%x1f%s%x1f%an%x1e', ...plan.commits.map(entry => entry.sha)],
    { timeoutMs: 30_000, signal: options.signal },
  )
  const subjects = new Map()
  if (details.code === 0) {
    for (const record of details.stdout.split('\x1e')) {
      if (record.trim() === '') continue
      const [sha, subject, author] = record.split('\x1f')
      if (sha) subjects.set(sha.trim(), { subject: subject ?? '', author: author ?? '' })
    }
  }

  const counts = { kept: 0, reworded: 0, edited: 0, squashed: 0, dropped: 0 }
  for (const entry of plan.commits) {
    if (entry.action === 'reword') counts.reworded++
    else if (entry.action === 'edit') counts.edited++
    else if (entry.action === 'squash' || entry.action === 'fixup') counts.squashed++
    else if (entry.action === 'drop') counts.dropped++
    else counts.kept++
  }

  // Which commits are already on a remote. This is the guard, not a hint: rewriting a
  // published commit rewrites history other clones already have, and this repository
  // cannot undo that. The answer is computed HERE (against the remote refs) rather than
  // taken from the caller, because the panel's list can be minutes stale and a count it
  // derived from its own rows is not evidence.
  const published = await publishedShas(repo, options)
  const publishedShasInPlan = plan.commits.filter(entry => published.has(entry.sha)).map(entry => entry.sha)

  return {
    base: plan.base,
    head: plan.head,
    branch: plan.branch,
    commits: plan.commits.map(entry => ({
      sha: entry.sha,
      shortSha: entry.sha.slice(0, 8),
      action: entry.action,
      subject: subjects.get(entry.sha)?.subject ?? '',
      author: subjects.get(entry.sha)?.author ?? '',
      published: published.has(entry.sha),
    })),
    counts,
    // The panel shows this and offers the explicit override; `applyPlan` refuses while
    // it is non-zero unless the caller passes `allowPublished`.
    published: publishedShasInPlan.length,
    // How many commits the plan carries. Deliberately NOT a promise about the
    // result: git also drops commits whose patch is already upstream, so the branch
    // can end up with fewer — {@link applyPlan} reports which ones went.
    planned: plan.commits.length,
    guard: await buildGuard(repo, plan, options),
  }
}

/**
 * Apply a reviewed plan with one `git rebase -i`.
 *
 * @param repo - the repository session.
 * @param request - `{ base, commits, messages, guard, allowPublished }`.
 * @param options - cancellation.
 * @returns the write outcome, the dropped commits and the undo point.
 */
export async function applyPlan(repo, request, options = {}) {
  const plan = await readPlan(repo, request, options)
  // Re-verify the guard the caller confirmed. `readPlan` proves the range is intact,
  // so this catches the one thing it cannot: a working tree that changed while the
  // dialog was open.
  if (request.guard) {
    const current = await buildGuard(repo, plan, options)
    if (request.guard.head !== current.head || request.guard.branch !== current.branch
      || (request.guard.state !== undefined && request.guard.state !== current.state)) {
      throw new Error('仓库或本地改动已变化，请重新预览并确认')
    }
  }

  // THE guard for this module. Rewriting a published commit rewrites history that other
  // clones already have, and nothing in this repository can undo that — so it is refused
  // unless the caller explicitly says nobody else is using those commits.
  //
  // Re-checked here rather than trusting `previewPlan`'s answer: the preview can be
  // minutes old, a `git fetch` in another terminal can publish a commit in between, and
  // the check costs one `rev-list`.
  const published = await publishedShas(repo, options)
  const blocked = plan.commits.filter(entry => published.has(entry.sha)).map(entry => entry.sha)
  if (blocked.length > 0 && request.allowPublished !== true) {
    throw new Error(`有 ${blocked.length} 个提交已经推送到远端，整理会覆盖远端历史。`
      + '确认没有其他人在使用这些提交后，才能勾选“允许改写已推送提交”。')
  }

  const shell = resolveShell(repo.gitPath)
  if (shell === null) throw new Error('找不到可用的 POSIX shell，无法执行交互式变基；请确认 Git 安装完整')

  const supplied = request.messages !== null && typeof request.messages === 'object' ? request.messages : {}
  const messageFor = sha => (typeof supplied[sha] === 'string' ? supplied[sha] : undefined)

  const directory = await mkdtemp(join(tmpdir(), 'dsh-rebase-'))
  let undo
  try {
    const statePath = await repo.run(['rev-parse', '--git-path', 'rebase-merge'], options)
    if (statePath.code !== 0) throw new Error(statePath.stderr.trim() || '无法定位变基状态目录')
    const rebaseDirectory = resolvePath(repo.root, statePath.stdout.trim())
    const files = []
    for (const entry of plan.commits) {
      const text = messageFor(entry.sha)
      if (typeof text !== 'string' || text.trim() === '') continue
      const path = join(directory, `message-${files.length}`)
      await writeFile(path, text, 'utf8')
      files.push({ sha: entry.sha, path, target: join(rebaseDirectory, `dsh-message-${files.length}`) })
    }
    const bySha = new Map(files.map(file => [file.sha, file.target]))
    const todoPath = join(directory, 'todo')
    await writeFile(todoPath, buildTodo(plan, messageFor, sha => bySha.get(sha) ?? ''), 'utf8')
    const sequence = join(directory, 'sequence.sh')
    // Git creates rebase-merge before invoking the editor. Keep messages there so
    // continue works after a stop (or Host restart), and Git cleans them on abort/end.
    await writeFile(sequence, ['#!/bin/sh', 'set -e',
      ...files.map(file => `cp ${quote(file.path)} ${quote(file.target)}`),
      `cat ${quote(todoPath)} > "$1"`, ''].join('\n'), 'utf8')

    undo = await createUndoPoint(repo, { sha: plan.head, action: 'rebase', ref: plan.branch }, options)
    // `--empty=drop` is passed explicitly because `-i` implies `stop`: a commit that
    // becomes empty during the replay would halt the rebase and hand the user a
    // "resolve the conflicts" prompt with no conflicted file to resolve. Dropping it
    // matches what the plan promised, and the dropped commits are reported below so
    // a smaller final count is explained rather than mysterious.
    //
    // `--no-verify` is deliberately NOT passed. A `pre-rebase` hook is the
    // repository's own policy, and a GUI that silently bypasses it is worse than one
    // that reports the refusal along with the terminal command that would skip it.
    const result = await repo.runWrite(
      ['rebase', '--interactive', '--empty=drop', plan.base],
      { timeoutMs: REBASE_TIMEOUT_MS, signal: options.signal, editor: { sequence: `${quote(shell)} ${quote(sequence)}` } },
    )
    // An `edit` stop exits zero too; repository state decides whether we finished.
    const operation = await repo.operation({ signal: undefined })
    const stopped = operation?.kind === 'rebase'
    const finished = result.code === 0 && !stopped
    const head = finished
      ? await repo.run(['rev-parse', '--verify', 'HEAD'], { signal: undefined })
      : null
    // A conflict is a RESULT, not a failure. Git stopped mid-rebase and is waiting for a
    // decision; reporting that as an error made the panel keep its dialog open with a red
    // message, so the user never reached the continue/skip/abort controls and believed
    // nothing had happened while their branch was actually half-rewritten.
    //
    // `stopped` says "this is expected, there is a decision to make", and is only true
    // when the repository really is mid-operation. Everything else that exits non-zero
    // (a refused hook, a missing shell, a plan git rejected) stays a failure.
    return {
      ok: finished || stopped,
      // `stopped` is the field the panel branches on; `code` keeps git's exit status for
      // the command log without claiming the operation failed.
      stopped,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      backup: undo.ref,
      before: plan.head,
      after: head?.code === 0 ? head.stdout.trim() : null,
      message: finished
        ? `已整理 ${plan.commits.length} 个提交`
        : result.code === 0 && stopped ? '已暂停变基，可修改当前提交后继续' : summarizeFailure(result),
      // Commits git discarded because their patch is already on the new base. The
      // only place that fact is available.
      dropped: droppedCommits(result),
      // Whether it finished or stopped, the undo point answers "how do I get back",
      // so it is reported either way.
      recovery: { kind: 'rebase', head: plan.head, backup: undo.ref, branch: plan.branch },
    }
  } catch (error) {
    if (undo) error.recovery = { kind: 'rebase', head: plan.head, backup: undo.ref, branch: plan.branch }
    throw error
  } finally {
    // The editor inputs have been copied into Git's own rebase state directory.
    await retryFileOperation(() => rm(directory, { recursive: true, force: true })).catch(() => {})
  }
}

/**
 * Turn git's failure output into one sentence that names the real problem.
 *
 * The causes below are NOT the same problem and do not have the same fix, so a
 * single `CONFLICT|could not apply` test is actively misleading: an empty pick stops
 * with "the previous cherry-pick is now empty" (and `git status` shows no conflicted
 * file at all), while a refused hook names a policy the user wrote. Reporting both
 * as "resolve the conflicts" sends people looking for conflicts that do not exist.
 *
 * @param result - the raw exit facts.
 * @returns a message.
 */
export function summarizeFailure(result) {
  const stderr = String(result.stderr ?? '')
  if (/does not accept merge commits/i.test(stderr)) {
    return '计划里有合并提交，交互式整理不支持；分支未移动，请先中止这次变基'
  }
  // An empty pick: the change is already upstream. Resolving "conflicts" is
  // impossible here; the exits are `--skip` (drop it) or `--continue` (keep it empty).
  if (/previous cherry-pick is now empty|nothing to commit/i.test(stderr)) {
    return '有提交在变基后变成空提交（改动已在目标分支上）；可跳过该提交或保留为空提交'
  }
  // The repository's own policy hook refused. Naming it is the whole fix: the user
  // either adjusts the hook or runs the rebase with --no-verify themselves.
  if (/pre-rebase hook refused/i.test(stderr)) {
    return '仓库的 pre-rebase hook 拒绝了这次变基；如需跳过，请在终端执行 git rebase --no-verify …'
  }
  if (/CONFLICT|could not apply/i.test(stderr)) return '整理过程中出现冲突；请解决后继续，或跳过这个提交'
  if (/nothing to do/i.test(stderr)) return '没有需要整理的内容'
  if (/problem with the editor/i.test(stderr)) return '无法为交互式变基提供计划文件；请确认 Git 安装完整'
  return stderr.trim() || `git rebase 退出码 ${result.code}`
}

/**
 * Report the commits git dropped while replaying, so a shrinking count is explained.
 *
 * Two different lines mean the same thing to the user — this commit's content is
 * already on the new base, so git discarded it:
 *
 * - `dropping <sha> <subject> -- patch contents already upstream`
 * - `warning: skipped previously applied commit <sha>`
 *
 * Without this report the panel says "planned 2, got 1" with no reason, which reads
 * as a bug in the plugin. The text comes from git rather than from our own guess,
 * because "is this patch already upstream" is git's own patch-id judgement.
 *
 * @param result - the raw exit facts.
 * @returns `[{ sha, subject, reason }]`, in the order git printed them.
 */
export function droppedCommits(result) {
  const text = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`
  const out = []
  const seen = new Set()
  // git's progress output uses `\r` to rewrite the same line, so a `\r` can appear at
  // the START of a line as well as at its end (`"Rebasing (2/3)\rdropping …"`). A
  // line-anchored `^dropping` therefore misses it, and the report comes back empty —
  // which is exactly the "planned 3, got 1" mystery this function exists to prevent.
  // Splitting on the carriage return as well is what makes both forms parseable.
  for (const raw of text.split(/[\n\r]+/)) {
    const line = raw.trim()
    if (line === '') continue
    const dropped = /^dropping ([0-9a-f]{7,64})\s*(.*?)(?:\s+--\s+(.*))?$/.exec(line)
    if (dropped !== null) {
      const sha = dropped[1]
      if (seen.has(sha)) continue
      seen.add(sha)
      out.push({ sha, subject: dropped[2] || '', reason: dropped[3] || 'patch contents already upstream' })
      continue
    }
    const skipped = /^warning: skipped previously applied commit ([0-9a-f]{7,64})/.exec(line)
    if (skipped !== null && !seen.has(skipped[1])) {
      seen.add(skipped[1])
      out.push({ sha: skipped[1], subject: '', reason: 'already applied upstream' })
    }
  }
  return out
}

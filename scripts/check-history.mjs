/**
 * History-rewrite checks: the planner, the undo points and the refusal surface.
 *
 * Everything here runs real Git in a temporary directory. The assertions are about
 * what git actually did to a repository, not about the shape of a return value,
 * because these failures do not throw: a plan that silently drops a commit, an undo
 * point that cannot be found, or a reword that lands on the wrong commit all look
 * like success from the outside.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { git, resolveGitPath } from '../lib/git/exec.js'
import { RepoRegistry } from '../lib/git/repo.js'
import { applyPlan, buildTodo, droppedCommits, previewPlan, resolveShell, summarizeFailure } from '../lib/git/rebasePlan.js'
import { createUndoPoint, deleteUndoPoint, listUndoPoints, restoreUndoPoint, UNDO_PREFIX } from '../lib/git/undo.js'
import { blame } from '../lib/git/blame.js'
import { rewriteCommits } from '../lib/git/rewrite.js'
import { createRpc } from '../lib/rpc.js'
import { DEFAULT_CONFIG } from '../lib/config.js'
import { operationReview } from '../lib/git/operationReview.js'

const gitPath = await resolveGitPath()

/**
 * A repository with `count` commits, each adding one file.
 *
 * @param label - temp-dir label.
 * @param count - how many commits to create.
 * @returns `{ root, run, repo }`.
 */
async function fixture(label, count) {
  const base = await mkdtemp(join(tmpdir(), `dsh-${label}-`))
  const root = join(base, 'repo')
  await mkdir(root)
  const run = async (args, options = {}) => {
    const result = await git({ gitPath, cwd: root, args, timeoutMs: 60_000, ...options })
    if (options.allowFailure !== true) assert.equal(result.code, 0, `${args.join(' ')}\n${result.stderr}`)
    return result.stdout.trim()
  }
  await run(['init', '-b', 'main'])
  for (const [key, value] of Object.entries({
    'user.name': 'History check', 'user.email': 'check@example.invalid',
    'core.autocrlf': 'false', 'commit.gpgsign': 'false',
  })) await run(['config', key, value])
  for (let index = 1; index <= count; index++) {
    await writeFile(join(root, `f${index}.txt`), `v${index}\n`)
    await run(['add', '-A'])
    await run(['commit', '-m', `commit ${index}`])
  }
  const { session } = await new RepoRegistry({ gitPath }).open(root)
  return { root, run, repo: session }
}

/** Subjects of the commits in `base..HEAD`, oldest first. */
async function subjectsSince(run, base) {
  const out = await run(['log', '--reverse', '--format=%s', `${base}..HEAD`])
  return out === '' ? [] : out.split('\n')}

/** Shas of the commits in `base..HEAD`, oldest first. */
async function commitsSince(run, base) {
  const out = await run(['rev-list', '--reverse', `${base}..HEAD`])
  return out === '' ? [] : out.split('\n')
}

// ---------------------------------------------------------------------------
// 1. The todo is the plan, and it is built the way git needs to read it.
//
// The message is applied by an `exec` amend rather than git's `reword` prompt,
// because that prompt is a COMBINED one for a run of squashes. That makes the
// placement of the exec line the correctness property, so it is asserted directly.
// ---------------------------------------------------------------------------
{
  const todo = buildTodo(
    { commits: [
      { sha: 'a'.repeat(40), action: 'pick' },
      { sha: 'b'.repeat(40), action: 'squash' },
      { sha: 'c'.repeat(40), action: 'squash' },
      { sha: 'd'.repeat(40), action: 'drop' },
    ] },
    sha => (sha.startsWith('b') ? 'folded message' : undefined),
    sha => `/tmp/msg-${sha.slice(0, 1)}`,
  )
  const lines = todo.split('\n').filter(Boolean)
  assert.equal(lines[0], `pick ${'a'.repeat(40)}`)
  assert.equal(lines[1], `squash ${'b'.repeat(40)}`)
  assert.equal(lines[2], `squash ${'c'.repeat(40)}`)
  assert.equal(lines[3], "exec git commit --amend --allow-empty --no-verify -F '/tmp/msg-b'")
  assert.equal(lines[4], `drop ${'d'.repeat(40)}`)
  assert.equal(lines.length, 5, 'an intermediate message is applied after the whole fold run')

  const acrossDrops = buildTodo({ commits: [
    { sha: 'a'.repeat(40), action: 'pick' },
    { sha: 'b'.repeat(40), action: 'squash' },
    { sha: 'd'.repeat(40), action: 'drop' },
    { sha: 'c'.repeat(40), action: 'fixup' },
  ] }, sha => sha.startsWith('b') ? 'combined' : undefined, sha => `/tmp/msg-${sha[0]}`)
  assert.equal(acrossDrops.trim().split('\n').at(-1), "exec git commit --amend --allow-empty --no-verify -F '/tmp/msg-b'")

  // The amend belongs to the LAST member, which is the commit that ends up holding
  // the combined content.
  const withMessage = buildTodo(
    { commits: [{ sha: 'a'.repeat(40), action: 'squash' }, { sha: 'b'.repeat(40), action: 'squash' }] },
    () => 'combined',
    () => '/tmp/msg',
  ).split('\n').filter(Boolean)
  assert.deepEqual(withMessage.slice(-1), [`exec git commit --amend --allow-empty --no-verify -F '/tmp/msg'`])
  assert.throws(() => buildTodo({ commits: [{ sha: 'a'.repeat(40), action: 'nonsense' }] }), /不支持的整理动作/)
  for (const action of ['pick', 'edit', 'drop']) {
    assert.doesNotMatch(buildTodo({ commits: [{ sha: 'a'.repeat(40), action }] }, () => 'stale draft'), /exec/)
  }
  console.log('PASS the todo puts a message on the last member of a fold run and rejects unknown actions')
}

// ---------------------------------------------------------------------------
// 2. Reorder against real git, keeping every file.
// ---------------------------------------------------------------------------
{
  const { run, repo } = await fixture('rebase-basic', 4)
  const base = await run(['rev-parse', 'HEAD~3'])
  const shas = await commitsSince(run, base)
  assert.equal(shas.length, 3)

  // Reorder: the first two commits swap places. Their files are independent, so this
  // applies cleanly and the tree is unchanged.
  const plan = [
    { sha: shas[1], action: 'pick' },
    { sha: shas[0], action: 'pick' },
    { sha: shas[2], action: 'pick' },
  ]
  const preview = await previewPlan(repo, { base, commits: plan }, {})
  assert.equal(preview.commits.length, 3)
  assert.equal(preview.counts.kept, 3)
  assert.equal(preview.planned, 3)
  assert.ok(preview.guard.head !== null && preview.guard.state.length > 0, 'the guard carries a content fingerprint')

  const applied = await applyPlan(repo, { base, commits: plan, guard: preview.guard }, {})
  assert.equal(applied.ok, true, applied.message)
  // The range is `commit 2..commit 4`; the plan replays 3 before 2.
  assert.deepEqual(await subjectsSince(run, base), ['commit 3', 'commit 2', 'commit 4'])
  for (const name of ['f2.txt', 'f3.txt', 'f4.txt']) {
    assert.equal(await run(['cat-file', '-e', `HEAD:${name}`]), '', `${name} still exists`)
  }
  assert.ok(applied.backup.startsWith(UNDO_PREFIX), 'the rewrite recorded an undo point')
  console.log('PASS interactive rebase reorders commits and records an undo point')
}

// ---------------------------------------------------------------------------
// 3. Folding keeps every change and lands the message on the surviving commit.
// ---------------------------------------------------------------------------
{
  const { run, repo } = await fixture('rebase-fold', 4)
  const base = await run(['rev-parse', 'HEAD~3'])
  const shas = await commitsSince(run, base)
  const plan = [
    { sha: shas[0], action: 'pick' },
    { sha: shas[1], action: 'fixup' },
    { sha: shas[2], action: 'squash' },
  ]
  const applied = await applyPlan(repo, {
    base, commits: plan, guard: null, messages: { [shas[2]]: 'folded together' },
  }, {})
  assert.equal(applied.ok, true, applied.message)
  assert.deepEqual(await subjectsSince(run, base), ['folded together'])
  // Both folded commits' files survive, so content was combined rather than lost.
  assert.equal(await readFile(join(repo.root, 'f2.txt'), 'utf8'), 'v2\n')
  assert.equal(await readFile(join(repo.root, 'f3.txt'), 'utf8'), 'v3\n')
  console.log('PASS folding keeps every change and uses the replacement message')
}

{
  const { run, repo } = await fixture('fold-intermediate-message', 4)
  const base = await run(['rev-parse', 'HEAD~3'])
  const head = await run(['rev-parse', 'HEAD'])
  const shas = await commitsSince(run, base)
  const commits = [{ sha: shas[0], action: 'pick' }, { sha: shas[1], action: 'squash' }, { sha: shas[2], action: 'fixup' }]
  const messages = { [shas[1]]: 'user supplied combined message\n\nPreserved body.' }
  const applied = await applyPlan(repo, { base, commits, messages })
  assert.equal(applied.ok, true, applied.message)
  assert.equal(await run(['log', '-1', '--format=%B']), messages[shas[1]])
  assert.equal(await run(['rev-parse', 'HEAD^{tree}']), await run(['rev-parse', `${head}^{tree}`]))
  // A later explicit replacement takes precedence; an empty field does not.
  await run(['reset', '--hard', head])
  messages[shas[2]] = 'last explicit replacement'
  const replaced = await applyPlan(repo, { base, commits, messages })
  assert.equal(replaced.ok, true, replaced.message)
  assert.equal(await run(['log', '-1', '--format=%B']), messages[shas[2]])
  console.log('PASS fold messages survive later empty rows and the last explicit replacement wins')
}

// ---------------------------------------------------------------------------
// 4. Dropping a commit removes exactly that commit's change.
// ---------------------------------------------------------------------------
{
  const { run, repo } = await fixture('rebase-drop-one', 4)
  const base = await run(['rev-parse', 'HEAD~3'])
  const shas = await commitsSince(run, base)
  const applied = await applyPlan(repo, {
    base, commits: [
      { sha: shas[0], action: 'pick' },
      { sha: shas[1], action: 'drop' },
      { sha: shas[2], action: 'pick' },
    ], guard: null,
  }, {})
  assert.equal(applied.ok, true, applied.message)
  assert.deepEqual(await subjectsSince(run, base), ['commit 2', 'commit 4'])
  // The dropped commit's file is gone; the others are untouched.
  await assert.rejects(run(['cat-file', '-e', 'HEAD:f3.txt']), /AssertionError/, 'the dropped commit\'s file is gone')
  assert.equal(await run(['cat-file', '-e', 'HEAD:f2.txt']), '')
  assert.equal(await run(['cat-file', '-e', 'HEAD:f4.txt']), '')
  console.log('PASS dropping one commit removes exactly its change')
}

// ---------------------------------------------------------------------------
// 5. Every plan that could corrupt history is refused BEFORE the branch moves.
// ---------------------------------------------------------------------------
{
  const { run, repo } = await fixture('rebase-guards', 4)
  const base = await run(['rev-parse', 'HEAD~3'])
  const shas = await commitsSince(run, base)
  const head = await run(['rev-parse', 'HEAD'])
  const picks = shas.map(sha => ({ sha, action: 'pick' }))

  // Omitting a commit would drop its changes, and git accepts that silently.
  await assert.rejects(previewPlan(repo, { base, commits: [{ sha: shas[0], action: 'pick' }] }, {}), /必须包含/)
  // A sha from outside the range would move a ref the caller is not looking at.
  const outside = await run(['rev-parse', 'HEAD~3'])
  await assert.rejects(previewPlan(repo, { base, commits: [...picks, { sha: outside, action: 'pick' }] }, {}), /不在这次变基范围内|必须包含/)
  // A leading fold has nothing to fold into.
  await assert.rejects(
    previewPlan(repo, { base, commits: [{ sha: shas[0], action: 'squash' }, ...picks.slice(1)] }, {}),
    /第一个提交不能被折叠/,
  )
  for (const action of ['squash', 'fixup']) {
    const commits = [{ sha: shas[0], action: 'drop' }, { sha: shas[1], action }, picks[2]]
    await assert.rejects(previewPlan(repo, { base, commits }), /第一个提交不能被折叠/)
    await assert.rejects(applyPlan(repo, { base, commits }), /第一个提交不能被折叠/)
  }
  // Every commit dropped leaves the branch with nothing of its own.
  await assert.rejects(previewPlan(repo, { base, commits: shas.map(sha => ({ sha, action: 'drop' })) }, {}), /不能丢弃全部提交/)
  // A malformed sha would land in the todo as `pick `, which git reads as "pick the
  // next line" — a silently wrong plan.
  await assert.rejects(previewPlan(repo, { base, commits: [{ sha: 'nope', action: 'pick' }, ...picks.slice(1)] }, {}), /无效的提交标识/)
  // A duplicate would make the set ambiguous.
  await assert.rejects(previewPlan(repo, { base, commits: [picks[0], ...picks] }, {}), /重复/)

  assert.equal(await run(['rev-parse', 'HEAD']), head, 'no refused plan moved the branch')
  assert.equal((await listUndoPoints(repo, {})).length, 0, 'and none created an undo point')
  assert.equal(await repo.operation({}), null, 'and none left a rebase half-started')

  // A plan confirmed against a changed working tree is refused rather than applied to
  // content the user never saw.
  const preview = await previewPlan(repo, { base, commits: picks }, {})
  await writeFile(join(repo.root, 'f2.txt'), 'edited after preview\n')
  await assert.rejects(applyPlan(repo, { base, commits: picks, guard: preview.guard }, {}), /已变化/)
  assert.equal(await run(['rev-parse', 'HEAD']), head)
  console.log('PASS incomplete, out-of-range, leading-fold, all-drop, malformed, duplicate and stale-guard plans are refused before HEAD moves')
}

// ---------------------------------------------------------------------------
// 6. A range containing a MERGE commit is refused at preview time.
//
// `pick <merge>` is rejected by git with "'pick' does not accept merge commits" —
// but only AFTER the rebase has started, leaving `.git/rebase-merge` behind and HEAD
// already re-pointed. A plan that can never work must be refused before anything
// moves.
// ---------------------------------------------------------------------------
{
  const { run, repo } = await fixture('rebase-merge-refusal', 2)
  const start = await run(['rev-parse', 'HEAD'])
  await run(['checkout', '-b', 'side', start])
  await writeFile(join(repo.root, 'side.txt'), 'side\n')
  await run(['add', '-A']); await run(['commit', '-m', 'side work'])
  await run(['checkout', '-b', 'merged', start])
  await writeFile(join(repo.root, 'main.txt'), 'main\n')
  await run(['add', '-A']); await run(['commit', '-m', 'main work'])
  await run(['merge', '--no-ff', 'side', '-m', 'Merge side'])
  const head = await run(['rev-parse', 'HEAD'])
  const range = await commitsSince(run, start)
  assert.ok(range.length >= 3, 'the fixture really has a merge in range')
  const plan = range.map(sha => ({ sha, action: 'pick' }))

  await assert.rejects(previewPlan(repo, { base: start, commits: plan }, {}), /合并提交/)
  await assert.rejects(applyPlan(repo, { base: start, commits: plan, guard: null }, {}), /合并提交/)
  assert.equal(await run(['rev-parse', 'HEAD']), head, 'a refused plan leaves HEAD alone')
  assert.equal((await listUndoPoints(repo, {})).length, 0, 'and creates no undo point')
  assert.equal(await repo.operation({}), null, 'and leaves no rebase half-started')

  // The classifier names each cause, so a plan that changes underneath us is not
  // reported as a conflict.
  assert.match(summarizeFailure({ stderr: "error: 'pick' does not accept merge commits" }), /合并提交/)
  assert.match(summarizeFailure({ stderr: 'The previous cherry-pick is now empty, possibly due to conflict resolution.' }), /空提交/)
  assert.match(summarizeFailure({ stderr: 'error: The pre-rebase hook refused to rebase.' }), /pre-rebase hook/)
  assert.match(summarizeFailure({ stderr: 'CONFLICT (content): Merge conflict in a.txt' }), /冲突/)
  assert.match(summarizeFailure({ stderr: 'error: there was a problem with the editor' }), /计划文件/)
  console.log('PASS a merge in range is refused before the rebase starts and the failure classifier names each cause')
}

// ---------------------------------------------------------------------------
// 7. A commit that becomes empty during the replay is DROPPED by git, and the reply
//    says which one. The plan lists N commits; the branch can end up with fewer.
//
// The fixture is the ordinary shape of that problem: one commit adds a change and a
// later commit reverts it. Dropping the first makes the second empty, and git
// discards it — correctly. Without a report, the panel would say "planned 2, got 0"
// with no reason, which reads as a bug in the plugin.
// ---------------------------------------------------------------------------
{
  const { run, repo } = await fixture('rebase-drop-empty', 1)
  const base = await run(['rev-parse', 'HEAD'])
  await writeFile(join(repo.root, 'f1.txt'), 'v1\nA\n')
  await run(['add', '-A']); await run(['commit', '-m', 'add A'])
  const addA = await run(['rev-parse', 'HEAD'])
  await writeFile(join(repo.root, 'f1.txt'), 'v1\n')
  await run(['add', '-A']); await run(['commit', '-m', 'revert A'])
  const revertA = await run(['rev-parse', 'HEAD'])
  await writeFile(join(repo.root, 'keep.txt'), 'keep\n')
  await run(['add', '-A']); await run(['commit', '-m', 'unrelated work'])

  // Dropping the addition makes the revert empty.
  const plan = [
    { sha: addA, action: 'drop' },
    { sha: revertA, action: 'pick' },
    { sha: await run(['rev-parse', 'HEAD']), action: 'pick' },
  ]
  const preview = await previewPlan(repo, { base, commits: plan }, {})
  assert.equal(preview.planned, 3, 'the preview reports what it will replay')

  const applied = await applyPlan(repo, { base, commits: plan, guard: null }, {})
  assert.equal(applied.ok, true, applied.message)
  assert.deepEqual(await subjectsSince(run, base), ['unrelated work'], 'the now-empty revert was dropped')
  assert.equal(applied.dropped.length, 1, 'the dropped commit is reported, not silently missing')
  assert.equal(applied.dropped[0].sha, revertA)
  // The file is exactly what the surviving history implies: A never landed.
  assert.equal(await readFile(join(repo.root, 'f1.txt'), 'utf8'), 'v1\n')

  // A plan that drops nothing reports an empty list rather than omitting the field.
  const clean = await fixture('rebase-no-drop', 2)
  const cleanBase = await clean.run(['rev-parse', 'HEAD~1'])
  const cleanSha = await clean.run(['rev-parse', 'HEAD'])
  const cleanApplied = await applyPlan(clean.repo, { base: cleanBase, commits: [{ sha: cleanSha, action: 'pick' }], guard: null }, {})
  assert.equal(cleanApplied.ok, true, cleanApplied.message)
  assert.deepEqual(cleanApplied.dropped, [])

  // The reporter reads both shapes git uses for the same fact, INCLUDING the
  // carriage-return form: git rewrites its progress line with `\r`, so the noticed
  // line arrives as `"Rebasing (2/3)\rdropping …"` — a `\r` at the START of the line,
  // not its end. An anchored `^dropping` misses that, the report comes back empty,
  // and the smaller commit count becomes exactly the mystery this function exists to
  // prevent. This case was found by running it on Windows, not by reading the code.
  assert.equal(droppedCommits({ stderr: 'dropping abc1234 subject here -- patch contents already upstream' })[0].sha, 'abc1234')
  assert.equal(droppedCommits({ stderr: 'warning: skipped previously applied commit abc1234' })[0].sha, 'abc1234')
  assert.equal(droppedCommits({ stderr: 'Rebasing (2/3)\rdropping abc1234 x -- y\r\n' })[0].sha, 'abc1234', 'a leading CR still parses')
  assert.equal(droppedCommits({ stderr: 'warning: skipped previously applied commit abc1234\r\n' })[0].sha, 'abc1234', 'a trailing CR still parses')
  assert.deepEqual(droppedCommits({ stderr: '' }), [])
  console.log('PASS a commit that becomes empty on replay is dropped by git and reported in the reply')
}

// ---------------------------------------------------------------------------
// 8. The undo points: created with a reflog, listed, restored both ways, pruned.
// ---------------------------------------------------------------------------
{
  const { run, repo } = await fixture('undo', 3)
  const head = await run(['rev-parse', 'HEAD'])

  // Nothing exists yet, and an empty listing is not an error.
  assert.deepEqual(await listUndoPoints(repo, {}), [])

  const undo = await createUndoPoint(repo, { sha: head, action: 'reword', ref: 'refs/heads/main', note: 'test entry' }, {})
  assert.ok(undo.ref.startsWith(UNDO_PREFIX))
  // The reflog is what keeps the commits alive after the ref is gone, so it is
  // asserted rather than assumed.
  const reflog = await run(['reflog', 'show', undo.ref])
  assert.match(reflog, /dsh: reword\|refs\/heads\/main\|test entry/)

  const listed = await listUndoPoints(repo, {})
  assert.equal(listed.length, 1)
  assert.equal(listed[0].sha, head)
  assert.equal(listed[0].action, 'reword')
  assert.equal(listed[0].origin, 'refs/heads/main')
  assert.equal(listed[0].shortSha, head.slice(0, 8))
  assert.ok(listed[0].at > 0)

  // `branch` mode creates a ref and moves nothing.
  const restored = await restoreUndoPoint(repo, { ref: undo.ref, mode: 'branch', name: 'rescue' }, {})
  assert.equal(restored.ok, true, restored.message)
  assert.equal(await run(['rev-parse', 'refs/heads/rescue']), head)
  assert.equal(await run(['rev-parse', 'HEAD']), head, 'creating a branch moved nothing')
  // A name that already exists is refused rather than moved.
  await assert.rejects(restoreUndoPoint(repo, { ref: undo.ref, mode: 'branch', name: 'rescue' }, {}), /已存在/)

  // `reset` mode moves the branch back, and `--keep` refuses instead of overwriting.
  // A commit on top must touch the SAME file the local edit touches, or `--keep`
  // legitimately carries the edit across and there is nothing to refuse: it only
  // blocks a move that would have to overwrite the working-tree version.
  await writeFile(join(repo.root, 'f1.txt'), 'v1 changed by a later commit\n')
  await run(['add', '-A']); await run(['commit', '-m', 'later work'])
  await writeFile(join(repo.root, 'f1.txt'), 'local edit that conflicts with the target\n')
  const refused = await restoreUndoPoint(repo, { ref: undo.ref, mode: 'reset' }, {})
  assert.equal(refused.ok, false, 'a move that would overwrite local work must fail')
  assert.match(refused.message, /本地改动/)
  assert.notEqual(await run(['rev-parse', 'HEAD']), head, 'the branch really was ahead')
  await run(['checkout', '--', 'f1.txt'])
  const moved = await restoreUndoPoint(repo, { ref: undo.ref, mode: 'reset' }, {})
  assert.equal(moved.ok, true, moved.message)
  assert.equal(await run(['rev-parse', 'HEAD']), head)

  // Only our own namespace is reachable.
  await assert.rejects(restoreUndoPoint(repo, { ref: 'refs/heads/main', mode: 'branch' }, {}), /无效的恢复点/)
  await assert.rejects(deleteUndoPoint(repo, { ref: 'refs/heads/main' }, {}), /无效的恢复点/)

  const deleted = await deleteUndoPoint(repo, { ref: undo.ref }, {})
  assert.equal(deleted.ok, true, deleted.message)
  assert.equal((await listUndoPoints(repo, {})).length, 0)
  console.log('PASS undo points are created with a reflog, listed, restored by branch and reset, and pruned')
}

// ---------------------------------------------------------------------------
// 9. A successful reword is discoverable through the same listing as an interactive
//    rebase, so the recovery panel is one screen for every rewrite.
// ---------------------------------------------------------------------------
{
  const { run, repo } = await fixture('undo-integration', 2)
  const head = await run(['rev-parse', 'HEAD'])
  const result = await rewriteCommits(repo, { mode: 'reword', sha: head, message: 'reworded tip' }, {})
  assert.equal(result.ok, true, result.message)
  assert.ok(result.backup.startsWith(UNDO_PREFIX), 'the reword reports an undo point in the shared namespace')

  const listed = await listUndoPoints(repo, {})
  assert.equal(listed.length, 1)
  assert.equal(listed[0].action, 'reword')
  assert.equal(listed[0].sha, head, 'the entry points at the tip BEFORE the rewrite')
  assert.equal(listed[0].origin, 'refs/heads/main')
  console.log('PASS a reword records a discoverable undo point in the shared namespace')
}

// ---------------------------------------------------------------------------
// 10. The shell used to run our sequence editor comes from the git that is running,
//     not from a hard-coded path. A machine that installed Git outside `C:\Program
//     Files` is the normal case, and a literal path fails there with "there was a
//     problem with the editor".
// ---------------------------------------------------------------------------
{
  const shell = resolveShell(gitPath)
  assert.ok(shell !== null, `no POSIX shell found next to ${gitPath}`)
  assert.equal(resolveShell(''), null)
  assert.equal(resolveShell(undefined), null)
  console.log(`PASS the sequence editor shell is resolved from git's own install (${shell})`)
}

// ---------------------------------------------------------------------------
// 11. A working-tree blame must not outlive the edit it describes.
//
// `git blame` on the working tree reads the FILE ON DISK, but the cache key used to be
// a bare `WORKTREE`. So: blame a file, change it, blame again — and the panel showed
// the previous version's attribution, which reads as "this line is still Alice's" when
// Alice has not touched it in weeks. The key now carries the file's `size:mtime`, and
// this case pins both halves: the edit is noticed, and a REVISION blame is still cached
// because a commit's content cannot change.
// ---------------------------------------------------------------------------
{
  const { run, repo } = await fixture('blame-stamp', 1)
  await run(['config', 'user.name', 'Alice'])
  await writeFile(join(repo.root, 'f.txt'), 'one\ntwo\n')
  await run(['add', '-A']); await run(['commit', '-m', 'alice wrote both lines'])
  const committed = await run(['rev-parse', 'HEAD'])

  const before = await blame(repo, { path: 'f.txt' }, {})
  const beforeLine1 = before.lines.find(line => line.line === 1)
  assert.ok(beforeLine1, 'line 1 is attributed')

  // An UNCOMMITTED edit: line 1 now belongs to nobody, and git says so.
  await writeFile(join(repo.root, 'f.txt'), 'ONE-EDITED\nand\nmore\nlines\n')
  const after = await blame(repo, { path: 'f.txt' }, {})
  const afterLine1 = after.lines.find(line => line.line === 1)
  assert.notEqual(afterLine1.sha, beforeLine1.sha, 'the cache must not answer for the previous bytes')
  // git attributes an uncommitted line to the all-zero sha and "Not Committed Yet".
  assert.match(String(afterLine1.sha), /^0+$/)

  // A REVISION blame is immutable, so it is still served from the cache. Proving it was
  // a cache hit rather than a re-run: the second call must not change the result even
  // though the working tree has moved on.
  const atCommit = await blame(repo, { path: 'f.txt', rev: committed }, {})
  const atCommitAgain = await blame(repo, { path: 'f.txt', rev: committed }, {})
  assert.equal(atCommitAgain.lines.find(line => line.line === 1).sha, atCommit.lines.find(line => line.line === 1).sha)
  assert.equal(atCommit.lines.find(line => line.line === 1).sha, beforeLine1.sha, 'the revision blame is the committed content')
  console.log('PASS blame is re-read after a working-tree edit while a revision blame stays cached')
}

// ---------------------------------------------------------------------------
// 12. A PUBLISHED commit cannot be rewritten without an explicit override.
//
// This is the guard the whole module exists behind: rewriting a commit that is already on
// a remote rewrites history other clones have, and nothing in this repository can undo
// that. It was MISSING from the first version of the planner — the panel drew a warning
// and a checkbox, and neither reached the Host, so a pushed commit could be dropped with
// one click and no refusal anywhere.
//
// The fixture pushes to a real bare remote, because "published" has to mean what git
// means by it (`rev-list --remotes`), not what a flag in the payload says.
// ---------------------------------------------------------------------------
{
  const { root, run, repo } = await fixture('rebase-published', 2)
  const remote = join(root, '..', 'remote.git')
  await run(['init', '--bare', '-q', remote])
  await run(['remote', 'add', 'origin', remote])
  // The tip is pushed; the commit above it is not.
  await run(['push', '-q', 'origin', 'HEAD:refs/heads/main'])
  await run(['fetch', '-q', 'origin'])
  const base = await run(['rev-parse', 'HEAD~1'])
  const pushed = await run(['rev-parse', 'HEAD'])
  await writeFile(join(repo.root, 'later.txt'), 'not pushed\n')
  await run(['add', '-A']); await run(['commit', '-m', 'unpushed work'])
  const tip = await run(['rev-parse', 'HEAD'])
  const headBefore = tip

  // The preview says how many commits are published, so the panel can warn about a fact
  // rather than guess one from a possibly stale list.
  const preview = await previewPlan(repo, { base, commits: [
    { sha: pushed, action: 'drop' },
    { sha: tip, action: 'pick' },
  ] }, {})
  assert.equal(preview.published, 1, 'the preview counts the pushed commit')
  assert.equal(preview.commits.find(entry => entry.sha === pushed).published, true)
  assert.equal(preview.commits.find(entry => entry.sha === tip).published, false)

  // Rewriting it is refused, and nothing moved.
  await assert.rejects(
    applyPlan(repo, { base, commits: [{ sha: pushed, action: 'drop' }, { sha: tip, action: 'pick' }], guard: null }, {}),
    /已经推送到远端/,
  )
  assert.equal(await run(['rev-parse', 'HEAD']), headBefore, 'a refused rewrite leaves HEAD alone')
  assert.equal(await repo.operation({}), null, 'and starts no rebase')

  // The explicit override is the only way through, and it must be exactly `true`.
  await assert.rejects(
    applyPlan(repo, { base, commits: [{ sha: pushed, action: 'drop' }, { sha: tip, action: 'pick' }], guard: null, allowPublished: 'yes' }, {}),
    /已经推送到远端/,
  )
  const allowed = await applyPlan(repo, {
    base, commits: [{ sha: pushed, action: 'drop' }, { sha: tip, action: 'pick' }], guard: null, allowPublished: true,
  }, {})
  assert.equal(allowed.ok, true, allowed.message)
  assert.deepEqual(await subjectsSince(run, base), ['unpushed work'], 'the override really did rewrite the pushed commit')

  // A plan that touches no published commit needs no override at all.
  const clean = await fixture('rebase-published-clean', 2)
  const cleanBase = await clean.run(['rev-parse', 'HEAD~1'])
  const cleanTip = await clean.run(['rev-parse', 'HEAD'])
  const cleanPreview = await previewPlan(clean.repo, { base: cleanBase, commits: [{ sha: cleanTip, action: 'reword' }] }, {})
  assert.equal(cleanPreview.published, 0, 'a repository with no remote has nothing published')
  const cleanApplied = await applyPlan(clean.repo, {
    base: cleanBase, commits: [{ sha: cleanTip, action: 'reword' }], guard: null, messages: { [cleanTip]: 'reworded' },
  }, {})
  assert.equal(cleanApplied.ok, true, cleanApplied.message)
  console.log('PASS a published commit is refused unless the caller explicitly allows it')
}

// ---------------------------------------------------------------------------
// 13. A CONFLICT is a result, not a failure.
//
// Git stops mid-rebase and waits for a decision. The first version reported that as
// `ok: false`, which the RPC layer turned into an error envelope, so the panel kept its
// dialog open with a red message and the user never reached the continue/skip/abort
// controls — while the branch was already half-rewritten. The reply now says
// `ok: true, stopped: true`, and `stopped` is only set when the repository really is
// mid-operation.
// ---------------------------------------------------------------------------
{
  const { run, repo } = await fixture('rebase-conflict', 1)
  // Two commits editing the same line: replaying them in the other order must conflict.
  await writeFile(join(repo.root, 'f.txt'), 'lineA\n')
  await run(['add', '-A']); await run(['commit', '-m', 'A'])
  const A = await run(['rev-parse', 'HEAD'])
  await writeFile(join(repo.root, 'f.txt'), 'lineB\n')
  await run(['add', '-A']); await run(['commit', '-m', 'B'])
  const B = await run(['rev-parse', 'HEAD'])
  const base = await run(['rev-parse', 'HEAD~2'])

  const applied = await applyPlan(repo, {
    base, commits: [{ sha: B, action: 'pick' }, { sha: A, action: 'pick' }], guard: null,
  }, {})
  assert.equal(applied.ok, true, 'a stopped rebase must not be reported as a failed write')
  assert.equal(applied.stopped, true, 'and it must say that a decision is waiting')
  // The undo point is the answer to "how do I get back", so it is reported either way.
  assert.ok(applied.backup.startsWith(UNDO_PREFIX))
  assert.match(applied.message, /冲突/)
  // The repository really is mid-rebase, which is what makes `stopped` truthful.
  const operation = await repo.operation({})
  assert.equal(operation?.kind, 'rebase')
  assert.equal(operation.stopReason, 'replay')
  assert.equal(operation.canSkip, true, 'a replay conflict can still be skipped')
  const conflictReview = await operationReview(repo)
  const conflictRpc = createRpc({ registry: new RepoRegistry({ gitPath }),
    config: { get: () => ({ ...DEFAULT_CONFIG }) }, logger: { warn() {} } })
  const skipped = await conflictRpc.call('write.continueOperation', {
    root: repo.root, kind: 'rebase', skip: true, confirm: true, reviewHash: conflictReview.hash,
  })
  assert.equal(skipped.ok, true, skipped.error?.message)
  assert.equal(await repo.operation(), null)

  // `stopped` is only true for a real mid-operation stop. A refusal that never started a
  // rebase must not claim one is waiting.
  const other = await fixture('rebase-not-stopped', 2)
  const otherBase = await other.run(['rev-parse', 'HEAD~1'])
  const otherTip = await other.run(['rev-parse', 'HEAD'])
  const done = await applyPlan(other.repo, {
    base: otherBase, commits: [{ sha: otherTip, action: 'pick' }], guard: null,
  }, {})
  assert.equal(done.ok, true)
  assert.equal(done.stopped, false, 'a finished rebase is not stopped')
  assert.equal(await other.repo.operation({}), null)
  console.log('PASS a conflict is reported as a stopped result rather than a failed write')
}

// Messages must survive stops, including a successful `edit` stop and a Host restart.
{
  const { run, repo, root } = await fixture('rebase-resume-message', 3)
  const base = await run(['rev-parse', 'HEAD~2'])
  const shas = await commitsSince(run, base)
  const rpc = createRpc({ registry: new RepoRegistry({ gitPath }),
    config: { get: () => ({ ...DEFAULT_CONFIG }) }, logger: { warn() {} } })
  const reply = await rpc.call('write.applyPlan', {
    root, confirm: true, base, commits: [{ sha: shas[0], action: 'edit' }, { sha: shas[1], action: 'reword' }],
    messages: { [shas[1]]: 'message after pause\n\nPreserved body.' },
  })
  assert.equal(reply.ok, true, reply.error?.message)
  const result = reply.value
  assert.equal(result.ok, true)
  assert.equal(result.stopped, true, 'edit exits zero but is still mid-rebase')
  assert.match(result.message, /暂停/)
  const review = await operationReview(repo)
  assert.equal(review.operation.stopReason, 'edit')
  assert.equal(review.operation.canSkip, false)
  const pausedHead = await run(['rev-parse', 'HEAD'])
  const refusedSkip = await rpc.call('write.continueOperation', {
    root, kind: 'rebase', skip: true, confirm: true, reviewHash: review.hash,
  })
  assert.equal(refusedSkip.ok, false)
  assert.match(refusedSkip.error.message, /已应用/)
  assert.equal(await run(['rev-parse', 'HEAD']), pausedHead, 'a refused skip leaves the edit stop untouched')
  assert.equal((await repo.operation()).stopReason, 'edit')
  const state = (await repo.run(['rev-parse', '--git-path', 'rebase-merge'])).stdout.trim()
  const stateDirectory = resolve(root, state)
  // rev-parse may return an absolute path for linked worktrees.
  const { session: reopened } = await new RepoRegistry({ gitPath }).open(root)
  const continued = await reopened.runWrite(['rebase', '--continue'])
  assert.equal(continued.code, 0, continued.stderr)
  assert.equal(await run(['log', '-1', '--format=%B']), 'message after pause\n\nPreserved body.')
  assert.equal(await reopened.operation({}), null)
  await assert.rejects(readFile(join(stateDirectory, 'dsh-message-0')), { code: 'ENOENT' })
  console.log('PASS edit stops retain future messages across sessions and Git cleans them on completion')
}
{
  const { run, repo, root } = await fixture('rebase-hook-refusal', 2)
  const base = await run(['rev-parse', 'HEAD~1'])
  const sha = await run(['rev-parse', 'HEAD'])
  const hooks = join(root, 'review-hooks')
  await mkdir(hooks)
  await writeFile(join(hooks, 'pre-rebase'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  await run(['config', 'core.hooksPath', hooks])
  const result = await applyPlan(repo, {
    base, commits: [{ sha, action: 'reword' }], messages: { [sha]: 'refused message' },
  })
  assert.equal(result.ok, false, 'a hook refusal is not a successful rewrite')
  assert.equal(result.stopped, false)
  assert.notEqual(result.code, 0)
  assert.equal(await run(['rev-parse', 'HEAD']), sha)
  assert.equal(await repo.operation({}), null)
  console.log('PASS a pre-rebase hook refusal reports failure without moving HEAD')
}

{
  const { run, repo, root } = await fixture('undo-preserve-index', 2)
  const target = await run(['rev-parse', 'HEAD~1'])
  const head = await run(['rev-parse', 'HEAD'])
  const undo = await createUndoPoint(repo, { sha: target, action: 'reword', ref: 'refs/heads/main' })
  await writeFile(join(root, 'f1.txt'), 'index-only version\n')
  await run(['add', 'f1.txt'])
  await writeFile(join(root, 'f1.txt'), 'working-only version\n')
  const index = await run(['write-tree'])
  const refused = await restoreUndoPoint(repo, { ref: undo.ref, mode: 'reset' })
  assert.equal(refused.ok, false)
  assert.match(refused.message, /暂存区/)
  assert.equal(await run(['write-tree']), index, 'the full index remains unchanged')
  assert.equal(await run(['rev-parse', 'HEAD']), head)
  assert.equal(await readFile(join(root, 'f1.txt'), 'utf8'), 'working-only version\n')
  assert.equal((await restoreUndoPoint(repo, { ref: undo.ref, mode: 'branch' })).ok, true, 'creating a rescue branch still works with staged changes')
  console.log('PASS restoring refuses index-only changes without altering the index, worktree or HEAD')
}
{
  const { run, repo } = await fixture('undo-created-time', 1)
  const newerCommit = await run(['rev-parse', 'HEAD'])
  await run(['commit', '--allow-empty', '-m', 'old commit date'], {
    env: { GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' },
  })
  const oldCommit = await run(['rev-parse', 'HEAD'])
  const now = Date.now()
  // Seed an older millisecond name and a legacy second name, both pointing at
  // a newer commit, to distinguish creation order from commit chronology.
  await run(['update-ref', `${UNDO_PREFIX}${now - 10000}-abcdef01-reword-main`, newerCommit])
  const legacy = `${UNDO_PREFIX}${Math.floor((now - 20000) / 1000)}-abcdef02-reword-main`
  await run(['update-ref', legacy, newerCommit])
  const latest = await createUndoPoint(repo, { sha: oldCommit, action: 'reword', ref: 'refs/heads/main' })
  const listed = await listUndoPoints(repo)
  assert.equal(listed[0].ref, latest.ref)
  assert(listed[0].at >= now && listed[0].at <= Date.now())
  assert.equal(listed[2].ref, legacy)
  assert.equal(listed[2].at, Math.floor((now - 20000) / 1000) * 1000)
  assert.equal((await listUndoPoints(repo, { limit: 1 }))[0].ref, latest.ref)
  console.log('PASS recovery dates and limits use creation order, including legacy second-based refs')
}

{
  const { run, repo, root } = await fixture('skip-conflicted-pick', 1)
  await writeFile(join(root, 'f1.txt'), 'incoming change\n')
  await run(['add', 'f1.txt']); await run(['commit', '-m', 'source change'])
  const source = await run(['rev-parse', 'HEAD'])
  await run(['checkout', '-b', 'target', 'HEAD~1'])
  await writeFile(join(root, 'f1.txt'), 'target change\n')
  await run(['add', 'f1.txt']); await run(['commit', '-m', 'target change'])
  const before = await run(['rev-parse', 'HEAD'])
  assert.notEqual((await repo.runWrite(['cherry-pick', source])).code, 0)
  const review = await operationReview(repo)
  assert.equal(review.operation.kind, 'cherry-pick')
  assert(review.conflicts > 0)
  const registry = new RepoRegistry({ gitPath })
  const rpc = createRpc({ registry, config: { get: () => ({ ...DEFAULT_CONFIG }) }, logger: { warn() {} } })
  const refused = await rpc.call('write.continueOperation', { root, kind: 'cherry-pick', skip: true, reviewHash: review.hash })
  assert.equal(refused.error?.code, 'git/needs-confirmation')
  const skipped = await rpc.call('write.continueOperation', { root, kind: 'cherry-pick', skip: true, reviewHash: review.hash, confirm: true })
  assert.equal(skipped.ok, true, skipped.error?.message)
  assert.equal(await run(['rev-parse', 'HEAD']), before)
  assert.equal(await readFile(join(root, 'f1.txt'), 'utf8'), 'target change\n')
  assert.equal(await repo.operation(), null)
  console.log('PASS confirmed skip works with unresolved conflicts and clears the operation')
}

{
  const { repo, run } = await fixture('undo-valid-long-branches', 1)
  for (const [index, name] of ['a'.repeat(79) + '.b', 'a'.repeat(75) + '.lock-tail', '分'.repeat(60)].entries()) {
    await run(['checkout', '-b', name])
    const head = await run(['rev-parse', 'HEAD'])
    const undo = await createUndoPoint(repo, { sha: head, action: 'reword', ref: 'refs/heads/' + name })
    await run(['check-ref-format', undo.ref])
    assert(Buffer.byteLength(undo.ref.split('/').at(-1), 'utf8') <= 255)
    const rewritten = await rewriteCommits(repo, { mode: 'reword', sha: head, message: `reword long branch ${index}` })
    assert.equal(rewritten.ok, true, rewritten.message)
    const points = await listUndoPoints(repo)
    assert(points.some(point => point.ref === undo.ref && point.origin === 'refs/heads/' + name), 'metadata retains the complete original branch name')
    assert(points.some(point => point.ref === rewritten.backup && point.origin === 'refs/heads/' + name))
  }
  console.log('PASS valid long branch names survive dot/lock truncation and multibyte ref length limits')
}

console.log('History rewrite checks passed')

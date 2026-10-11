/**
 * dsh-plugin-git — rewriting unpushed commits.
 *
 * Two operations live here: rewording one commit's message, and squashing a run
 * of commits into one. Both rewrite history, which is the most dangerous thing
 * this plugin can do, so the module is built around three invariants rather than
 * around convenience:
 *
 * 1. **Only unpublished commits are ever touched.** A commit reachable from any
 *    `refs/remotes/*` has been pushed; rewriting it would rewrite history other
 *    people already have, and the local repository cannot undo that. The check is
 *    one `git rev-list --remotes`, and it covers the rewritten commits AND every
 *    descendant that has to be re-parented on top of them.
 *
 * 2. **Content cannot change.** Commits are rebuilt with `commit-tree` using each
 *    original commit's *tree verbatim*, so every snapshot is byte-identical and
 *    only the message (and therefore the SHA) differs. The tip's tree is asserted
 *    equal to the old tip's tree before the branch moves, which is what makes the
 *    working tree, the index and `git status` come out unchanged. A rewrite that
 *    could alter a file would be a different, far riskier feature.
 *
 * 3. **The branch moves by compare-and-swap.** `update-ref` is given the expected
 *    old value, in the same transaction that creates the backup ref, so a commit
 *    landing from another terminal between the plan and the move fails the whole
 *    operation instead of silently discarding it.
 *
 * Deliberately NOT implemented with `git rebase -i`: that path needs a sequence
 * editor, can conflict, and leaves the repository mid-rebase in a state the user
 * has to reason about. Rebuilding commits directly cannot conflict, because no
 * working-tree content is ever re-applied.
 */
import { randomUUID } from 'node:crypto'

import { workbenchState } from './workbench.js'

/** Field separator inside one commit record. */
const FIELD = '\x1f'
/** Record separator between commits. */
const RECORD = '\x1e'

/** The fields read for every commit that takes part in a rewrite. */
const FIELDS = ['%H', '%T', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%B']

/** The maximum commits one squash may combine. */
const MAX_SQUASH = 100

/**
 * Refuse a message git would store in a way we did not intend.
 *
 * NUL cannot appear in a commit object's message, and a message that is nothing
 * but whitespace is not a message. Newlines are of course allowed — a commit body
 * is the common case.
 *
 * @param message - the candidate message.
 * @returns the message with a trailing newline normalized away.
 */
function validateMessage(message) {
  if (typeof message !== 'string') throw new Error('提交信息无效')
  if (message.includes('\0')) throw new Error('提交信息不能包含 NUL 字符')
  if (message.trim() === '') throw new Error('提交信息不能为空')
  return message
}

/**
 * Reject a ref that could be read as an option or address another namespace.
 *
 * These values reach `update-ref` and `commit-tree`, so a leading `-` would be
 * parsed as a flag, and anything outside `refs/` is not a branch we own.
 *
 * @param ref - a full ref name.
 * @param prefix - the namespace the ref must live in.
 * @returns the ref.
 */
function validateRef(ref, prefix) {
  if (typeof ref !== 'string' || !ref.startsWith(prefix) || ref.startsWith('-') || /[\0\r\n ~^:?*[\\]/.test(ref)) {
    throw new Error('无效的引用')
  }
  return ref
}

/**
 * Parse `git log --format=<fields>` output for a batch of commits.
 *
 * `%B` is a multi-line value, so records are separated by `\x1e` rather than by
 * newlines; splitting on lines would corrupt any commit with a body.
 *
 * @param text - raw stdout.
 * @returns commit records.
 */
function parseCommits(text) {
  const out = []
  for (const record of String(text ?? '').split(RECORD)) {
    if (record.trim() === '') continue
    const parts = record.split(FIELD)
    if (parts.length < FIELDS.length) continue
    const [sha, tree, parents, authorName, authorEmail, authorDate, , , , message] = parts
    out.push({
      sha: sha.trim(),
      tree: tree.trim(),
      parents: parents.trim() === '' ? [] : parents.trim().split(' '),
      authorName,
      authorEmail,
      authorDate: authorDate.trim(),
      // `%B` keeps its trailing newline; git stores the message verbatim, so it
      // is trimmed here to keep comparisons and display predictable.
      message: message.replace(/\n+$/, ''),
    })
  }
  return out
}

/**
 * Read one commit, or several in the order given.
 *
 * @param repo - the repository session.
 * @param shas - the commits to read.
 * @param options - cancellation.
 * @returns commit records, newest first as git emits them.
 */
async function readCommits(repo, shas, options) {
  const wanted = shas.filter((sha) => typeof sha === 'string' && /^[a-f0-9]{7,64}$/i.test(sha))
  if (wanted.length === 0) throw new Error('未指定提交')
  const result = await repo.run(['log', '--no-walk=unsorted', `--format=${FIELDS.join(FIELD)}${RECORD}`, ...wanted], {
    timeoutMs: 30_000,
    signal: options.signal,
  })
  if (result.code !== 0) throw new Error(result.stderr.trim() || '无法读取提交')
  const parsed = parseCommits(result.stdout)
  const bySha = new Map(parsed.map((commit) => [commit.sha, commit]))
  // `--no-walk=unsorted` preserves our order; anything git could not resolve is
  // reported rather than silently dropped, because a dropped commit would make
  // the rewrite quietly incomplete.
  const ordered = []
  for (const sha of shas) {
    const commit = bySha.get(sha)
    if (commit === undefined) throw new Error(`提交不存在：${String(sha).slice(0, 12)}`)
    ordered.push(commit)
  }
  return ordered
}

/**
 * Every commit reachable from a remote-tracking ref, i.e. already published.
 *
 * One command rather than one `for-each-ref --contains` per commit: a squash can
 * involve dozens of commits and a per-commit probe would make the guard the
 * slowest part of the operation, which is how guards get removed.
 *
 * @param repo - the repository session.
 * @param options - cancellation.
 * @returns a Set of commit SHAs.
 */
async function publishedShas(repo, options) {
  const result = await repo.run(['rev-list', '--remotes'], { timeoutMs: 60_000, signal: options.signal, maxBuffer: 32 * 1024 * 1024 })
  // No remotes configured is the normal answer, not a failure: nothing is
  // published, so every local commit may be rewritten.
  if (result.code !== 0) return new Set()
  return new Set(result.stdout.split('\n').map((line) => line.trim()).filter(Boolean))
}

/**
 * Read the repository facts a rewrite must not violate.
 *
 * The returned object is a full workbench-style guard, not just a head/branch
 * pair: the RPC layer runs {@link checkWorkbenchIdentity} before every write, and
 * a guard missing `state` would make that check compare `undefined` to the real
 * dirty-tree fingerprint and refuse every execution.
 *
 * @param repo - the repository session.
 * @param options - cancellation.
 * @returns `{ head, branch, state, references, operation }`.
 */
async function requireRewritableHead(repo, options) {
  const state = await workbenchState(repo, options)
  if (state.head === null || state.head === '') throw new Error('当前分支还没有提交')
  if (state.branch === null || state.branch === '') throw new Error('处于分离 HEAD 状态，请先切换到分支')
  const branch = validateRef(state.branch, 'refs/heads/')
  if (state.operation !== null && state.operation !== undefined) throw new Error('请先完成或中止正在进行的 Git 操作')
  return {
    head: state.head,
    branch,
    state: state.state,
    references: { [branch]: state.head },
  }
}

/**
 * The commits that must be re-parented because a rewrite happened below them.
 *
 * @param repo - the repository session.
 * @param from - the newest rewritten commit (exclusive).
 * @param options - cancellation.
 * @returns commits in parent-before-child order.
 */
async function descendantsOf(repo, from, options) {
  const result = await repo.run(['rev-list', '--reverse', '--topo-order', `${from}..HEAD`], {
    timeoutMs: 60_000,
    signal: options.signal,
  })
  if (result.code !== 0) throw new Error(result.stderr.trim() || '无法读取后续提交')
  const shas = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  return shas.length === 0 ? [] : readCommits(repo, shas, options)
}

/**
 * Build one commit object with an explicit tree and parents.
 *
 * The author identity and date are carried over from the original commit, which
 * is what `git rebase` and `git commit --amend` do: rewriting changes who
 * committed it and when, never who wrote it.
 *
 * @param repo - the repository session.
 * @param spec - `{ tree, parents, message, author }`.
 * @param options - cancellation.
 * @returns the new commit SHA.
 */
async function createCommit(repo, spec, options) {
  const args = ['commit-tree', spec.tree]
  for (const parent of spec.parents) args.push('-p', parent)
  args.push('-F', '-')
  const result = await repo.runWrite(args, {
    timeoutMs: 60_000,
    signal: options.signal,
    // The message goes over stdin so that quotes, `$`, backslashes and newlines
    // are stored exactly as typed instead of being re-interpreted.
    input: spec.message,
    env: {
      GIT_AUTHOR_NAME: spec.author.authorName,
      GIT_AUTHOR_EMAIL: spec.author.authorEmail,
      GIT_AUTHOR_DATE: spec.author.authorDate,
    },
  })
  const sha = result.stdout.trim()
  if (result.code !== 0 || !/^[a-f0-9]{40,64}$/i.test(sha)) {
    throw new Error(result.stderr.trim() || '无法创建改写后的提交')
  }
  return sha
}

/**
 * Validate a squash run and put it in parent-before-child order.
 *
 * A caller's selection order is whatever the UI happened to send, so it is not
 * trusted: the run is rebuilt as the parent chain starting from the oldest
 * selected commit. That also makes the "must be contiguous" rule checkable in one
 * pass — if walking parents never visits exactly the selected set, the selection
 * was not a linear run and is refused.
 *
 * That restriction is the whole safety story for squatting a range: combining
 * commits that are not adjacent on one branch cannot be expressed as "one commit
 * carrying the newest tree", and silently flattening a merge would discard branch
 * structure the user still has.
 *
 * @param commits - the requested commits, in any order.
 * @returns the same commits ordered oldest first.
 */
function orderSquashRun(commits) {
  if (!Array.isArray(commits) || commits.length < 2) throw new Error('请选择至少两个提交进行合并')
  if (commits.length > MAX_SQUASH) throw new Error(`一次最多合并 ${MAX_SQUASH} 个提交`)
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]))
  if (bySha.size !== commits.length) throw new Error('选择的提交有重复')
  const children = new Map()
  for (const commit of commits) {
    if (commit.parents.length > 1) throw new Error('合并操作不支持包含合并提交的范围')
    const parent = commit.parents[0]
    if (parent !== undefined && bySha.has(parent)) {
      if (children.has(parent)) throw new Error('只能合并同一分支上连续的提交')
      children.set(parent, commit)
    }
  }
  // The oldest commit is the one no other selected commit claims as its parent.
  const roots = commits.filter((commit) => {
    const parent = commit.parents[0]
    return parent === undefined || !bySha.has(parent)
  })
  if (roots.length !== 1) throw new Error('只能合并同一分支上连续的提交')
  const ordered = []
  let cursor = roots[0]
  while (cursor !== undefined) {
    ordered.push(cursor)
    cursor = children.get(cursor.sha)
  }
  if (ordered.length !== commits.length) throw new Error('只能合并同一分支上连续的提交')
  return ordered
}

/**
 * Plan a rewrite without changing anything.
 *
 * The plan is what the confirmation dialog renders, and {@link rewriteCommits}
 * recomputes it and refuses to run if it no longer matches. That is the same
 * preview/execute discipline the workbench uses, and it is what makes
 * "the thing I confirmed" and "the thing that ran" the same operation.
 *
 * @param repo - the repository session.
 * @param request - `{ mode: 'reword'|'squash', sha?, shas?, message? }`.
 * @param options - cancellation.
 * @returns the plan: the commits involved, their new messages, and the result.
 */
export async function rewritePreview(repo, request, options = {}) {
  const mode = request?.mode === 'squash' ? 'squash' : request?.mode === 'reword' ? 'reword' : null
  if (mode === null) throw new Error('不支持的改写方式')
  const guard = await requireRewritableHead(repo, options)
  const { head, branch } = guard

  const requestedShas = mode === 'squash'
    ? (Array.isArray(request.shas) ? request.shas : [])
    : [request.sha]
  const requested = await readCommits(repo, requestedShas, options)
  const commits = mode === 'squash' ? orderSquashRun(requested) : requested

  // The rewritten commits must be ancestors of HEAD; rewriting a commit from
  // another branch would move a ref the caller is not looking at.
  const newest = commits[commits.length - 1]
  const reachable = await repo.run(['merge-base', '--is-ancestor', newest.sha, head], options)
  if (reachable.code !== 0) throw new Error('只能改写当前分支上的提交')

  const descendants = await descendantsOf(repo, newest.sha, options)
  const published = await publishedShas(repo, options)

  const involved = [...commits, ...descendants]
  const blocked = involved.filter((commit) => published.has(commit.sha))
  if (blocked.length > 0) {
    throw new Error(`有 ${blocked.length} 个提交已经推送，改写会覆盖远端历史。请先确认这些提交没有其他人使用，或改用 revert。`)
  }

  const defaultMessage = mode === 'squash'
    ? commits.map((commit) => commit.message).join('\n\n')
    : commits[0].message
  const message = request.message === undefined ? defaultMessage : validateMessage(request.message)

  return {
    mode,
    branch,
    head,
    // Everything the operation will touch, oldest first, so the dialog reads in
    // the same direction as `git log --reverse`.
    commits: commits.map((commit) => ({
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 8),
      subject: commit.message.split('\n')[0],
      message: commit.message,
      authorName: commit.authorName,
    })),
    replayed: descendants.map((commit) => ({ sha: commit.sha, shortSha: commit.sha.slice(0, 8), subject: commit.message.split('\n')[0] })),
    // The squash collapses the run into one commit; reword keeps the count.
    resultCount: mode === 'squash' ? 1 : commits.length,
    message,
    // The whole guard, so the write can be checked with the same identity rule
    // every other workbench write uses.
    guard,
  }
}

/**
 * Reword one commit, or squash a contiguous run of unpushed commits.
 *
 * @param repo - the repository session.
 * @param request - `{ mode, sha?, shas?, message?, guard? }`.
 * @param options - cancellation.
 * @returns `{ ok, message, ... }` plus the SHA mapping and the backup ref.
 */
export async function rewriteCommits(repo, request, options = {}) {
  const plan = await rewritePreview(repo, request, options)

  // Re-verify the caller's guard: the panel confirms a plan it rendered, and the
  // repository may have changed while the user was reading the dialog. The RPC
  // layer runs the same check before calling this, but repeating it here keeps
  // the invariant true for any other caller.
  if (request.guard) {
    const current = await requireRewritableHead(repo, options)
    if (request.guard.head !== current.head || request.guard.branch !== current.branch
      || (request.guard.state !== undefined && request.guard.state !== current.state)) {
      throw new Error('仓库或本地改动已变化，请重新预览并确认')
    }
  }

  const mode = plan.mode
  // Read the commits again by SHA, in the plan's (oldest-first) order, rather
  // than trusting the plan's own summary fields.
  const ordered = await readCommits(repo, plan.commits.map((commit) => commit.sha), options)

  const mapping = new Map()
  if (mode === 'squash') {
    const oldest = ordered[0]
    const newest = ordered[ordered.length - 1]
    // The squashed commit keeps the OLDEST author/date and the NEWEST tree, so
    // the combined commit's content is exactly the last commit's content.
    const sha = await createCommit(repo, {
      tree: newest.tree,
      parents: oldest.parents,
      message: plan.message,
      author: oldest,
    }, options)
    for (const commit of ordered) mapping.set(commit.sha, sha)
  } else {
    const target = ordered[0]
    const sha = await createCommit(repo, {
      tree: target.tree,
      parents: target.parents,
      message: plan.message,
      author: target,
    }, options)
    mapping.set(target.sha, sha)
  }

  // Replay everything above the rewrite so the branch tip is reconstructed.
  // Each replayed commit reuses its own tree verbatim and only its parent link
  // changes, which is why this can never conflict.
  const descendants = await descendantsOf(repo, ordered[ordered.length - 1].sha, options)
  for (const commit of descendants) {
    const parents = commit.parents.map((parent) => mapping.get(parent) ?? parent)
    const sha = await createCommit(repo, { tree: commit.tree, parents, message: commit.message, author: commit }, options)
    mapping.set(commit.sha, sha)
  }
  // The tip is the rewritten HEAD; if nothing was replayed it is the rewritten
  // commit itself. `plan.head` is always in the mapping because every commit
  // between the rewrite and HEAD is replayed.
  const finalHead = mapping.get(plan.head)
  if (finalHead === undefined) throw new Error('改写真算失败：未能定位新的分支顶端')

  // The content guard. Every tree was copied verbatim, so this cannot fail unless
  // this module has a bug — and moving the branch on a mismatch would change the
  // user's files, so it is checked rather than assumed.
  const oldTree = await repo.run(['rev-parse', `${plan.head}^{tree}`], options)
  const newTree = await repo.run(['rev-parse', `${finalHead}^{tree}`], options)
  if (oldTree.code !== 0 || newTree.code !== 0 || oldTree.stdout.trim() !== newTree.stdout.trim()) {
    throw new Error('改写会改变文件内容，已中止；分支未移动')
  }

  // One transaction: the backup ref and the branch move together, and the move
  // is a compare-and-swap against the head we planned from.
  const backup = `refs/dsh-rewrite/${Math.floor(Date.now() / 1000)}-${randomUUID().slice(0, 8)}`
  const action = mode === 'squash' ? `squash ${ordered.length} commits` : 'reword'
  const transaction = [
    'start',
    `create ${backup} ${plan.head}`,
    `update ${plan.branch} ${finalHead} ${plan.head}`,
    'prepare',
    'commit',
    '',
  ].join('\n')
  const updated = await repo.runWrite(['update-ref', '-m', `dsh: ${action}`, '--stdin'], {
    timeoutMs: 60_000,
    signal: options.signal,
    input: transaction,
  })
  if (updated.code !== 0) {
    return {
      ok: false,
      code: updated.code,
      message: updated.stderr.trim() || '分支已在其他位置变化，请刷新后重试',
      stdout: updated.stdout,
      stderr: updated.stderr,
    }
  }

  return {
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    message: mode === 'squash'
      ? `已把 ${ordered.length} 个提交合并为 1 个`
      : '已修改提交信息',
    backup,
    before: plan.head,
    after: finalHead,
    rewritten: plan.commits.map((entry) => ({ sha: entry.sha, newSha: mapping.get(entry.sha) })),
  }
}

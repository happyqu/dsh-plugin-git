import { workbenchUpstream } from './model.js'

function workbenchBranchItems(branch, api) {
  var remote = branch.ref.startsWith('refs/remotes/'), current = !remote && branch.name === api.current
  var commands = {
    checkout: 'checkout', createBranch: 'branch / checkout', createTag: 'tag', merge: 'merge', rebase: 'rebase',
    renameBranch: 'branch', push: 'push', pull: current ? 'pull --ff-only' : 'fetch <src>:<dst>', setUpstream: 'branch', deleteBranch: remote ? 'push' : 'branch', fetch: 'fetch', addWorktree: 'worktree add',
  }
  var op = function (action, disabled) { return { id: action, label: api.t(action === 'pull' && !current ? 'wb.pullLocalFastForward' : action === 'fetch' && !remote ? 'wb.fetchLocal' : 'wb.' + action), command: commands[action],
    hint: action === 'addWorktree' && disabled ? api.t('wb.worktreeUnsupported') : (action === 'pull' || action === 'fetch') && disabled ? api.t(action === 'pull' && branch.occupied ? 'wb.occupied' : 'wb.pullNeedsUpstream') : action === 'pull' && !current ? api.t('wb.pullLocalHint') : action === 'fetch' && !remote ? api.t('wb.fetchLocalHint') : undefined, disabled: api.busy || disabled,
    run: function () { api.workflow(action, branch) } } }
  return [
    ...(branch.occupied && api.openWorktree ? [{ id: 'openWorktree', label: api.t('wt.openOccupied'), disabled: api.busy,
      run: function () { api.openWorktree(branch.occupied) } }] : []),
    { id: 'history', label: api.t('wb.history'), command: 'log', run: function () { api.history(branch) } },
    { id: 'incoming', label: api.t('wb.incoming'), command: 'log', run: function () { api.history(branch, true) } },
    { id: 'outgoing', label: api.t('wb.outgoing'), command: 'log', run: function () { api.history(branch, 'outgoing') } },
    { id: 'compare', label: api.t('wb.compare'), command: 'diff', run: function () { api.compare(branch) } },
    { separator: true }, op('checkout', current || branch.occupied), op('createBranch'), op('createTag'), op('merge', current),
    op('rebase', current), op('addWorktree'),
    { separator: true },
  ].concat(remote ? [{ id: 'fetch', label: api.t('wb.fetchBranch'), command: 'fetch', disabled: api.busy, run: function () { api.workflow('fetch', branch) } },
    { id: 'fetchPrune', label: api.t('wb.fetchPrune'), command: 'fetch', hint: api.t('wb.fetchPruneHint'), disabled: api.busy, run: function () { api.workflow('fetch', branch, { prune: true }) } }]
    : [op('renameBranch', branch.occupied && !current), op('push'), op('pull', !!branch.occupied || !(branch.upstreamRef || branch.upstream)),
      op('fetch', !/^refs\/remotes\//.test(workbenchUpstream(branch))), op('setUpstream')]).concat([
    { id: 'favorite', label: api.t('wb.favorite'), run: api.favorite },
    { id: 'copy', label: api.t('wb.copy'), run: function () { api.copy(branch.name) } },
    { separator: true }, op('deleteBranch', current || branch.occupied),
  ])
}


function workbenchCommitItems(sha, api) {
  var latest = sha === api.head
  var commands = { createBranch: 'branch / checkout', createTag: 'tag', cherryPick: 'cherry-pick', revert: 'revert', undoCommit: 'reset', commit: 'commit', resetTo: 'reset',
    reword: 'commit --amend', squash: 'rebase -i', addWorktree: 'worktree add' }
  var op = function (action, disabled, hint) { return { id: action, label: api.t('wb.' + action), command: commands[action], disabled: api.busy || disabled, hint: hint,
    run: function () { api.workflow(action, { sha: sha }) } } }
  // Rewriting is offered only on commits that have not been pushed. The item
  // is omitted entirely rather than shown disabled: a greyed-out "edit
  // message" on a published commit invites the question "why not", and the
  // answer (it would rewrite other people's history) belongs in the docs, not
  // in a menu that is mostly about other things.
  //
  // Only REWORD lives here. Combining is a range operation, and its home is
  // the tick column in the list — offering "combine this and everything
  // above" from a per-commit menu as well gave two mechanisms for one job,
  // which is what made the earlier design hard to follow.
  var rewrite = api.rewrite
  var rewriteItems = []
  if (rewrite && rewrite.canReword) {
    rewriteItems = [{ separator: true },
      { id: 'reword', label: api.t('rewrite.rewordTitle'), command: commands.reword, disabled: api.busy,
        hint: api.t('rewrite.rewordHint'), run: function () { rewrite.run('reword', { sha: sha }) } }]
  }
  return [{ id: 'copy', label: api.t('wb.copy'), run: function () { api.copy(sha) } },
    { id: 'compare', label: api.t('wb.compare'), command: 'diff', run: api.compare }, { separator: true },
    op('createBranch'), op('createTag'), op('addWorktree'), op('cherryPick', api.detached || api.commit?.parents.length > 1, api.t('wb.parent')), op('revert', api.detached), { separator: true },
    op('undoCommit', !latest || api.detached || (api.commit && !api.commit.parents.length), api.t('wb.rootUndo')),
    op('commit', !latest || api.detached), op('resetTo', api.detached)].concat(rewriteItems)
}

export { workbenchBranchItems, workbenchCommitItems }

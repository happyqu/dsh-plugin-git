/**
 * dsh-plugin-git — the interactive rebase editor's model.
 *
 * The dialog itself is a thin renderer over this module, and that split is
 * deliberate: the rules below are the part that decides what happens to someone's
 * history, so they are pure functions that can be asserted without a DOM. The
 * renderer only turns their answers into rows and buttons.
 *
 * Three rules shape everything here:
 *
 * 1. **The list IS the plan.** Rows are shown in their new order, top to bottom, and
 *    the array this module returns is exactly what the Host will execute. There is no
 *    separate mode to enter and no todo syntax to learn.
 * 2. **A refusal is explained by the rule that refused.** A leading fold, an
 *    all-dropped plan and a merge in the range are three different mistakes with
 *    three different fixes, so each produces its own reason instead of one generic
 *    "invalid plan".
 * 3. **Nothing is silently dropped from the plan.** Every commit in the range must
 *    appear as a row; the Host refuses a plan that omits one, and this module never
 *    constructs such a plan in the first place.
 */

/** The actions one row may carry, in the order the chips are shown. */
var ROW_ACTIONS = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop']

/**
 * A fresh plan for a range: every commit picked, in its existing order.
 *
 * Opening the editor must not, by itself, change anything — so `pick` is the initial
 * state for every row rather than an empty one that the user has to fill in.
 *
 * @param commits - the range, oldest first, each `{ sha, shortSha, subject }`.
 * @returns `[{ sha, shortSha, subject, action, message }]`.
 */
function initialPlan(commits) {
  return (commits || []).map(function (commit) {
    return {
      sha: commit.sha,
      shortSha: commit.shortSha || String(commit.sha).slice(0, 8),
      subject: commit.subject || '',
      action: 'pick',
      // Empty means "keep the original message". A non-empty value is what the Host
      // applies through `exec git commit --amend`, so an untouched row sends nothing.
      message: '',
    }
  })
}

/**
 * Move one row, without mutating the list.
 *
 * @param plan - the rows.
 * @param index - the row to move.
 * @param delta - -1 for up, +1 for down.
 * @returns a new list; the same list when the move is not possible.
 */
function movedRow(plan, index, delta) {
  var target = index + delta
  if (index < 0 || target < 0 || target >= plan.length) return plan
  var next = plan.slice()
  var row = next.splice(index, 1)[0]
  next.splice(target, 0, row)
  return next
}

/**
 * Set one row's action.
 *
 * `squash`/`fixup` on the first row is not representable — there is nothing to fold
 * into — so the attempt is ignored rather than stored and refused later. A row that
 * carries an action the todo cannot express is worse than a click that does nothing.
 *
 * @param plan - the rows.
 * @param index - the row.
 * @param action - one of {@link ROW_ACTIONS}.
 * @returns a new list.
 */
function setRowAction(plan, index, action) {
  if (ROW_ACTIONS.indexOf(action) === -1) return plan
  if ((action === 'squash' || action === 'fixup') && !plan.slice(0, index).some(function (row) { return row.action !== 'drop' })) return plan
  return plan.map(function (row, position) {
    return position === index ? Object.assign({}, row, { action: action,
      message: ['reword', 'squash', 'fixup'].includes(action) ? row.message : '',
    }) : row
  })
}

/**
 * Put every row back to `pick`.
 *
 * This is the editor's Reset. It exists because a plan assembled over several
 * gestures is hard to unwind row by row, and "start again" is the honest escape.
 *
 * @param plan - the rows.
 * @returns a new list with the current ORDER kept and every action reset.
 */
function resetPlan(plan) {
  return (plan || []).map(function (row) { return Object.assign({}, row, { action: 'pick', message: '' }) })
}

/**
 * Count the actions in a plan.
 *
 * Derived on every call rather than kept in state: a counter that can drift from the
 * rows is worse than no counter.
 *
 * @param plan - the rows.
 * @returns `{ pick, reword, edit, squash, fixup, drop, kept }`.
 */
function planCounts(plan) {
  var counts = { pick: 0, reword: 0, edit: 0, squash: 0, fixup: 0, drop: 0, kept: 0 }
  for (var i = 0; i < (plan || []).length; i++) {
    var action = plan[i].action
    if (counts[action] === undefined) continue
    counts[action] += 1
  }
  // "kept" is what the branch will carry: every row except the dropped ones. Folded
  // rows disappear into their target, so they do not add to the total either.
  counts.kept = counts.pick + counts.reword + counts.edit
  return counts
}

/**
 * Whether a plan can be executed, and why not when it cannot.
 *
 * Mirrors the Host's own refusals so the button is disabled for the SAME reasons the
 * write would reject — not for different ones. A dialog that offers something the
 * server then refuses is the most irritating possible outcome: the user did
 * everything asked and is still told no.
 *
 * @param plan - the rows.
 * @param options - `{ allowPublished, published }`.
 * @returns `{ ok, reason, detail }`; `reason` is `null` when the plan is runnable.
 */
function planProblem(plan, options) {
  var rows = plan || []
  var opts = options || {}
  if (rows.length === 0) return { ok: false, reason: 'empty', detail: '' }
  var first = rows.find(function (row) { return row.action !== 'drop' })
  if (first?.action === 'squash' || first?.action === 'fixup') {
    return { ok: false, reason: 'leadingFold', detail: first.shortSha }
  }
  var counts = planCounts(rows)
  if (counts.drop === rows.length) return { ok: false, reason: 'allDropped', detail: '' }
  // The plan is a rewrite of this branch's own commits, so a published one is refused
  // until the user says, explicitly, that nobody else has it. The count is returned so
  // the dialog can state how many rather than just refusing.
  var published = Number(opts.published) || 0
  if (published > 0 && opts.allowPublished !== true) {
    return { ok: false, reason: 'published', detail: String(published) }
  }
  return { ok: true, reason: null, detail: '' }
}

/**
 * The request body for `rebasePreview` / `write.applyPlan`.
 *
 * Only the rows and their actions travel; messages are folded into a map keyed by sha
 * because that is what the Host's `exec` lines look up. A row the user did not edit
 * contributes no entry at all, which is what makes "leave the message alone" the
 * default rather than a special case.
 *
 * @param base - the commit the range is replayed onto.
 * @param plan - the rows.
 * @returns `{ base, commits, messages }`.
 */
function planRequest(base, plan) {
  var messages = {}
  var commits = (plan || []).map(function (row) {
    if (['reword', 'squash', 'fixup'].includes(row.action) && typeof row.message === 'string' && row.message.trim() !== '') messages[row.sha] = row.message
    return { sha: row.sha, action: row.action }
  })
  return { base: base, commits: commits, messages: messages }
}

/**
 * The commits a preview says will be dropped because they become empty.
 *
 * A row marked `drop` is the user's own decision and needs no explanation; a commit
 * that VANISHES on its own does, because "I asked for 3 and got 1" reads as a bug.
 * Keeping the two apart is why this is separate from `planCounts`.
 *
 * @param dropped - the Host's `dropped` array.
 * @param plan - the rows that were sent.
 * @returns the entries the user did not drop themselves.
 */
function unexpectedDrops(dropped, plan) {
  var requested = {}
  for (var i = 0; i < (plan || []).length; i++) requested[plan[i].sha] = plan[i].action
  return (dropped || []).filter(function (entry) { return requested[entry.sha] !== 'drop' })
}

export {
  ROW_ACTIONS,
  initialPlan,
  movedRow,
  setRowAction,
  resetPlan,
  planCounts,
  planProblem,
  planRequest,
  unexpectedDrops,
}



/**
 * Turn a raw write outcome into something worth showing a human.
 *
 * The Host hands back git's own words, which are written for a terminal:
 * they lead with the URL, repeat "error: failed to push some refs", and bury
 * the one actionable sentence at the end. Dumping that into a 220px chip was
 * unreadable AND unhelpful — the reader had to parse git's prose to find out
 * what to do.
 *
 * This maps the few failures whose FIX is knowable to a plain-language line
 * plus, where the plugin can do it, the action that resolves it. Anything it
 * does not recognise falls through to the raw text, so an unknown failure is
 * still reported rather than swallowed.
 *
 * @param text - the raw message (stderr, or a thrown error's message).
 * @param method - the write method that failed.
 * @param t - the translator.
 * @returns `{ text, hint, action }`; `action` is `{ id, label }` or null.
 */
function explainFailure(text, method, t) {
  var raw = String(text === undefined || text === null ? '' : text)
  var lower = raw.toLowerCase()

  // The remote has commits we do not: the only correct fix is to integrate
  // them first. Offering "Pull" turns a dead end into one click.
  if (lower.indexOf('non-fast-forward') !== -1 || lower.indexOf('fetch first') !== -1 ||
      lower.indexOf('updates were rejected') !== -1) {
    return {
      text: raw,
      hint: t('failure.nonFastForward'),
      action: { id: 'pull', label: t('failure.actionPull') },
    }
  }
  // No upstream configured: publishing is the fix.
  if (lower.indexOf('has no upstream branch') !== -1 || lower.indexOf('no upstream') !== -1) {
    return {
      text: raw,
      hint: t('failure.noUpstream'),
      action: { id: 'publish', label: t('failure.actionPublish') },
    }
  }
  // Authentication and connectivity are the user's to fix; say which it is
  // instead of showing a wall of hints.
  if (lower.indexOf('authentication failed') !== -1 || lower.indexOf('permission denied') !== -1 ||
      lower.indexOf('could not read username') !== -1 || lower.indexOf('invalid username or password') !== -1) {
    return { text: raw, hint: t('failure.auth'), action: { id: 'auth', label: t('auth.help') } }
  }
  if (lower.indexOf('could not resolve host') !== -1 || lower.indexOf('unable to access') !== -1 ||
      lower.indexOf('connection timed out') !== -1 || lower.indexOf('network is unreachable') !== -1) {
    return { text: raw, hint: t('failure.network'), action: null }
  }
  if (lower.indexOf('diverged') !== -1 || lower.indexOf('not possible to fast-forward') !== -1) {
    return {
      text: raw,
      hint: t('failure.diverged'),
      action: { id: 'reconcile', label: t('failure.actionReconcile') },
    }
  }
  // A conflict is a state, not a failure: the merge went in and now needs
  // resolving, so point at the files rather than repeating git's advice.
  if (lower.indexOf('conflict') !== -1 || lower.indexOf('merge conflict') !== -1) {
    return { text: raw, hint: t('failure.conflict'), action: null }
  }
  if (/nothing to commit|nothing added to commit|no changes added to commit/.test(lower)) {
    return { text: raw, hint: t('failure.nothingToCommit'), action: null }
  }
  if (lower.indexOf('pathspec') !== -1 && lower.indexOf('did not match') !== -1) {
    return { text: raw, hint: t('failure.noMatch'), action: null }
  }
  if (lower.indexOf('would be overwritten') !== -1 || lower.indexOf('local changes') !== -1) {
    return { text: raw, hint: t('failure.localChanges'), action: null }
  }
  return { text: raw, hint: null, action: null }
}


/**
 * Condense a multi-line git message into one readable line.
 *
 * Git's first line is usually the URL or a repeated `error:` prefix, while
 * the LAST line is the one that says what went wrong. `hint:` lines are
 * dropped entirely — they are advice for a terminal, and the banner either
 * supplies better advice or shows the raw text in full on demand.
 *
 * @param text - the raw message.
 * @returns a single line, at most ~160 characters.
 */
function firstMeaningfulLine(text) {
  var lines = String(text === undefined || text === null ? '' : text)
    .split(/\r?\n/)
    .map(function (line) { return line.trim() })
    .filter(function (line) { return line !== '' && line.indexOf('hint:') !== 0 })
  if (lines.length === 0) return ''
  // Prefer the last line that reads as a sentence about the failure; fall
  // back to the first non-empty line.
  var best = lines[lines.length - 1]
  for (var i = lines.length - 1; i >= 0; i--) {
    if (/^(error|fatal|remote|!|\s*!)/i.test(lines[i]) || lines[i].length > 24) { best = lines[i]; break }
  }
  return best.length > 160 ? best.slice(0, 157) + '…' : best
}

export { explainFailure, firstMeaningfulLine }

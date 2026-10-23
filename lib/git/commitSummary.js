/**
 * dsh-plugin-git — the short, human-readable outcome of a commit.
 *
 * `git commit` prints the new commit and its change totals, then ONE line per
 * file it created, deleted, renamed or re-moded:
 *
 *   [main abc1234] add generated fixtures
 *    3000 files changed, 3000 insertions(+)
 *    create mode 100644 fixtures/a.json
 *    create mode 100644 fixtures/b.json
 *    ...
 *
 * That last part grows without bound — a commit of a few thousand files prints
 * a few thousand lines — and the write result used to forward it verbatim as
 * `message`. The UI renders a write result in a toast, so the toast grew taller
 * than the window. The per-file lines are redundant next to the totals
 * ("3000 files changed" already says how many), so they are dropped from the
 * message. The untouched output still travels separately as `stdout`, which is
 * where diagnostics and logs read it.
 */

// One line per file. `rename` covers both `rename a => b (100%)` and the
// grouped `rename dir/{a => b}/f (100%)` form; `mode change` covers chmod-only
// entries. Git always starts these with the verb and a space.
const PER_FILE_LINE = /^(create mode|delete mode|mode change|rename|copy)\s/

// A toast, not a log view: four lines of context is already generous, and a
// hook that prints more than that is not something a transient banner can
// usefully show anyway.
const KEEP_LINES = 4

/**
 * Condense `git commit`'s stdout into text a toast can show.
 *
 * @param stdout - the raw stdout of the commit.
 * @param fallback - what to say when stdout is empty (e.g. git's stderr).
 * @returns the commit header and change totals, with any held-back output
 *   (beyond the per-file lines) reported as a count.
 */
export function summarizeCommitOutput(stdout, fallback = '提交完成') {
  const lines = String(stdout ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
  if (lines.length === 0) return fallback
  const kept = []
  let omitted = 0
  for (const line of lines) {
    // The totals line above already counts these files.
    if (PER_FILE_LINE.test(line)) continue
    if (kept.length >= KEEP_LINES) { omitted++; continue }
    kept.push(line)
  }
  // Nothing but per-file lines (not something git does, but a hook could): the
  // fallback still beats a banner with no text at all.
  if (kept.length === 0) return fallback
  return omitted === 0 ? kept.join('\n') : kept.join('\n') + '\n…（另有 ' + omitted + ' 行未显示）'
}

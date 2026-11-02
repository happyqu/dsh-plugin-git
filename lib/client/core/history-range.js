/**
 * Turn a history time-range PRESET into the bounds `git log` understands.
 *
 * Kept free of React so it can be unit-tested directly and imported by the
 * shell without dragging the whole filter UI (and therefore the client
 * runtime) into a module that only needs arithmetic.
 *
 * The lower bound is computed against `now` AT QUERY TIME rather than stored,
 * so "last 7 days" keeps its meaning after the panel has been open for a
 * while, and a remembered preference never rots into a fixed window.
 *
 * An empty preset means "all time" and yields null, so the caller omits the
 * flag entirely instead of sending something like an epoch timestamp.
 *
 * @param range - preset id: '', '7d', '30d', '90d' or 'year'.
 * @param now - the reference instant.
 * @returns `{ since }` as a git-acceptable ISO string, or null for all time.
 */
function historyRangeWindow(range, now = new Date()) {
  if (typeof range !== 'string' || range === '') return null
  var DAY = 86400000
  var days = { '7d': 7, '30d': 30, '90d': 90 }[range]
  if (days !== undefined) return { since: new Date(now.getTime() - days * DAY).toISOString() }
  if (range === 'year') {
    // Built in LOCAL time on purpose: `new Date(now.getFullYear(), 0, 1)` is
    // the user's local January 1, while a UTC-midnight January 1 would be
    // January 1 for some users and December 31 for others.
    return { since: new Date(now.getFullYear(), 0, 1).toISOString() }
  }
  return null
}

export { historyRangeWindow }

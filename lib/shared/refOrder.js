/** Annotated tags use tagger time; lightweight tags use their commit time. */
export function compareTagsByCreated(a, b) {
  const time = tag => Number(tag.creatorDate ?? tag.committerDate) || 0
  return time(b) - time(a) || String(b.name || b.ref || '').localeCompare(String(a.name || a.ref || ''), 'en', { numeric: true })
}

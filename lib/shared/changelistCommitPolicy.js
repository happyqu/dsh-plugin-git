/** Pure commit policy shared by the browser and Host. Missing flags allow commits. */
export function blockedChangelistIds(state) {
  return new Set((state?.lists || []).filter(list => list.commitBlocked === true).map(list => list.id))
}

export function allowedChangelistCommitPaths(state, paths = state?.selected || []) {
  const blocked = blockedChangelistIds(state)
  if (!blocked.size) return paths
  return paths.filter(path => {
    const record = state.chunks?.[path]
    return record ? !record.invalid && record.parts.some(part => part.selected && !blocked.has(part.list || state.assignments[path]))
      : !blocked.has(state.assignments[path])
  })
}

/** Return a new state only where a blocked selection needs to be removed. */
export function applyChangelistCommitBlocks(state) {
  const blocked = blockedChangelistIds(state)
  if (!blocked.size) return state
  let chunks = state.chunks
  for (const [path, record] of Object.entries(state.chunks || {})) {
    if (!record.parts.some(part => part.selected && blocked.has(part.list || state.assignments[path]))) continue
    if (chunks === state.chunks) chunks = { ...chunks }
    chunks[path] = { ...record, parts: record.parts.map(part => blocked.has(part.list || state.assignments[path]) ? { ...part, selected: false } : part) }
  }
  const next = { ...state, chunks }
  next.selected = allowedChangelistCommitPaths(next)
  return next
}

/** Full-file commits check every part; scoped commits check the selected parts. */
export function blockedChangelistCommitPaths(state, paths, selectedOnly = false) {
  const blocked = blockedChangelistIds(state)
  return paths.filter(path => {
    const record = state?.chunks?.[path]
    return record ? record.parts.some(part => (!selectedOnly || part.selected) && blocked.has(part.list || state.assignments[path]))
      : blocked.has(state?.assignments?.[path])
  })
}

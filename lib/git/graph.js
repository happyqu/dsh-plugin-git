/**
 * dsh-plugin-git — commit graph (lane layout).
 *
 * GitLens does not use `git log --graph`: its ASCII art is not a rendering
 * primitive, and it carries no stable identity for interaction. It reads parent
 * pointers (`%P`) and computes the lane layout itself. This module does the
 * same, for the same reason — we need each row to be clickable and each edge to
 * be a real object.
 *
 * The layout is a single pass over the commits in git's own order (newest
 * first). Active lanes are kept as an array of "the sha this lane is waiting
 * for"; a commit takes the leftmost lane waiting for it, and its parents either
 * continue that lane or open new ones.
 */
import { git } from './exec.js'
import { normalizeTips } from './repo.js'

/** Field spec used to read enough of each commit to build the graph. */
const GRAPH_FIELDS = {
  sha: '%H',
  shortSha: '%h',
  parents: '%P',
  author: '%aN',
  authorEmail: '%aE',
  authorDate: '%at',
  committerDate: '%ct',
  subject: '%s',
  tips: '%D',
}

/** Separators, matching the log protocol used elsewhere in this plugin. */
const RECORD = '\x1e'
const FIELD = '\x1d'

/**
 * Read the commit graph.
 *
 * @param repo - the repository session.
 * @param request - `{ limit, refs, path, ordering, all }`.
 * @param options - cancellation.
 * @returns rows (each a commit with lane data) plus the lane count.
 */
export async function commitGraph(repo, request = {}, options = {}) {
  const limit = Number.isInteger(request.limit) ? Math.min(Math.max(request.limit, 1), 2000) : 200
  const format = RECORD + Object.values(GRAPH_FIELDS).join(FIELD) + FIELD
  const args = ['log', `--format=${format}`, `-n${limit + 1}`, request.ordering === 'topo' ? '--topo-order' : '--date-order']
  if (Array.isArray(request.refs) && request.refs.length) {
    for (const ref of request.refs) {
      if (typeof ref !== 'string' || ref.startsWith('-') || /[\0\r\n]/.test(ref)) throw new Error('无效的分支引用')
      args.push(ref)
    }
  } else if (request.all !== false) {
    args.push('--branches', '--tags')
    if (request.showRemote !== false) args.push('--remotes')
    if ((await repo.run(['rev-parse', '--verify', 'HEAD'], { signal: options.signal })).code === 0) args.push('HEAD')
  } else args.push('HEAD')
  if (typeof request.path === 'string' && request.path !== '') args.push('--', request.path)

  const result = await git({
    gitPath: repo.gitPath,
    cwd: repo.root,
    args: ['--no-optional-locks', ...args],
    timeoutMs: options.timeoutMs ?? 60_000,
    signal: options.signal,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.code !== 0 && result.stdout.trim() === '') {
    const head = await repo.run(['rev-parse', '--verify', 'HEAD'], { signal: options.signal })
    if (head.code !== 0 && !(await repo.refs({ signal: options.signal })).branches.length && !(await repo.refs({ signal: options.signal })).remotes.length) return { rows: [], laneCount: 0, hasMore: false }
    throw new Error(result.stderr.trim() || `git log 退出码 ${result.code}`)
  }

  const commits = parseGraphRecords(result.stdout)
  return { ...layoutGraph(commits.slice(0, limit)), hasMore: commits.length > limit, limit, maximum: 2000 }
}

/**
 * Parse graph records out of a `--format` stream.
 * @param text - raw stdout.
 * @returns commit records, in emission order.
 */
export function parseGraphRecords(text) {
  const out = []
  for (const chunk of String(text ?? '').split(RECORD)) {
    if (chunk.trim() === '') continue
    const fields = chunk.split(FIELD)
    const sha = fields[0] ?? ''
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) continue
    out.push({
      sha,
      shortSha: fields[1] ?? sha.slice(0, 7),
      parents: (fields[2] ?? '') === '' ? [] : (fields[2] ?? '').split(' '),
      author: fields[3] ?? '',
      authorEmail: fields[4] ?? '',
      authorDate: fields[5] === '' ? null : Number(fields[5]),
      committerDate: fields[6] === '' ? null : Number(fields[6]),
      subject: fields[7] ?? '',
      tips: normalizeTips(fields[8] ?? ''),
    })
  }
  return out
}

/**
 * Assign lanes to commits.
 *
 * @param commits - newest-first commit records with `parents`.
 * @returns `{ rows, laneCount }`, where each row lists the segments crossing it.
 */
export function layoutGraph(commits) {
  /** Lane slots: each holds the sha the lane is currently expecting, or null. */
  const lanes = []
  const rows = []
  let maxLane = 0

  const findLane = (sha) => lanes.indexOf(sha)
  const freeLane = (index) => {
    lanes[index] = null
  }
  const takeLane = (preferred) => {
    if (preferred !== -1) return preferred
    const empty = lanes.indexOf(null)
    if (empty !== -1) return empty
    lanes.push(null)
    return lanes.length - 1
  }

  for (const commit of commits) {
    // Snapshot the incoming edges BEFORE mutating, so the renderer can draw the
    // lines that pass through this row without reconstructing history.
    const before = lanes.slice()

    let lane = findLane(commit.sha)
    if (lane === -1) {
      // A tip: no lane was waiting for it, so open a fresh one.
      lane = takeLane(-1)
    } else {
      freeLane(lane)
    }

    for (let i = 0; i < commit.parents.length; i++) {
      const parent = commit.parents[i]
      if (parent === undefined || parent === '') continue
      const existing = findLane(parent)
      if (existing !== -1) {
        // A lane already waits for this parent (the merge case); nothing to do
        // but record the join for the renderer.
        continue
      }
      if (i === 0) {
        lanes[lane] = parent
      } else {
        const extra = takeLane(-1)
        lanes[extra] = parent
      }
    }

    // Collapse trailing empties so lane indices stay dense from the left.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    const after = lanes.slice()
    const width = Math.max(before.length, after.length, lane + 1)
    maxLane = Math.max(maxLane, width)

    rows.push({
      ...commit,
      lane,
      laneCount: width,
      // `through` are lanes that existed before and after without being this
      // commit's own lane: the renderer draws them as full-height verticals.
      through: collectThrough(before, after, lane),
      // Edges from this row down to its parents' lanes.
      edges: commit.parents
        .map((parent, index) => {
          const target = after.indexOf(parent)
          return target === -1 ? null : { from: lane, to: target, parent, index }
        })
        .filter((edge) => edge !== null),
    })
  }

  return { rows, laneCount: maxLane }
}

/** Lanes occupied both before and after a row, excluding the row's own lane. */
function collectThrough(before, after, ownLane) {
  const out = []
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (i === ownLane) continue
    if (before[i] != null && after[i] != null) out.push(i)
  }
  return out
}

/**
 * Pick lane colors deterministically from a palette length.
 *
 * Deterministic rather than random so a commit keeps its color across renders,
 * reloads, and windows — a graph that repaints in different colors is unusable
 * for tracking a branch by eye.
 *
 * @param lane - the lane index.
 * @param paletteSize - how many colors the theme provides.
 * @returns a palette index.
 */
export function laneColorIndex(lane, paletteSize) {
  if (paletteSize <= 0) return 0
  return ((lane % paletteSize) + paletteSize) % paletteSize
}

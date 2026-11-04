/**
 * dsh-plugin-git — a small LRU cache with optional TTLs.
 *
 * The TTL values this plugin actually uses mirror GitLens, read out of its
 * bundle:
 *
 *     get blame()   { return this._caches.blame   ??= new I0({ createTTL: 6e5, capacity: 50  }) }
 *     get diff()    { return this._caches.diff    ??= new I0({ createTTL: 6e5, capacity: 50  }) }
 *     get fileLog() { return this._caches.fileLog ??= new I0({ createTTL: 6e5, capacity: 500 }) }
 *
 * (`6e5` = 10 minutes.) The reasoning behind caching blame for a bounded time
 * rather than until invalidation: the working tree can change for reasons we
 * never observe — another editor, a script, `git checkout` in a terminal — so a
 * TTL is the only invalidation source that cannot be missed.
 *
 * Invalidation is ALSO event-driven where we can see the cause (see
 * `invalidate`), because a 10-minute stale blame after your own commit is
 * indefensible even though it is technically allowed.
 */

/**
 * The error a per-caller cancellation rejects with, matching what `exec.js`
 * already produces for an aborted read so callers need no second shape.
 *
 * @returns an AbortError-shaped Error.
 */
function abortError() {
  const error = new Error('操作已取消')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

/** Sentinel results for "did the read settle, or did this caller leave?" */
const SETTLED = 'settled'
const ABANDONED = 'abandoned'

/**
 * A bounded map with per-entry TTL and LRU eviction.
 *
 * Reads are non-mutating with respect to the entry's value but do refresh
 * recency, which is what makes `capacity` behave like an LRU rather than a FIFO.
 */
export class LruTtlCache {
  /**
   * @param options - cache policy.
   * @param options.capacity - maximum live entries.
   * @param options.ttlMs - entry lifetime in milliseconds; null means forever.
   */
  constructor(options = {}) {
    this.capacity = Number.isInteger(options.capacity) ? options.capacity : 100
    this.ttlMs = typeof options.ttlMs === 'number' ? options.ttlMs : null
    /** @type {Map<string, { value: unknown, at: number }>} */
    this.entries = new Map()
    this.pending = new Map()
    this.producers = new Map()
    this.generation = 0
    this.hits = 0
    this.misses = 0
  }

  /**
   * Read a live entry, or undefined when absent or expired.
   * @param key - cache key.
   * @returns the cached value, or undefined.
   */
  get(key) {
    const entry = this.entries.get(key)
    if (entry === undefined) {
      this.misses++
      return undefined
    }
    if (this.ttlMs !== null && Date.now() - entry.at > this.ttlMs) {
      this.entries.delete(key)
      this.misses++
      return undefined
    }
    // Re-insert so the key becomes the most recently used.
    this.entries.delete(key)
    this.entries.set(key, entry)
    this.hits++
    return entry.value
  }

  /**
   * Store a value, evicting the least recently used entries past capacity.
   * @param key - cache key.
   * @param value - value to store.
   */
  set(key, value) {
    this.entries.delete(key)
    this.entries.set(key, { value, at: Date.now() })
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) break
      this.entries.delete(oldest.value)
    }
  }

  /**
   * Get through a producer, storing the result.
   *
   * Concurrent callers for one key share ONE production. That used to be skipped
   * whenever the caller supplied a `signal`, on the reasoning that a cancellable
   * read cannot be shared — and since every RPC carries the HTTP request's
   * signal, the dedupe was effectively dead in production. Two panes refreshing
   * at once ran two `git status` processes over the same tree.
   *
   * Sharing is safe when cancellation is per-CONSUMER rather than per-read: the
   * read belongs to the cache, and each caller gets its own view that rejects
   * with `AbortError` when that caller's signal fires. The read is not torn down
   * because one subscriber left — another may still be waiting for it.
   *
   * The cache is only populated while at least one consumer is still waiting, so
   * a read that everyone abandoned cannot leave a value nobody could have seen.
   *
   * @param key - cache key.
   * @param produce - called only on a miss. It runs WITHOUT the caller's signal,
   *   because the read outlives any single consumer.
   * @param options - `{ force, signal }`.
   * @returns the cached or freshly produced value.
   */
  async through(key, produce, options = {}) {
    const hit = options.force === true ? undefined : this.get(key)
    if (hit !== undefined) return hit
    // An already-cancelled caller must not start work nobody asked for.
    if (options.signal?.aborted) throw abortError()
    const shared = this.pending.get(key)
    // `force` means "do not answer from a STORED value", not "run twice
    // concurrently". Two panes that both ask for a fresh status want one fresh
    // status, so a forced caller joins an in-flight read like any other. Keeping
    // `force` in this condition was why the client's own refresh path — which
    // always forces — never deduped.
    if (shared !== undefined && this.producers.get(key) === shared) {
      return this.follow(shared, options.signal)
    }
    const generation = this.generation
    const task = Promise.resolve().then(produce)
    this.producers.set(key, task)
    this.pending.set(key, task)
    // Storage belongs to the READ, not to any one caller. Hanging it off the
    // producing caller's await meant that caller walking away threw the result
    // away even though other consumers were still waiting for it — the value was
    // delivered to them and then never cached.
    task.then(
      (value) => {
        // Invalidation during production must not repopulate stale data, and a
        // newer read for the same key must not be overwritten by an older one.
        if (value !== undefined && generation === this.generation && this.producers.get(key) === task) this.set(key, value)
      },
      () => {},
    ).finally(() => {
      if (this.pending.get(key) === task) this.pending.delete(key)
      if (this.producers.get(key) === task) this.producers.delete(key)
    })
    return this.follow(task, options.signal)
  }

  /**
   * Await a shared read, abandoning only this caller when its signal fires.
   *
   * The read itself is never torn down by a consumer leaving: another pane may
   * still be waiting, and the result is worth caching either way. What the
   * cancelled caller gets is an `AbortError`, matching what `exec.js` already
   * produces for an aborted read so callers need no second shape.
   *
   * @param task - the shared production.
   * @param signal - this caller's cancellation, if any.
   * @returns the produced value, or rejects with the abort reason.
   */
  async follow(task, signal) {
    if (signal === undefined) return task
    if (signal.aborted) throw abortError()
    let onAbort
    try {
      const outcome = await new Promise((resolve) => {
        onAbort = () => resolve(ABANDONED)
        signal.addEventListener('abort', onAbort, { once: true })
        // Settle either way; the shared outcome is re-read below.
        task.then(() => resolve(SETTLED), () => resolve(SETTLED))
      })
      if (outcome === ABANDONED) throw abortError()
      return await task
    } finally {
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
    }
  }

  /** Drop one key. */
  delete(key) {
    this.generation++
    this.pending.delete(key)
    this.producers.delete(key)
    this.entries.delete(key)
  }

  /**
   * Drop every key carrying a prefix.
   * @param prefix - the prefix to match.
   * @returns how many keys were dropped.
   */
  deleteByPrefix(prefix) {
    this.generation++
    let dropped = 0
    for (const key of this.pending.keys()) {
      if (key.startsWith(prefix)) this.pending.delete(key)
    }
    for (const key of this.producers.keys()) {
      if (key.startsWith(prefix)) this.producers.delete(key)
    }
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key)
        dropped++
      }
    }
    return dropped
  }

  /** Drop everything. */
  clear() {
    this.generation++
    this.pending.clear()
    this.producers.clear()
    this.entries.clear()
  }

  /** Live entry count, after dropping expired entries. */
  get size() {
    if (this.ttlMs !== null) {
      const now = Date.now()
      for (const [key, entry] of [...this.entries.entries()]) {
        if (now - entry.at > this.ttlMs) this.entries.delete(key)
      }
    }
    return this.entries.size
  }
}

/** The cache family this plugin keeps per repository. */
export class RepoCache {
  constructor() {
    // Blame is the most expensive call and the one most likely to be re-read,
    // so it gets its own small, hot cache.
    this.blame = new LruTtlCache({ capacity: 50, ttlMs: 600_000 })
    // Commit lists are small and highly shared between views.
    this.log = new LruTtlCache({ capacity: 200, ttlMs: 600_000 })
    // Ref enumerations and status are cheap; short TTL keeps the UI honest.
    this.refs = new LruTtlCache({ capacity: 50, ttlMs: 5_000 })
    this.status = new LruTtlCache({ capacity: 8, ttlMs: 2_000 })
    this.lfs = new LruTtlCache({ capacity: 12, ttlMs: 60_000 })
    this.lfsInfo = new LruTtlCache({ capacity: 2, ttlMs: 30_000 })
    // Capability probes never change for a running process.
    this.capability = new LruTtlCache({ capacity: 4, ttlMs: null })
  }

  /**
   * Drop cached data, optionally limited to one kind.
   * @param kinds - `'blame' | 'log' | 'refs' | 'status' | 'lfs'`;
   *   omitted means everything but the capability probe.
   */
  invalidate(...kinds) {
    const all = kinds.length === 0
    if (all || kinds.includes('blame')) this.blame.clear()
    if (all || kinds.includes('log')) this.log.clear()
    if (all || kinds.includes('refs')) this.refs.clear()
    if (all || kinds.includes('status')) this.status.clear()
    if (all || kinds.includes('lfs')) this.lfs.clear()
    if (all || kinds.includes('lfs')) this.lfsInfo.clear()
  }

  /** Cache counters, for the settings page's diagnostics block. */
  stats() {
    const view = (cache) => ({ size: cache.size, hits: cache.hits, misses: cache.misses })
    return {
      blame: view(this.blame),
      log: view(this.log),
      refs: view(this.refs),
      status: view(this.status),
    }
  }
}

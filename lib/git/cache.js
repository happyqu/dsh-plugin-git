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
   * @param key - cache key.
   * @param produce - called only on a miss.
   * @returns the cached or freshly produced value.
   */
  async through(key, produce, options = {}) {
    if (options.signal) {
      const hit = options.force === true ? undefined : this.get(key)
      if (hit !== undefined) return hit
      const generation = this.generation
      const value = await produce()
      if (value !== undefined && generation === this.generation) this.set(key, value)
      return value
    }
    const hit = options.force === true ? undefined : this.get(key)
    if (hit !== undefined) return hit
    if (this.pending.has(key)) return this.pending.get(key)
    const task = Promise.resolve().then(produce)
    this.pending.set(key, task)
    try {
      const value = await task
      // Invalidation during production must not repopulate stale data.
      if (value !== undefined && this.pending.get(key) === task) this.set(key, value)
      return value
    } finally {
      if (this.pending.get(key) === task) this.pending.delete(key)
    }
  }

  /** Drop one key. */
  delete(key) {
    this.generation++
    this.pending.delete(key)
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
    // Diffs are consumed by scrolling UIs; keep more of them.
    this.diff = new LruTtlCache({ capacity: 50, ttlMs: 600_000 })
    // File history lists are cheap to re-derive but numerous.
    this.fileLog = new LruTtlCache({ capacity: 500, ttlMs: 600_000 })
    // Commit lists are small and highly shared between views.
    this.log = new LruTtlCache({ capacity: 200, ttlMs: 600_000 })
    // Ref enumerations and status are cheap; short TTL keeps the UI honest.
    this.refs = new LruTtlCache({ capacity: 50, ttlMs: 5_000 })
    this.status = new LruTtlCache({ capacity: 8, ttlMs: 2_000 })
    this.lfs = new LruTtlCache({ capacity: 1, ttlMs: 60_000 })
    this.lfsInfo = new LruTtlCache({ capacity: 2, ttlMs: 30_000 })
    // Capability probes never change for a running process.
    this.capability = new LruTtlCache({ capacity: 4, ttlMs: null })
  }

  /**
   * Drop cached data, optionally limited to one kind.
   * @param kinds - `'blame' | 'diff' | 'fileLog' | 'log' | 'refs' | 'status'`;
   *   omitted means everything but the capability probe.
   */
  invalidate(...kinds) {
    const all = kinds.length === 0
    if (all || kinds.includes('blame')) this.blame.clear()
    if (all || kinds.includes('diff')) this.diff.clear()
    if (all || kinds.includes('fileLog')) this.fileLog.clear()
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
      diff: view(this.diff),
      fileLog: view(this.fileLog),
      log: view(this.log),
      refs: view(this.refs),
      status: view(this.status),
    }
  }
}

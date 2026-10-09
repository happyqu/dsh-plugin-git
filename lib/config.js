/**
 * dsh-plugin-git — durable plugin settings.
 *
 * Deliberately a plain JSON file rather than `ctx.storageDomain`: the values
 * here are a handful of scalars, the file must be readable/editable by hand when
 * the UI is the thing that is broken, and a git path is exactly the setting a
 * user needs to fix *before* any UI works. A service dependency would make the
 * plugin unable to start on the profile where it is most needed.
 *
 * Nothing secret is stored here — there are no credentials in this plugin. Git
 * authentication is left to git itself (credential helper, SSH agent), which is
 * both safer and the thing users already have configured.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Defaults, and the schema the settings page renders. */
export const DEFAULT_CONFIG = {
  /** Absolute path to the git executable; empty means "resolve from PATH". */
  gitPath: '',
  /** Repository used when no path is supplied by the caller. */
  defaultRepo: '',
  /** Rename-detection threshold, as a percentage. Matches git's own default. */
  similarityThreshold: 50,
  /** Whether a full-file blame is attempted automatically on file open. */
  autoBlame: true,
  /** Lines per blame request when blaming incrementally. */
  blameChunkLines: 2000,
  /** Cap on how many commits a file-history walk returns. */
  historyLimit: 300,
  /** Whether AI commit-message generation is offered in the UI. */
  aiEnabled: true,
  /** Pinned provider for AI calls; empty follows the current DSH session model. */
  aiProvider: '',
  /** Pinned model for AI calls; empty follows the current DSH session model. */
  aiModel: '',
  /** Locale override for the panel: '' follows the DSH locale. */
  locale: '',
}

/** Configuration keys with their expected type, used to reject junk patches. */
const SCHEMA = {
  gitPath: 'string',
  defaultRepo: 'string',
  similarityThreshold: 'number',
  autoBlame: 'boolean',
  blameChunkLines: 'number',
  historyLimit: 'number',
  aiEnabled: 'boolean',
  aiProvider: 'string',
  aiModel: 'string',
  locale: 'string',
}

/** Where the settings file lives. */
export function configPath() {
  const home = process.env.DSH_HOME
  const base = typeof home === 'string' && home !== '' ? home : join(homedir(), '.dsh')
  return join(base, 'git-plugin.json')
}

/**
 * A small, self-healing settings store.
 *
 * Reads are cached in memory and writes are atomic (temp file + rename), so a
 * crash mid-write cannot leave a truncated JSON file that bricks the plugin's
 * settings page.
 */
export class ConfigStore {
  /**
   * @param options - `{ path, logger }`.
   */
  constructor(options = {}) {
    this.path = options.path ?? configPath()
    this.logger = options.logger ?? null
    this.current = { ...DEFAULT_CONFIG }
    this.loaded = false
    /** The in-flight read, shared by concurrent {@link load} callers. */
    this.loading = null
    this.writeChain = Promise.resolve()
  }

  /**
   * Read the settings from disk once, tolerating a missing or corrupt file.
   *
   * Concurrent callers share ONE in-flight read. The first version set the
   * `loaded` flag BEFORE awaiting the read, so a second caller arriving during
   * that await saw `loaded === true` and got the untouched defaults back. That
   * is a classic async race. The cache must represent a completed read.
   *
   * @returns the loaded settings.
   */
  async load() {
    if (this.loaded) return this.current
    // Share one read between concurrent callers instead of racing.
    if (this.loading !== null) return this.loading
    this.loading = (async () => {
      try {
        const text = await readFile(this.path, 'utf8')
        const parsed = JSON.parse(text)
        this.current = sanitize({ ...DEFAULT_CONFIG, ...parsed })
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          // A corrupt file must not take the plugin down: keep defaults, tell the
          // log, and let the next write heal it.
          this.logger?.warn?.(`[git] settings unreadable (${error?.code || error?.name || 'invalid data'})`)
        }
        this.current = { ...DEFAULT_CONFIG }
      }
      // Only now is the result real, so only now is the store "loaded".
      this.loaded = true
      this.loading = null
      return this.current
    })()
    return this.loading
  }

  /** The in-memory settings; `load()` first if that has not happened. */
  get() {
    return this.current
  }

  /**
   * Merge a patch and persist it.
   * @param patch - partial settings.
   * @returns the resulting settings.
   */
  async update(patch) {
    await this.load()
    const clean = sanitize({ ...this.current, ...patch })
    this.current = clean
    this.writeChain = this.writeChain.then(() => this.write()).catch(() => {})
    await this.writeChain
    return clean
  }

  /** Persist the current settings atomically. */
  async write() {
    await mkdir(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(this.current, null, 2)}\n`, 'utf8')
    await rename(temp, this.path)
  }
}

/**
 * Coerce a candidate settings object into the schema.
 *
 * Out-of-range and wrong-typed values are replaced by the default rather than
 * rejected wholesale, so one bad key never discards the rest of the user's
 * settings.
 *
 * @param candidate - merged settings.
 * @returns a valid settings object.
 */
export function sanitize(candidate) {
  const out = { ...DEFAULT_CONFIG }
  for (const [key, type] of Object.entries(SCHEMA)) {
    const value = candidate?.[key]
    if (type === 'string') {
      out[key] = typeof value === 'string' ? value : DEFAULT_CONFIG[key]
    } else if (type === 'boolean') {
      out[key] = typeof value === 'boolean' ? value : DEFAULT_CONFIG[key]
    } else if (type === 'number') {
      out[key] = Number.isFinite(value) ? Number(value) : DEFAULT_CONFIG[key]
    }
  }
  if (out.similarityThreshold < 1) out.similarityThreshold = 1
  if (out.similarityThreshold > 100) out.similarityThreshold = 100
  if (out.blameChunkLines < 200) out.blameChunkLines = 200
  if (out.blameChunkLines > 20000) out.blameChunkLines = 20000
  if (out.historyLimit < 20) out.historyLimit = 20
  if (out.historyLimit > 5000) out.historyLimit = 5000
  return out
}

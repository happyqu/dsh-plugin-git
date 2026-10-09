/**
 * dsh-plugin-git — a bounded log of the git commands this plugin runs.
 *
 * Two reasons this exists rather than being a debug afterthought:
 *
 * 1. **Show Git Output.** Every git GUI grows one, because the moment a push is
 *    rejected or a merge conflicts the user needs to see what git actually said.
 *    A concise diagnosis needs the command and its error.
 * 2. **Diagnosis.** "Why is this slow / why did that fail" is answered by the
 *    argv and exit code, which no user-facing message carries.
 *
 * ## Credential redaction is mandatory, not a nicety
 *
 * A remote URL can embed a token (`https://user:ghp_xxx@host/repo.git`), and
 * that URL shows up in `git remote -v` output, in `push`/`fetch` argv, and in
 * git's own error text. This log is rendered in the browser and can be copied
 * out, so anything credential-shaped must be masked on the way IN — masking on
 * display would leave the real value in memory and in any later export.
 */

/** How many command records to retain. */
const MAX_ENTRIES = 300

/** Longest command output stored per record, in characters. */
const MAX_OUTPUT_CHARS = 4000

/** @type {Array<object>} */
const entries = []
const SOURCE_COMMANDS = new Set(['diff', 'show', 'blame', 'log', 'cat-file', 'config'])
const normalizeCwd = (value) => {
  const normalized = String(value ?? '').replace(/\\/g, '/').replace(/\/$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Monotonic id so the UI can key records and detect new ones. */
let nextId = 1

/**
 * Mask credentials embedded in a URL or in `user:pass@host` form.
 *
 * Handles the shapes that actually appear: `scheme://user:secret@host`,
 * `scheme://token@host`, and the bare `user:secret@host` inside error text.
 *
 * @param text - text that may contain a credential.
 * @returns the text with secrets replaced by `***`.
 */
export function redact(text) {
  const value = String(text ?? '')
  return (
    value
      // scheme://user:secret@host  →  scheme://user:***@host
      .replace(/(\w+:\/\/)([^/\s:@]+):([^/\s@]+)@/g, '$1$2:***@')
      // scheme://token@host  →  scheme://***@host
      .replace(/(\w+:\/\/)([^/\s:@]+)@/g, '$1***@')
      // bare user:secret@host inside a message
      .replace(/([^\s/:@]+):([^\s/@]+)@([^\s/@]+\.[^\s/@]+)/g, '$1:***@$3')
      // Authorization headers, in case a provider echoes one back. The whole
      // credential is masked, scheme word included: masking only "Bearer" and
      // leaving the token beside it is the failure this case exists to catch.
      .replace(/(Authorization:\s*)(\S+)(\s+\S+)?/gi, '$1***')
      // Common token prefixes, even outside a URL
      .replace(/(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{10,}\b/g, '$1_***')
      .replace(/glpat-[A-Za-z0-9_-]{10,}\b/g, 'glpat-***')
      .replace(/xox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'xox-***')
      .replace(/-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g, '[private key redacted]')
      .replace(/sk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, 'sk-***')
      .replace(/([?&](?:access_token|token|api_key|password|secret)=)[^&#\s]+/gi, '$1***')
      .replace(/((?:["']?(?:password|passwd|access_token|api[_-]?key|client[_-]?secret|auth[_-]?token|token|secret)["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gi, '$1***')
  )
}

/**
 * Record one completed command.
 *
 * @param record - `{ cwd, args, code, durationMs, stdout, stderr, error }`.
 */
export function recordCommand(record) {
  const args = Array.isArray(record.args) ? record.args.filter((arg) => arg !== '--no-optional-locks') : []
  // Only the git subcommand and its flags are stored; the argv we append
  // ourselves (`-c core.quotepath=false` and friends) is noise, and the `--`
  // separator plus paths are useful context.
  entries.push({
    id: nextId++,
    at: Date.now(),
    cwd: record.cwd ?? '',
    args: args.map((arg, index) => ['-m', '--message'].includes(args[index - 1]) ? '[message omitted]' : redact(arg)),
    code: record.code ?? null,
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : null,
    stdout: (SOURCE_COMMANDS.has(args[0]) || (args[0] === 'stash' && args[1] === 'show')) ? '' : truncateOutput(redact(record.stdout)),
    stderr: truncateOutput(redact(record.stderr)),
    error: record.error === undefined ? null : redact(record.error),
  })
  while (entries.length > MAX_ENTRIES) entries.shift()
}

/** Keep a record's stored output bounded, noting that it was cut. */
function truncateOutput(text) {
  const value = String(text ?? '')
  if (value.length <= MAX_OUTPUT_CHARS) return value
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n…（输出已截断，共 ${value.length} 字符）`
}

/**
 * Read the log, newest first.
 *
 * @param options - `{ limit, sinceId }`.
 * @returns the selected records plus the total retained count.
 */
export function readCommandLog(options = {}) {
  const limit = Number.isInteger(options.limit) ? Math.min(Math.max(options.limit, 1), MAX_ENTRIES) : 100
  const sinceId = Number.isInteger(options.sinceId) ? options.sinceId : null
  const scoped = options.cwd === undefined ? entries : entries.filter((entry) => normalizeCwd(entry.cwd) === normalizeCwd(options.cwd))
  const selected = sinceId === null ? scoped : scoped.filter((entry) => entry.id > sinceId)
  return {
    total: scoped.length,
    entries: selected.slice(-limit).reverse(),
  }
}

/** Drop every record. */
export function clearCommandLog(options = {}) {
  if (options.cwd === undefined) entries.length = 0
  else for (let index = entries.length - 1; index >= 0; index--) {
    if (normalizeCwd(entries[index].cwd) === normalizeCwd(options.cwd)) entries.splice(index, 1)
  }
}

/**
 * Format one record as the single line a terminal would show.
 *
 * @param entry - a log entry.
 * @returns `git <args>` with the cwd when it is not the repository root.
 */
export function formatCommand(entry) {
  return `git ${entry.args.join(' ')}`
}

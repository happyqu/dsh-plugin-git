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

/**
 * Extra characters redacted past the stored limit.
 *
 * A credential that starts just inside the kept window can end past it, and a
 * pattern that sees only its first half does not match. The margin gives every
 * pattern room to match the whole token before the result is cut back.
 */
const REDACT_MARGIN = 4096

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
 * Redact, and bound what is stored.
 *
 * Order matters and used to be wrong: the whole of `git status` output was run
 * through `redact()` (13 regular expressions, several of them multiline
 * back-tracking) and then 99% of the result was discarded by `truncateOutput`.
 * On a 0.8 MB status read that cost ~138 ms of CPU per command, on a command
 * that runs every couple of seconds, to keep the last 4000 characters.
 *
 * So the slice is taken first. Two details keep that safe:
 *
 * - The slice is cut at a LINE boundary. Redaction patterns are token-shaped;
 *   cutting mid-line could split a credential across the edge and leave a
 *   fragment no pattern matches — a half-token is still a leak.
 * - The slice keeps a margin of slack before the redaction pass, so a token that
 *   starts inside the kept window and ends past the cut is still whole when the
 *   patterns see it.
 *
 * @param value - raw command output.
 * @returns the stored (redacted, bounded) text.
 */
function redactOutput(value) {
  const text = String(value ?? '')
  if (text.length <= MAX_OUTPUT_CHARS) return redact(text)
  // Redact a bounded window around what will actually be stored.
  const limit = MAX_OUTPUT_CHARS + REDACT_MARGIN
  const boundary = text.lastIndexOf('\n', limit)
  const head = boundary <= 0 ? text.slice(0, limit) : text.slice(0, boundary)
  const safe = redact(head).slice(0, MAX_OUTPUT_CHARS)
  return `${safe}\n…（输出已截断，共 ${text.length} 字符）`
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
    ...(['rpc', 'diagnostic'].includes(record.source) ? { source: record.source } : {}),
    args: args.map((arg, index) => ['-m', '--message'].includes(args[index - 1]) ? '[message omitted]' : redact(arg)),
    code: record.code ?? null,
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : null,
    stdout: (SOURCE_COMMANDS.has(args[0]) || (args[0] === 'stash' && args[1] === 'show')) ? '' : redactOutput(record.stdout),
    stderr: redactOutput(record.stderr),
    error: record.error === undefined ? null : redact(record.error),
  })
  while (entries.length > MAX_ENTRIES) entries.shift()
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
  return `${entry.source === 'rpc' ? 'RPC' : entry.source === 'diagnostic' ? 'Diagnostic' : 'git'} ${entry.args.join(' ')}`
}

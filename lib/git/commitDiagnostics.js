import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordCommand } from './commandLog.js'
import { reportGitPhase } from './exec.js'
import { retryFileOperation } from './fileRetry.js'

const hooks = new Set(['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-rewrite', 'reference-transaction'])
const labels = { creating: '生成提交', refreshing: '刷新索引', hook: '执行仓库 hook', scope: '校验提交范围', maintenance: 'Git 自动维护' }
const regionPhase = event => event.category === 'index' && ['refresh', 'preload'].includes(event.label) ? 'refreshing' : null

/** Observe one commit without logging argv, commit messages or raw trace data. */
export async function runCommitWithDiagnostics(repo, args, options, context = {}) {
  let directory = context.directory, owned = false
  try { if (!directory) { directory = await mkdtemp(join(tmpdir(), 'dsh-commit-trace-')); owned = true } }
  catch {
    reportGitPhase(options.signal, 'commit.phase.creating')
    return repo.runWrite(args, options)
  }
  const trace = join(directory, 'commit-trace.json'), started = Date.now()
  let offset = 0, carry = '', dropping = false, pending, stopped = false, traceComplete = false
  let phase = 'creating', detail = '', phaseAt = started, refreshScans = 0, refreshStats = 0
  const active = new Map(), times = new Map(), regions = new Map()
  const recordRegion = (frame, seconds) => {
    if (!frame || !Number.isFinite(seconds) || seconds < 0) return
    const name = frame.phase + (frame.detail ? ':' + frame.detail : '')
    regions.set(name, (regions.get(name) || 0) + Math.round(seconds * 1000))
  }
  const setPhase = (next, nextDetail = '') => {
    if (phase === next && detail === nextDetail) return
    const key = phase + (detail ? ':' + detail : '')
    times.set(key, (times.get(key) || 0) + Date.now() - phaseAt)
    phase = next; detail = nextDetail; phaseAt = Date.now()
    reportGitPhase(options.signal, 'commit.phase.' + phase, detail)
  }
  const consume = event => {
    const id = event.sid + ':' + event.thread + ':'
    if (event.event === 'child_start' && event.child_class === 'hook' && hooks.has(event.hook_name)) {
      active.set(id + 'hook:' + event.child_id, { phase: 'hook', detail: event.hook_name })
    } else if (event.event === 'child_exit') {
      const key = id + 'hook:' + event.child_id
      recordRegion(active.get(key), event.t_rel); active.delete(key)
    } else if (event.event === 'region_enter' && regionPhase(event)) {
      active.set(id + 'region:' + event.category + ':' + event.label + ':' + event.nesting, { phase: regionPhase(event) })
    } else if (event.event === 'region_leave') {
      const key = id + 'region:' + event.category + ':' + event.label + ':' + event.nesting
      recordRegion(active.get(key), event.t_rel); active.delete(key)
    } else if (event.event === 'cmd_name' && ['gc', 'maintenance', 'repack', 'pack-objects'].includes(event.name)) {
      active.set(event.sid + ':maintenance', { phase: 'maintenance' })
    } else if (event.event === 'exit' || event.event === 'atexit') {
      for (const key of active.keys()) if (key.startsWith(event.sid + ':')) active.delete(key)
    } else if (event.event === 'data' && /^\d+$/.test(String(event.value)) && Number.isSafeInteger(Number(event.value))) {
      if (event.key === 'refresh/sum_scan') refreshScans += Number(event.value)
      if (event.key === 'refresh/sum_lstat') refreshStats += Number(event.value)
    }
    // Broken/incomplete traces must not grow the observer without bound.
    if (active.size > 128) active.delete(active.keys().next().value)
  }
  const sample = async () => {
    let file
    try {
      file = await open(trace, 'r')
      traceComplete = false
      const buffer = Buffer.alloc(65536)
      for (let batch = 0; batch < 4; batch++) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
        if (!bytesRead) { traceComplete = true; break }
        offset += bytesRead
        // Retain partial UTF-8 characters until the next complete event line.
        carry += buffer.subarray(0, bytesRead).toString('latin1')
        let end
        while ((end = carry.indexOf('\n')) !== -1) {
          const line = carry.slice(0, end); carry = carry.slice(end + 1)
          if (!dropping && line.length <= 32768) {
            try { consume(JSON.parse(Buffer.from(line, 'latin1').toString('utf8'))) } catch {}
          }
          dropping = false
        }
        if (carry.length > 32768) { carry = ''; dropping = true }
      }
    } catch { /* Tracing is best effort; it never determines commit success. */ }
    finally { await file?.close().catch(() => {}) }
    let stage = ''
    if (context.stageFile) { try { stage = (await readFile(context.stageFile, 'utf8')).trim() } catch {} }
    const frames = Array.from(active.values())
    const hook = frames.find(frame => frame.phase === 'hook')
    const current = hook || frames.at(-1) || { phase: 'creating' }
    if (stage === '校验提交范围') setPhase('scope')
    else if (stage.startsWith('hook: ') && hooks.has(stage.slice(6))) setPhase('hook', stage.slice(6))
    else setPhase(current.phase, current.detail)
  }
  const tick = () => {
    if (stopped || pending) return
    pending = sample().catch(() => {}).finally(() => { pending = null })
  }
  reportGitPhase(options.signal, 'commit.phase.creating')
  const timer = setInterval(tick, 250)
  let result
  try {
    result = await repo.runWrite(args, { ...options, env: { ...options.env, GIT_TRACE2_EVENT: trace } })
    return result
  } finally {
    stopped = true; clearInterval(timer)
    await pending
    await sample().catch(() => {})
    const key = phase + (detail ? ':' + detail : '')
    times.set(key, (times.get(key) || 0) + Date.now() - phaseAt)
    const diagnostics = { durationMs: Date.now() - started, refreshScans, refreshStats, traceComplete,
      regions: Array.from(regions, ([name, durationMs]) => ({ phase: name, durationMs })),
      phases: Array.from(times, ([name, durationMs]) => ({ phase: name, durationMs })) }
    if (result) {
      result.commitDiagnostics = diagnostics
      if (result.timedOut) result.stderr += '\nGit 内部步骤：' + labels[phase] + (detail ? ' (' + detail + ')' : '')
      else if (result.killed) result.stderr += '\n提交操作已取消，正在确认提交结果。'
      recordCommand({ source: 'diagnostic', cwd: repo.root, args: ['commit'], code: result.code,
        durationMs: diagnostics.durationMs, stdout: JSON.stringify(diagnostics) })
    }
    // Recovery directories may be retained, but raw trace argv must not be.
    await retryFileOperation(() => rm(trace, { force: true })).catch(() => {})
    if (owned) await retryFileOperation(() => rm(directory, { recursive: true, force: true })).catch(() => {})
  }
}

import { navigate } from '../core/navigation.js'
import { operationReviewText } from '../features/conflicts/operation-review.js'
import { ConflictEditor } from '../features/conflicts/view.js'
import { externalEditorItem } from '../core/external.js'
import { Fragment, React, ReactDOM, h } from '../core/runtime.js'
import { FileContextMenu, useDialogFocus } from '../ui/controls.js'
import { explainFailure, firstMeaningfulLine } from '../core/errors.js'
import { callRpc, startOperationCompatible, withExplicitSession } from '../core/rpc.js'
import { useChangelists } from '../features/changes/model.js'
import { getWindowState, setWindowState } from '../core/state.js'
import { readRepositorySnapshot, stableRepositoryStatus, useRepositoryUpdates } from '../core/repository.js'
import { readWorkbenchStorage, writeWorkbenchStorage } from '../core/preferences.js'
import { workbenchUpstream } from '../features/branches/model.js'
import { workbenchBranchItems } from '../features/branches/actions.js'
import { isStaged } from '../core/files.js'
import { IconBranch, IconChanges, IconChevron } from '../ui/icons.js'
import { BranchPicker } from '../features/branches/picker.js'
import { ChangelistCommitPanel, CommitPanel } from '../features/changes/commit.js'
import { ChoiceDialog, ConfirmBar, OperationPanel, PromptDialog, RemoteConfigDialog } from '../ui/dialogs.js'
import { MergeReviewDialog } from '../features/branches/merge.js'
import { FileViewer } from '../preview/viewer.js'
import { ChipNotice, OperationProgress } from '../ui/notifications.js'
import { WorkbenchDialog } from '../features/branches/dialogs.js'

/* ------------------------------------------------------------------ *
 * The header chips, the workbench window, and the launcher
 * ------------------------------------------------------------------ */

/**
 * One header chip that opens a popover.
 *
 * The popover is portaled to `document.body` rather than positioned inside
 * the chip: the session header is a flex row inside a clipping, scrolling
 * shell, and an absolutely positioned panel inside it gets cut off or
 * scrolls away. The portal is the same mechanism the file browser already
 * uses, and it is what lets the panel be wider than the chip.
 *
 * @param props - `{ label, title, tone, active, anchor, onOpen, onClose, children, t }`.
 */
function ChipPopover(props) {
  var panelRef = React.useRef(null)
  var sizeState = React.useState(0)
  var setSize = sizeState[1]
  useDialogFocus(panelRef, props.onClose, { opener: props.opener })
  React.useEffect(function () {
    var resize = function () { setSize(function (n) { return n + 1 }) }
    window.addEventListener?.('resize', resize)
    return function () {
      window.removeEventListener?.('resize', resize)
    }
  }, [])
  var anchor = props.opener?.isConnected !== false && props.opener?.getBoundingClientRect
    ? props.opener.getBoundingClientRect() : props.anchor
  if (anchor === null || anchor === undefined) return null
  var width = props.width === undefined ? 380 : props.width
  var viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1440
  var viewportHeight = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 900
  width = Math.min(width, Math.max(0, viewportWidth - 16))
  // Right-align to the chip and keep the panel on screen: the chip cluster
  // sits at the right edge, so a left-aligned panel would run off it.
  var left = Math.max(8, Math.min(anchor.right - width, viewportWidth - width - 8))
  var top = Math.max(8, Math.min(anchor.bottom + 6, viewportHeight - 80))
  return ReactDOM.createPortal(
    h(Fragment, null, [
      // A full-viewport catcher, so a click anywhere outside closes the
      // popover without a document-level listener racing React's own events.
      h('div', {
        key: 'scrim',
        className: 'dshgit-scrim',
        onClick: props.onClose,
        onContextMenu: function (event) { event.preventDefault(); props.onClose() },
      }),
      h('div', {
        key: 'panel',
        ref: panelRef,
        tabIndex: -1,
        className: 'dshgit-popover',
        role: 'dialog',
        'aria-label': props.title,
        'data-popover': props.kind,
        style: { left: left + 'px', top: top + 'px', width: width + 'px', maxHeight: Math.max(0, Math.min(560, viewportHeight - top - 8)) + 'px', boxSizing: 'border-box', overflow: 'hidden' },
      }, props.children),
    ]),
    document.body,
  )
}


/**
 * The session-header Git status chips.
 *
 * Everyday actions in a stable order: branch, changes, merge, remote action,
 * and a small menu for alternate pull/push forms.
 *
 * This is a session-scoped slot, so it is also the only place that knows
 * `sessionId` — which is why the whole cluster lives here and publishes the
 * id into the window store for the root-scoped overlay.
 *
 * @param props - `{ connection, sessionId, t }`.
 */
function GitStatusChips(props) {
  var syncActionRef = React.useRef(null)
  var t = props.t
  var connection = props.connection

  var repoState = React.useState(null)
  var repo = repoState[0]
  var setRepo = repoState[1]
  var statusState = React.useState(null)
  var status = statusState[0]
  var setStatus = statusState[1]
  var refsState = React.useState(null)
  var refs = refsState[0]
  var setRefs = refsState[1]
  var trackingState = React.useState(null)
  var tracking = trackingState[0]
  var setTracking = trackingState[1]
  var readyState = React.useState(false)
  var ready = readyState[0]
  var setReady = readyState[1]
  var readErrorState = React.useState(null)
  var readError = readErrorState[0]
  var setReadError = readErrorState[1]
  var refreshingState = React.useState(false)
  var refreshing = refreshingState[0]
  var setRefreshing = refreshingState[1]
  var missingState = React.useState(false)
  var gitMissing = missingState[0]
  var setGitMissing = missingState[1]
  var canInitState = React.useState(false)
  var canInit = canInitState[0]
  var setCanInit = canInitState[1]
  var busyState = React.useState(false)
  var busy = busyState[0]
  var setBusy = busyState[1]
  var busyMethodState = React.useState(null)
  var busyMethod = busyMethodState[0]
  var setBusyMethod = busyMethodState[1]
  var headerJob = React.useState(null)
  var writeRef = React.useRef(false)
  var contextRef = React.useRef(props.sessionId)
  var contextEpochRef = React.useRef(0)
  if (contextRef.current !== props.sessionId) contextEpochRef.current++
  contextRef.current = props.sessionId
  var operationReviewContextRef = React.useRef({ root: repo?.root, generation: 0, request: 0, mounted: true })
  if (operationReviewContextRef.current.root !== repo?.root) {
    operationReviewContextRef.current.root = repo?.root
    operationReviewContextRef.current.generation++
  }
  React.useEffect(function () {
    operationReviewContextRef.current.mounted = true
    return function () { operationReviewContextRef.current.mounted = false; operationReviewContextRef.current.request++ }
  }, [])
  var refreshRef = React.useRef(null)
  var refreshQueuedRef = React.useRef(false)
  var refreshLatestRef = React.useRef(null)
  /**
   * The last action's outcome, or null.
   *
   * `{ id, tone, summary, hint, detail, action }`. `id` is a sequence number
   * so the auto-dismiss effect restarts on every new outcome instead of
   * inheriting the previous one's timer.
   */
  var noticeState = React.useState(null)
  var notice = noticeState[0]
  var setNotice = noticeState[1]
  // Whether the raw git text is expanded in the banner.
  var noticeOpenState = React.useState(false)
  var noticeOpen = noticeOpenState[0]
  var setNoticeOpen = noticeOpenState[1]

  /** Show a successful outcome: one line, auto-dismissed. */
  var succeed = React.useCallback(function (summary, detail) {
    setNotice({ id: Date.now(), tone: 'success', summary: summary, hint: null, detail: detail || null, action: null })
    setNoticeOpen(false)
  }, [])

  /**
   * Show a failure: a plain-language line, the fix when it is knowable, and
   * git's own words kept behind a disclosure.
   *
   * The SUMMARY is the plugin's own explanation when it recognises the
   * failure, and git's most useful line otherwise. It must never be both —
   * showing `error: failed to push some refs` above "the remote has commits
   * you have not fetched" says the same thing twice in two vocabularies and
   * buries the actionable half.
   */
  var fail = React.useCallback(function (message, method) {
    var explained = explainFailure(message, method, t)
    var fallback = firstMeaningfulLine(explained.text)
    setNotice({
      id: Date.now(),
      tone: 'error',
      summary: explained.hint === null ? fallback : explained.hint,
      hint: null,
      detail: explained.text,
      action: explained.action,
    })
    setNoticeOpen(/^discard/.test(method || ''))
  }, [t])

  /**
   * Auto-dismiss a SUCCESS, but never an error.
   *
   * A success is confirmation of something the user just watched happen, so
   * it can fade. An error is information they have not acted on yet, and a
   * failure that vanishes unread is one they will simply hit again — so an
   * error stays until dismissed. Keyed on `notice.id` so each new outcome
   * gets its own timer rather than inheriting the previous one's.
   */
  React.useEffect(
    function () {
      if (notice === null || notice.tone !== 'success') return undefined
      var timer = setTimeout(function () { setNotice(null) }, 4200)
      return function () { clearTimeout(timer) }
    },
    [notice === null ? null : notice.id],
  )
  // Which popover is open, and the chip's measured box to anchor it to.
  var popoverState = React.useState(null)
  var popover = popoverState[0]
  var setPopover = popoverState[1]
  var anchorState = React.useState(null)
  var anchor = anchorState[0]
  var setAnchor = anchorState[1]
  var openerRef = React.useRef(null)
  // Whether the in-progress-operation panel is expanded. It is not a popover
  // because it must stay visible while the user reads the conflicted files,
  // and an outside click must not dismiss the way out of a stuck state.
  var opOpenState = React.useState(false)
  var opOpen = opOpenState[0]
  var setOpOpen = opOpenState[1]
  // The merge-vs-rebase question, shown only when a fast-forward pull refused.
  var pullChoiceState = React.useState(false)
  var pullChoice = pullChoiceState[0]
  var setPullChoice = pullChoiceState[1]
  // The commit box's own state, so it survives a popover close/reopen.
  var messageState = React.useState('')
  var message = messageState[0]
  var setMessage = messageState[1]
  var messageLatestRef = React.useRef(message)
  messageLatestRef.current = message
  var aiBusyState = React.useState(false)
  var aiBusy = aiBusyState[0]
  var setAiBusy = aiBusyState[1]
  var aiRequestRef = React.useRef(0)
  var aiRunningRef = React.useRef(false)
  var aiState = React.useState(null)
  var aiNotice = aiState[0]
  var setAiNotice = aiState[1]
  var pickerQueryState = React.useState('')
  var pickerQuery = pickerQueryState[0]
  var setPickerQuery = pickerQueryState[1]
  var confirmState = React.useState(null)
  var confirmRequest = confirmState[0]
  var setConfirmRequest = confirmState[1]
  var promptState = React.useState(null)
  var promptRequest = promptState[0]
  var setPromptRequest = promptState[1]
  // The right-click menu for a file row. The commit popover lists files, and a
  // list whose rows can only be opened is a dead end for everything else a
  // file needs — discard, stash, ignore, history. These are the same items the
  // full window offers, so a file exposes the same verbs wherever it is listed.
  var fileMenuState = React.useState(null)
  var fileMenuRequest = fileMenuState[0]
  var setFileMenuRequest = fileMenuState[1]
  var headerWorkbenchState = React.useState(null)
  var remoteRequest = React.useState(null)
  React.useEffect(function () { remoteRequest[1](null) }, [repo?.root, props.sessionId])
  // The file viewer: which path is open, or null when it is closed. It is
  // deliberately OUTSIDE the popover that launched it — reading a file means
  // the popover may close behind it, and the viewer must survive that.
  var viewerState = React.useState(null)
  var viewerPath = viewerState[0]
  var setViewerPath = React.useCallback(function (next) { navigate(function () { viewerState[1](next) }) }, [])
  var mergeSourceState = React.useState(null)
  var mergeSource = mergeSourceState[0]
  var setMergeSource = mergeSourceState[1]
  var mergePreviewState = React.useState(null)
  var mergePreview = mergePreviewState[0]
  var setMergePreview = mergePreviewState[1]
  var mergeErrorState = React.useState(null)
  var mergeError = mergeErrorState[0]
  var setMergeError = mergeErrorState[1]
  var mergeTargetState = React.useState(null), mergeTarget = mergeTargetState[0]
  var mergeFetchState = React.useState(false), mergeRetryState = React.useState(0)
  var setMergeFetchState = mergeFetchState[1]
  var mergeReviewRequestRef = React.useRef(0)

  /** One RPC call, unwrapped, with errors surfaced in the popover. */
  var call = React.useCallback(function (method, payload) {
    // The chips know the session they were rendered for as a PROP, so they
    // state it instead of letting `callRpc` read the window store. The store
    // is published by the parent cluster from an effect, and React runs this
    // component's effects first — reading it here would target the session
    // the user just left.
    return callRpc(connection, method, withExplicitSession(payload, props.sessionId), undefined)
  }, [connection, props.sessionId])

  var headerChangelists = useChangelists(repo, status, call)

  React.useEffect(function () {
    if (mergeSource === null || repo === null) return
    var active = true
    var request = ++mergeReviewRequestRef.current
    setMergePreview(null)
    setMergeError(null)
    var target = mergeTarget || mergeSource
    setMergeFetchState(false)
    Promise.all([
      call('commits', { root: repo.root, ref: 'HEAD..' + target, limit: 20 }),
      call('commits', { root: repo.root, ref: target + '..HEAD', limit: 20 }),
    ]).then(function (values) {
      if (!active || request !== mergeReviewRequestRef.current) return
      setMergePreview({ incoming: values[0].commits || [], outgoing: values[1].commits || [] })
    }).catch(function (failure) {
      if (active && request === mergeReviewRequestRef.current) setMergeError(failure.message)
    })
    return function () { active = false; mergeReviewRequestRef.current++ }
  }, [call, repo === null ? null : repo.root, mergeSource, mergeTarget, mergeRetryState[0]])

  /**
   * Load discovery, status, refs and tracking.
   *
   * @param options - `{ force }` bypasses the Host's caches; `session`
   *   re-resolves from the session instead of naming the current repository,
   *   which is what makes a conversation switch actually switch.
   */
  var refresh = React.useCallback(function (options) {
    var opts = options || {}
    var epoch = contextEpochRef.current
    if (refreshRef.current !== null && refreshRef.current.epoch === epoch) {
      if (opts.force && !opts.background) refreshQueuedRef.current = true
      return refreshRef.current.promise
    }
    var active = function () { return contextEpochRef.current === epoch }
    var request = { epoch: epoch, promise: null }
    refreshRef.current = request
    if (!opts.background) setRefreshing(true)
    request.promise = (opts.background && repo !== null && opts.session !== true ? Promise.resolve({ repos: [repo] }) : call('repos', Object.assign({}, repo !== null && opts.session !== true ? { path: repo.root } : {}, { force: opts.force === true })))
      .then(function (result) {
        if (!active()) return null
        setGitMissing(false)
        setReady(true)
        var list = result.repos || []
        if (!opts.background) setCanInit(result.canInitialize === true)
        if (list.length === 0) {
          setReadError(null)
          setRepo(null)
          setStatus(null)
          setRefs(null)
          setTracking(null)
          setWindowState({ workspace: result.directory || '' })
          return null
        }
        var next = list[0]
        if (repo !== null && opts.session !== true) {
          for (var i = 0; i < list.length; i++) if (list[i].root === repo.root) next = list[i]
        }
        setRepo(next)
        setWindowState({ workspace: next.root })
        return readRepositorySnapshot(next.root, call, { force: opts.force === true, metadata: true })
          .then(function (snapshot) {
            if (!active()) return
            setStatus(snapshot.status); setReadError(null)
            if (snapshot.refs) setRefs(function (previous) { return JSON.stringify(previous) === JSON.stringify(snapshot.refs) ? previous : snapshot.refs })
            setTracking(snapshot.tracking)
          }).catch(function (failure) {
            if (active()) { if (!opts.background) setStatus(null); setReadError({ scope: 'status', message: failure.message }) }
          })
      })
      .catch(function (failure) {
        if (!active()) return
        setGitMissing(failure.code === 'git/not-found' || failure.code === 'git/invalid-path' || failure.code === 'git/git-not-found')
        setReadError({ scope: 'repos', message: failure.message, code: failure.code })
        setReady(true)
        setRepo(null)
        setStatus(null)
        setRefs(null)
        setTracking(null)
      })
      .finally(function () {
        if (refreshRef.current !== request) return
        refreshRef.current = null
        if (refreshQueuedRef.current && active()) {
          refreshQueuedRef.current = false
          return refreshLatestRef.current({ force: true })
        }
        if (active()) setRefreshing(false)
      })
    return request.promise
  }, [call, repo])
  refreshLatestRef.current = refresh
  var autoFetchStatus = useRepositoryUpdates(repo?.root, props.active !== false, call, busy || refreshing, function (snapshot) {
    setStatus(function (previous) { return stableRepositoryStatus(previous, snapshot.status) })
    setReadError(null)
    if (snapshot.refs) setRefs(function (previous) { return JSON.stringify(previous) === JSON.stringify(snapshot.refs) ? previous : snapshot.refs })
    if (snapshot.tracking) setTracking(function (previous) { return JSON.stringify(previous) === JSON.stringify(snapshot.tracking) ? previous : snapshot.tracking })
  })
  var lastRefreshToken = React.useRef(props.refreshToken)
  React.useEffect(function () {
    if (props.refreshToken === lastRefreshToken.current) return
    lastRefreshToken.current = props.refreshToken
    refresh({ force: true })
  }, [props.refreshToken])

  // First load, and again whenever the conversation changes: the chips show
  // THIS conversation's repository.
  var lastSessionRef = React.useRef(props.sessionId)
  React.useEffect(function () {
    refresh({ force: true })
  }, [])
  React.useEffect(function () {
    if (lastSessionRef.current === props.sessionId) return
    lastSessionRef.current = props.sessionId
    writeRef.current = false
    setBusy(false)
    setBusyMethod(null)
    headerJob[1](null)
    aiRequestRef.current++
    aiRunningRef.current = false
    setAiBusy(false)
    refreshQueuedRef.current = false
    setReady(false)
    setReadError(null)
    setRepo(null)
    setStatus(null)
    setRefs(null)
    setTracking(null)
    setPopover(null)
    setConfirmRequest(null)
    setPromptRequest(null)
    headerWorkbenchState[1](null)
    setMergeSource(null)
    setMessage('')
    setNotice(null)
    setAiNotice(null)
    refresh({ force: true, session: true })
  }, [props.sessionId])

  /**
   * Whether a failed write is really "your branch diverged".
   *
   * Deliberately NOT a match on git's wording. The plugin already knows the
   * divergence from `status` (`ahead > 0 && behind > 0`), which is the same
   * fact git is reporting — reading it from state is stable across locales
   * and git versions, while `fatal: Not possible to fast-forward` is not.
   *
   * `--ff-only` is the only call that passes `onReject`, and it can only fail
   * this way when the branch has both local and remote commits.
   *
   * @param failure - the rejected error.
   * @returns whether to ask the merge-or-rebase question.
   */
  var looksDiverged = function (failure) {
    if (failure === null || failure === undefined) return false
    if (ahead > 0 && behind > 0) return true
    // Fallback for a state that changed between the status read and the pull
    // (another window committed): the phrase is stable because the exec layer
    // forces `LC_ALL=C`.
    return /not possible to fast-forward/i.test(String(failure.message || ''))
  }

  /**
   * React to a legitimate refusal.
   * @param kind - the follow-up to run.
   */
  var handleReject = function (kind) {
    if (kind === 'diverged') setPullChoice(true)
  }

  /**
   * Run a write, asking for confirmation when the Host demands one.
   *
   * @param method - the write method (without the `write.` prefix).
   * @param payload - its payload.
   * @param options - `{ confirm, after, onReject }`. `onReject` names a
   *   follow-up to run instead of showing an error, for the cases where a
   *   refusal is a legitimate answer rather than a failure — a refused
   *   fast-forward means the branch diverged, which is a question to ask, not
   *   an error to report.
   */
  var write = function (method, payload, options) {
    var opts = options || {}
    if (writeRef.current) return Promise.resolve(null)
    var body = Object.assign({}, payload)
    if (repo !== null) body.root = repo.root
    var epoch = contextEpochRef.current
    var active = function () { return contextEpochRef.current === epoch }
    var actionOpener = document.activeElement
    if (method === 'push' && !body.remote && !body.tags && body.forceWithLease !== true && !status?.branch?.upstream) body.setUpstream = true
    if (method === 'push' && body.setUpstream === true && !body.remote) {
      writeRef.current = true
      setBusy(true)
      setBusyMethod('push')
      return call('remotes', { root: body.root }).then(function (value) {
        if (!active()) return null
        writeRef.current = false
        setBusy(false)
        setBusyMethod(null)
        var remotes = Array.isArray(value) ? value : (value.remotes || [])
        if (remotes.length === 0) { closePopover(); remoteRequest[1]({ id: Date.now(), push: true, branch: body.sourceBranch || body.branch || status?.branch?.head }); return null }
        var publish = function (remote) {
          return write(method, Object.assign({}, body, { remote: remote, branch: status?.branch?.head }), opts)
        }
        if (remotes.length === 1) return publish(remotes[0].name)
        setPromptRequest({
          title: t('publish.remote'),
          fields: [{ key: 'remote', label: t('label.remote'), options: remotes.map(function (remote) { return { value: remote.name, label: remote.name } }) }],
          submit: function (values) { if (values.remote) publish(values.remote) },
        })
        return null
      }).catch(function (failure) {
        if (active()) { writeRef.current = false; setBusy(false); setBusyMethod(null); fail(failure.message, 'push') }
        return null
      })
    }
    // Avoid the obsolete history-rewrite prompt for ordinary pushes on
    // older Hosts, while keeping force-with-lease behind confirmation.
    if (method === 'push' && body.forceWithLease !== true) body.confirm = true
    if (opts.confirm === true) body.confirm = true
    writeRef.current = true
    setBusyMethod(method)
    setBusy(true)
    // A write usually names its `root`, in which case the session id is
    // irrelevant. When it does not — an init in a directory with no
    // repository yet — the explicit id still has to beat the stale store.
    var execute = function () {
      if (!['fetch', 'push', 'pull', 'lfsTransfer'].includes(method)) return callRpc(connection, 'write.' + method, withExplicitSession(body, props.sessionId), undefined)
      return startOperationCompatible(call, { root: body.root, method: 'write.' + method, parameters: withExplicitSession(body, props.sessionId) }).then(function (job) {
        if (job.legacy) return job.value
        if (active()) headerJob[1](job)
        return new Promise(function (resolve, reject) {
          var failures = 0
          var poll = function () { call('operationStatus', { root: job.root, id: job.id }).then(function (value) {
            failures = 0
            if (active()) headerJob[1](value)
            if (value.state === 'running') { setTimeout(poll, 600); return }
            if (value.state === 'complete' && value.result?.ok) resolve(value.result.value)
            else { var failure = new Error(value.result?.error?.message || t('lfs.' + value.state)); failure.code = value.result?.error?.code; failure.details = value.result?.error?.details; reject(failure) }
          }).catch(function (failure) { if (++failures > 5) reject(failure); else setTimeout(poll, 2000) }) }
          poll()
        })
      })
    }
    return execute()
      .then(function (value) {
        if (!active()) return null
        // Success is a success: it gets the success tone, not the error red
        // the old single-purpose span painted everything with.
        succeed(value.message || t('action.ok'), value.stderr || null)
        if (value.recovery && repo && (value.recovery.backup || value.recovery.stash)) {
          writeWorkbenchStorage('recovery:' + repo.root, [Object.assign({ at: Date.now() }, value.recovery)].concat(readWorkbenchStorage('recovery:' + repo.root, [])).slice(0, 20))
          setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
        }
        if (method === 'fetch' && repo) writeWorkbenchStorage('fetch:' + repo.root, Date.now())
        if (opts.after !== undefined) {
          writeRef.current = false
          setBusy(false)
          setBusyMethod(null)
          opts.after()
        } else return refresh({ force: true }).then(function () {
          if (active()) { writeRef.current = false; setBusy(false); setBusyMethod(null) }
          return value
        })
        return value
      })
      .catch(function (failure) {
        if (!active()) return null
        writeRef.current = false
        setBusy(false)
        setBusyMethod(null)
        if (failure.code === 'git/needs-confirmation') {
          setConfirmRequest({
            message: failure.message,
            opener: actionOpener,
            label: method === 'push' ? t('action.pushForceLease') : method === 'checkout' ? t('action.switch') : t('action.apply'),
            onConfirm: function () {
              setConfirmRequest(null)
              write(method, payload, Object.assign({}, opts, { confirm: true }))
            },
          })
          return null
        }
        // A refused fast-forward is git answering a question, not failing:
        // the branch diverged, so ask which way to reconcile instead of
        // showing "Not possible to fast-forward" as an error.
        if (opts.onReject !== undefined && looksDiverged(failure)) {
          refresh({ force: true })
          handleReject(opts.onReject)
          return null
        }
        if (method === 'commit' || method === 'commitPaths') refresh({ force: true })
        if (!opts.propagate) fail(failure.message, method)
        if (opts.onError) opts.onError(failure)
        if (failure.details?.recovery && repo) {
          writeWorkbenchStorage('recovery:' + repo.root, [Object.assign({ at: Date.now() }, failure.details.recovery)].concat(readWorkbenchStorage('recovery:' + repo.root, [])).slice(0, 20))
          setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
        }
        if (method === 'merge') {
          setOpOpen(true)
          refresh({ force: true })
        }
        if (opts.propagate) { refresh({ force: true }); throw failure }
        return null
      })
  }

  /**
   * Open a popover, measuring the chip so the panel can anchor to it.
   *
   * @param kind - `'branch'` or `'commit'`.
   * @param event - the click event, whose target is the chip.
   */
  var openPopover = function (kind, event) {
    var node = event && event.currentTarget
    openerRef.current = node || document.activeElement
    var rect = node && typeof node.getBoundingClientRect === 'function'
      ? node.getBoundingClientRect()
      : { right: 420, bottom: 40 }
    setAnchor({ right: rect.right, bottom: rect.bottom })
    setPopover(popover === kind ? null : kind)
    if (notice?.tone === 'success') setNotice(null)
    setPickerQuery('')
    refresh({ force: true })
  }

  var closePopover = function () {
    setPopover(null)
    setConfirmRequest(null)
    // Deliberately NOT clearing the notice here. A write started from inside
    // a popover (a failed commit) must stay readable after that popover
    // closes; wiping it on close would hide the failure the user just hit.
  }

  /**
   * The right-click menu for one file row.
   *
   * The commit popover lists changed files, and a row that can only be opened
   * is a dead end: everything else a file needs — discard, stash, ignore, its
   * history — had no entry point there, while the full window offered all of
   * them. The items therefore match the full window's, minus the ones that
   * assume it (opening a HEAD revision in the editor).
   *
   * `section` decides which half of a partially-staged file is being acted on,
   * exactly as in the full window: discarding from the staged list is refused,
   * because that would silently throw away what the user just staged.
   *
   * @param event - the context-menu event.
   * @param file - the status entry.
   * @param section - `'staged'` or `'unstaged'`.
   */
  var openFileMenu = function (event, file, section, extraItems) {
    event.preventDefault()
    event.stopPropagation?.()
    var staged = section === 'staged'
    var items = [
      { id: 'changes', label: t('action.openChanges'), command: 'diff',
        run: function () { closePopover(); setViewerPath(file.path) } },
      { id: 'history', label: t('action.fileHistory'), command: 'log', disabled: file.kind === 'untracked',
        run: function () {
          closePopover()
          // The history module reads its path filter from the window state, so
          // switching to it has to carry the path or it would open unfiltered.
          setWindowState({ mode: 'full', tab: 'history', historyPath: file.path, minimized: false, sessionId: props.sessionId })
        } },
      { separator: true },
      { id: 'stage', label: t(staged ? 'action.unstage' : 'action.stage'), command: staged ? 'reset' : 'add',
        disabled: busy,
        run: function () { write(staged ? 'unstage' : 'stage', { paths: [file.path] }) } },
      // Discarding the INDEX would destroy a staged change with no way back,
      // so it is offered only for the working-tree half.
      { id: 'discard', label: t('action.discard'), command: file.kind === 'untracked' ? 'clean' : 'restore',
        danger: true, disabled: busy || staged,
        hint: staged ? t('file.discardStagedHint') : undefined,
        run: function () {
          var message = t('confirm.discard', { path: file.path })
          if (file.kind === 'untracked') message += t('confirm.discardUntrackedSuffix')
          setConfirmRequest({ message: message, opener: document.activeElement, label: t('action.discard'),
            onConfirm: function () {
              setConfirmRequest(null)
              write('discardPath', { path: file.path, untracked: file.kind === 'untracked' }, { confirm: true })
            } })
        } },
      { id: 'stash', label: t('action.stashFile'), command: 'stash push', disabled: busy,
        run: function () { write('stashPush', { paths: [file.path], includeUntracked: file.kind === 'untracked' }) } },
      externalEditorItem(repo.root, file, t, event, call, fail),
      { id: 'ignore-local', label: t('action.ignoreLocal'), disabled: busy || file.kind !== 'untracked', run: function () { write('ignoreLocalPath', { path: file.path }) } },
      { id: 'ignore', label: t('action.ignoreFile'), disabled: busy || file.kind !== 'untracked',
        run: function () { write('ignorePath', { path: file.path }) } },
      { separator: true },
      { id: 'copy-path', label: t('action.copyPath'),
        run: function () { navigator.clipboard.writeText(file.path).catch(function () {}) } },
    ]
    if (extraItems?.length) items = extraItems.concat([{ separator: true }], items)
    setFileMenuRequest({ x: event.clientX || 0, y: event.clientY || 0, items: items })
  }

  /**
   * Switch to a local branch, after the destructive-change confirmation.
   *
   * `checkout` is destructive on the Host because it can discard uncommitted
   * work, so it always comes back as `needs-confirmation`; asking first is
   * where the user sees what is about to happen.
   *
   * @param name - the local branch.
   */
  var openHeaderWorkbench = function (action, subject) {
    closePopover()
    headerWorkbenchState[1]({ action: action, subject: subject, id: Date.now() })
  }
  var switchBranch = function (name) {
    closePopover()
    if (name === status?.branch?.head) return
    write('checkout', { ref: 'refs/heads/' + name, localBranch: true }, { confirm: true, after: function () {
      refresh({ force: true })
      var token = getWindowState().refreshToken + 1
      lastRefreshToken.current = token
      setWindowState({ refreshToken: token })
    } })
  }
  var chooseRemoteBranch = function (name) {
    var branch = (refs?.remotes || []).find(function (item) { return item.name === name })
    openHeaderWorkbench('checkout', branch || { name: name, ref: 'refs/remotes/' + name })
  }
  var openNewBranchDialog = function (from) {
    openHeaderWorkbench('createBranch', from && from !== 'HEAD' ? { ref: from } : null)
  }
  var headerBranchWorkflow = function (action, branch, extras) {
    if (action === 'checkout' && branch.ref.startsWith('refs/heads/')) { switchBranch(branch.name); return }
    if (action === 'fetch' || action === 'pull') {
      var parameters
      if (branch.ref.startsWith('refs/heads/')) {
        var upstream = workbenchUpstream(branch)
        if (!/^refs\/remotes\//.test(upstream)) return
        parameters = { name: branch.ref.slice(11), upstream: upstream, ffOnly: action === 'pull' }
      } else {
        var remoteName = branch.remoteName || branch.ref.slice(13).split('/')[0]
        parameters = { remote: remoteName, prune: extras?.prune === true }
        if (!parameters.prune) parameters.branch = branch.ref.slice(14 + remoteName.length)
      }
      write(action, parameters)
      return
    }
    openHeaderWorkbench(action, branch)
  }
  var headerBranchItems = function (branch) {
    return workbenchBranchItems(branch, {
      t: t, busy: busy || !!status?.operation, current: status?.branch?.head,
      worktreesSupported: repo?.features?.['git:worktrees'] !== false,
      workflow: headerBranchWorkflow,
      compare: function (target) { closePopover(); setWindowState({ mode: 'full', tab: 'compare', compareWith: target.ref, minimized: false, sessionId: props.sessionId }) },
      copy: function (text) { navigator.clipboard.writeText(text).catch(function () { fail(t('diff.copyFailed')) }) },
    }).filter(function (item) { return !['history', 'incoming', 'outgoing', 'favorite'].includes(item.id) })
  }
  var openHeaderBranchMenu = function (event, branch) {
    event.preventDefault(); event.stopPropagation()
    setFileMenuRequest({ x: event.clientX || 0, y: event.clientY || 0, items: headerBranchItems(branch) })
  }

  /** Ask the model for a commit message for the current staged changes. */
  var generateMessage = function () {
    if (aiRunningRef.current || writeRef.current) return
    aiRunningRef.current = true
    setAiBusy(true)
    var requestId = ++aiRequestRef.current
    var draft = messageLatestRef.current
    setAiNotice(null)
    call('ai.commitMessage', { root: repo.root })
      .then(function (value) {
        if (requestId !== aiRequestRef.current) return
        if (value.available === false) { setAiNotice(value.message); return }
        if (value.empty === true) { setAiNotice(value.reason || t('commit.nothing')); return }
        if (typeof value.message !== 'string' || !value.message.trim()) { setAiNotice(t('ai.emptyResult')); return }
        if (messageLatestRef.current === draft) { setMessage(value.message); setAiNotice(null) }
        else setAiNotice(t('ai.draftChanged'))
      })
      .catch(function (failure) { if (requestId === aiRequestRef.current) setAiNotice(failure.message) })
      .finally(function () {
        if (requestId !== aiRequestRef.current) return
        aiRunningRef.current = false
        setAiBusy(false)
      })
  }

  /**
   * Continue an optional remote action only after the commit succeeds.
   *
   * The popover closes HERE, not when the button was pressed: the commit can
   * still fail (a pre-commit hook, a rejected sign-off, an empty tree), and
   * closing on the click would hide the error along with the panel that
   * reported it. Reaching this callback means the commit really landed, and
   * the change list it was built from is now empty — leaving it open would
   * show a stale list of files that are already committed.
   *
   * The follow-up push/pull keeps running after the close and reports
   * through the outcome banner, which lives outside the popover.
   */
  var afterCommit = function (mode) {
    aiRequestRef.current++
    aiRunningRef.current = false
    setAiBusy(false)
    setMessage('')
    closePopover()
    refresh({ force: true })
    setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
    if (mode === 'push') {
      write('push', status?.branch?.upstream ? {} : { setUpstream: true })
    } else if (mode === 'sync') {
      write('pull', { ffOnly: true }, { after: function () { write('push', {}) } })
    }
  }

  /** Respect the user's staged selection; stage all only when none is staged. */
  var commit = function (mode) {
    // These are pre-flight refusals the plugin itself decided, not git
    // failures: no raw output to disclose, no remote fix to offer.
    var refuse = function (summary) {
      setNotice({ id: Date.now(), tone: 'error', summary: summary, hint: null, detail: null, action: null })
      setNoticeOpen(false)
    }
    if (message.trim() === '') { refuse(t('commit.requiredMessage')); return }
    if (status === null) return
    var changed = status.files || []
    if (changed.some(function (file) { return file.kind === 'unmerged' })) { refuse(t('conflict.resolveRemaining')); return }
    if (changed.length === 0) { refuse(t('commit.nothing')); return }
    if (changed.some(isStaged)) {
      write('commit', { message: message }, { after: function () { afterCommit(mode) } })
    } else stageAllAndCommit(mode)
  }

  /**
   * Stage everything, then commit the visible change list.
   *
   * Sequenced through the `after` callback rather than Promise chaining: the
   * write helper already owns busy state, notices and refresh, and the commit
   * must only run if the stage actually succeeded. Committing a partially
   * staged tree after a failed stage-all would record the wrong subset.
   */
  var stageAllAndCommit = function (mode) {
    if (message.trim() === '') return
    write('stage', {}, {
      after: function () {
        write('commit', { message: message }, {
          after: function () { afterCommit(mode) },
        })
      },
    })
  }

  // --- chip values -----------------------------------------------------

  var files = status === null ? [] : (status.files || [])
  var branchName = status !== null && status.branch !== null ? status.branch.head : null
  var ahead = tracking !== null && tracking !== undefined ? tracking.ahead : (status?.branch?.ahead || 0)
  var behind = tracking !== null && tracking !== undefined ? tracking.behind : (status?.branch?.behind || 0)
  var upstream = status !== null && status.branch !== null ? status.branch.upstream : null
  var operation = status !== null && status.operation !== undefined ? status.operation : null
  var detached = status !== null && status.branch !== null && status.branch.detached === true

  // Git missing entirely: the chips would be meaningless, so say so once.
  if (gitMissing) {
    return h('button', { type: 'button', className: 'dshgit-chip dshgit-chipaction', title: (readError?.message || t('state.noGit')) + '\n' + t('action.retryRead'), disabled: refreshing, onClick: function () { refresh({ force: true }) } },
      t(readError?.code === 'git/invalid-path' ? 'settings.gitInvalid' : 'settings.gitMissing'))
  }
  if (!ready) {
    return h('span', { className: 'dshgit-chip dshgit-chipmuted' }, t('state.loading'))
  }
  if (repo === null) {
    if (readError !== null && !gitMissing) return h('button', {
      type: 'button', className: 'dshgit-chip dshgit-chipaction dshgit-next-warn',
      title: readError.message + '\n' + t('action.retryRead'),
      'aria-label': t('action.retryRead'), 'aria-busy': refreshing,
      disabled: refreshing,
      onClick: function () { refresh({ force: true }) },
    }, [t('state.readFailed'), refreshing ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true }) : null])
    return canInit
      ? h('button', {
          type: 'button',
          className: 'dshgit-chip dshgit-chipaction',
          'data-chip': 'init',
          title: t('chips.notRepo'),
          onClick: function () {
            if (writeRef.current) return
            var epoch = contextEpochRef.current
            writeRef.current = true
            setBusy(true)
            call('initRepository', {})
              .then(function () { if (epoch === contextEpochRef.current) { writeRef.current = false; setBusy(false); refresh({ force: true }) } })
              .catch(function (failure) { if (epoch === contextEpochRef.current) { writeRef.current = false; setBusy(false); fail(failure.message, 'initRepository') } })
          },
          disabled: busy,
        }, t('chips.init'))
      : h('span', { className: 'dshgit-chip dshgit-chipmuted', title: t('chips.notRepo') },
          t('chips.notRepo'))
  }

  /**
   * What to do about SYNC, derived from the repository's real state.
   *
   * The changes chip owns the commit flow, so this action always describes
   * the remote even while the working tree has edits.
   *
   * So this answers one question — "what does the remote need?" — and it
   * carries the counts itself rather than leaving them to a separate chip. The
   * arrows ARE the state and the label IS the verb, so splitting them across
   * two controls printed the same number twice within 40px.
   *
   * Precedence is deliberate. An unfinished merge outranks everything (nothing
   * else can proceed); publishing outranks a plain push because a plain push
   * cannot succeed without an upstream.
   *
   * @returns `{ id, label, counts, hint, tone, disabled }`.
   */
  var nextAction = (function () {
    if (readError !== null) return { id: 'retry', label: t('state.readFailed'), counts: '', hint: readError.message + '\n' + t('action.retryRead'), tone: 'warn', disabled: false }
    if (status === null) return { id: 'unavailable', label: t('state.loading'), counts: '', hint: t('window.open'), tone: 'clean', disabled: true }
    if (operation !== null) {
      var kindKey = operation.kind === 'cherry-pick' ? 'op.cherry-pick' : 'op.' + operation.kind
      return {
        id: 'resolve',
        label: t('next.resolve'),
        counts: '',
        hint: t('next.hint.resolve', { kind: t(kindKey) }),
        tone: 'warn',
        disabled: false,
      }
    }
    // No upstream: a plain push cannot work, so offer the one that can.
    // A detached HEAD has no branch to publish, so it falls through to the
    // sync state rather than offering an action that must fail.
    if (upstream === null && !detached) {
      return {
        id: 'publish',
        label: t('next.publish'),
        counts: '',
        hint: t('next.hint.publish'),
        tone: 'ahead',
        disabled: branchName === null,
      }
    }
    // Both counts, because when a branch has diverged BOTH numbers are the
    // reason the pull needs a decision.
    if (ahead > 0 && behind > 0) {
      return {
        id: 'diverged',
        label: t('next.diverged'),
        counts: '↑' + ahead + ' ↓' + behind,
        hint: t('next.hint.diverged'),
        tone: 'warn',
        disabled: false,
      }
    }
    if (behind > 0) {
      return { id: 'pull', label: t('action.pull'), counts: '↓' + behind, hint: t('next.hint.pull', { count: behind }), tone: 'behind', disabled: false }
    }
    if (ahead > 0) {
      return { id: 'push', label: t('action.push'), counts: '↑' + ahead, hint: t('next.hint.push', { count: ahead }), tone: 'ahead', disabled: false }
    }
    return { id: 'fetch', label: t('action.fetch'), counts: '', hint: t('sync.fetch'), tone: 'clean', disabled: false }
  })()
  if ((syncBusy || retryBusy) && syncActionRef.current) nextAction = syncActionRef.current
  else syncActionRef.current = nextAction

  /**
   * Run the primary action.
   *
   * Pull is `--ff-only` by default: it is the only form that cannot surprise
   * the user with a merge commit they did not ask for. When it cannot
   * fast-forward the branch has diverged, and the choice between merging and
   * rebasing is a real decision — so it is asked rather than guessed.
   */
  var runNext = function (event) {
    if (event?.currentTarget) openerRef.current = event.currentTarget
    if (nextAction.id === 'retry') { refresh({ force: true }); return }
    if (nextAction.id === 'resolve') { setOpOpen(true); return }
    if (nextAction.id === 'publish') {
      write('push', { setUpstream: true })
      return
    }
    if (nextAction.id === 'pull') {
      write('pull', { ffOnly: true }, {
        // A refused fast-forward is not an error to shout about; it is the
        // signal to ask which way the user wants to reconcile.
        onReject: 'diverged',
      })
      return
    }
    if (nextAction.id === 'push') { write('push', {}); return }
    if (nextAction.id === 'diverged') { setPullChoice(true) }
    if (nextAction.id === 'fetch') { write('fetch', { prune: true }) }
  }

  var syncBusy = busy && (busyMethod === 'push' || busyMethod === 'pull' || busyMethod === 'fetch')
  var retryBusy = refreshing && nextAction.id === 'retry'

  return h(Fragment, null, [
    // Branch chip → branch picker.
    h('button', {
      key: 'branch',
      type: 'button',
      className: 'dshgit-chip dshgit-chipaction',
      'data-chip': 'branch',
      'data-push-pending': ahead > 0,
      title: repo.root + '\n' + (branchName || 'HEAD') + (ahead > 0 ? '\n' + t('state.readyPush', { count: ahead }) : ''),
      'aria-haspopup': 'dialog',
      'aria-expanded': popover === 'branch',
      onClick: function (event) { openPopover('branch', event) },
    }, [
      busy && (busyMethod === 'checkout' || busyMethod === 'createBranch') ? h('span', { key: 'i', className: 'dshgit-spinner', 'aria-hidden': true, style: { width: '12px', height: '12px', boxSizing: 'border-box', flex: 'none' } }) : h(IconBranch, { key: 'i', size: 12 }),
      h('span', { key: 'n', className: 'dshgit-chipname' }, branchName === null ? 'HEAD' : branchName),
    ]),

    // One stable entry for reviewing, staging and committing changes.
    h('button', {
      key: 'changes',
      type: 'button',
      className: 'dshgit-chip dshgit-chipaction' + (files.length > 0 ? ' dshgit-chipdirty' : ' dshgit-chipmuted'),
      'data-chip': 'changes',
      title: files.length === 0 ? t('chips.clean') : t('chips.changes', { count: files.length }),
      'aria-haspopup': 'dialog',
      'aria-expanded': popover === 'commit',
      onClick: function (event) { openPopover('commit', event) },
    }, [
      busy && !syncBusy && busyMethod !== 'checkout' && busyMethod !== 'createBranch' && busyMethod !== 'merge' && popover !== 'commit' ? h('span', { key: 'i', className: 'dshgit-spinner', 'aria-hidden': true, style: { width: '12px', height: '12px', flex: 'none' } }) : h(IconChanges, { key: 'i', size: 12 }),
      h('span', { key: 'n' }, String(files.length)),
    ]),

    // Keep recovery visible while a Git operation is unfinished.
    operation !== null ? h('button', {
      key: 'resolve', type: 'button', className: 'dshgit-chip dshgit-chipaction dshgit-next-warn',
      'data-chip': 'operation', title: t('next.resolve'), disabled: busy,
      onClick: function () { setOpOpen(true) },
    }, t('next.resolve')) : null,

    // The primary remote action describes the cached tracking state. Alternate
    // commands stay available through the adjacent chevron in every state.
    h('button', {
      key: 'next', type: 'button',
      className: 'dshgit-chip dshgit-chipaction dshgit-chipnext dshgit-next-' + nextAction.tone,
      'data-chip': 'next',
      'data-next': nextAction.id,
      'data-push-pending': nextAction.id === 'push' && ahead > 0,
      title: nextAction.hint + (upstream ? '\n' + t('sync.target', { target: upstream }) : '') + (autoFetchStatus?.error ? '\n' + t('sync.autoFetchFailed', { message: autoFetchStatus.error }) : ''),
      style: nextAction.id === 'fetch' && autoFetchStatus?.error ? { color: 'var(--dshgit-warning-text)' } : undefined,
      'aria-busy': syncBusy || retryBusy,
      'aria-label': (syncBusy ? t(busyMethod === 'push' ? 'sync.pushing' : busyMethod === 'pull' ? 'sync.pulling' : 'sync.fetching') : nextAction.label) + (nextAction.counts ? ' ' + nextAction.counts : ''),
      disabled: busy || retryBusy || nextAction.disabled || operation !== null,
      onClick: runNext,
    }, [
      h('span', { key: 'n', className: 'dshgit-chipname' }, nextAction.label),
      nextAction.counts ? h('span', { key: 'c', className: 'dshgit-chipcounts', title: nextAction.counts }, nextAction.counts) : null,
    ]),
    h('button', {
      key: 'sync-menu', type: 'button',
      className: 'dshgit-chip dshgit-chipaction dshgit-chipmore',
      'data-chip': 'sync-menu',
      title: t('next.more'),
      'aria-label': t('next.more'),
      'aria-haspopup': 'dialog',
      'aria-expanded': popover === 'sync',
      disabled: busy || operation !== null,
      onClick: function (event) { openPopover('sync', event) },
    }, busy || retryBusy ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : h(IconChevron, { size: 9 })),

    popover === 'branch'
      ? h(ChipPopover, {
          key: 'branchpop',
          opener: openerRef.current,
          kind: 'branch',
          title: t('action.switchBranch'),
          anchor: anchor,
          width: 520,
          onClose: closePopover,
        }, h(BranchPicker, {
          t: t,
          busy: busy,
          refs: refs,
          current: branchName,
          query: pickerQuery,
          setQuery: setPickerQuery,
          onSwitch: switchBranch,
          onRemote: chooseRemoteBranch,
          onTag: function (tag) { openHeaderWorkbench('checkout', tag) },
          onNew: openNewBranchDialog,
          onMerge: function (source, ref) { closePopover(); setMergePreview(null); setMergeError(null); mergeTargetState[1](ref || source); setMergeSource(source) },
          mergeDisabled: operation !== null || branchName === null || detached,
          branchItems: headerBranchItems,
          onBranchMenu: openHeaderBranchMenu,
          onFetch: function () { write('fetch', {}, { after: function () { refresh({ force: true }) } }) },
        }))
      : null,

    popover === 'commit'
      ? h(ChipPopover, {
          key: 'commitpop',
          opener: openerRef.current,
          kind: 'commit',
          title: t('commit.title'),
          anchor: anchor,
          width: 460,
          onClose: closePopover,
        }, h(headerChangelists.mode === 'lists' ? ChangelistCommitPanel : CommitPanel, {
          changelists: headerChangelists, run: call, tracking: tracking, setAiNotice: setAiNotice,
          afterWrite: function () { refresh({ force: true }) },
          t: t,
          repo: repo,
          status: status,
          message: headerChangelists.mode === 'lists' ? headerChangelists.message : message,
          setMessage: headerChangelists.mode === 'lists' ? headerChangelists.setMessage : function (value) { messageLatestRef.current = value; setMessage(value) },
          busy: busy,
          aiBusy: aiBusy,
          busyMethod: busyMethod,
          aiNotice: aiNotice,
          onGenerate: generateMessage,
          onCommit: function () { commit('commit') },
          onCommitPush: function () { commit('push') },
          onCommitSync: function () { commit('sync') },
          syncAction: files.length === 0 && (nextAction.id === 'push' || nextAction.id === 'publish')
            ? { label: nextAction.id === 'push' ? t('action.sync') : nextAction.label, run: runNext }
            : null,
          onWrite: write,
          onOpenFull: function () {
            closePopover()
            setWindowState({ mode: 'full', tab: 'changes' })
          },
          requestConfirm: function (message, onConfirm, label) { if (!writeRef.current) setConfirmRequest({ message: message, onConfirm: onConfirm, label: label, opener: document.activeElement }) },
          onOpenFile: function (next) { closePopover(); setViewerPath(next) },
          onFileMenu: openFileMenu,
          prompt: function (spec) { setPromptRequest({ title: spec.title, fields: spec.fields, compact: spec.compact, submit: spec.onSubmit, awaitSubmit: true }) },
        }))
      : null,

    // Alternate sync forms are available from the chevron in every state.
    popover === 'sync'
      ? h(ChipPopover, {
          key: 'syncpop',
          opener: openerRef.current,
          kind: 'sync',
          title: t('next.more'),
          anchor: anchor,
          width: 340,
          onClose: closePopover,
        }, h('div', { className: 'dshgit-picker' }, [
          h('div', { key: 'list', className: 'dshgit-picklist' }, [
            h('button', {
              key: 'fetch', type: 'button', className: 'dshgit-pickrow',
              'data-sync': 'fetch',
              onClick: function () { closePopover(); write('fetch', { prune: true }) },
            }, t('sync.fetch')),
            h('div', { key: 'sep1', className: 'dshgit-menusep' }),
            h('button', {
              key: 'pullmerge', type: 'button', className: 'dshgit-pickrow',
              'data-sync': 'pull-merge',
              onClick: function () { closePopover(); write('pull', {}) },
            }, t('sync.pullMerge')),
            h('button', {
              key: 'pullrebase', type: 'button', className: 'dshgit-pickrow',
              'data-sync': 'pull-rebase',
              onClick: function () { closePopover(); write('pull', { rebase: true }) },
            }, t('sync.pullRebase')),
            h('div', { key: 'sep2', className: 'dshgit-menusep' }),
            h('button', {
              key: 'pushlease', type: 'button', className: 'dshgit-pickrow dshgit-pickdanger',
              'data-sync': 'push-lease',
              onClick: function () { closePopover(); write('push', { forceWithLease: true }) },
            }, t('sync.pushLease')),
          ]),
        ]))
      : null,

    // The in-progress operation, with its way out. This is a panel rather than
    // a popover on purpose: a popover closes on the first outside click, and
    // the way out of a conflicted merge must not vanish while the user reads
    // the conflicted files.
    operation !== null && opOpen
      ? h(OperationPanel, {
          key: 'oppanel',
          t: t,
          operation: operation,
          busy: busy,
          onContinue: function () {
            if (writeRef.current) return
            var epoch = contextEpochRef.current, generation = operationReviewContextRef.current.generation
            var request = ++operationReviewContextRef.current.request
            var active = function () {
              var current = operationReviewContextRef.current
              return current.mounted && contextEpochRef.current === epoch && current.generation === generation && current.request === request
            }
            call('operationReview', { root: repo.root }).then(function (review) {
              if (!active()) return
              if (review.operation?.kind !== operation.kind) throw new Error(t('conflict.operationChanged'))
              if (review.conflicts) throw new Error(t('conflict.resolveRemaining'))
              setConfirmRequest({ title: t('conflict.continue', { kind: t('op.' + operation.kind) }), danger: false, message: operationReviewText(t, review), label: t('conflict.confirmContinue'), onConfirm: function () { if (!active()) return; setConfirmRequest(null); write('continueOperation', { kind: operation.kind, reviewHash: review.hash }) } })
            }).catch(function (failure) { if (active()) setNotice({ id: Date.now(), tone: 'error', summary: failure.message }) })
          },
          onAbort: function () {
            var label = t(operation.kind === 'cherry-pick' ? 'op.cherry-pick' : 'op.' + operation.kind)
            setConfirmRequest({
              message: t('confirm.abortOp', { kind: label }),
              label: t('action.abortOp'),
              onConfirm: function () {
                setConfirmRequest(null)
                setOpOpen(false)
                write('abortOperation', { kind: operation.kind }, { confirm: true })
              },
            })
          },
          onClose: function () { setOpOpen(false) },
        })
      : null,

    // The merge-or-rebase question, asked only when a fast-forward pull
    // refused. Guessing here is what creates surprise merge commits.
    pullChoice
      ? h(ChoiceDialog, {
          key: 'pullchoice',
          opener: openerRef.current,
          title: t('confirm.pullDiverged'),
          t: t,
          choices: [
            {
              label: t('action.pullMerge'),
              // The hints must say what each choice DOES to history: that is
              // the entire reason the question is being asked. Repeating the
              // dialog title here would waste the one place that can explain
              // the difference.
              hint: t('choice.mergeHint'),
              run: function () { setPullChoice(false); write('pull', {}) },
            },
            {
              label: t('action.pullRebase'),
              hint: t('choice.rebaseHint'),
              run: function () { setPullChoice(false); write('pull', { rebase: true }) },
            },
          ],
          onClose: function () { setPullChoice(false) },
        })
      : null,
    mergeSource !== null && branchName !== null
      ? h(MergeReviewDialog, {
          key: 'merge-review', t: t,
          opener: openerRef.current,
          source: mergeSource, target: branchName,
          preview: mergePreview, error: mergeError,
          fetching: mergeFetchState[0], remote: /^refs\/remotes\//.test(mergeTarget || ''),
          onFetch: function () {
            if (writeRef.current || mergeFetchState[0] || !/^refs\/remotes\//.test(mergeTarget || '')) return
            var target = mergeTarget, request = ++mergeReviewRequestRef.current, epoch = contextEpochRef.current
            var active = function () { return request === mergeReviewRequestRef.current && epoch === contextEpochRef.current }
            var record = (refs?.remotes || []).find(function (branch) { return branch.ref === target })
            var remoteName = record?.remoteName || target.slice(13).split('/')[0]
            setMergeFetchState(true); setMergePreview(null); setMergeError(null)
            write('fetch', { remote: remoteName, branch: target.slice(14 + remoteName.length) }, { propagate: true }).then(function (result) {
              if (!active()) return
              if (!result || result.ok === false) throw new Error(result?.message || t('action.failed'))
              mergeRetryState[1](function (value) { return value + 1 })
            }).catch(function (failure) { if (active()) setMergeError(failure.message) })
              .finally(function () { if (active()) setMergeFetchState(false) })
          },
          onRetry: function () { mergeRetryState[1](function (value) { return value + 1 }) },
          dirty: files.length, busy: busy,
          onClose: function () { setMergeSource(null) },
          onChanges: function () {
            setMergeSource(null)
            closePopover()
            setWindowState({ mode: 'full', tab: 'changes', minimized: false, sessionId: props.sessionId })
          },
          onStash: function () { write('stashPush', { includeUntracked: true }) },
          onMerge: function () {
            if (files.length > 0 || mergePreview === null || mergePreview.incoming.length === 0) return
            var source = mergeTarget || mergeSource
            setMergeSource(null)
            write('merge', { ref: source })
          },
        })
      : null,
    // The file viewer. Portalled to the body so it escapes the header's own
    // stacking/clipping context, and rendered OUTSIDE the popover so it
    // survives the popover closing.
    viewerPath !== null && repo !== null
      ? h(FileViewer, {
          key: 'viewer',
          renderConflict: function (path) { return h(ConflictEditor, { key: repo.root + ':' + path, repo: repo, path: path, t: t, run: call, onChanged: function () { refresh({ force: true }) }, onOpenConflict: function (file) { setViewerPath(file.path) } }) },
          connection: props.connection,
          repo: repo,
          path: viewerPath,
          onChanged: function () { refresh({ force: true }) },
          // The viewer needs the file's kind to pick a sensible first view:
          // an untracked file has no patch, so it opens as its contents.
          kind: (function () {
            for (var vi = 0; vi < files.length; vi++) if (files[vi].path === viewerPath) return files[vi].kind
            return null
          })(),
          staged: (function () {
            for (var si = 0; si < files.length; si++) if (files[si].path === viewerPath) return files[si].staged === true
            return false
          })(),
          files: files.map(function (file) { return file.path }),
          revision: status, blockedByDialog: confirmRequest !== null || remoteRequest[0] !== null || promptRequest !== null,
          sidebar: h(headerChangelists.mode === 'lists' ? ChangelistCommitPanel : CommitPanel, {
            changelists: headerChangelists, run: call, tracking: tracking, setAiNotice: setAiNotice,
            afterWrite: function () { refresh({ force: true }) }, t: t, repo: repo, status: status,
            selectedPath: viewerPath,
            message: headerChangelists.mode === 'lists' ? headerChangelists.message : message,
            setMessage: headerChangelists.mode === 'lists' ? headerChangelists.setMessage : function (value) { messageLatestRef.current = value; setMessage(value) },
            busy: busy, aiBusy: aiBusy, busyMethod: busyMethod, aiNotice: aiNotice, onGenerate: generateMessage,
            onCommit: function () { commit('commit') }, onCommitPush: function () { commit('push') },
            onCommitSync: function () { commit('sync') }, syncAction: null, onWrite: write,
            onOpenFile: function (next) { setViewerPath(next) },
            onOpenFull: function () { setViewerPath(null); setWindowState({ mode: 'full', tab: 'changes', minimized: false, sessionId: props.sessionId }) },
            requestConfirm: function (text, confirm, label) { if (!writeRef.current) setConfirmRequest({ message: text, onConfirm: confirm, label: label, opener: document.activeElement }) },
            onFileMenu: openFileMenu,
            prompt: function (spec) { setPromptRequest({ title: spec.title, fields: spec.fields, compact: spec.compact, submit: spec.onSubmit, awaitSubmit: true }) },
          }),
          t: t,
          onNavigate: function (next) { setViewerPath(next) },
          onClose: function () { setViewerPath(null) },
          onStage: function (target) { write('stage', { paths: [target] }) },
        })
      : null,

    headerJob[0]?.state === 'running' && notice === null ? h(OperationProgress, { key: 'progress', job: headerJob[0], t: t, onCancel: function () { call('operationCancel', { root: headerJob[0].root, id: headerJob[0].id }).catch(function (failure) { fail(failure.message) }) } }) : null,

    notice !== null
      ? h(ChipNotice, {
          key: 'notice',
          outcome: notice,
          detailsOpen: noticeOpen,
          t: t,
          onDismiss: function () { setNotice(null); setNoticeOpen(false) },
          onDetails: function () { setNoticeOpen(!noticeOpen) },
          // The banner's own fix button. `pull`/`publish`/`reconcile` are the
          // three the classifier can offer, and each maps to something the
          // chips already know how to do.
          onAction: function (action) {
            setNotice(null)
            setNoticeOpen(false)
            if (action.id === 'pull') { write('pull', { ffOnly: true }, { onReject: 'diverged' }); return }
            if (action.id === 'publish') { write('push', { setUpstream: true }); return }
            if (action.id === 'auth') { closePopover(); setWindowState({ mode: 'full', tab: 'settings', minimized: false, sessionId: props.sessionId }); return }
            if (action.id === 'reconcile') { setPullChoice(true) }
          },
        })
      : null,

    confirmRequest !== null
      ? h(ConfirmBar, {
          key: 'confirm', centered: true,
          opener: confirmRequest.opener || openerRef.current,
          t: t,
          request: Object.assign({}, confirmRequest, { onConfirm: function (option) { var action = confirmRequest.onConfirm; setConfirmRequest(null); action(option) } }),
          onCancel: function () { setConfirmRequest(null) },
        })
      : null,

    promptRequest !== null
      ? h(PromptDialog, {
          key: 'prompt',
          zIndex: 1600,
          opener: openerRef.current,
          spec: promptRequest,
          t: t,
          onClose: function () { setPromptRequest(null) },
        })
      : null,
    // Rendered outside the popover so the menu survives the popover it was
    // opened from: choosing "view changes" closes the popover AND opens the
    // viewer, and a menu owned by the popover would vanish mid-choice.
    h(FileContextMenu, { key: 'filemenu', menu: fileMenuRequest, onClose: function () { setFileMenuRequest(null) } }),
    headerWorkbenchState[0] && repo ? h(WorkbenchDialog, {
      key: headerWorkbenchState[0].id, request: headerWorkbenchState[0], repo: repo, status: status, refs: refs, run: call, t: t,
      execute: function (payload) { return write('workbenchAction', payload, { confirm: true, propagate: true }) },
      onClose: function () { if (!writeRef.current) headerWorkbenchState[1](null) },
    }) : null,
    remoteRequest[0] && repo ? h(RemoteConfigDialog, {
      key: repo.root + ':' + remoteRequest[0].id, repo: repo, run: call, t: t, initialPush: remoteRequest[0].push, branch: remoteRequest[0].branch,
      onWrite: function (method, payload) { return write(method, payload, { propagate: true }) },
      onSaved: function () { refresh({ force: true }); setWindowState({ refreshToken: getWindowState().refreshToken + 1 }) },
      onClose: function () { remoteRequest[1](null) },
    }) : null,
  ])
}

export { GitStatusChips }

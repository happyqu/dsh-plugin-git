import { navigate, requestNavigation } from '../core/navigation.js'
import { externalEditorItem } from '../core/external.js'
import { Fragment, React, h } from '../core/runtime.js'
import { callRpc, mergeRpcFailures, startOperationCompatible, withExplicitSession } from '../core/rpc.js'
import { useChangelists } from '../features/changes/model.js'
import { getWindowState, publishPluginConfig, setWindowState } from '../core/state.js'
import { readWorkbenchStorage, writeWorkbenchStorage, readPreviewMode, writePreviewMode } from '../core/preferences.js'
import { readRepositorySnapshot, stableRepositoryStatus, useRepositoryUpdates } from '../core/repository.js'
import { baseName, dirName, isImagePath, isStaged, isUnstaged } from '../core/files.js'
import { readAnnotatedPreview } from '../preview/code.js'
import { workbenchUpstream } from '../features/branches/model.js'
import { workbenchBranchItems, workbenchCommitItems } from '../features/branches/actions.js'
import { setDiscardTarget } from '../features/changes/actions.js'
import { IconBranchSync, IconClose, IconGit, IconMore, IconRefresh, svg } from '../ui/icons.js'
import { ComboBox, FileContextMenu } from '../ui/controls.js'
import { ActivityBar, StatusBar, moduleById } from './navigation.js'
import { SettingsNav, SettingsTab } from '../features/settings/view.js'
import { StashDetails, StashesSidebar } from '../features/stashes/view.js'
import { CompareSidebar, CompareTab } from '../features/compare/view.js'
import { OutputList, OutputSidebar } from '../features/output/view.js'
import { WorkbenchBranchSidebar, WorkbenchGraph, WorkbenchRecovery } from '../features/branches/view.js'
import { HistorySidebar } from '../features/history/list.js'
import { HistoryCommitDetails } from '../features/history/details.js'
import { ChangelistModeToolbar, ChangelistPane, LeftPane } from '../features/changes/view.js'
import { CenterPane } from './content.js'
import { PaneResizeHandle } from '../ui/resize.js'
import { CommitComposer, CommitFormContainer } from '../features/changes/commit.js'
import { ChipNotice, OperationProgress, Toast } from '../ui/notifications.js'
import { ConfirmBar, PromptDialog, RemoteConfigDialog } from '../ui/dialogs.js'
import { RewriteDialog, WorkbenchDialog } from '../features/branches/dialogs.js'

function GitApp(props) {
  var connection = props.connection
  var t = props.t

  var tabState = React.useState(props.focusTab === undefined ? 'changes' : props.focusTab)
  var tab = tabState[0]
  var setTab = React.useCallback(function (next) { navigate(function () { tabState[1](next) }) }, [])
  var historyPathState = React.useState(props.focusPath || '')
  var historyPath = historyPathState[0]
  var setHistoryPath = historyPathState[1]
  var contextState = React.useState(null)
  var contextMenu = contextState[0]
  var setContextMenu = contextState[1]

  // The settings module's sub-navigation, lifted here so the sidebar (which
  // renders the nav) and the editor (which renders the section) share it.
  var settingsSectionState = React.useState('general')
  var settingsSection = settingsSectionState[0]
  var setSettingsSection = settingsSectionState[1]

  // The output module's command log is fetched once by GitApp rather than by
  // the view, because the sidebar shows the count and the editor shows the
  // rows — two components that would otherwise fetch the same list twice.
  var outputEntriesState = React.useState(null)
  var outputEntries = outputEntriesState[0]
  var setOutputEntries = outputEntriesState[1]
  var outputFilterState = React.useState('all')
  var outputFilter = outputFilterState[0]
  var setOutputFilter = outputFilterState[1]

  // The window can hand the panel a tab to focus (e.g. "show me the full
  // history") and a ref to preload into Compare.
  React.useEffect(
    function () {
      if (props.focusTab !== undefined && props.focusTab !== '') setTab(props.focusTab)
    },
    [props.focusTab],
  )
  React.useEffect(function () {
    if (props.focusPath) setHistoryPath(props.focusPath)
  }, [props.focusPath])

  var repoState = React.useState(null)
  var repo = repoState[0]
  var setRepo = repoState[1]
  var workbenchContextRef = React.useRef(null)
  workbenchContextRef.current = String(props.sessionId || '') + ':' + (repo?.root || '')
  var discoveryState = React.useState(true)
  var discovering = discoveryState[0]
  var setDiscovering = discoveryState[1]

  var reposState = React.useState([])
  var knownRepos = reposState[0]
  var setKnownRepos = reposState[1]

  var initState = React.useState(false)
  var canInitialize = initState[0]
  var setCanInitialize = initState[1]
  var directoryState = React.useState(null)
  var directory = directoryState[0]
  var setDirectory = directoryState[1]

  var gitPathState = React.useState(null)
  var gitPath = gitPathState[0]
  var setGitPath = gitPathState[1]

  // Whether git itself is missing, as opposed to "a repository read failed".
  // Conflating the two made a failed `git status` render the "git not found"
  // banner and hide the real message behind it.
  var gitMissingState = React.useState(false)
  var gitMissing = gitMissingState[0]
  var setGitMissing = gitMissingState[1]

  var statusState = React.useState(null)
  var status = statusState[0]
  var setStatus = statusState[1]

  var refsState = React.useState(null)
  var refs = refsState[0]
  var setRefs = refsState[1]

  var stashesState = React.useState(null)
  var stashes = stashesState[0]
  var setStashes = stashesState[1]
  var stashErrorState = React.useState(null)
  var stashError = stashErrorState[0]
  var setStashError = stashErrorState[1]
  var selectedStashState = React.useState(null)
  var selectedStashId = selectedStashState[0]
  var setSelectedStashId = selectedStashState[1]
  var stashRepoRef = React.useRef(null)
  var stashActionState = React.useState(null)
  var stashAction = stashActionState[0]
  var setStashAction = stashActionState[1]

  var worktreesState = React.useState([])
  var worktrees = worktreesState[0]
  var setWorktrees = worktreesState[1]

  // Configured remotes, which exist independently of fetched branches.
  var remotesState = React.useState([])
  var remoteList = remotesState[0]
  var setRemotes = remotesState[1]

  var contributorsState = React.useState([])
  var contributors = contributorsState[0]
  var setContributors = contributorsState[1]

  var trackingState = React.useState(null)
  var tracking = trackingState[0]
  var setTracking = trackingState[1]

  var metaState = React.useState(null)
  var repoMeta = metaState[0]
  var setRepoMeta = metaState[1]

  // Ref a "Compare with …" action asked the Compare tab to preload.
  var compareWithState = React.useState(props.compareWith || 'HEAD')
  var compareWith = compareWithState[0]
  var setCompareWith = compareWithState[1]
  var compareToState = React.useState('HEAD'), compareTo = compareToState[0]
  var compareRetry = React.useState(0), compareData = React.useState(null), compareError = React.useState(null)
  var compareHistory = React.useState(null), comparePath = React.useState(null)
  var compareReturn = React.useRef('graph')
  var openComparison = function (ref) {
    return navigate(function () {
      if (tab !== 'compare') compareReturn.current = tab
      setCompareWith(ref); compareToState[1]('HEAD'); setTab('compare')
    })
  }
  React.useEffect(function () {
    if (tab !== 'compare' || !repo || !compareWith) return
    var active = true
    var comparisonKey = JSON.stringify([repo.root, compareWith, compareTo, compareRetry[0]])
    compareData[1](null); compareError[1](null); compareHistory[1](null); comparePath[1](null)
    run('compareFiles', { root: repo.root, from: compareWith, to: compareTo }, { silentError: true })
      .then(function (value) {
        if (!active) return
        compareData[1](Object.assign({}, value, { requestKey: comparisonKey })); comparePath[1](value.files?.[0]?.path || null)
        run('compareCommits', { root: repo.root, left: value.from, right: value.to }, { silentError: true })
          .then(function (history) { if (active) compareHistory[1](history) })
          .catch(function (failure) { if (active) compareHistory[1]({ error: failure.message }) })
      }).catch(function (failure) { if (active) compareError[1](failure.message) })
    return function () { active = false }
  }, [tab, repo?.root, compareWith, compareTo, compareRetry[0]])

  var commitsState = React.useState([])
  var commits = commitsState[0]
  var setCommits = commitsState[1]
  var historyRefState = React.useState('HEAD')
  var historyRef = historyRefState[0]
  var setHistoryRef = historyRefState[1]
  var historyLimitState = React.useState(60)
  var historyLimit = historyLimitState[0]
  var setHistoryLimit = historyLimitState[1]
  var historyLoadingState = React.useState(false), historyErrorState = React.useState(null), historyRetryState = React.useState(0)

  var graphState = React.useState(null)
  var graph = graphState[0]
  var setGraph = graphState[1]
  var graphConfigState = React.useState({ scope: 'all', selected: '', showRemote: true, ordering: 'date', limit: 200, refresh: 0 })
  var graphConfig = graphConfigState[0], setGraphConfig = graphConfigState[1]
  var graphLoadingState = React.useState(false), graphErrorState = React.useState(null)
  var workbenchRequestState = React.useState(null), workbenchRequest = workbenchRequestState[0]
  // The reword/squash dialog. Its own state rather than a `workbenchRequest`
  // action, because it previews through a different method and its result is
  // "history moved", which the branch-workbench result handling would treat as
  // an unrelated action.
  var rewriteRequestState = React.useState(null)
  // Multi-select for rewriting unpushed commits. `null` means multi-select is
  // OFF, an array means it is on and holds the ticked SHAs — so "is the mode
  // active" and "what is ticked" cannot drift apart, and leaving the mode is
  // one assignment rather than two.
  var rewriteSelectionState = React.useState(null)
  var branchSyncState = React.useState(null)
  var recoveryState = React.useState([]), reflogOpenState = React.useState(false)

  var selectionState = React.useState(null)
  var selection = selectionState[0]
  var setSelection = React.useCallback(function (next) { if (typeof next === 'function') selectionState[1](next); else navigate(function () { selectionState[1](next) }) }, [])

  var diffState = React.useState(null)
  var diff = diffState[0]
  var setDiff = diffState[1]

  // Both sides of an image change, fetched only when the user is looking at
  // an image: the bytes are far too large to carry on every file selection.
  var imageDiffState = React.useState(null)
  var imageDiff = imageDiffState[0]
  var setImageDiff = imageDiffState[1]

  var commitState = React.useState(null)
  var commitDetail = commitState[0]
  var setCommitDetail = commitState[1]

  var fileState = React.useState(null)
  var fileView = fileState[0]
  var setFileView = fileState[1]
  var fileDisplayState = React.useState('diff')
  var fileDisplay = fileDisplayState[0]
  var setFileDisplay = fileDisplayState[1]
  var fileRequestRef = React.useRef(0)
  // Aborts the previous commit-browse read when another one starts. Kept as a
  // ref rather than derived from `fileRequestRef` because that counter also
  // guards working-tree file reads, and aborting those on a commit click would
  // cancel a fetch the user is still waiting for.
  var commitAbortRef = React.useRef(null)
  var filePreviewCache = React.useRef({ status: null, values: new Map() })
  var previewCacheEpoch = React.useRef(0), backgroundPreviewRef = React.useRef(false), statusReadEpoch = React.useRef(0)
  var stalePreview = React.useState(null)
  var revisionSideState = React.useState('after')
  var revisionSide = revisionSideState[0]
  var setRevisionSide = revisionSideState[1]
  var treeRefreshState = React.useState(0)
  var treeRefresh = treeRefreshState[0]
  var setTreeRefresh = treeRefreshState[1]

  var blameState = React.useState(null)
  var blameData = blameState[0]
  var setBlameData = blameState[1]

  var busyState = React.useState(0)
  var busy = busyState[0]
  var setBusy = busyState[1]
  var pendingWriteRef = React.useRef(false)
  var writeMethodState = React.useState(null)
  var writeMethod = writeMethodState[0]
  var setWriteMethod = writeMethodState[1]
  var backgroundJob = React.useState(null)

  var errorState = React.useState(null)
  var error = errorState[0]
  var setError = errorState[1]

  var toastState = React.useState(null)
  var toast = toastState[0]
  var setToast = toastState[1]

  var queryState = React.useState('')
  var query = queryState[0]
  var setQuery = queryState[1]

  var confirmState = React.useState(null)
  var confirmRequest = confirmState[0]
  var setConfirmRequest = confirmState[1]

  // A small text/form dialog: clone, new branch, new tag, add remote. Inline
  // rather than window.prompt because several of these need more than one
  // field, and a native prompt cannot be styled or validated.
  var promptState = React.useState(null)
  var promptRequest = promptState[0]
  var setPromptRequest = promptState[1]
  var remoteRequest = React.useState(null)
  React.useEffect(function () { remoteRequest[1](null) }, [repo?.root])

  var messageState = React.useState('')
  var commitMessage = messageState[0]
  var setCommitMessage = messageState[1]

  var aiState = React.useState(null)
  var aiNotice = aiState[0]
  var setAiNotice = aiState[1]

  var versionRef = React.useRef(0)

  /** Run an RPC call with busy tracking and uniform error surfacing. */
  var run = React.useCallback(
    function (method, payload, options) {
      var opts = options || {}
      versionRef.current += 1
      var token = versionRef.current
      if (opts.silent !== true) setBusy(function (n) { return n + 1 })
      // Like the chips, the panel states the session it is rendering rather
      // than reading it back from the store: the store is what this
      // component is rendered FROM, so trusting it is circular during the
      // render that follows a conversation switch.
      return callRpc(connection, method, withExplicitSession(payload, props.sessionId), opts.signal)
        .then(function (value) {
          if (opts.silent !== true) setBusy(function (n) { return Math.max(0, n - 1) })
          return value
        })
        .catch(function (failure) {
          if (opts.silent !== true) setBusy(function (n) { return Math.max(0, n - 1) })
          if (opts.silentError !== true) {
            setError(t('error.load', { message: failure.message }))
          }
          throw failure
        })
    },
    [connection, t, props.sessionId],
  )

  var changelistModel = useChangelists(repo, status, run)
  if (changelistModel.mode === 'lists') {
    commitMessage = changelistModel.message
    setCommitMessage = changelistModel.setMessage
  }

  /** Refresh repository discovery plus everything derived from the repo. */
  var refresh = React.useCallback(
    function (options) {
      var opts = options || {}
      // `session: true` means "resolve from the session again", i.e. do not
      // name the repository we already had. Without it, switching
      // conversations would keep re-requesting the previous session's root.
      var payload = repo === null || opts.session === true ? {} : { path: repo.root }
      return run('repos', Object.assign({}, payload, { force: opts.force === true }), { silentError: true })
        .then(function (result) {
          if (result.config) publishPluginConfig(result.config)
          setGitPath(result.gitPath || null)
          setGitMissing(false)
          setKnownRepos(result.repos || [])
          setCanInitialize(result.canInitialize === true)
          setDirectory(result.directory || null)
          var next = null
          if (repo !== null) {
            for (var i = 0; i < (result.repos || []).length; i++) {
              if (result.repos[i].root === repo.root) next = result.repos[i]
            }
          }
          if (next === null && (result.repos || []).length > 0) next = result.repos[0]
          setRepo(next)
          // The title bar lives on GitWindow, a different component with no
          // shared ancestor, so the resolved repository travels through the
          // window store — the same bridge that carries `sessionId` the
          // other way. Published here, where discovery answers, so every
          // mode and every re-resolve keeps it current.
          setWindowState({ workspace: next !== null ? next.root : (result.directory || '') })
          setDiscovering(false)
          if (next === null) return null
          return loadRepo(next, opts)
        })
        .catch(function (failure) {
          // `repos` failing means the Host could not resolve git at all;
          // that is a state with its own screen, not an error banner.
          setGitPath(null)
          setGitMissing(failure.code === 'git/not-found' || failure.code === 'git/invalid-path' || failure.code === 'git/git-not-found')
          setKnownRepos([])
          setCanInitialize(false)
          setDirectory(null)
          setRepo(null)
          setDiscovering(false)
          setError(failure.message)
          return null
        })
    },
    [run, repo],
  )
  var lastRefreshToken = React.useRef(props.refreshToken)
  React.useEffect(function () {
    if (props.active === false) return
    if (props.refreshToken === lastRefreshToken.current) return
    lastRefreshToken.current = props.refreshToken
    if (repo === null) refresh({ force: true })
    else {
      // A completed operation reloads the opened repository, not the
      // conversation directory, which may not be a Git repository.
      loadRepo(repo, { force: true })
      setGraphConfig(function (value) { return Object.assign({}, value, { refresh: value.refresh + 1 }) })
      historyRetryState[1](function (value) { return value + 1 })
    }
  }, [props.refreshToken, props.active])

  /** Load status, refs, stashes and worktrees for one repository. */
  var loadRepo = React.useCallback(
    function (target, options) {
      var opts = options || {}
      var root = target.root
      var statusEpoch = ++statusReadEpoch.current
      var storedRecovery = readWorkbenchStorage('recovery:' + root, null)
      if (Array.isArray(storedRecovery)) recoveryState[1](storedRecovery)
      if (stashRepoRef.current !== root) {
        pendingWriteRef.current = false; setWriteMethod(null)
        setToast(null); setContextMenu(null)
        workbenchRequestState[1](null); branchSyncState[1](null); reflogOpenState[1](false); setGraph(null)
        // Rewrite ticks are SHAs from the repository being left, so they are
        // meaningless in the next one.
        rewriteRequestState[1](null); rewriteSelectionState[1](null)
        setGraphConfig({ scope: 'all', selected: '', showRemote: true, ordering: 'date', limit: 200, refresh: 0 })
        recoveryState[1](readWorkbenchStorage('recovery:' + root, []))
        fileRequestRef.current++; setSelection(null); setCommitDetail(null); setDiff(null); setCommits([])
        stashRepoRef.current = root; setStashes(null); setStashError(null); setSelectedStashId(null)
      }
      // A failed status is reported and then swallowed: it must not reject
      // the `repos` promise chain, or a broken repository would render as
      // "git is not installed" — the wrong screen entirely.
      var statusStep = readRepositorySnapshot(root, function (method, payload) {
        return run(method, payload, { silent: method !== 'status' || opts.background === true, silentError: method !== 'status' })
      }, { force: opts.force === true, metadata: true })
        .then(function (snapshot) {
          if (stashRepoRef.current !== root) return null
          if (statusReadEpoch.current === statusEpoch) { setStatus(snapshot.status); setTracking(snapshot.tracking) }
          return Promise.all([
            Promise.resolve(snapshot.refs),
            run('stashes', { root: root }, { silent: true, silentError: true }).then(function (value) {
              if (stashRepoRef.current === root) setStashError(null); return value
            }).catch(function (failure) { if (stashRepoRef.current === root) setStashError(failure.message); return null }),
            run('worktrees', { root: root }, { silent: true, silentError: true }).catch(function () { return [] }),
            run('remotes', { root: root }, { silent: true, silentError: true }).catch(function (failure) {
              setError(failure.code === 'git/unknown-method'
                ? t('error.hostOutdated')
                : t('error.remoteLoad', { message: failure.message }))
              return []
            }),
          ])
        })
        .then(function (loaded) {
          if (!loaded || stashRepoRef.current !== root) return
          if (statusReadEpoch.current === statusEpoch) setRefs(function (previous) { return JSON.stringify(previous) === JSON.stringify(loaded[0]) ? previous : loaded[0] })
          if (stashRepoRef.current === root) setStashes(loaded[1])
          setWorktrees(loaded[2] || [])
          setRemotes(loaded[3] || [])
          // These are informational: a failure degrades the header,
          // never the panel.
          if (opts.lightweight === true) return
          run('repoMeta', { root: root }, { silent: true, silentError: true })
            .then(function (value) { if (stashRepoRef.current === root) setRepoMeta(value) }).catch(function () { if (stashRepoRef.current === root) setRepoMeta(null) })
          run('contributors', { root: root, limit: 50 }, { silent: true, silentError: true })
            .then(function (value) { if (stashRepoRef.current === root) setContributors(value) }).catch(function () { if (stashRepoRef.current === root) setContributors([]) })
        })
        .catch(function (failure) {
          if (stashRepoRef.current !== root) return
          setError(t('error.load', { message: failure.message }))
        })
      return statusStep
    },
    [run, t],
  )

  var autoFetchStatus = useRepositoryUpdates(repo?.root, props.active !== false, function (method, payload) {
    return run(method, payload, { silent: true, silentError: true })
  }, busy > 0 || pendingWriteRef.current, function (snapshot) {
    statusReadEpoch.current++
    var nextStatus = stableRepositoryStatus(status, snapshot.status)
    setStatus(nextStatus)
    var filesChanged = !status || nextStatus.files.length !== status.files.length || nextStatus.files.some(function (file, index) { return file !== status.files[index] })
    // Invalidate mutable previews independently of status/line-count equality.
    if (snapshot.versionChanged || snapshot.previewChanged || filesChanged) {
      previewCacheEpoch.current++; filePreviewCache.current.values.clear()
      if (selection?.kind === 'file' && (snapshot.previewChanged || filesChanged)) {
        backgroundPreviewRef.current = true
        stalePreview[1]({ root: repo.root, path: selection.path })
      }
    }
    if (snapshot.refs) setRefs(function (previous) { return JSON.stringify(previous) === JSON.stringify(snapshot.refs) ? previous : snapshot.refs })
    if (snapshot.tracking) setTracking(function (previous) { return JSON.stringify(previous) === JSON.stringify(snapshot.tracking) ? previous : snapshot.tracking })
  }, selection?.kind === 'file' ? selection.path : null)

  // Resume from retained UI immediately; only older data needs a background read.
  React.useEffect(function () {
    if (props.active === false) setContextMenu(null)
  }, [props.active])

  // First load.
  React.useEffect(
    function () {
      refresh({ force: true })
    },
    [],
  )

  // Follow the session the window is showing.
  //
  // Switching conversations does not remount this component — the overlay
  // renders one persistent window — so without this the panel would keep
  // displaying the previous session's repository, which is worse than
  // opening the wrong one: the header would say one thing and the file list
  // another. The repository is dropped first so discovery re-resolves from
  // the session (no `root`) rather than from the stale one.
  var lastSessionRef = React.useRef(props.sessionId)
  React.useEffect(
    function () {
      if (props.sessionId === undefined) return
      if (lastSessionRef.current === props.sessionId) return
      lastSessionRef.current = props.sessionId
      setRepo(null)
      setStatus(null)
      setSelection(null)
      setDiff(null)
      setError(null)
      refresh({ force: true, session: true })
    },
    [props.sessionId],
  )

  /** Load commit history for the current search box. */
  React.useEffect(
    function () {
      if (repo === null) return
      if (tab !== 'history' && tab !== 'compare') return
      var active = true
      historyLoadingState[1](true); historyErrorState[1](null)
      var payload = { root: repo.root, limit: historyLimit, ref: historyRef }
      if (query.trim() !== '') payload.grep = query.trim()
      if (historyPath !== '') payload.path = historyPath
      run('commits', payload, { silent: true, silentError: true })
        .then(function (value) { if (active) setCommits(value.commits || []) })
        .catch(function (failure) { if (active) { setCommits([]); historyErrorState[1](failure.message) } })
        .finally(function () { if (active) historyLoadingState[1](false) })
      return function () { active = false }
    },
    [tab, repo, refs, query, historyPath, historyRef, historyLimit, historyRetryState[0]],
  )

  /** Load the commit graph when its tab is visible. */
  React.useEffect(
    function () {
      if (repo === null || tab !== 'graph') return
      var active = true, target = graphConfig.scope === 'current' ? 'HEAD' : graphConfig.selected
      graphLoadingState[1](true); graphErrorState[1](null)
      run('commitGraph', { root: repo.root, limit: graphConfig.limit, all: graphConfig.scope === 'all',
        refs: graphConfig.scope !== 'all' && target ? [target] : undefined,
        showRemote: graphConfig.showRemote, ordering: graphConfig.ordering }, { silent: true, silentError: true })
        .then(function (value) {
          if (!active) return
          setGraph(value)
          setSelection(function (previous) {
            return previous?.kind === 'commit' && !(value.rows || []).some(function (row) { return row.sha === previous.sha }) ? null : previous
          })
        }).catch(function (failure) { if (active) graphErrorState[1](failure.message) })
        .finally(function () { if (active) graphLoadingState[1](false) })
      return function () { active = false }
    },
    [tab, repo, graphConfig, refs],
  )

  /**
   * Load the command log for the output module.
   *
   * Fetched here rather than in the view because the sidebar and the editor
   * both read it — the sidebar counts the entries, the editor lists them —
   * and two components fetching the same list would double every request.
   */
  var loadOutput = React.useCallback(
    function () {
      return run('gitOutput', { root: repo?.root, limit: 200 }, { silentError: true })
        .then(function (value) { setOutputEntries(value.entries || []) })
        .catch(function (failure) { setOutputEntries(mergeRpcFailures([], repo?.root)); setError(t('error.load', { message: failure.message })) })
    },
    [run, repo?.root],
  )
  React.useEffect(
    function () {
      if (tab !== 'output') return
      loadOutput()
    },
    [tab, loadOutput],
  )

  /** Empty the Host's command log and the local copy together. */
  var clearOutput = React.useCallback(
    function () {
      run('clearGitOutput', { root: repo?.root }, { silentError: true })
        .then(function () { setOutputEntries([]) })
        .catch(function (failure) { setError(t('error.action', { message: failure.message })) })
    },
    [run, repo?.root],
  )

  // Each group previews its own side of the index/worktree boundary.
  var openChangedFile = React.useCallback(
    function (file, display, section, quiet) {
      if (!quiet && !requestNavigation(function () { openChangedFile(file, display, section, quiet) })) return
      if (repo === null) return
      if (!display) display = readPreviewMode(repo.root, file.path, 'diff')
      if (display === 'diff' || display === 'content') writePreviewMode(repo.root, file.path, display)
      backgroundPreviewRef.current = false
      var cacheEpoch = previewCacheEpoch.current
      var samePreview = selection?.kind === 'file' && selection.path === file.path && (display === 'head' || display === 'content' || file.kind === 'untracked' ? 'content' : 'diff') === fileDisplay
      quiet = quiet || samePreview
      if (!quiet) stalePreview[1](null)
      section = section || (isUnstaged(file) ? 'unstaged' : 'staged')
      setSelection({ kind: 'file', path: file.path, file: file, section: section, conflict: file.kind === 'unmerged' || (quiet && selection?.path === file.path && selection?.conflict === true),
        rev: display === 'head' ? 'HEAD' : null })
      setFileDisplay(display === 'head' || display === 'content' || file.kind === 'untracked' ? 'content' : 'diff')
      setCommitDetail(null)
      if (!quiet) { setFileView(null); setDiff(null); setBlameData(null); setImageDiff(null) }
      var requestId = ++fileRequestRef.current
      if (file.kind === 'unmerged') return
      if (filePreviewCache.current.status !== status) filePreviewCache.current = { status: status, values: new Map() }
      var cache = filePreviewCache.current.values
      var contentMode = display === 'head' || display === 'content' || file.kind === 'untracked'
      var cacheKey = JSON.stringify([repo.root, file.path, section, display === 'head' ? 'HEAD' : null, contentMode])
      if (!quiet && cache.has(cacheKey)) {
        var cached = cache.get(cacheKey)
        cache.delete(cacheKey); cache.set(cacheKey, cached)
        if (contentMode) setFileView(cached); else setDiff(cached)
        return
      }
      var remember = function (value) {
        // Bound both entry count and text size; huge previews are not retained.
        // Image payloads are skipped entirely: one data URL can be megabytes,
        // and four of them in a 4-entry cache is a memory leak.
        if (fileRequestRef.current !== requestId || previewCacheEpoch.current !== cacheEpoch) return
        stalePreview[1](null)
        if (typeof value.image === 'string') return
        var weight = (value.text || '').length
        ;(value.changeHunks || []).forEach(function (hunk) { (hunk.lines || []).forEach(function (line) { weight += line.length }) })
        if (weight > 500000) return
        if (cache.size >= 4) cache.delete(cache.keys().next().value)
        cache.set(cacheKey, value)
      }
      var payload = { root: repo.root, path: file.path, staged: section === 'staged' }
      if (display !== 'head' && display !== 'content' && file.kind !== 'untracked') run(section === 'working' ? 'changelistDiff' : 'diff', section === 'working' ? { root: repo.root, paths: [file.path] } : payload, { silent: quiet === true, silentError: true })
        .then(function (value) { if (fileRequestRef.current === requestId) { remember(value); setDiff(value) } })
        .catch(function (failure) { if (fileRequestRef.current === requestId) { if (!quiet) setDiff({ text: '', files: [], hunks: [] }); setError(failure.message) } })
      // An image is the one case the text diff cannot show, because git
      // reports it as "Binary files differ". Fetch both sides as pixels,
      // using the same coordinates the text diff uses: staged compares
      // HEAD→INDEX, unstaged compares INDEX→working tree. Only fetched when
      // the diff is what will be rendered — the content view already shows
      // the pixels through `fileContent`.
      if (display !== 'head' && display !== 'content' && file.kind !== 'untracked' && file.kind !== 'unmerged' && isImagePath(file.path)) {
        var imagePayload = { root: repo.root, path: file.path, originalPath: file.originalPath,
          from: section === 'staged' ? 'HEAD' : 'INDEX',
          to: section === 'staged' ? 'INDEX' : undefined }
        run('imageDiff', imagePayload, { silent: true, silentError: true })
          .then(function (value) { if (fileRequestRef.current === requestId) setImageDiff(value?.image === true ? value : null) })
          .catch(function () { if (fileRequestRef.current === requestId) setImageDiff(null) })
      }
      if (display === 'head' || display === 'content' || file.kind === 'untracked') readAnnotatedPreview(run('fileContent', { root: repo.root, path: file.path,
        rev: display === 'head' ? 'HEAD' : section === 'staged' ? 'INDEX' : undefined }, { silent: quiet === true, silentError: true }), display === 'head' || file.kind === 'untracked' || isImagePath(file.path) ? null : function () {
          return run(section === 'working' ? 'changelistDiff' : 'diff', section === 'working' ? { root: repo.root, paths: [file.path] } : payload, { silent: true, silentError: true })
        }, file.path, file.kind === 'untracked')
        .then(function (value) { if (fileRequestRef.current === requestId) { remember(value); setFileView(value) } })
        .catch(function (failure) { if (fileRequestRef.current === requestId) { if (!quiet) setFileView({ exists: false }); setError(failure.message) } })
    },
    [repo, run, status, selection, fileDisplay],
  )

  // Preserve the selected file across staging, discarding and refreshes.
  React.useEffect(function () {
    if (repo === null || status === null || tab !== 'changes') return
    if (backgroundPreviewRef.current && selection?.kind === 'file') return
    var files = status.files || []
    var current = selection && selection.kind === 'file' && files.find(function (file) { return file.path === selection.path })
    if (selection?.conflict) return
    if (!current) {
      var next = files.find(isUnstaged) || files[0]
      if (next) openChangedFile(next, 'diff')
      else if (selection !== null) {
        fileRequestRef.current++
        setSelection(null); setDiff(null); setFileView(null); setBlameData(null)
      }
      return
    }
    var section = selection.section === 'working' && changelistModel.mode === 'lists' ? 'working'
      : selection.section === 'staged' && isStaged(current) ? 'staged'
      : selection.section === 'unstaged' && isUnstaged(current) ? 'unstaged'
      : isUnstaged(current) ? 'unstaged' : 'staged'
    if (current !== selection.file || section !== selection.section) {
      openChangedFile(current, selection.rev === 'HEAD' ? 'head' : fileDisplay, section, section === selection.section && current.kind === selection.file?.kind)
    }
  }, [repo, status, selection, tab, fileDisplay, openChangedFile])

  /** Open a commit: metadata plus its full diff. */
  var openCommit = React.useCallback(
    function (sha) {
      return navigate(function () {
        if (repo === null || typeof sha !== 'string') return
        setSelection({ kind: 'commit', sha: sha })
        setDiff(null)
        setCommitDetail(null)
        var requestId = ++fileRequestRef.current
        // Supersede any commit read already running: its result is about to be
        // irrelevant, and leaving it alive made rapid clicking queue up `git
        // show` processes that each new click then waited behind.
        if (commitAbortRef.current !== null) commitAbortRef.current.abort()
        if (tab === 'history' || tab === 'graph') return
        var controller = new AbortController()
        commitAbortRef.current = controller
        // Both are reads, so `silent`: browsing commits must not disable the
        // write controls or spin the status bar.
        run('commit', { root: repo.root, sha: sha },
          { silent: true, silentError: true, signal: controller.signal })
          .then(function (value) { if (fileRequestRef.current === requestId) setCommitDetail(value) })
          .catch(function () { if (fileRequestRef.current === requestId) setCommitDetail(null) })
        run('diff', { root: repo.root, commit: sha, from: sha + '^', to: sha },
          { silent: true, silentError: true, signal: controller.signal })
          .then(function (value) { if (fileRequestRef.current === requestId) setDiff(value) })
          .catch(function () { if (fileRequestRef.current === requestId) setDiff({ text: '', files: [], hunks: [] }) })
      })
    },
    [repo, run, tab],
  )

  var openRevisionFile = React.useCallback(function (sha, path, oldPath) {
    return navigate(function () {
      if (repo === null) return
      var requestId = ++fileRequestRef.current
      setSelection({ kind: 'revisionFile', sha: sha, path: path, oldPath: oldPath || path })
      setTab('history')
      setFileDisplay('diff')
      setRevisionSide('after')
      setFileView(null)
      setDiff(null)
      setImageDiff(null)
      // A commit's image change is shown as the two versions side by side,
      // which is the only readable form of "Binary files differ".
      run('imageDiff', { root: repo.root, path: path, originalPath: oldPath, from: sha + '^', to: sha }, { silent: true, silentError: true })
        .then(function (value) { if (fileRequestRef.current === requestId) setImageDiff(value?.image === true ? value : null) })
        .catch(function () { if (fileRequestRef.current === requestId) setImageDiff(null) })
    })
  }, [repo, run])

  var viewRevisionSide = function (side) {
    if (repo === null || selection === null || selection.kind !== 'revisionFile') return
    var requestId = ++fileRequestRef.current
    setRevisionSide(side)
    setFileDisplay('content')
    setFileView(null)
    run('fileContent', {
      root: repo.root,
      path: side === 'before' ? selection.oldPath : selection.path,
      rev: selection.sha + (side === 'before' ? '^' : ''),
    }, { silentError: true })
      .then(function (value) { if (fileRequestRef.current === requestId) setFileView(value) })
      .catch(function () { if (fileRequestRef.current === requestId) setFileView({ exists: false }) })
  }

  var openStash = React.useCallback(function (stash) {
    return navigate(function () {
      setSelectedStashId(stash.sha || stash.ref)
      setTab('stashes')
    })
  }, [])
  React.useEffect(function () {
    if (tab !== 'stashes' || stashes === null) return
    if (!stashes.some(function (stash) { return (stash.sha || stash.ref) === selectedStashId })) {
      setSelectedStashId(stashes.length > 0 ? stashes[0].sha || stashes[0].ref : null)
    }
  }, [tab, stashes, selectedStashId])

  var showRefHistory = function (refName) {
    return navigate(function () {
      fileRequestRef.current++
      setHistoryRef(refName || 'HEAD')
      setHistoryPath('')
      setHistoryLimit(60)
      setQuery('')
      setSelection(null)
      setCommitDetail(null); setDiff(null); setFileView(null)
      setTab('history')
    })
  }

  /**
   * Clone into a directory, then discover the new repository.
   *
   * Lives here rather than in the sidebar because it changes WHICH
   * repositories exist — the same registry `refresh()` reads — and the
   * sidebar should not own registry mutations.
   */
  var cloneRepo = React.useCallback(
    function (payload) {
      runWithProgress('clone', payload)
        .then(function (value) {
          setToast({ seq: Date.now(), text: value.message || t('action.clone') })
          refresh({ force: true })
        })
        .catch(function (failure) {
          setError(t('error.action', { message: failure.message }))
        })
    },
    [run, refresh, t],
  )

  /** Perform a write, asking for confirmation when the Host requires it. */
  var performWrite = React.useCallback(
    function (method, payload, options) {
      var opts = options || {}
      var body = Object.assign({}, payload)
      if (repo !== null) body.root = repo.root
      if (pendingWriteRef.current) return Promise.resolve(null)
      if (method === 'push' && !body.remote && !body.tags && body.forceWithLease !== true && !status?.branch?.upstream) body.setUpstream = true
      if (method === 'push' && body.setUpstream === true && !body.remote) {
        if (remoteList.length === 0) { remoteRequest[1]({ id: Date.now(), push: true, branch: body.sourceBranch || body.branch || status?.branch?.head }); return Promise.resolve(null) }
        if (remoteList.length > 1) {
          setPromptRequest({ title: t('publish.remote'),
            fields: [{ key: 'remote', label: t('label.remote'), options: remoteList.map(function (remote) { return { value: remote.name, label: remote.name } }) }],
            submit: function (values) { performWrite(method, Object.assign({}, body, { remote: values.remote, branch: status?.branch?.head }), opts) },
          })
          return Promise.resolve(null)
        }
        body.remote = remoteList[0].name
        body.branch = status?.branch?.head
      }
      // Older Hosts also gate ordinary pushes; the Push click authorizes
      // this fast-forward-only operation. Forced pushes still ask first.
      if (method === 'push' && body.forceWithLease !== true) body.confirm = true
      var send = function (confirmed) {
        if (pendingWriteRef.current) return Promise.resolve(null)
        pendingWriteRef.current = true
        setWriteMethod(method)
        var finalBody = Object.assign({}, body)
        if (confirmed === true) finalBody.confirm = true
        return runWithProgress('write.' + method, finalBody)
          .then(function (value) {
            pendingWriteRef.current = false
            setWriteMethod(null)
            setToast({ seq: Date.now(), text: opts.successText || (method === 'stashPush' ? t('stash.created') : value.message || t('action.apply')),
              action: method === 'stashPush' ? { label: t('stash.view'), run: function () { setTab('stashes') } } : undefined })
            if (opts.after !== undefined) opts.after()
            return value
          })
          .catch(function (failure) {
            pendingWriteRef.current = false
            setWriteMethod(null)
            if (failure.code === 'git/needs-confirmation') {
              setConfirmRequest({
                message: failure.message,
                onConfirm: function () { send(true).catch(function () {}) },
              })
              return null
            }
            if ((method === 'commit' || method === 'commitPaths') && repo !== null) {
              setTreeRefresh(function (value) { return value + 1 })
              loadRepo(repo, { force: true, background: true })
            }
            if (!opts.propagate) setError(t('error.action', { message: failure.message }))
            if (opts.onError) opts.onError(failure)
            if (opts.propagate) throw failure
            return null
          })
      }
      return send(opts.confirm === true)
    },
    [repo, run, t, remoteList, status, loadRepo],
  )

  var runWithProgress = function (method, payload) {
    if (!['clone', 'write.fetch', 'write.push', 'write.pull', 'write.lfsTransfer'].includes(method)) return run(method, payload, { silentError: true })
    setBusy(function (count) { return count + 1 })
    var owner = method === 'clone' ? payload.directory : repo.root
    return startOperationCompatible(function (name, body) { return run(name, body, { silent: true, silentError: true }) }, { root: owner, method: method, parameters: payload }).then(function (job) {
      if (job.legacy) return job.value
      backgroundJob[1](job)
      return new Promise(function (resolve, reject) {
        var failures = 0
        var poll = function () { run('operationStatus', { root: owner, id: job.id }, { silent: true, silentError: true }).then(function (value) {
          failures = 0; backgroundJob[1](value)
          if (value.state === 'running') { setTimeout(poll, 600); return }
          if (value.state === 'complete' && value.result?.ok) resolve(value.result.value)
          else { var failure = new Error(value.result?.error?.message || t('lfs.' + value.state)); failure.code = value.result?.error?.code; failure.details = value.result?.error?.details; reject(failure) }
        }).catch(function (failure) { if (++failures > 5) reject(failure); else setTimeout(poll, 2000) }) }
        poll()
      })
    }).finally(function () { setBusy(function (count) { return Math.max(0, count - 1) }); if (method !== 'clone') afterWrite() })
  }

  /** Reload the repository after a mutation. */
  var afterWrite = React.useCallback(
    function () {
      if (repo === null) return
      setTreeRefresh(function (value) { return value + 1 })
      var refreshRequest = loadRepo(repo, { force: true })
      if (tab === 'graph') {
        setGraphConfig(function (value) { return Object.assign({}, value, { refresh: value.refresh + 1 }) })
      }
      if (tab === 'history') {
        historyRetryState[1](function (value) { return value + 1 })
      }
      return refreshRequest
    },
    [repo, loadRepo, run, tab, historyRef, historyLimit],
  )


  var createStash = function () {
    if (busy > 0 || status === null || (status.files || []).length === 0) return
    setPromptRequest({ title: t('stash.create'), fields: [
      { key: 'message', label: t('label.message'), placeholder: '' },
      { key: 'includeUntracked', type: 'checkbox', label: t('stash.includeUntracked'), initial: (status.files || []).every(function (file) { return file.kind === 'untracked' }) },
    ], submit: function (values) {
      if (!values.includeUntracked && (status.files || []).every(function (file) { return file.kind === 'untracked' })) {
        setError(t('stash.noEligible')); return
      }
      performWrite('stashPush', { message: values.message, includeUntracked: values.includeUntracked === true }, { after: afterWrite })
    } })
  }
  var executeApplyStash = function (stash, pop, restoreIndex) {
    if (pendingWriteRef.current) return
    setStashAction({ id: stash.sha || stash.ref, action: pop ? 'pop' : 'apply' })
    performWrite('stashApply', { ref: stash.ref, expectedSha: stash.sha, pop: pop, restoreIndex: restoreIndex }, {
      successText: changelistModel.data?.stashLists?.[stash.sha]?.kind === 'changelist' && restoreIndex !== false ? undefined : t(pop ? 'stash.popped' : 'stash.applied'), after: afterWrite,
      onError: function () {
        afterWrite()
        run('status', { root: repo.root, force: true }, { silent: true, silentError: true }).then(function (value) {
          if ((value.files || []).some(function (file) { return file.kind === 'unmerged' })) {
            setStatus(value); setSelection(null); setTab('changes')
          }
        }).catch(function () {})
      },
    }).finally(function () { setStashAction(null) })
  }
  var applyStash = function (stash, pop) {
    if (pendingWriteRef.current) return
    setConfirmRequest({ title: t(pop ? 'action.stashPop' : 'action.stashApply'),
      label: t(pop ? 'action.stashPop' : 'action.stashApply'), danger: false,
      message: t(pop ? 'stash.popConfirm' : 'stash.applyConfirm', { ref: stash.ref, message: stash.message || stash.ref }),
      option: { label: t('cl.restoreIndex'), checked: changelistModel.data?.stashLists?.[stash.sha]?.kind === 'changelist' },
      onConfirm: function (restoreIndex) { executeApplyStash(stash, pop, restoreIndex) },
    })
  }
  var dropStash = function (stash) {
    setConfirmRequest({ title: t('action.stashDrop'), label: t('action.stashDrop'), danger: true,
      message: t('stash.dropConfirm', { ref: stash.ref, message: stash.message || stash.ref }),
      onConfirm: function () {
        if (pendingWriteRef.current) return
        setStashAction({ id: stash.sha || stash.ref, action: 'drop' })
        performWrite('stashDrop', { ref: stash.ref, expectedSha: stash.sha },
          { confirm: true, successText: t('stash.deleted'), after: afterWrite, onError: afterWrite }).finally(function () { setStashAction(null) })
      },
    })
  }

  /* -------------------------- rendering -------------------------- */
  var openWorkbench = function (action, subject, extras) {
    if (pendingWriteRef.current) return
    if (action === 'push' && remoteList.length === 0) { remoteRequest[1]({ id: Date.now(), push: true, branch: subject?.name || status?.branch?.head }); return }
    var localBranch = /^refs\/heads\//.test(subject?.ref || ''), remoteBranch = /^refs\/remotes\//.test(subject?.ref || '')
    if (action === 'checkout' && localBranch) {
      if (subject.head || subject.ref === 'refs/heads/' + status?.branch?.head) return
      if (subject.occupied) { setError(t('wb.occupied')); return }
      var checkoutContext = workbenchContextRef.current
      var refreshCheckout = function () {
        if (workbenchContextRef.current !== checkoutContext) return
        afterWrite()
        var token = getWindowState().refreshToken + 1
        lastRefreshToken.current = token
        setWindowState({ refreshToken: token })
      }
      branchSyncState[1](subject.ref)
      performWrite('checkout', { ref: subject.ref, localBranch: true }, {
        confirm: true, successText: t('wb.checkout') + ' · ' + t('action.ok'), after: refreshCheckout,
        onError: function (failure) {
          if (workbenchContextRef.current !== checkoutContext) return
          if (/would be overwritten|commit your changes or stash/i.test(failure.message || '')) setError(t('wb.checkoutBlocked'))
          refreshCheckout()
        },
      }).finally(function () { if (workbenchContextRef.current === checkoutContext) branchSyncState[1](null) })
      return
    }
    if ((action === 'pull' && localBranch) || (action === 'fetch' && (localBranch || remoteBranch || extras?.remote))) {
      var parameters, successLabel
      if (localBranch) {
        var upstream = workbenchUpstream(subject)
        if (!/^refs\/remotes\//.test(upstream)) { setError(t('wb.pullNeedsUpstream')); return }
        parameters = { name: subject.ref.slice(11), upstream: upstream, ffOnly: action === 'pull' }
        successLabel = t(action === 'fetch' ? 'wb.fetchLocal' : 'wb.pull')
      } else {
        var configuredRemote = remoteList.filter(function (remote) { return subject?.ref?.startsWith('refs/remotes/' + remote.name + '/') }).sort(function (a, b) { return b.name.length - a.name.length })[0]
        var remoteName = subject?.remoteName || configuredRemote?.name || extras?.remote || (remoteBranch ? subject.ref.slice(13).split('/')[0] : '')
        parameters = { remote: remoteName, prune: extras?.prune === true }
        if (remoteBranch && !parameters.prune) parameters.branch = subject.ref.slice(14 + remoteName.length)
        successLabel = t(parameters.prune ? 'wb.fetchPrune' : remoteBranch ? 'wb.fetchBranch' : 'wb.fetch')
      }
      var context = workbenchContextRef.current
      var refreshBranchSync = function () {
        if (workbenchContextRef.current !== context) return
        afterWrite(); setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
      }
      branchSyncState[1](subject?.ref || (extras?.remote ? 'remote:' + extras.remote : null))
      performWrite(action, parameters, {
        successText: successLabel + ' · ' + t('action.ok'),
        after: function () {
          if (workbenchContextRef.current !== context) return
          writeWorkbenchStorage('fetch:' + repo.root, Date.now()); refreshBranchSync()
        },
        onError: refreshBranchSync,
      }).finally(function () { if (workbenchContextRef.current === context) branchSyncState[1](null) })
      return
    }
    workbenchRequestState[1]({ action: action, subject: subject || null, extras: extras || {}, id: Date.now() })
  }
  var executeWorkbench = function (payload) {
    if (pendingWriteRef.current) return Promise.reject(new Error(t('state.loading')))
    var context = workbenchContextRef.current
    var active = function () { return workbenchContextRef.current === context }
    pendingWriteRef.current = true; setWriteMethod(payload.action)
    return run('write.workbenchAction', Object.assign({}, payload, { root: repo.root, confirm: true }), { silentError: true })
      .then(function (value) {
        if (!active()) return value
        if (value.recovery && (value.recovery.backup || value.recovery.stash || ['resetTo', 'undoCommit'].includes(value.recovery.kind))) {
          recoveryState[1](function (current) { var next = [Object.assign({ at: Date.now() }, value.recovery)].concat(current).slice(0, 20)
            writeWorkbenchStorage('recovery:' + repo.root, next); return next })
        }
        if (payload.action === 'undoCommit') {
          if (!commitMessage.trim()) setCommitMessage(payload.parameters?.originalMessage || '')
          setTab('changes')
        }
        if (payload.action === 'revert' && payload.parameters?.noCommit) setTab('changes')
        if (payload.action === 'cherryPick' && payload.parameters?.noCommit) setTab('changes')
        if (payload.action === 'restoreRevision') setTab('changes')
        if (payload.action === 'fetch') writeWorkbenchStorage('fetch:' + repo.root, Date.now())
        if (payload.action === 'renameBranch') {
          setGraphConfig(function (current) { return Object.assign({}, current, {
            selected: current.selected === 'refs/heads/' + payload.parameters.from ? 'refs/heads/' + payload.parameters.to : current.selected }) })
          writeWorkbenchStorage('favorites:' + repo.root, readWorkbenchStorage('favorites:' + repo.root, []).map(function (ref) {
            return ref === 'refs/heads/' + payload.parameters.from ? 'refs/heads/' + payload.parameters.to : ref
          }))
        }
        if (payload.action === 'deleteBranch') {
          var removedRef = payload.parameters.remote ? 'refs/remotes/' + payload.parameters.remoteName + '/' + payload.parameters.name : 'refs/heads/' + payload.parameters.name
          setGraphConfig(function (current) { return current.selected === removedRef ? Object.assign({}, current, { selected: '', scope: 'all' }) : current })
          writeWorkbenchStorage('favorites:' + repo.root, readWorkbenchStorage('favorites:' + repo.root, []).filter(function (ref) { return ref !== removedRef }))
        }
        setToast({ seq: Date.now(), text: t('wb.' + payload.action) + ' · ' + t('action.ok'),
          action: payload.action === 'undoCommit' && commitMessage.trim() ? { label: t('wb.originalMessage'), run: function () { setCommitMessage(payload.parameters?.originalMessage || '') } } : null })
        return value
      }).catch(function (failure) {
        if (!active()) throw failure
        if (failure.details?.recovery) recoveryState[1](function (current) { var next = [Object.assign({ at: Date.now() }, failure.details.recovery)].concat(current).slice(0, 20)
          writeWorkbenchStorage('recovery:' + repo.root, next); return next })
        return run('status', { root: repo.root, force: true }, { silent: true, silentError: true }).then(function (value) {
          if (!active()) throw failure
          setStatus(value)
          if (value.operation || (value.files || []).some(function (file) { return file.kind === 'unmerged' })) {
            workbenchRequestState[1](null); setTab('changes'); setSelection(null); setError(t('wb.conflict'))
          }
          throw failure
        })
      }).finally(function () {
        if (!active()) return
        pendingWriteRef.current = false; setWriteMethod(null); afterWrite()
        setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
      })
  }
  var branchApi = {
    t: t, busy: busy > 0 || !!status?.operation, current: status?.branch?.head,
    worktreesSupported: repo?.features?.['git:worktrees'] !== false,
    workflow: openWorkbench,
    history: function (branch, direction) {
      showRefHistory(direction === 'outgoing' ? branch.ref + '..HEAD' : direction ? 'HEAD..' + branch.ref : branch.ref); setQuery('')
    },
    compare: function (branch) { openComparison(branch.ref) },
    copy: function (text) { navigator.clipboard.writeText(text).then(function () { setToast({ seq: Date.now(), text: t('diff.copied') }) }).catch(function () { setError(t('diff.copyFailed')) }) },
  }
  var openBranchMenu = function (event, branch) {
    event.preventDefault(); event.stopPropagation?.()
    var rect = event.currentTarget?.getBoundingClientRect?.()
    setContextMenu({ x: rect?.left || event.clientX || 0, y: rect?.bottom || event.clientY || 0,
      items: branch.folder && branch.remoteName ? [{ id: 'pruneRemote', label: t('wb.pruneRemote'), command: 'fetch', hint: t('wb.pruneRemoteHint'), disabled: branchApi.busy,
        run: function () { performWrite('fetch', { remote: branch.remoteName, prune: true }, { after: afterWrite, successText: t('wb.remotePruned', { name: branch.remoteName }) }) } }]
        : branch.folder ? [{ id: 'new', label: t('wb.createBranch'), command: 'branch / checkout', disabled: branchApi.busy,
        run: function () { openWorkbench('createBranch', null, { prefix: branch.prefix }) } }]
        : workbenchBranchItems(branch, Object.assign({}, branchApi, { favorite: function () {
          var key = 'favorites:' + repo.root, value = readWorkbenchStorage(key, [])
          value = value.includes(branch.ref) ? value.filter(function (ref) { return ref !== branch.ref }) : value.concat(branch.ref)
          writeWorkbenchStorage(key, value); setGraphConfig(function (config) { return Object.assign({}, config) })
        } })) })
  }
  var openCommitMenu = function (event, sha) {
    event.preventDefault(); event.stopPropagation?.()
    var rect = event.currentTarget?.getBoundingClientRect?.()
    // Which commits are unpushed decides whether rewriting is even offered.
    // Both sources are consulted because this menu is reached from the history
    // list AND the graph, and neither view is guaranteed to have loaded the
    // other's data.
    var publishedUniverse = (commits || []).concat((graph && graph.rows) || [])
    var unpublishedShas = []
    for (var i = 0; i < publishedUniverse.length; i++) {
      var entry = publishedUniverse[i]
      if (entry.unpublished === true && unpublishedShas.indexOf(entry.sha) === -1) unpublishedShas.push(entry.sha)
    }
    var rewrite = {
      canReword: unpublishedShas.indexOf(sha) !== -1,
      // Only the reword payload is built here. Combining is driven by the tick
      // column, which knows the whole selection; a per-commit menu cannot.
      run: function (mode, payload) { setContextMenu(null); rewriteRequestState[1](Object.assign({ mode: mode }, payload)) },
    }
    var api = { t: t, workflow: openWorkbench, copy: branchApi.copy, busy: branchApi.busy, detached: !!status?.branch?.detached,
      head: status?.branch?.oid, compare: function () { openComparison(sha) }, rewrite: rewrite, unpublished: unpublishedShas }
    var context = workbenchContextRef.current
    setContextMenu({ sha: sha, x: rect?.left || event.clientX || 0, y: rect?.bottom || event.clientY || 0,
      items: workbenchCommitItems(sha, api) })
    run('commit', { root: repo.root, sha: sha }, { silent: true, silentError: true }).then(function (commit) {
      if (context !== workbenchContextRef.current) return
      api.commit = commit
      setContextMenu(function (current) { return current?.sha === sha ? Object.assign({}, current, { items: workbenchCommitItems(sha, api) }) : current })
    }).catch(function () {})
  }

  var showFileHistory = function (path, ref) {
    return navigate(function () {
      fileRequestRef.current++
      setHistoryPath(path); setHistoryRef(ref || 'HEAD'); setHistoryLimit(60); setQuery('')
      setSelection(null); setCommitDetail(null); setDiff(null); setFileView(null)
      historyRetryState[1](function (value) { return value + 1 }); setTab('history')
    })
  }
  var showHistoryFileMenu = function (event, file, ref) {
    event.preventDefault(); event.stopPropagation?.()
    setContextMenu({ x: event.clientX || 0, y: event.clientY || 0, items: [
      { id: 'history', label: t('action.fileHistory'), command: 'log', disabled: file.kind === 'untracked',
        run: function () { showFileHistory(file.path, ref) } },
      { id: 'copy-path', label: t('action.copyPath'), run: function () { branchApi.copy(file.path) } },
    ] })
  }
  var showFileMenu = function (event, file, section) {
    var extras = Array.isArray(section) ? section : []
    if (extras.length) section = 'working'
    event.preventDefault()
    event.stopPropagation?.()
    var staged = extras.length ? isStaged(file) && !isUnstaged(file) : section ? section === 'staged' : !isUnstaged(file)
    section = section || (staged ? 'staged' : 'unstaged')
    var items = [
      { id: 'changes', label: t('action.openChanges'), run: function () { navigate(function () { openChangedFile(file, 'diff', section); setTab('changes') }) } },
      { id: 'file', label: t('action.openFile'), run: function () { navigate(function () { openChangedFile(file, 'content', section); setTab('changes') }) } },
      { id: 'lfs-track', label: t(file.lfs ? 'lfs.manageRules' : 'lfs.track'), command: file.lfs ? null : 'lfs track --filename', disabled: busy > 0,
        run: function () { if (file.lfs) { setTab('settings'); setSettingsSection('lfs') } else performWrite('lfsTrack', { pattern: file.path, literal: true }, { after: afterWrite }) } },
      { id: 'lfs-pull', label: t('lfs.pull'), command: 'lfs pull', disabled: busy > 0 || !file.lfs || !remoteList.length,
        run: function () {
          if (remoteList.length === 1) performWrite('lfsTransfer', { action: 'pull', remote: remoteList[0].name, path: file.path }, { after: afterWrite })
          else { setTab('settings'); setSettingsSection('lfs') }
        } },
      { id: 'head', label: t('action.openHead'), disabled: file.kind === 'untracked',
        run: function () { navigate(function () { openChangedFile(file, 'head', section); setTab('changes') }) } },
      { separator: true },
      { id: 'history', label: t('action.fileHistory'), disabled: file.kind === 'untracked',
        run: function () { showFileHistory(file.path) } },
      { separator: true },
      { id: 'stage', disabled: busy > 0, label: staged ? t('action.unstage') : t('action.stage'),
        run: function () { performWrite(staged ? 'unstage' : 'stage', { paths: [file.path] }, { after: afterWrite }) } },
      { id: 'discard', label: t('action.discard'), danger: true, disabled: busy > 0 || staged,
        run: function () { setDiscardTarget(file, {
          t: t, requestConfirm: function (message, onConfirm) { setConfirmRequest({ message: message, onConfirm: onConfirm }) },
          onWrite: performWrite, afterWrite: afterWrite,
        }) } },
      { id: 'stash', label: t('action.stashFile'), disabled: busy > 0,
        run: function () { performWrite('stashPush', {
          paths: [file.path], includeUntracked: file.kind === 'untracked',
        }, { after: afterWrite }) } },
      externalEditorItem(repo.root, file, t, event, run, setError),
      { id: 'ignore-local', label: t('action.ignoreLocal'), disabled: busy > 0 || file.kind !== 'untracked', run: function () { performWrite('ignoreLocalPath', { path: file.path }, { after: afterWrite }) } },
      { id: 'ignore', label: t('action.ignoreFile'), disabled: busy > 0 || file.kind !== 'untracked',
        run: function () { performWrite('ignorePath', { path: file.path }, { after: afterWrite }) } },
      { separator: true },
      { id: 'copy-patch', label: t('action.copyPatch'), disabled: file.kind === 'untracked',
        run: function () {
          run('diff', { root: repo.root, staged: staged, path: file.path }, { silentError: true })
            .then(function (value) { return navigator.clipboard.writeText(value.text || '') })
            .catch(function (failure) { setError(t('error.action', { message: failure.message })) })
        } },
      { id: 'copy-path', label: t('action.copyPath'),
        run: function () { navigator.clipboard.writeText(file.path).catch(function () {}) } },
    ]
    var commands = {
      changes: file.kind === 'untracked' ? null : 'diff',
      file: staged ? 'show' : null, head: 'show', history: 'log',
      stage: staged ? 'reset' : 'add',
      discard: file.kind === 'untracked' ? 'clean' : 'restore',
      stash: 'stash push', 'copy-patch': 'diff',
      'lfs-track': file.lfs ? null : 'lfs track --filename', 'lfs-pull': 'lfs pull',
    }
    items.forEach(function (item) { if (!item.separator) item.command = commands[item.id] })
    if (extras.length) items = extras.concat([{ separator: true }], items)
    setContextMenu({ x: event.clientX || 0, y: event.clientY || 0, items: items })
  }

  var header = h('div', { className: 'dshgit-titlebar', key: 'bar',
    'data-draggable': !!props.onDragStart && !props.maximized,
    onPointerDown: props.onDragStart,
  }, [
    h('span', { key: 'brand', className: 'dshgit-brand' }, [
      h(IconGit, { key: 'i', size: 16 }),
      h('span', { key: 't' }, t('panel.title')),
    ]),
    // Repository identity as a breadcrumb. The switcher replaces the plain
    // path when there is more than one repository, because choosing between
    // them is then a real task rather than a label.
    knownRepos.length > 1 && repo !== null
      ? h(ComboBox, {
          key: 'repo',
          t: t,
          // The repository list is a list of PATHS: filtering by a path
          // fragment is how you find the right one once a profile has a
          // dozen checkouts, and a native select cannot be typed into.
          className: 'dshgit-repo-combo',
          style: { width: 'auto', maxWidth: '280px' },
          value: repo.root,
          placeholder: baseName(repo.root),
          // Show the basename (that is what identifies a checkout) but filter
          // on the full path as well, so either form finds it.
          options: knownRepos.map(function (entry) {
            return { value: entry.root, label: baseName(entry.root), group: dirName(entry.root) }
          }),
          onChange: function (value) {
            var chosen = null
            for (var i = 0; i < knownRepos.length; i++) {
              if (knownRepos[i].root === value) chosen = knownRepos[i]
            }
            if (chosen !== null) {
              navigate(function () { setRepo(chosen); setStatus(null); loadRepo(chosen, { force: true }) })
            }
          },
        })
      : repo !== null
        ? h('span', { key: 'root', className: 'dshgit-crumbs', title: repo.root }, [
            // The whole path stays in the text (so it is still selectable and
            // searchable), but CSS lets it shrink with an ellipsis before it
            // can push the sync controls off the row.
            h('span', { key: 'n', className: 'dshgit-crumb-name' }, repo.root),
          ])
        : null,
    // Branch stays in the title bar: it is the identity of what this
    // workbench is showing, like the repository it sits beside. Divergence
    // does NOT — that is sync state, and it belongs with the other sync facts
    // in the status bar. Showing it in both places was duplication that made
    // the title bar noisier for no extra information.
    status !== null && status.branch !== null
      ? h('span', { key: 'branch', className: 'dshgit-crumb-strong' }, status.branch.head || '?')
      : null,
    h('span', { key: 'spacer', className: 'dshgit-spacer' }),
    // Remote actions. Grouped and always visible so the common loop
    // (fetch → review → commit → push) needs no menu hunting.
    repo !== null
      ? h('div', { key: 'tools', className: 'dshgit-title-tools', role: 'group', 'aria-label': 'Git' }, [
          h('button', {
            key: 'fetch', type: 'button', className: 'dshgit-winbtn', title: autoFetchStatus?.error ? t('sync.autoFetchFailed', { message: autoFetchStatus.error }) : t('action.fetch'),
            style: autoFetchStatus?.error ? { color: 'var(--dshgit-warning-text)' } : undefined,
            disabled: busy > 0, 'aria-busy': writeMethod === 'fetch',
            'aria-label': t('action.fetch'),
            onClick: function () {
              performWrite('fetch', { prune: true }, { after: afterWrite })
            },
          }, writeMethod === 'fetch' ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : h(IconBranchSync, { kind: 'fetch', size: 16 })),
          h('button', {
            key: 'pull', type: 'button', className: 'dshgit-winbtn', title: t('action.pull'), 'aria-label': t('action.pull'),
            disabled: busy > 0, 'aria-busy': writeMethod === 'pull',
            onClick: function () { performWrite('pull', {}, { after: afterWrite }) },
          }, writeMethod === 'pull' ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : h(IconBranchSync, { kind: 'pull', size: 16 })),
          h('button', {
            key: 'push', type: 'button', className: 'dshgit-winbtn', title: t('action.push') + ((tracking?.ahead || status?.branch?.ahead || 0) > 0 ? '\n' + t('state.readyPush', { count: tracking?.ahead || status?.branch?.ahead }) : ''), 'aria-label': t('action.push'), 'data-push-pending': (tracking?.ahead || status?.branch?.ahead || 0) > 0,
            disabled: busy > 0, 'aria-busy': writeMethod === 'push',
            onClick: function () { performWrite('push', {}, { after: afterWrite }) },
          }, writeMethod === 'push' ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : h(IconBranchSync, { kind: 'push', size: 16 })),
          h('button', { key: 'refresh', type: 'button', className: 'dshgit-winbtn', disabled: busy > 0,
            onClick: function () { refresh({ force: true }) }, title: t('action.refresh'), 'aria-label': t('action.refresh'),
          }, h(IconRefresh, { size: 16 })),
        ])
      : null,
    // Window controls. They live on this row (not in a separate window
    // header) because the title bar is already the window's identity strip —
    // a second header above it would be a strip of pure chrome.
    props.onMinimize || props.onMaximize || props.onClose ? h('div', { key: 'window', className: 'dshgit-window-controls', role: 'group', 'aria-label': t('panel.title') }, [
    props.onMinimize === undefined ? null : h('button', {
      key: 'min', type: 'button', className: 'dshgit-winbtn',
      title: t('window.minimize'), 'aria-label': t('window.minimize'),
      onClick: props.onMinimize,
    }, svg({ size: 16 }, h('path', { d: 'M3 8h10', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))),
    props.onMaximize === undefined ? null : h('button', {
      key: 'max', type: 'button', className: 'dshgit-winbtn',
      title: t(props.maximized ? 'window.restore' : 'window.maximize'),
      'aria-label': t(props.maximized ? 'window.restore' : 'window.maximize'),
      'aria-pressed': props.maximized === true,
      onClick: props.onMaximize,
    }, svg({ size: 16 }, props.maximized
      ? h('path', { d: 'M5 5V3h8v8h-2M3 5h8v8H3z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' })
      : h('rect', { x: 3, y: 3, width: 10, height: 10, rx: 1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }))),
    props.onClose === undefined ? null : h('button', {
      key: 'close', type: 'button', className: 'dshgit-winbtn dshgit-window-close',
      title: t('window.close'), 'aria-label': t('window.close'),
      onClick: props.onClose,
    }, h(IconClose, { size: 16 })),
    ]) : null,
  ])

  // Repository facts that are always true and never actionable, parked at the
  // bottom where they cannot push the actions off the title bar.
  var statusbar = h(StatusBar, {
    key: 'status',
    t: t,
    status: status,
    repoMeta: repoMeta,
    busy: busy > 0,
    // The resolved git executable is the one fact that explains a broken
    // repository read, so it belongs somewhere always visible.
    gitVersion: gitPath,
  })

  // Settings remain accessible before a repository or Git is available.
  if (repo === null && tab !== 'settings') {
    return h('div', { className: 'dshgit' }, [
      header,
      h('div', { key: 'body', className: 'dshgit-setup' },
        h('div', { className: 'dshgit-setup-card' }, [
          h('div', { key: 'icon', className: 'dshgit-setup-icon', 'aria-hidden': true }, h(IconGit, { size: 28 })),
          h('div', { key: 'title', className: 'dshgit-setup-title' }, t('state.repoSetup')),
          h('div', { key: 'hint', className: 'dshgit-setup-hint', role: discovering ? 'status' : undefined },
            discovering ? t('state.loading') : gitMissing ? (error || t('state.noGit')) : t('state.noRepo')),
          directory !== null ? h('div', { key: 'path', className: 'dshgit-setup-path', title: directory }, directory) : null,
          error !== null && !gitMissing ? h('div', { key: 'error', className: 'dshgit-setup-error', role: 'alert' }, error) : null,
          h('div', { key: 'actions', className: 'dshgit-setup-actions' }, [
            !discovering ? h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', disabled: busy > 0, onClick: function () { setError(null); refresh({ force: true }) } }, t('action.retryRead')) : null,
            !discovering && !gitMissing && canInitialize ? h('button', {
              key: 'init', type: 'button', className: 'dshgit-btn dshgit-btn-primary',
              disabled: busy > 0, title: 'git init', 'data-repo-action': 'init',
              onClick: function () {
                if (busy > 0) return
                setError(null)
                run('initRepository', {}).then(function () { refresh({ force: true }) }).catch(function () {})
              },
            }, [busy > 0 ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true }) : null,
              h('span', { key: 'label' }, t('action.initRepository'))]) : null,
            h('button', { key: 'settings', type: 'button', className: 'dshgit-btn',
              'data-repo-action': 'settings', onClick: function () { setTab('settings') },
            }, t('tab.settings')),
          ]),
        ])),
      statusbar,
    ])
  }

  /* -------------------------- layout -------------------------- */

  // Every module renders through ONE skeleton — activity bar, sidebar,
  // editor — so the spatial model never changes when the user switches.
  // Previously only "changes" had a sidebar and the other five modules were
  // full-width single-column panels, which meant re-learning where things
  // were on every switch.
  var sidebar = null
  var editor = null
  var editorHead = null

  if (tab === 'settings') {
    sidebar = h(SettingsNav, {
      key: 'nav',
      section: settingsSection,
      onSelect: setSettingsSection,
      t: t,
    })
    editor = h(SettingsTab, {
      key: 'settings',
      run: run,
      gitPath: gitPath,
      repo: repo,
      section: settingsSection,
      onBusy: function (active) { setBusy(function (count) { return Math.max(0, count + (active ? 1 : -1)) }) },
      onChanged: function () { refresh({ force: true }) },
      onToast: function (text, tone) { setToast({ seq: Date.now(), text: text, tone: tone }) },
      t: t,
    })
  } else if (tab === 'stashes') {
    var selectedStash = (stashes || []).find(function (stash) { return (stash.sha || stash.ref) === selectedStashId }) || null
    sidebar = h(StashesSidebar, { stashes: stashes, error: stashError, selected: selectedStashId,
      canCreate: status !== null && (status.files || []).length > 0, busy: busy > 0,
      onCreate: createStash, onSelect: openStash, onRetry: afterWrite,
      onApply: applyStash, onDrop: dropStash, busyAction: stashAction, t: t })
    editor = h(StashDetails, { key: repo.root + ':' + (selectedStash === null ? 'empty' : selectedStash.sha || selectedStash.ref),
      stash: selectedStash, repo: repo, run: run, busy: busy > 0, onFileMenu: showHistoryFileMenu, t: t,
    })
  } else if (tab === 'compare') {
    var comparison = compareData[0]?.requestKey === JSON.stringify([repo.root, compareWith, compareTo, compareRetry[0]]) ? compareData[0] : null
    sidebar = h(CompareSidebar, {
      key: compareWith + ':' + compareTo,
      root: repo.root,
      files: comparison?.files || [], loading: !comparison && !compareError[0], error: compareError[0],
      selected: comparePath[0], onSelect: comparePath[1], t: t,
      onFileMenu: function (event, file) { showHistoryFileMenu(event, file, comparison?.to || compareTo) },
    })
    editor = h(CompareTab, {
      key: repo.root + ':' + compareWith + ':' + compareTo + ':' + compareRetry[0],
      repo: repo, run: run, from: compareWith, to: compareTo,
      data: comparison, error: compareError[0], history: compareHistory[0], selected: comparePath[0],
      onCompare: function (from, to) { setCompareWith(from); compareToState[1](to); compareRetry[1](function (value) { return value + 1 }) },
      onBack: function () { setTab(compareReturn.current) },
      onFileMenu: showHistoryFileMenu,
      refs: [].concat(refs?.branches || [], refs?.remotes || [], refs?.tags || []),
      t: t,
    })
  } else if (tab === 'output') {
    sidebar = h(OutputSidebar, {
      key: 'nav',
      entries: outputEntries,
      filter: outputFilter,
      onFilter: setOutputFilter,
      onRefresh: loadOutput,
      onClear: clearOutput,
      t: t,
    })
    editor = h(OutputList, {
      key: 'output',
      entries: outputEntries,
      filter: outputFilter,
      t: t,
    })
  } else if (tab === 'graph') {
    sidebar = h(WorkbenchBranchSidebar, { key: repo.root, root: repo.root, refs: refs, remotes: remoteList,
      status: status, worktrees: worktrees, selected: graphConfig.selected, busy: branchApi.busy,
      busyRef: branchSyncState[0] || workbenchRequest?.subject?.ref, busyAction: writeMethod, t: t,
      onSelect: function (branch) { navigate(function () { setSelection(null); setGraphConfig(function (value) { return Object.assign({}, value, { selected: branch.ref, scope: 'selected', limit: 200 }) }) }) },
      onWorkflow: openWorkbench, onMenu: openBranchMenu,
      refreshing: graphLoadingState[0], onRefresh: function () {
        var context = workbenchContextRef.current
        return loadRepo(repo, { force: true }).then(function () {
          if (workbenchContextRef.current !== context) return
          setGraphConfig(function (value) { return Object.assign({}, value, { refresh: value.refresh + 1 }) })
        })
      },
      onFetch: function (remote, prune) { openWorkbench('fetch', null, { remote: remote, prune: prune === true }) },
      onReflog: function () { reflogOpenState[1](true) },
    })
    editor = h(WorkbenchGraph, { key: 'graph', graph: graph, refs: refs, config: graphConfig, loading: graphLoadingState[0], error: graphErrorState[0],
      onConfig: function (patch) { navigate(function () { if (patch.scope !== undefined || patch.selected !== undefined || patch.ordering !== undefined) setSelection(null); setGraphConfig(function (value) { return Object.assign({}, value, patch) }) }) },
      selection: selection, onOpenCommit: openCommit, onMenu: openCommitMenu,
      onCloseDetail: function () { setSelection(null) }, repo: repo, run: run,
      onFileMenu: showHistoryFileMenu,
      onFileRestore: function (sha, path) { openWorkbench('restoreRevision', { sha: sha, path: path }) },
      recovery: recoveryState[0][0], onRecovery: function () { reflogOpenState[1](true) }, t: t })
  } else if (tab === 'history') {
    sidebar = h(HistorySidebar, {
      key: 'nav',
      commits: commits,
      selection: selection,
      query: query,
      setQuery: function (value) { setHistoryLimit(60); setQuery(value) },
      historyPath: historyPath,
      historyRef: historyRef,
      onResetHistory: function () { showRefHistory('HEAD') },
      hasMore: commits.length >= historyLimit,
      loading: historyLoadingState[0], error: historyErrorState[0],
      onRetry: function () { historyRetryState[1](historyRetryState[0] + 1) },
      onLoadMore: function () { setHistoryLimit(historyLimit + 60) },
      clearHistoryPath: function () { setHistoryLimit(60); setHistoryPath('') },
      onOpenCommit: openCommit,
      onMenu: openCommitMenu,
      // Ticks for rewriting unpushed commits. An empty array is the resting
      // state — there is no mode to enter, so "no ticks" needs no null.
      selection2: rewriteSelectionState[0] || [],
      onTick: function (sha) {
        // The rule lives HERE, not only in the control's rendering. A tick
        // control that merely omits itself for pushed commits is a UI
        // convention any direct caller can bypass, and letting a pushed commit
        // into the selection would surface only as a refusal at the last step.
        var entry = (commits || []).filter(function (commit) { return commit.sha === sha })[0]
        if (!entry || entry.unpublished !== true) return
        rewriteSelectionState[1](function (current) {
          var list = current || []
          return list.indexOf(sha) === -1 ? list.concat(sha) : list.filter(function (item) { return item !== sha })
        })
      },
      // Used by "fill the gap": several SHAs at once, each still subject to
      // the same unpublished rule.
      onTickMany: function (shas) {
        rewriteSelectionState[1](function (current) {
          var list = (current || []).slice()
          ;(shas || []).forEach(function (sha) {
            var entry = (commits || []).filter(function (commit) { return commit.sha === sha })[0]
            if (entry && entry.unpublished === true && list.indexOf(sha) === -1) list.push(sha)
          })
          return list
        })
      },
      onClearSelection: function () { rewriteSelectionState[1]([]) },
      onClearFilter: function () { setHistoryLimit(60); setQuery(''); setHistoryPath('') },
      onRunRewrite: function (verdict) { rewriteRequestState[1]({ mode: verdict.action, shas: verdict.shas }) },
      t: t,
    })
    // Selecting a commit replaces the editor's content, so the diff for what
    // was just clicked appears where the click happened.
    editor = selection !== null && (selection.kind === 'commit' || selection.kind === 'revisionFile')
      ? h(HistoryCommitDetails, { key: repo.root + ':' + selection.sha, sha: selection.sha,
          initialPath: selection.kind === 'revisionFile' ? selection.path : historyPath,
          repo: repo, run: run, onMenu: openCommitMenu, onFileMenu: showHistoryFileMenu,
          onFileRestore: function (sha, path) { openWorkbench('restoreRevision', { sha: sha, path: path }) }, t: t })
      : h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.noCommitSelected'))
  } else {
    // changes: the file list is the sidebar, the diff is the editor.
    sidebar = h(changelistModel.mode === 'lists' ? ChangelistPane : LeftPane, {
      key: 'nav',
      changelists: changelistModel,
      hideToolbar: true,
      prompt: function (spec) { setPromptRequest({ title: spec.title, fields: spec.fields, compact: spec.compact, submit: spec.onSubmit, awaitSubmit: true }) },
      fileMenu: showFileMenu,
      status: status,
      busy: busy > 0,
      selection: selection,
      onOpenFile: openChangedFile,
      onFileContextMenu: showFileMenu,
      showMenu: function (event, items, options) {
        event.preventDefault(); event.stopPropagation?.()
        var rect = event.type === 'contextmenu' ? null : event.currentTarget?.getBoundingClientRect?.()
        setContextMenu({ x: rect ? rect.left : event.clientX || 0, y: rect ? rect.bottom : event.clientY || 0, items: items, compact: options?.compact === true })
      },
      onWrite: performWrite,
      afterWrite: afterWrite,
      requestConfirm: function (message, onConfirm) {
        setConfirmRequest({ message: message, onConfirm: onConfirm })
      },
      t: t,
    })
    editor = h(CenterPane, {
      key: 'center',
      previewStale: stalePreview[0]?.root === repo?.root && stalePreview[0]?.path === selection?.path,
      onPreviewRefresh: function () {
        if (selection?.kind !== 'file') return
        var file = (status?.files || []).find(function (file) { return file.path === selection.path }) || selection.file
        openChangedFile(file, selection.rev === 'HEAD' ? 'head' : fileDisplay, selection.section === 'working' ? 'working' : undefined, true)
      },
      changelists: changelistModel,
      tab: tab,
      repo: repo,
      status: status,
      tracking: tracking,
      diff: diff,
      imageDiff: imageDiff,
      fileView: fileView,
      fileDisplay: fileDisplay,
      setFileDisplay: setFileDisplay,
      revisionSide: revisionSide,
      viewRevisionSide: viewRevisionSide,
      onOpenRevisionFile: openRevisionFile,
      onFileMenu: function (event, file) {
        if (selection?.kind === 'file') showFileMenu(event, selection.file, selection.section)
        else showHistoryFileMenu(event, file, selection?.sha)
      },
      commitDetail: commitDetail,
      selection: selection,
      commits: commits,
      graph: graph,
      query: query,
      setQuery: setQuery,
      historyPath: historyPath,
      historyRef: historyRef,
      onResetHistory: function () { showRefHistory('HEAD') },
      historyLimit: historyLimit,
      loadMoreHistory: function () { setHistoryLimit(historyLimit + 60) },
      clearHistoryPath: function () { setHistoryPath('') },
      onOpenCommit: openCommit,
      onOpenFile: openChangedFile,
      clearSelection: function () { setSelection(null) },
      commitMessage: commitMessage,
      setCommitMessage: setCommitMessage,
      busy: busy > 0,
      busyMethod: writeMethod,
      onWrite: performWrite,
      afterWrite: afterWrite,
      aiNotice: aiNotice,
      setAiNotice: setAiNotice,
      run: run,
      t: t,
    })
  }

  // The module's own definition supplies its sidebar header. A module whose
  // sidebar has nothing to say hides the column instead of showing an empty
  // gutter, which reads as a failed load.
  var moduleDef = moduleById(tab)
  var hasSidebar = tab !== 'graph' || graph !== null

  var body = h('div', { key: 'body', className: 'dshgit-body' }, [
    h(ActivityBar, {
      key: 'activity',
      t: t,
      active: tab === 'compare' ? compareReturn.current : tab,
      changes: status === null ? 0 : (status.files || []).length,
      onSelect: setTab,
    }),
    hasSidebar
      ? h('div', { key: 'sidebar', className: 'dshgit-sidebar' }, [h(PaneResizeHandle, { key: 'resize', t: t }),
          h('div', { key: 'h', className: 'dshgit-sidebar-head' }, [
            tab === 'changes' ? h(ChangelistModeToolbar, { key: 'title', changelists: changelistModel, label: t(moduleDef.sidebarKey), t: t,
              busy: busy > 0 || changelistModel.loading,
              showMenu: function (event, items) { var rect = event.currentTarget.getBoundingClientRect(); setContextMenu({ x: rect.left, y: rect.bottom, items: items }) },
              onCreate: changelistModel.mode === 'lists' ? function () { setPromptRequest({ title: t('cl.create'), compact: true, fields: [
                { key: 'name', label: t('cl.name'), value: '' }, { key: 'makeActive', label: t('cl.active'), type: 'checkbox', value: false },
              ], awaitSubmit: true, submit: function (values) { return changelistModel.mutate({ action: 'create', name: values.name, makeActive: values.makeActive }) } }) } : undefined,
            }) : h('span', { key: 'title', style: { flex: 1 } }, t(moduleDef.sidebarKey)),
            tab === 'changes' ? h('button', { key: 'more', type: 'button', className: 'dshgit-iconbtn',
              title: t('menu.actions'), 'aria-label': t('menu.actions'), 'aria-haspopup': 'menu',
              onClick: function (event) {
                var rect = event.currentTarget.getBoundingClientRect()
                setContextMenu({ x: rect.left, y: rect.bottom, items: [
                  { id: 'undo', label: t('action.undoCommit'), disabled: busy > 0,
                    run: function () { openWorkbench('undoCommit', { sha: status?.branch?.oid }) } },
                ] })
              },
            }, h(IconMore, { size: 16 })) : null,
          ]),
          h('div', { key: 'b', className: 'dshgit-sidebar-body', 'data-file-scroll': true }, sidebar),
          tab === 'changes' && repo !== null ? h(CommitFormContainer, { key: 'composer', className: 'dshgit-sidebar-composer', t: t },
            h(CommitComposer, { message: commitMessage, setMessage: setCommitMessage,
              changelists: changelistModel,
              busy: busy > 0, busyMethod: writeMethod, status: status, tracking: tracking,
              onWrite: performWrite, afterWrite: afterWrite, run: run, repo: repo,
              aiNotice: aiNotice, setAiNotice: setAiNotice, sidebar: true, t: t })) : null,
        ])
      : null,
    h('div', { key: 'editor', className: 'dshgit-editor' }, [
      editorHead,
      h('div', { key: 'body', className: 'dshgit-editor-body', 'data-preview-revision': selection?.kind === 'revisionFile' ? selection.sha + ':' + revisionSide : selection?.rev || selection?.section || 'worktree' }, editor),
    ]),
  ])

  var overlay = []
  if (backgroundJob[0]?.state === 'running' && error === null) overlay.push(h(OperationProgress, { key: 'progress', job: backgroundJob[0], t: t, onCancel: function () { run('operationCancel', { root: backgroundJob[0].root, id: backgroundJob[0].id }, { silent: true, silentError: true }).catch(function (failure) { setError(failure.message) }) } }))
  if (error !== null) overlay.push(h(ChipNotice, { key: 'err', t: t, outcome: { id: 'operation-error', tone: 'error', summary: error, action: /authentication|permission denied|could not read username|publickey|user.name|user.email|author identity/i.test(error) ? { label: t('auth.help') } : null }, onDismiss: function () { setError(null) }, onAction: function () { setTab('settings'); setSettingsSection('general'); setError(null) } }))
  if (toast !== null && error === null && backgroundJob[0]?.state !== 'running') {
    overlay.push(h(Toast, { key: 'toast', seq: toast.seq, text: toast.text, tone: toast.tone, placement: toast.placement, action: toast.action, busy: busy > 0, onDone: function () { setToast(null) } }))
  }
  if (confirmRequest !== null) {
    overlay.push(h(ConfirmBar, {
      key: 'confirm', centered: true, t: t,
      request: Object.assign({}, confirmRequest, { onConfirm: function (option) {
        var action = confirmRequest.onConfirm
        setConfirmRequest(null)
        action(option)
      } }),
      onCancel: function () { setConfirmRequest(null) },
    }))
  }

  if (promptRequest !== null) {
    overlay.push(h(PromptDialog, {
      key: 'prompt',
      spec: promptRequest,
      t: t,
      onClose: function () { setPromptRequest(null) },
    }))
  }

  if (remoteRequest[0] && repo) overlay.push(h(RemoteConfigDialog, {
    key: repo.root + ':' + remoteRequest[0].id, repo: repo, run: run, t: t, remotes: remoteList,
    initialPush: remoteRequest[0].push, branch: remoteRequest[0].branch || status?.branch?.head,
    onWrite: function (method, payload) { return performWrite(method, payload, { propagate: true }) },
    onSaved: function () { afterWrite(); setWindowState({ refreshToken: getWindowState().refreshToken + 1 }) },
    onClose: function () { remoteRequest[1](null) },
  }))

  if (workbenchRequest !== null && repo !== null) overlay.push(h(WorkbenchDialog, {
    key: workbenchRequest.id, request: workbenchRequest, repo: repo, status: status, refs: refs, worktrees: worktrees,
    run: run, execute: executeWorkbench, t: t,
    onWorktreeOpen: function (directory) {
      var target = Object.assign({}, repo, { root: directory.replace(/\\/g, '/').replace(/\/$/, '') })
      setKnownRepos(function (value) { return value.some(function (entry) { return entry.root === target.root }) ? value : value.concat(target) })
      setRepo(target); setStatus(null); loadRepo(target, { force: true })
    },
    onClose: function () { if (!pendingWriteRef.current) workbenchRequestState[1](null) },
  }))
  if (reflogOpenState[0] && repo !== null) overlay.push(h(WorkbenchRecovery, {
    key: 'recovery', repo: repo, run: run, recovery: recoveryState[0], t: t,
    onClose: function () { reflogOpenState[1](false) },
    onWorkflow: function (action, subject, extras) { reflogOpenState[1](false); openWorkbench(action, subject, extras) },
    onStash: function (sha) { reflogOpenState[1](false); setSelectedStashId(sha); setTab('stashes') },
  }))
  if (rewriteRequestState[0] !== null && repo !== null) overlay.push(h(RewriteDialog, {
    key: 'rewrite', repo: repo, request: rewriteRequestState[0], run: run, t: t,
    onClose: function () { rewriteRequestState[1](null) },
    onDone: function (value) {
      rewriteRequestState[1](null)
      // The ticks refer to SHAs that no longer exist, so the selection is
      // dropped rather than left pointing at rewritten commits. Exiting the
      // mode entirely is the honest outcome: there is nothing left to combine.
      rewriteSelectionState[1](null)
      setToast({ seq: Date.now(), text: value?.message || t('rewrite.done') })
      // The old SHAs no longer resolve, so every view derived from them has to
      // be refetched rather than patched in place.
      setSelection(null); setDiff(null); setCommitDetail(null)
      afterWrite()
      setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
    },
  }))

  overlay.push(h(FileContextMenu, { key: 'context', menu: contextMenu, onClose: function () { setContextMenu(null) } }))

  return h(Fragment, null, [h('div', { key: 'root', className: 'dshgit', 'data-preview-root': repo?.root || '' }, [header, body, statusbar])].concat(props.active === false ? [] : overlay))
}

export { GitApp }

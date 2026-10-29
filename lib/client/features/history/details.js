import { readPreviewMode, writePreviewMode } from '../../core/preferences.js'
import { HistoryZipExport } from './archive.js'
import { Fragment, React, h } from '../../core/runtime.js'
import { formatBytes, formatTime } from '../../core/format.js'
import { DiffBody, FilePreview, readAnnotatedPreview } from '../../preview/code.js'
import { DiffStats, FileDiffCard, StashFileNavigation } from '../../ui/file-diff.js'
import { PaneResizeHandle } from '../../ui/resize.js'
import { ExplainPanel } from './explain.js'
import { BlamePanel } from './blame.js'
import { withReviewPrefs, subscribeReviewPrefs } from '../../core/preferences.js'
import { ReviewPrefsButton } from '../review/prefs.js'
import { IconChangeAction, IconChevron, IconMore } from '../../ui/icons.js'
import { CopyFilePathsButton } from '../../ui/notifications.js'
import { isImagePath } from '../../core/files.js'
import { ImageDiffView } from '../../preview/images.js'
import { HistoryFileExport } from './export.js'

/**
 * One commit's full diff, shown where its row was clicked.
 *
 * The commit list is reached from two tabs (History and Graph), so the view
 * owns only the diff plus a way back — it deliberately does not reload the
 * list, which keeps "back" instant and preserves the scroll position the
 * user returns to.
 */
function CommitDiffView(props) {
  var t = props.t
  var detail = props.commit
  var diff = props.diff
  var header = h('div', { key: 'head', className: 'dshgit-card' }, [
    h('div', { key: 'row', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
      h(
        'button',
        { key: 'back', type: 'button', className: 'dshgit-btn', onClick: props.onBack },
        '← ' + t('tab.history'),
      ),
      detail === null
        ? h('span', { key: 'sha', className: 'dshgit-muted' }, props.selection.sha.slice(0, 12))
        : h('span', { key: 'sha', className: 'dshgit-muted', style: { fontFamily: 'ui-monospace, monospace' } },
            detail.shortSha ?? detail.sha.slice(0, 7)),
    ]),
    detail === null
      ? null
      : h('div', { key: 'subject', style: { fontWeight: 600, marginTop: '4px' } }, detail.subject),
    detail === null
      ? null
      : h('div', { key: 'meta', className: 'dshgit-meta' }, [
          h('span', { key: 'a' }, detail.author),
          h('span', { key: 'd', className: 'dshgit-muted' }, formatTime(detail.authorDate)),
          h('span', { key: 'f', className: 'dshgit-muted' }, t('count.files', { count: (detail.files || []).length })),
        ]),
    detail !== null && detail.message !== detail.subject
      ? h('div', { key: 'message', className: 'dshgit-hint', style: { whiteSpace: 'pre-wrap' } }, detail.message)
      : null,
  ])

  if (diff === null) {
    return h(Fragment, null, [header, h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))])
  }

  var files = diff.files || []
  if (files.length === 0) {
    return h(Fragment, null, [
      header,
      // A refused oversized diff arrives with no files and no hunks, which
      // without this branch is indistinguishable from "no differences" —
      // the exact opposite of the truth.
      h('div', { key: 'empty', className: 'dshgit-empty' },
        diff.tooLarge === true ? t('state.diffTooLarge', { size: formatBytes(diff.bytes || 0) }) : t('state.emptyDiff')),
    ])
  }

  var nodes = []
  for (var i = 0; i < files.length; i++) {
    var file = files[i]
    nodes.push(
      h('div', { key: 'f' + i }, [
        h('div', { key: 'h', className: 'dshgit-card', style: { marginBottom: '0', cursor: 'pointer' },
          onClick: function () { props.onOpenRevisionFile(props.selection.sha, file.path, file.from) },
        }, [
          h('div', { key: 'top', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
            h('span', { key: 's', className: 'dshgit-badge', 'data-status': file.status }, file.status),
            h('span', { key: 'p', className: 'dshgit-name' + (file.status === 'D' ? ' dshgit-struck' : '') }, file.path),
            file.from !== null && file.from !== undefined
              ? h('span', { key: 'f', className: 'dshgit-muted' }, '← ' + file.from)
              : null,
          ]),
        ]),
        h(DiffBody, { t: t,
          key: 'body',
          path: file.path,
          hunks: file.hunks,
          emptyText: file.binary === true ? '（二进制文件）' : t('state.emptyDiff'),
        }),
      ]),
    )
  }
  return h(Fragment, null, [header, h('div', { key: 'files-and-diff', className: 'dshgit-commitfiles' }, [
    // The grip is absolutely positioned against this pane, so the pane itself
    // must not scroll: the list scrolls inside an inner wrapper instead, and
    // the grip stays pinned to the border.
    h('div', { key: 'nav', className: 'dshgit-commitfiles-nav' }, [
      h(PaneResizeHandle, { key: 'resize', t: t }),
      h('div', { key: 'list', className: 'dshgit-commitfiles-list' },
        (detail?.files || files).map(function (file) {
          return h('button', { key: file.path, type: 'button', className: 'dshgit-treerow', 'data-status': file.status || 'M',
            style: { width: '100%', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left' },
            onClick: function () { props.onOpenRevisionFile(props.selection.sha, file.path, file.from) },
          }, [h('span', { key: 'status', className: 'dshgit-status', 'data-status': file.status || 'M' }, file.status || 'M'), ' ', h('span', { key: 'path', className: 'dshgit-name' }, file.path)])
        }))]),
    h('div', { key: 'diff', className: 'dshgit-commitfiles-main' }, nodes),
  ])])
}


/** History keeps commit navigation visible while previewing one file. */
function HistoryCommitDetails(props) {
  var t = props.t
  var detailState = React.useState(null), errorState = React.useState(null), retryState = React.useState(0)
  var pathState = React.useState(props.compact ? null : props.initialPath || null), searchState = React.useState(''), limitState = React.useState(100)
  var filePicker = React.useRef(null), fileListNode = React.useRef(null), fileListScroll = React.useRef(0)
  // The graph's compact panel already expands a file over the whole pane; the
  // history tab's three-column detail had no equivalent, so a narrow code
  // column could not be read without collapsing the window by hand. Same view,
  // toggled by a button in the code toolbar instead of implicitly by a click.
  var expandedState = React.useState(false)
  var pickerOpen = props.compact ? props.previewOpen === true : expandedState[0]
  React.useEffect(function () {
    var dismiss = function (event) { if (filePicker.current && !filePicker.current.contains(event.target)) filePicker.current.open = false }
    var escape = function (event) {
      if (event.key !== 'Escape') return
      if (filePicker.current?.open) { filePicker.current.open = false; event.stopPropagation(); return }
      if (!props.compact) expandedState[1](false)
    }
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape)
    return function () { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [props.compact])
  React.useLayoutEffect(function () {
    if (props.compact && !props.previewOpen && fileListNode.current) fileListNode.current.scrollTop = fileListScroll.current
  }, [props.previewOpen])
  var cacheRef = React.useRef(new Map())
  var reviewRevision = React.useState(0)
  React.useEffect(function () {
    return subscribeReviewPrefs(function () {
      cacheRef.current = new Map()
      reviewRevision[1](function (value) { return value + 1 })
    })
  }, [])
  React.useEffect(function () {
    // Browsing commits is a READ, so it must not touch the panel-wide busy
    // counter (`silent`). That counter is what disables fetch/pull/push and
    // spins the status bar; without `silent`, merely looking at a commit made
    // the whole panel report "git is running…", so a second click while the
    // first was still loading left the UI locked until the slowest read
    // finished. The loading state this view needs is its own: `detail === null`
    // renders the placeholder below.
    //
    // The controller aborts the in-flight read when the user clicks another
    // commit. Without it, every click left its own `git show` running to
    // completion while the result was thrown away, so switching quickly piled
    // up processes and made each new click wait behind them.
    var controller = new AbortController()
    var active = true
    detailState[1](null); errorState[1](null); cacheRef.current = new Map()
    props.run('commit', { root: props.repo.root, sha: props.sha },
      { silent: true, silentError: true, signal: controller.signal })
      .then(function (value) {
        if (!active) return
        var files = (value.files || []).map(function (file) { return Object.assign({}, file, { from: file.from || file.originalPath || null }) })
        value = Object.assign({}, value, { files: files })
        detailState[1](value)
        pathState[1](function (path) { return files.some(function (file) { return file.path === path }) ? path : props.compact ? null : files[0]?.path || null })
      }).catch(function (failure) {
        // An aborted read is not a failure: the user moved on deliberately.
        if (active) errorState[1](failure.message)
      })
    return function () { active = false; controller.abort() }
  }, [props.repo.root, props.sha, retryState[0]])
  var detail = detailState[0], files = detail?.files || []
  React.useEffect(function () {
    if (props.initialPath && files.some(function (file) { return file.path === props.initialPath })) pathState[1](props.initialPath)
  }, [props.initialPath, detail])
  var loadFile = React.useCallback(function readHistoryFile(file, mode, signal) {
    var key = mode + ':' + file.path, cache = cacheRef.current
    if (cache.has(key)) { var hit = cache.get(key); cache.delete(key); cache.set(key, hit); return Promise.resolve(hit.value) }
    var parent = detail?.parents?.[0]
    // A read, so `silent`: loading a file's patch while browsing history must
    // not disable the write controls or spin the status bar.
    // 'content' is the whole file at this commit with the commit's changes
    // marked inline, so it composes the two other reads instead of a third.
    var promise = mode === 'content' ? readAnnotatedPreview(readHistoryFile(file, 'after', signal), function () {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        return readHistoryFile(file, 'diff', signal)
      }, file.path, !parent)
      : mode === 'before' && !parent ? Promise.resolve({ exists: false, text: '', binary: false })
      : mode === 'diff' ? props.run('diff', withReviewPrefs({ root: props.repo.root, commit: props.sha,
          from: parent || props.sha + '^', to: props.sha, path: file.path, originalPath: file.from, previewOnly: true }),
          { silent: true, silentError: true, signal: signal })
        : props.run('fileContent', { root: props.repo.root,
            path: mode === 'before' ? file.from || file.path : file.path,
            rev: mode === 'before' ? parent : props.sha }, { silent: true, silentError: true, signal: signal })
    // Cache completed reads only. In-flight work belongs to the selected
    // view and must be cancellable without poisoning the next selection.
    promise.then(function (value) {
      if (signal?.aborted || cache !== cacheRef.current) return
      if (value.lfsOid && !value.image && !value.truncated) return
      var weight = (value.text || '').length + (value.image || '').length
      ;(value.changeHunks || []).forEach(function (hunk) { (hunk.lines || []).forEach(function (line) { weight += line.length }) })
      ;(value.files || []).forEach(function (file) { (file.hunks || []).forEach(function (hunk) { hunk.lines.forEach(function (line) { weight += line.length }) }) })
      if (weight > 1500000) return
      cache.set(key, { value: value, weight: weight })
      var size = 0; cache.forEach(function (entry) { size += entry.weight })
      while (cache.size > 4 || size > 3000000) { var oldest = cache.keys().next().value; size -= cache.get(oldest).weight; cache.delete(oldest) }
    }, function () {})
    return promise
  }, [props.repo.root, props.sha, props.run, detail, reviewRevision[0]])
  if (errorState[0]) return h('div', { className: 'dshgit-card', role: 'alert' }, [
    props.actions || null,
    h('div', { key: 'message' }, t('history.detailFailed', { message: errorState[0] })),
    h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () { retryState[1](retryState[0] + 1) } }, t('stash.retry')),
  ])
  if (detail === null) return h(Fragment, null, [props.actions || null, h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))])
  var query = searchState[0].trim().toLowerCase()
  var matched = files.filter(function (file) { return !query || file.path.toLowerCase().indexOf(query) !== -1 || (file.from || '').toLowerCase().indexOf(query) !== -1 })
  var visible = matched.slice(0, limitState[0]), selected = files.find(function (file) { return file.path === pathState[0] })
  var selectedIndex = files.indexOf(selected)
  var selectFile = function (path) {
    if (!pickerOpen && fileListNode.current) fileListScroll.current = fileListNode.current.scrollTop
    pathState[1](path)
    if (filePicker.current?.open) { filePicker.current.open = false; filePicker.current.querySelector('summary')?.focus() }
    props.onPreviewOpen?.()
  }
  var fileMenu = props.onFileMenu ? function (event, file) { props.onFileMenu(event, file, props.sha) } : undefined
  var messageBody = String(detail.message || '').replace(/\r\n/g, '\n').trim(), subjectText = String(detail.subject || '').trim()
  if (messageBody === subjectText) messageBody = ''
  else if (messageBody.startsWith(subjectText + '\n')) messageBody = messageBody.slice(subjectText.length).trim()
  var fileNavigation = h(Fragment, null, [
    h(StashFileNavigation, { key: 'files', root: props.repo.root, files: visible, selected: pathState[0], onSelect: selectFile, onFileMenu: fileMenu, t: t,
      search: h('input', { key: 'search', type: 'search', className: 'dshgit-input', value: searchState[0],
        placeholder: t('list.searchFiles'), 'aria-label': t('list.searchFiles'),
        onChange: function (event) { searchState[1](event.currentTarget.value); limitState[1](100) },
      }) }),
    matched.length === 0 ? h('div', { key: 'empty', className: 'dshgit-sidebar-hint' }, t(query ? 'list.noMatches' : 'state.emptyDiff')) : null,
    matched.length > visible.length ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn dshgit-list-more',
      onClick: function () { limitState[1](limitState[0] + 100) },
    }, t('action.loadMore') + ' (' + visible.length + '/' + matched.length + ')') : null,
  ])
  // The picker toolbar belongs to the expanded view in BOTH layouts: the
  // graph's compact panel (where a click expands implicitly) and the history
  // tab (where the toolbar button below does it explicitly).
  var fileControls = pickerOpen ? h(Fragment, null, [
      h('details', { key: 'picker', ref: filePicker, className: 'dshgit-history-filepicker' }, [
        h('summary', { key: 'selected', title: selected?.path || t('stash.allFiles') }, [h(IconChevron, { key: 'icon', size: 14 }), h('span', { key: 'path' }, selected?.path || t('stash.allFiles'))]),
        h('div', { key: 'menu', className: 'dshgit-history-filemenu' }, fileNavigation),
      ]),
      h('span', { key: 'count', className: 'dshgit-muted' }, (selectedIndex >= 0 ? selectedIndex + 1 : 0) + ' / ' + files.length),
      h('button', { key: 'previous', type: 'button', className: 'dshgit-iconbtn', title: t('action.previousFile'), 'aria-label': t('action.previousFile'), disabled: selectedIndex <= 0,
        onClick: function () { selectFile(files[selectedIndex - 1].path) } }, '‹'),
      h('button', { key: 'next', type: 'button', className: 'dshgit-iconbtn', title: t('action.nextFile'), 'aria-label': t('action.nextFile'), disabled: selectedIndex < 0 || selectedIndex >= files.length - 1,
        onClick: function () { selectFile(files[selectedIndex + 1].path) } }, '›'),
      h(CopyFilePathsButton, { key: 'copy-paths:' + props.sha, files: files, t: t, history: true }), h(HistoryZipExport, { key: 'zip:' + props.sha, root: props.repo.root, rev: props.sha, files: files, run: props.run, t: t }),
    ]) : null
  return h('div', { className: 'dshgit-stash-details dshgit-history-details', 'data-history-commit': props.sha, 'data-preview-root': props.repo.root, 'data-compact': props.compact === true, 'data-preview-open': props.previewOpen === true }, [
    h('div', { key: 'header', className: 'dshgit-card' }, [
      h('div', { key: 'heading', className: 'dshgit-history-heading' }, [
        h('div', { key: 'subject', className: 'dshgit-history-subject', title: detail.subject }, detail.subject),
        props.compact ? h('span', { key: 'sha', className: 'dshgit-muted', title: detail.sha }, detail.shortSha || props.sha.slice(0, 8)) : null,
        props.compact ? h('details', { key: 'info', className: 'dshgit-history-message' }, [
          h('summary', { key: 'toggle' }, t('label.message')),
          h('div', { key: 'body', className: 'dshgit-history-message-body' }, [detail.author + ' · ' + formatTime(detail.authorDate),
            (detail.parents || []).length ? t('wb.parent') + ': ' + detail.parents.join(', ') : '', detail.message || detail.subject].filter(Boolean).join('\n')),
        ]) : null,
        props.onMenu && !props.actions ? h('button', { key: 'more', type: 'button', className: 'dshgit-iconbtn', title: t('menu.actions'), 'aria-label': t('menu.actions'),
          onClick: function (event) { props.onMenu(event, props.sha) } }, h(IconMore, { size: 16 })) : null,
        props.actions || null,
      ]),
      !props.compact ? h('div', { key: 'meta', className: 'dshgit-history-meta' }, [
        h('span', { key: 'sha', title: detail.sha }, detail.shortSha || props.sha.slice(0, 8)),
        h('span', { key: 'author' }, detail.author),
        h('span', { key: 'date' }, formatTime(detail.authorDate)),
        (detail.parents || []).length ? h('span', { key: 'parents', title: detail.parents.join('\n') }, t('wb.parent') + ': ' + detail.parents.map(function (sha) { return sha.slice(0, 10) }).join(', ')) : null,
        messageBody ? h('details', { key: 'message', className: 'dshgit-history-message' }, [
          h('summary', { key: 'toggle' }, t('label.message')),
          h('div', { key: 'body', className: 'dshgit-history-message-body' }, messageBody),
        ]) : null,
      ]) : null,
      // The explanation lives next to the commit it explains. It used to be reachable
      // only from a component nothing rendered, and its answer arrived in an `alert()`,
      // which cannot be scrolled or copied — so the feature was implemented, reachable
      // over RPC, and unusable.
      props.run ? h(ExplainPanel, { key: 'explain', repo: props.repo, sha: props.sha, run: props.run, t: t }) : null,
    ]),
    props.compact ? h('div', { key: 'files-list', ref: fileListNode, className: 'dshgit-history-files-list', style: props.previewOpen ? { display: 'none' } : undefined,
      onScroll: function (event) { if (!props.previewOpen) fileListScroll.current = event.currentTarget.scrollTop } }, [
      h('div', { key: 'count', className: 'dshgit-sidebar-head' }, [h('span', { key: 'label' }, t('count.files', { count: files.length })),
        h(CopyFilePathsButton, { key: 'copy-paths:' + props.sha, files: files, t: t, history: true }), h(HistoryZipExport, { key: 'zip:' + props.sha, root: props.repo.root, rev: props.sha, files: files, run: props.run, t: t })]),
      fileNavigation,
    ]) : null,
    h('div', { key: 'body', className: 'dshgit-stash-detailbody', style: props.compact && !props.previewOpen ? { display: 'none' } : undefined }, [
      !props.compact ? h('div', { key: 'nav', className: 'dshgit-stash-filenav', style: pickerOpen ? { display: 'none' } : undefined }, [
        h(PaneResizeHandle, { key: 'resize', t: t }),
        h('div', { key: 'count', className: 'dshgit-sidebar-head' }, [
          h('span', { key: 'label' }, t('count.files', { count: files.length })),
          h(CopyFilePathsButton, { key: 'copy-paths:' + props.sha, files: files, t: t, history: true }), h(HistoryZipExport, { key: 'zip:' + props.sha, root: props.repo.root, rev: props.sha, files: files, run: props.run, t: t }),
        ]),
        fileNavigation,
      ]) : null,
      h('div', { key: 'preview', className: 'dshgit-stash-preview' }, selected && (!props.compact || props.previewOpen)
        ? h(HistoryFilePreview, { key: selected.path, file: selected, compact: props.compact, expanded: !props.compact && pickerOpen,
            onToggleExpand: props.compact ? undefined : function () { expandedState[1](function (value) { return !value }) },
            fileControls: fileControls, loadFile: loadFile, onFileMenu: fileMenu,
            exportFile: { run: props.run, root: props.repo.root, rev: props.sha, parent: detail.parents?.[0] },
            loadImage: { run: props.run, root: props.repo.root, from: detail.parents?.[0] || 'EMPTY', to: props.sha },
            // Blame is offered at the commit being viewed, not at the working tree: the
            // user is asking about THIS revision, and blaming the checkout would answer
            // about a different file.
            blame: { repo: props.repo, rev: props.sha, parentRev: detail.parents?.[0], run: props.run, t: t },
            onOpenCommit: props.onOpenBlameCommit || props.onOpenCommit,
            onRestore: props.onFileRestore ? function () { props.onFileRestore(props.sha, selected.path) } : null, t: t })
        : h('div', { className: 'dshgit-empty' }, t('state.emptyDiff'))),
    ]),
  ])
}


function HistoryFilePreview(props) {
  var modeState = React.useState(function () { return readPreviewMode(props.loadImage?.root, props.loadImage?.to + ':' + props.file.path, 'diff') }), valueState = React.useState(null), errorState = React.useState(null), retryState = React.useState(0)
  // Whether the attribution column is showing. Local to this preview because it is a
  // way of looking at ONE file; carrying it in the window state would follow the user
  // to the next file for no reason.
  var blameState = React.useState(false)
  React.useEffect(function () { writePreviewMode(props.loadImage?.root, props.loadImage?.to + ':' + props.file.path, modeState[0]) }, [modeState[0]])
  // A different file starts with the column closed, so the previous file's choice does
  // not silently apply to a file the user has not looked at yet.
  React.useEffect(function () { blameState[1](false) }, [props.file.path])
  React.useEffect(function () {
    var active = true, controller = new AbortController()
    valueState[1](null); errorState[1](null)
    var read = props.loadFile(props.file, modeState[0], controller.signal)
    read.then(function (value) { if (active) valueState[1](value) })
      .catch(function (failure) { if (active) errorState[1](failure.message) })
    return function () { active = false; controller.abort() }
  }, [props.file.path, props.loadFile, modeState[0], retryState[0]])
  var value = valueState[0], patch = (value?.files || []).find(function (file) { return file.path === props.file.path })
  var tools = h('div', { key: 'tools', className: 'dshgit-history-filetools' }, [
    h(ReviewPrefsButton, { key: 'review', t: props.t }),
    // 差异与文件内容是同一份正文的两种读法，永远二选一，所以做成一个切换按钮：
    // 标签显示“点下去会切到哪个视图”，文案与改动列表的 PreviewModeControls
    // 完全一致（action.viewDiff / action.viewFile）。
    // 提交前/提交后是三个互斥视图里的另外两个，保持图标形式。
    h('div', { key: 'views', className: 'dshgit-history-viewmodes', role: 'group', 'aria-label': props.t('action.viewMode') }, [
      h('button', { key: 'toggle', type: 'button', className: 'dshgit-btn dshgit-history-viewtoggle', 'data-preview-mode': true,
        'data-history-view': modeState[0] === 'content' ? 'diff' : 'content',
        title: props.t(modeState[0] === 'content' ? 'action.viewDiff' : 'action.viewFile'),
        onClick: function () { modeState[1](modeState[0] === 'content' ? 'diff' : 'content') },
      }, props.t(modeState[0] === 'content' ? 'action.viewDiff' : 'action.viewFile')),
    ].concat(['before', 'after'].map(function (mode) { return h('button', {
      key: mode, type: 'button', className: 'dshgit-iconbtn',
      title: props.t(mode === 'before' ? 'action.viewBefore' : 'action.viewAfter'),
      'aria-label': props.t(mode === 'before' ? 'action.viewBefore' : 'action.viewAfter'),
      'aria-pressed': modeState[0] === mode, 'data-history-view': mode, onClick: function () { modeState[1](mode) },
    }, h(IconChangeAction, { kind: mode, size: 16 })) }))),
    // 放大/还原：把当前文件的差异铺满整个详情区，收起左侧文件列表。
    // 提交图面板点文件即隐式进入这个状态；历史标签页用这个按钮显式切换。
    props.onToggleExpand ? h('button', {
      key: 'expand', type: 'button', className: 'dshgit-iconbtn dshgit-history-expand',
      title: props.t(props.expanded ? 'fileViewer.restore' : 'fileViewer.maximize'),
      'aria-label': props.t(props.expanded ? 'fileViewer.restore' : 'fileViewer.maximize'),
      'aria-pressed': props.expanded === true,
      onClick: props.onToggleExpand,
    }, h(IconChangeAction, { kind: props.expanded ? 'collapse' : 'expand', size: 16 })) : null,
    props.exportFile || props.onRestore ? h('div', { key: 'actions', className: 'dshgit-history-fileactions' }, [
    props.exportFile ? h(HistoryFileExport, { key: 'export:' + modeState[0], run: props.exportFile.run, root: props.exportFile.root,
      rev: modeState[0] === 'before' || (modeState[0] === 'diff' && props.file.status === 'D') ? props.exportFile.parent : props.exportFile.rev,
      path: modeState[0] === 'before' || (modeState[0] === 'diff' && props.file.status === 'D') ? props.file.from || props.file.path : props.file.path, t: props.t }) : null,
    props.onRestore ? h('button', {
        key: 'restore', type: 'button', className: 'dshgit-iconbtn dshgit-history-restore', title: props.t('wb.restoreRevision'), 'aria-label': props.t('wb.restoreRevision'), onClick: props.onRestore,
      }, h(IconChangeAction, { kind: 'restoreRevision', size: 16 })) : null,
    ]) : null,
    // Attribution is a THIRD view of the same file, not a mode switch: it answers a
    // question ("who wrote this line") that must be readable while the code stays on
    // screen. Offered only for a text file at a known revision, because a working-tree
    // blame of a file that is not checked out would attribute nothing.
    props.blame && modeState[0] !== 'diff' && value?.exists !== false && !isImagePath(props.file.path)
      ? h('button', {
        key: 'blame', type: 'button', className: 'dshgit-iconbtn dshgit-history-blame',
        title: props.t('action.blameAll'), 'aria-label': props.t('action.blameAll'),
        'aria-pressed': blameState[0] === true, 'data-blame-toggle': props.file.path,
        onClick: function () { blameState[1](!blameState[0]) },
      }, '⌗')
      : null,
  ])
  // A commit's changed image has no text diff to show — git only says
  // "Binary files differ" — so the comparison takes the diff slot.
  // A refused oversized diff has no hunks by construction, which would render
  // as the ordinary empty-diff text. Saying "no differences" about a diff
  // that exists and is enormous is worse than saying nothing, so it gets its
  // own message and the size that caused the refusal.
  var tooLarge = value !== null && value.tooLarge === true
  var body = errorState[0] ? h('div', { className: 'dshgit-card', role: 'alert' }, [
    h('span', { key: 'message' }, errorState[0]),
    h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () { retryState[1](retryState[0] + 1) } }, props.t('stash.retry')),
  ]) : value === null ? h('div', { className: 'dshgit-empty' }, props.t('state.loading'))
    : tooLarge ? h('div', { className: 'dshgit-empty' },
        props.t(value.lineLimit ? 'state.diffTooManyLines' : 'state.diffTooLarge', { size: formatBytes(value.bytes || 0) }))
    : modeState[0] === 'diff' ? (isImagePath(props.file.path) && props.loadImage
        ? h(ImageDiffView, { run: props.loadImage.run, root: props.loadImage.root, path: props.file.path,
            originalPath: props.file.from, from: props.loadImage.from, to: props.loadImage.to, t: props.t })
        : h(DiffBody, { path: props.file.path, hunks: patch?.hunks || [], t: props.t, emptyText: patch?.binary || props.file.binary ? props.t('state.fileBinary') : props.t('state.emptyDiff') }))
      : h(FilePreview, { blob: value, path: modeState[0] === 'before' ? props.file.from || props.file.path : props.file.path, t: props.t })
  var file = Object.assign({}, props.file, modeState[0] === 'diff' ? patch || {} : {})
  return h(Fragment, null, [
    // Keep the picker outside the clipped card and the code scroller. Its
    // popup must remain clickable even when a patch has only one line.
    props.compact ? h('div', { key: 'toolbar', className: 'dshgit-filediff-head dshgit-history-filesbar',
      onContextMenu: props.onFileMenu ? function (event) { props.onFileMenu(event, file) } : undefined,
    }, [props.fileControls, tools, h(DiffStats, { key: 'stats', file: file })]) : null,
    h('div', { key: 'diff', className: 'dshgit-stash-diff', 'data-preview-revision': (props.loadImage?.to || '') + ':' + modeState[0] }, h(FileDiffCard, {
      file: file, onFileMenu: props.onFileMenu, compact: props.compact, hideHeader: props.compact, tools: tools, t: props.t,
    }, body)),
    // The blame column sits BESIDE the code rather than replacing it: attribution is
    // read while comparing it to the line it describes, and swapping the code out
    // loses the question being asked.
    blameState[0] && props.blame && modeState[0] !== 'diff' && value?.exists !== false
      && (modeState[0] !== 'before' || props.blame.parentRev)
      ? h(BlamePanel, { key: 'blame', repo: props.blame.repo,
          path: modeState[0] === 'before' ? props.file.from || props.file.path : props.file.path,
          rev: modeState[0] === 'before' ? props.blame.parentRev : props.blame.rev,
          run: props.blame.run, onOpenCommit: props.onOpenCommit, t: props.t })
      : null,
  ])
}

export { CommitDiffView, HistoryCommitDetails, HistoryFilePreview }

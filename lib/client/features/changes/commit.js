import { React, h } from '../../core/runtime.js'
import { Menu } from '../../ui/controls.js'
import { IconChevron } from '../../ui/icons.js'
import { ChangeGroup, ChangeRowActions, FileBatchActions, changelistFileActions, groupBatchActions, useFileBatch, useFileFilter } from './actions.js'
import { changelistHasFile, changelistSelection } from './model.js'
import { ChangelistCheckbox, ChangelistFiles, ChangelistLayoutSwitch } from './view.js'
import { baseName, isPartial, isStaged, isUnstaged, statusLetter } from '../../core/files.js'
import { getWindowState, setWindowState, usePluginConfig } from '../../core/state.js'
import { changeFileLabel } from '../../ui/file-icons.js'
import { changelistListMenu, moveWholeFilesMenu } from './list-menu.js'
import { useChangelistOrder } from './list-order.js'
import { CommitScopePreview } from './scope-preview.js'

/**
 * One VS Code style primary action with a separate options chevron.
 *
 * The chevron is a real menu, not a toggle: it replaces the two checkboxes
 * that used to sit above the button, which cost a row of height and made the
 * commit scope look like a form to fill in. Choosing an item runs it
 * directly, so there is no armed mode left behind for a later click on the
 * pill to stumble into.
 *
 * `disabled` and `pending` are SEPARATE because they answer different
 * questions. `disabled` means "this control is not usable right now", which is
 * true while an unrelated write is in flight — ticking a file writes the
 * changelist metadata, and committing mid-write would send a stale scope
 * version. `pending` means "the action THIS control performs is running", and
 * only that earns a spinner. Merging the two made every checkbox tick spin the
 * commit button, claiming a commit that was not happening.
 */
function CommitActions(props) {
  // The two halves are ONE control, so they enable and disable together. When
  // the pill greyed out but the chevron stayed saturated the pair read as
  // broken: a dead label beside a live-looking button.
  var unavailable = props.disabled === true || props.pending === true
  return h('div', { className: 'dshgit-commit-actions' }, [
    h('div', { key: 'main', className: 'dshgit-commit-split',
      'data-has-menu': props.options.length > 0 ? 'true' : 'false',
      'data-disabled': unavailable ? 'true' : 'false',
    }, [
      h('button', {
        key: 'primary', type: 'button', className: 'dshgit-btn dshgit-btn-primary dshgit-commit-primary',
        disabled: props.disabled, 'aria-busy': props.pending === true,
        'aria-keyshortcuts': props.shortcut ? 'Control+Enter Meta+Enter' : undefined,
        title: props.hint, onClick: props.onPrimary,
      }, [props.pending ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true }) : null,
        h('span', { key: 'label' }, props.label)]),
      props.options.length === 0 ? null : h(Menu, {
        key: 'options', t: props.t, rootClass: 'dshgit-commit-menu-root',
        triggerClass: 'dshgit-commit-arrow', align: 'right', disabled: unavailable,
        label: h(IconChevron, { open: true, size: 15 }),
        title: props.t('menu.actions'), items: props.options, portal: true,
        menuClass: 'dshgit-commit-options',
      }),
    ]),
  ])
}


function CommitFormContainer(props) {
  return h('div', { className: 'dshgit-commit-fold ' + (props.className || '') }, props.children)
}


/**
 * The commit panel: staged and unstaged lists with per-file actions, plus the
 * message box.
 *
 * The staged section defines the commit scope; when empty, the primary
 * action explicitly offers to stage and commit all changes.
 *
 * @param props - the panel's state and callbacks.
 */
function ChangelistCommitPanel(props) {
  var model = props.changelists, data = model.data, t = props.t
  var search = React.useState(''), untrackedOpen = React.useState(true)
  var query = search[0].trim().toLowerCase()
  var files = props.status?.files || []
  var fileFilter = useFileFilter(files, t)
  files = fileFilter.files
  var createList = props.prompt ? function (paths, from) {
    props.prompt({ title: t('cl.create'), compact: true, fields: [
      { key: 'name', label: t('cl.name'), value: '' },
      { key: 'makeActive', label: t('cl.active'), type: 'checkbox', value: false },
    ], submit: t('action.ok'), onSubmit: function (values) {
      return model.mutate({ action: 'create', name: values.name, makeActive: values.makeActive, paths: paths, from: from })
    } })
  } : null
  var batch = useFileBatch(Object.assign({}, props, { onCreateList: createList }), files, query)
  var order = useChangelistOrder(props)
  var groups = data ? data.lists.map(function (list) { return { id: list.id, name: list.id === 'default' && list.name === '默认' ? t('cl.default') : list.name, expanded: list.expanded !== false, commitBlocked: list.commitBlocked === true, files: files.filter(function (file) { return changelistHasFile(data, list.id, file.path) }) } }) : []
  var unassigned = files.filter(function (file) { return !data?.assignments[file.path] })
  if (unassigned.length) groups.push({ id: 'untracked', name: t('cl.untracked'), expanded: untrackedOpen[0], files: unassigned })
  var visible = groups.filter(function (group) { return group.files.length || (files.length && !query) }).map(function (group) {
    return Object.assign({}, group, { matched: group.files.filter(function (file) { return !query || group.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query) }) })
  }).filter(function (group) { return group.matched.length || (files.length && !query) })
  return h('div', { className: 'dshgit-commitpanel dshgit-cl-commitpanel', onKeyDown: batch.keydown, onClick: batch.blank,
    onContextMenu: function (event) {
      if (!data || event.defaultPrevented || event.target.closest?.('input,textarea,button,select,a,.dshgit-cl-head,.dshgit-change,.dshgit-cl-error')) return
      batch.folderMenu(event, [])
    },
  }, [
    h(CommitFormContainer, { key: 'composer', t: t }, h(CommitComposer, Object.assign({}, props))),
    model.error ? h('div', { key: 'error', role: 'alert', className: 'dshgit-cl-error' }, [model.error,
      h('button', { key: 'retry', className: 'dshgit-btn', onClick: model.retry }, t('action.retryRead'))]) : null,
    h('div', { key: 'search', className: 'dshgit-cl-search' }, [h('input', { key: 'input', type: 'search', className: 'dshgit-input', value: search[0], placeholder: t('cl.search'), 'aria-label': t('cl.search'), onChange: function (event) { search[1](event.currentTarget.value) } }), h(ChangelistLayoutSwitch, { key: 'layout', changelists: model, t: t, busy: props.busy })]),
    fileFilter.control, batch.overlay,
    h('div', { key: 'lists', className: 'dshgit-commitlists', 'data-file-scroll': true }, !data ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading')) : !visible.length ? h('div', { className: 'dshgit-empty' }, t(query ? 'list.noMatches' : 'commit.nothing')) : visible.map(function (group) {
      var choice = changelistSelection(data, group.id, group.matched), checked = choice.checked.length
      var open = !!query || group.expanded
      var toggle = function () { if (group.id === 'untracked') untrackedOpen[1](!open); else model.mutate({ action: 'expand', id: group.id, expanded: !open }).catch(function () {}) }
      return h('div', { key: group.id, className: 'dshgit-cl-group', 'data-commit-blocked': group.commitBlocked === true }, [h('div', Object.assign({ key: 'head', className: 'dshgit-cl-head', 'data-changelist-id': group.id, onContextMenu: function (event) {
        var list = data.lists.find(function (entry) { return entry.id === group.id })
        if (list) batch.showMenu(event, changelistListMenu(Object.assign({}, props, { onCreateList: createList ? function () { createList([]) } : undefined }), list, group.files))
        else batch.folderMenu(event, group.matched, { createEmpty: true })
      } }, order.header(group.id, batch.drop(group.id, open, toggle))), [
        h('button', { key: 'fold', type: 'button', className: 'dshgit-iconbtn', 'aria-label': group.name, 'aria-expanded': open, disabled: props.busy, onClick: toggle }, h(IconChevron, { size: 16, open: open })),
        h(ChangelistCheckbox, { key: 'check', label: group.name, checked: group.matched.length > 0 && checked === group.matched.length, mixed: choice.mixed.length > 0 || (checked > 0 && checked < group.matched.length),
          disabled: props.busy || group.commitBlocked || !group.matched.length, onChange: function (event) { model.mutate({ action: 'select', id: group.id === 'untracked' ? undefined : group.id, paths: group.matched.filter(function (file) { return file.kind !== 'unmerged' }).map(function (file) { return file.path }), checked: event.currentTarget.checked }).catch(function () {}) } }),
        h('button', Object.assign({ key: 'label', type: 'button', className: 'dshgit-name dshgit-cl-toggle', disabled: props.busy, 'aria-expanded': open, onClick: toggle, title: group.name }, order.handle(group.id)), [h('span', { key: 'title', className: 'dshgit-cl-title' }, group.name), data.active === group.id ? h('span', { key: 'active', className: 'dshgit-cl-active', title: t('cl.activeHint') }, '●') : null]),
        h(FileBatchActions, Object.assign({}, props, { key: 'batch', files: group.matched })),
        h('span', { key: 'count', className: 'dshgit-cl-count' }, query ? group.matched.length + '/' + group.files.length : group.files.length),
      ]), open ? h(ChangelistFiles, { key: 'files', listId: group.id, batch: batch, layout: data.fileLayout || 'tree', filterKey: query, files: group.matched, checked: choice.checked, mixed: choice.mixed, multi: props.selectedPath ? [props.selectedPath] : [], busy: props.busy, commitBlocked: group.commitBlocked,
        renderActions: function (file) { return changelistFileActions(props, file, function () { props.onOpenFile(file.path) }) },
        onCheck: function (paths, checked) { model.mutate({ action: 'select', id: group.id === 'untracked' ? undefined : group.id, paths: paths, checked: checked }).catch(function () {}) }, onOpenFile: function (file) { props.onOpenFile(file.path) }, onSelect: function (file) { props.onOpenFile(file.path) },
        // The same per-file menu as the plain list. Right-clicking a file used
        // to jump straight to the full window, which answered a question
        // nobody asked: the menu is what a right-click means on a file row.
        //
        // The section is derived from the FILE, not the group: in changelist
        // mode a group is a changelist, not a staged/unstaged bucket, so its id
        // says nothing about which half of a partially-staged file this is.
        // A file that is partly staged counts as unstaged here, so the worktree
        // half — the part with a change still to lose — stays actionable.
        onMenu: function (event, file) { if (props.onFileMenu && file) props.onFileMenu(event, file, isStaged(file) && !isUnstaged(file) ? 'staged' : 'unstaged', [
          moveWholeFilesMenu(props, file.kind === 'unmerged' ? [] : [file.path], group.id),
        ].concat(createList ? [
          { id: 'new-list', label: t('cl.create'), disabled: props.busy || model.loading || model.pending, run: function () { createList([file.path], group.id === 'untracked' ? undefined : group.id) } },
        ] : [])) },
      }) : null])
    })),
    h('div', { key: 'foot', className: 'dshgit-pickfoot' }, [
      h('button', { key: 'full', type: 'button', className: 'dshgit-pickinline', onClick: props.onOpenFull }, t('commit.openFull')),
    ]),
  ])
}


function CommitPanel(props) {
  var config = usePluginConfig(props.run)
  var aiEnabled = config !== null && config.aiEnabled !== false
  var t = props.t
  var search = React.useState(''), query = search[0].trim().toLowerCase()
  var layout = props.changelists?.data?.fileLayout || 'tree'
  var validationState = React.useState(null)
  var validation = validationState[0]
  var setValidation = validationState[1]
  var messageRef = React.useRef(null)
  var scopeFiles = props.status?.files || []
  var hasConflicts = scopeFiles.some(function (file) { return file.kind === 'unmerged' })
  var files = scopeFiles
  var fileFilter = useFileFilter(files, t)
  files = fileFilter.files
  var batch = useFileBatch(props, files, query)
  var staged = files.filter(isStaged)
  var unstaged = files.filter(isUnstaged)
  var commitLabel = t(staged.length > 0 || files.length === 0 ? 'action.commit' : 'commit.all')
  var progressKey = { push: 'sync.pushing', pull: 'sync.pulling', fetch: 'sync.fetching', commit: 'commit.inProgress', stage: 'commit.inProgress' }[props.busyMethod] || 'state.loading'
  var submit = function (action) {
    if (props.status?.files?.some(function (file) { return file.kind === 'unmerged' })) { setValidation(t('conflict.resolveRemaining')); return }
    if (props.busy === true || files.length === 0) return
    if (props.message.trim() === '') {
      setValidation(t('commit.requiredMessage'))
      messageRef.current?.focus?.()
      return
    }
    setValidation(null)
    action()
  }

  /** A file row, with actions that appear on hover or keyboard focus. */
  var row = function (file, section, style) {
    var partial = isPartial(file)
    return h('div', {
      // A partially staged file is in both lists, so the key must include
      // which list this instance belongs to or React would see duplicates.
      key: (section === 'staged' ? 's:' : 'u:') + file.path,
      className: 'dshgit-row dshgit-change dshgit-pickfile' + (partial ? ' dshgit-partial' : ''),
      style: style,
      'data-status': statusLetter(file),
      'data-selected': props.selectedPath === file.path,
      'data-partial': partial === true ? 'true' : 'false',
      title: file.path,
      // Clicking the row opens the file — the popover's own content is a
      // list, and a list with no way into the file is a dead end.
      onClick: function () { props.onOpenFile(file.path) },
      // Right-click reaches the same verbs the full window offers. Without
      // this the popover's list was open-only, so discarding or stashing one
      // file meant leaving it for the full window.
      onContextMenu: props.onFileMenu
        ? function (event) { props.onFileMenu(event, file, section) }
        : undefined,
    }, changeFileLabel(layout === 'flat' ? file.path : baseName(file.path)).concat([
      h(ChangeRowActions, {
        key: 'actions', t: t, section: section, busy: props.busy,
        onOpen: function () { props.onOpenFile(file.path) },
        onDiscard: function () {
          var text = t('confirm.discard', { path: file.path })
          if (file.kind === 'untracked') text += t('confirm.discardUntrackedSuffix')
          props.requestConfirm(text, function () {
            props.onWrite('discardPath', { path: file.path, untracked: file.kind === 'untracked' }, { confirm: true })
          }, t('action.discard'))
        },
        onToggleStage: function () {
          props.onWrite(section === 'staged' ? 'unstage' : 'stage', { paths: [file.path] })
        },
      }),
      h('span', { key: 'st', className: 'dshgit-status' }, statusLetter(file)),
    ]))
  }

  var fileList = function (entries, section) {
    var matched = entries.filter(function (file) { return !query || file.path.toLowerCase().includes(query) })
    return h(ChangelistFiles, { files: matched, listId: section, batch: batch, layout: layout, filterKey: query, busy: props.busy,
      renderFile: function (file, style) { return row(file, section, style) },
    })
  }
  return h('div', { className: 'dshgit-commitpanel dshgit-cl-commitpanel', onKeyDown: batch.keydown, onClick: batch.blank }, [
    h(CommitFormContainer, { key: 'composer', t: t },
    h('div', { key: 'msg', className: 'dshgit-commitbox dshgit-commit-composer' }, [
      h('div', { key: 'field', className: 'dshgit-commit-field', 'data-ai': aiEnabled }, [
        h('textarea', {
          key: 'ta',
          ref: messageRef,
          className: 'dshgit-textarea',
          style: { minHeight: '56px' },
          value: props.message,
          autoFocus: true,
          readOnly: props.busy === true,
          placeholder: t('commit.placeholderMessage'),
          onChange: function (event) { props.setMessage(event.currentTarget.value); setValidation(null) },
          onKeyDown: function (event) {
            if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault(); event.stopPropagation?.()
              if (!event.repeat) submit(props.onCommit)
            }
          },
        }),
        aiEnabled ? h('button', { key: 'ai', type: 'button', className: 'dshgit-commit-ai',
          disabled: props.aiBusy || props.busy,
          'aria-busy': props.aiBusy === true,
          'aria-label': t('action.generateMessage'),
          title: t('action.generateMessage'), onClick: props.onGenerate,
        }, props.aiBusy ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true })
          : h('span', { key: 'icon', 'aria-hidden': true }, '✨')) : null,
      ]),
      // Scope and action on one row, matching the sidebar composer.
      h('div', { key: 'row', className: 'dshgit-commit-meta' }, [
        h(CommitScopePreview, Object.assign({}, props, { key: 'scope-preview', disabled: props.busy || hasConflicts || !scopeFiles.length || scopeFiles.some(function (file) { return file.kind === 'unmerged' }) })),
        h('span', { key: 'scope', className: 'dshgit-muted' }, t('window.staged', { count: staged.length })),
        h(CommitActions, {
          key: 'commit', t: t, shortcut: props.syncAction === null, pending: props.busy === true,
          label: props.busy ? t(progressKey) : props.syncAction === null ? commitLabel : props.syncAction.label,
          disabled: props.busy || hasConflicts || (props.syncAction === null && files.length === 0),
          hint: props.syncAction === null ? t(staged.length > 0 ? 'commit.stagedHint' : 'commit.smartHint') : undefined,
          onPrimary: props.syncAction === null
            ? function () { submit(props.onCommit) } : props.syncAction.run,
          options: props.syncAction !== null ? [] : [
            { id: 'commit', label: t('action.commit'),
              disabled: props.busy || hasConflicts || files.length === 0, run: function () { submit(props.onCommit) } },
            { separator: true },
            { id: 'push', label: t('action.commitAndPush'),
              disabled: props.busy || hasConflicts || files.length === 0 || props.status?.branch?.detached === true,
              run: function () { submit(props.onCommitPush) } },
            { id: 'sync', label: t('action.commitAndSync'),
              disabled: props.busy || hasConflicts || files.length === 0 || !props.status?.branch?.upstream,
              run: function () { submit(props.onCommitSync) } },
          ],
        }),
      ]),
      validation !== null
        ? h('div', { key: 'validation', className: 'dshgit-commit-validation', role: 'alert' }, validation)
        : null,
      props.aiNotice !== null && props.aiNotice !== undefined
        ? h('div', { key: 'ai', className: 'dshgit-muted', style: { fontSize: 'var(--dshgit-font-small)' } },
            t('state.aiUnavailable') + '：' + props.aiNotice)
        : null,
    ])),

    h('div', { key: 'search', className: 'dshgit-cl-search' }, [h('input', { key: 'input', type: 'search', className: 'dshgit-input', value: search[0], placeholder: t('list.searchFiles'), 'aria-label': t('list.searchFiles'), onChange: function (event) { search[1](event.currentTarget.value) } }), props.changelists ? h(ChangelistLayoutSwitch, { key: 'layout', changelists: props.changelists, t: t, busy: props.busy }) : null]),
    fileFilter.control, batch.overlay,
    files.length === 0
      ? h('div', { key: 'none', className: 'dshgit-empty' }, t('commit.nothing'))
      : h('div', { key: 'lists', className: 'dshgit-commitlists', 'data-file-scroll': true }, [
          staged.some(function (file) { return !query || file.path.toLowerCase().includes(query) })
            ? h(ChangeGroup, { key: 'staged', kind: 'staged', t: t, title: t('commit.stagedSection'),
              busy: props.busy,
              count: staged.filter(function (file) { return !query || file.path.toLowerCase().includes(query) }).length, actions: groupBatchActions(batch, props, staged.filter(function (file) { return !query || file.path.toLowerCase().includes(query) }), true),
            }, fileList(staged, 'staged'))
            : null,
          unstaged.some(function (file) { return !query || file.path.toLowerCase().includes(query) })
            ? h(ChangeGroup, { key: 'unstaged', kind: 'unstaged', t: t, title: t('commit.unstagedSection'),
              busy: props.busy,
              count: unstaged.filter(function (file) { return !query || file.path.toLowerCase().includes(query) }).length, actions: groupBatchActions(batch, props, unstaged.filter(function (file) { return !query || file.path.toLowerCase().includes(query) }), false),
            }, fileList(unstaged, 'unstaged'))
            : null,
        ]),

    h('div', { key: 'foot', className: 'dshgit-pickfoot' }, [
      h('button', { key: 'full', type: 'button', className: 'dshgit-pickinline', onClick: props.onOpenFull }, t('commit.openFull')),
    ]),
  ])
}


/** The commit message box with AI assist. */
function CommitComposer(props) {
  var config = usePluginConfig(props.run)
  var aiEnabled = config !== null && config.aiEnabled !== false
  var t = props.t
  var lists = props.changelists?.mode === 'lists'
  var submitting = React.useState(false), submittingRef = React.useRef(false)
  // `changelists.pending` is deliberately NOT part of `blocked`. It counts
  // changelist METADATA writes — ticking a file, folding a list — and the
  // commit already serializes behind them via `flush()`. Folding it in made
  // the button grey out and snap back on every checkbox click, so the primary
  // action flickered while the user was only choosing what to commit.
  var blocked = props.busy || submitting[0] || props.status?.files?.some(function (file) { return file.kind === 'unmerged' }) || (lists && (props.changelists.loading || !!props.status?.operation || props.status?.files?.some(function (file) { return file.kind === 'unmerged' })))
  var aiState = React.useState(false)
  var aiBusy = aiState[0]
  var setAiBusy = aiState[1]
  var aiRef = React.useRef({ busy: false, id: 0 })
  var draftRef = React.useRef(props.message)
  draftRef.current = props.message
  React.useEffect(function () {
    if (!aiEnabled) { aiRef.current.id++; aiRef.current.busy = false; setAiBusy(false) }
  }, [aiEnabled])
  React.useEffect(function () {
    return function () { aiRef.current.id++; aiRef.current.busy = false }
  }, [props.repo.root])
  var validationState = React.useState(null)
  var validation = validationState[0]
  var setValidation = validationState[1]
  var messageRef = React.useRef(null)
  var changedFiles = props.status === null ? [] : (props.status.files || [])
  var selectedPaths = lists ? props.changelists.paths : null
  var commitCount = lists ? selectedPaths.length : changedFiles.length
  var stagedCount = changedFiles.filter(isStaged).length
  var commitLabel = t(lists || changedFiles.length === 0 ? 'action.commit'
    : stagedCount > 0 ? 'action.commitStaged' : 'commit.all')
  var progressKey = { push: 'sync.pushing', pull: 'sync.pulling', fetch: 'sync.fetching', commit: 'commit.inProgress', commitPaths: 'commit.inProgress', stage: 'commit.inProgress' }[props.busyMethod] || 'state.loading'
  var upstream = props.status?.branch?.upstream
  var publish = !props.sidebar && changedFiles.length === 0 && upstream === null &&
    props.status?.branch?.head !== null && props.status?.branch?.detached !== true
  var canSync = !props.sidebar && props.status !== null && changedFiles.length === 0 && !publish &&
    (props.tracking?.ahead || 0) > 0 && (props.tracking?.behind || 0) === 0

  var sync = function () {
    props.onWrite('push', publish ? { setUpstream: true } : {}, { after: props.afterWrite })
  }

  var afterCommit = function (mode) {
    aiRef.current.id++
    aiRef.current.busy = false
    setAiBusy(false)
    props.setMessage('')
    props.afterWrite()
    setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
    if (mode === 'push') {
      props.onWrite('push', upstream ? {} : { setUpstream: true }, { after: props.afterWrite })
    } else if (mode === 'sync') {
      props.onWrite('pull', { ffOnly: true }, { after: function () {
        props.onWrite('push', {}, { after: props.afterWrite })
      } })
    }
  }
  var commitStaged = function (mode) {
    props.onWrite('commit', { message: props.message }, {
      after: function () { afterCommit(mode) },
    })
  }
  var commitAll = function (mode) {
    if (changedFiles.length === 0) return
    props.onWrite('stage', {}, { after: function () { commitStaged(mode) } })
  }
  var commit = function (mode) {
    if (props.status === null) return
    if (changedFiles.length === 0) return
    if (lists) {
      if (submittingRef.current || !selectedPaths.length) return
      submittingRef.current = true; submitting[1](true)
      // `flush()` queues behind any selection write still in flight, so the
      // scope and its version come back consistent. Both are taken from the
      // RESULT: the closure's `selectedPaths` can predate that write.
      props.changelists.flush().then(function (data) {
        var paths = props.changelists.pathsFor(data)
        if (!paths.length) { setValidation(t('commit.nothing')); return null }
        return props.onWrite('commitPaths', { message: props.message, paths: paths, changelistVersion: data.version }, { after: function () { afterCommit(mode) } })
      }).catch(function (error) { setValidation(error.message) })
        .finally(function () { submittingRef.current = false; submitting[1](false) })
      return
    }
    if (stagedCount > 0) commitStaged(mode)
    else commitAll(mode)
  }
  var submit = function (mode) {
    if (blocked || commitCount === 0) return
    if (props.message.trim() === '') {
      setValidation(t('commit.requiredMessage'))
      messageRef.current?.focus?.()
      return
    }
    setValidation(null)
    commit(mode)
  }
  // The trigger for the pill: the same Smart Commit the keyboard shortcut
  // runs, so the two paths can never diverge in what they stage.
  var submitPrimary = function () { submit('commit') }

  var generate = function () {
    if (!aiEnabled || aiRef.current.busy || blocked || (lists && !commitCount)) return
    aiRef.current.busy = true
    setAiBusy(true)
    var id = ++aiRef.current.id
    var draft = draftRef.current
    props.setAiNotice(null)
    var scope = lists ? props.changelists.flush().then(function (data) {
      var paths = props.changelists.pathsFor(data)
      if (!paths.length) throw new Error(t('commit.nothing'))
      return { paths: paths, changelistVersion: data.version }
    }) : Promise.resolve({})
    scope.then(function (parameters) {
      if (id !== aiRef.current.id) return null
      return props.run('ai.commitMessage', Object.assign({ root: props.repo.root }, parameters), { silent: true, silentError: true })
    })
      .then(function (value) {
        if (id !== aiRef.current.id) return
        if (value.available === false) {
          props.setAiNotice(value.message)
          return
        }
        if (value.empty === true) {
          props.setAiNotice(value.reason || '没有可提交的改动')
          return
        }
        if (typeof value.message !== 'string' || !value.message.trim()) {
          props.setAiNotice(t('ai.emptyResult')); return
        }
        if (draftRef.current === draft) { props.setMessage(value.message); props.setAiNotice(null) }
        else props.setAiNotice(t('ai.draftChanged'))
      })
      .catch(function (failure) {
        if (id === aiRef.current.id) props.setAiNotice(failure.message)
      })
      .finally(function () {
        if (id !== aiRef.current.id) return
        aiRef.current.busy = false
        setAiBusy(false)
      })
  }

  return h('div', { className: 'dshgit-card dshgit-commit-composer' }, [
    // The AI trigger lives inside the field's top-right corner, so it reads
    // as "fill this box" instead of as a second commit-adjacent action.
    h('div', { key: 'field', className: 'dshgit-commit-field', 'data-ai': aiEnabled }, [
      h('textarea', {
        key: 'msg',
        ref: messageRef,
        className: 'dshgit-textarea',
        value: props.message,
        placeholder: t('commit.placeholderMessage'),
        onKeyDown: function (event) {
          if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault(); event.stopPropagation?.()
            if (!event.repeat) submitPrimary()
          }
        },
        readOnly: blocked,
        onChange: function (event) { draftRef.current = event.currentTarget.value; props.setMessage(event.currentTarget.value); setValidation(null) },
      }),
      aiEnabled ? h(
        'button',
        {
          key: 'ai',
          disabled: aiBusy || blocked || (lists && !commitCount),
          'aria-busy': aiBusy,
          type: 'button',
          className: 'dshgit-commit-ai',
          onClick: generate,
          title: t('action.generateMessage'), 'aria-label': t('action.generateMessage'),
        },
        aiBusy ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true })
          : h('span', { key: 'icon', 'aria-hidden': true }, '✨'),
      ) : null,
    ]),
    validation !== null
      ? h('div', { key: 'validation', className: 'dshgit-commit-validation', role: 'alert' }, validation)
      : null,
    // Scope and action share one row: "2 个文件" is the answer to "what will
    // this commit?", so it belongs beside the button that commits it rather
    // than on a line of its own.
    h('div', { key: 'row', className: 'dshgit-commit-meta' }, [
      h(CommitScopePreview, Object.assign({}, props, { key: 'scope-preview', disabled: blocked || commitCount === 0 })),
      h('span', { key: 'info', className: 'dshgit-muted', title: lists ? t('cl.fullFile') : undefined }, t(lists ? 'cl.selected' : 'window.staged', { count: lists ? commitCount : stagedCount })),
      h(CommitActions, {
        key: 'commit', t: t, shortcut: !publish && !canSync,
        // The spinner and the progress label are two halves of one fact — that
        // THIS button's action is running — so they share one condition. It is
        // deliberately not `blocked`: that also covers a changelist metadata
        // write (ticking a file), which is not a commit.
        pending: props.busy || submitting[0],
        label: props.busy || submitting[0] ? t(progressKey)
          : publish ? t('next.publish') : canSync ? t('action.sync') : commitLabel,
        disabled: blocked || (!publish && !canSync && commitCount === 0),
        hint: !publish && !canSync ? t(lists ? 'cl.fullFile' : stagedCount > 0 ? 'commit.stagedHint' : 'commit.smartHint') : undefined,
        onPrimary: publish || canSync ? sync : submitPrimary,
        options: publish || canSync ? [] : [
          { id: 'commit', label: t('action.commit'),
            disabled: blocked || commitCount === 0, run: submitPrimary },
          { separator: true },
          { id: 'push', label: t('action.commitAndPush'),
            disabled: blocked || commitCount === 0 || props.status?.branch?.detached === true,
            run: function () { submit('push') } },
          { id: 'sync', label: t('action.commitAndSync'),
            disabled: blocked || commitCount === 0 || !upstream,
            run: function () { submit('sync') } },
        ],
      }),
    ]),
    props.aiNotice !== null && props.aiNotice !== undefined
      ? h('div', { key: 'notice', className: 'dshgit-muted', style: { fontSize: 'var(--dshgit-font-small)' } },
          t('state.aiUnavailable') + '：' + props.aiNotice)
      : null,
  ])
}

export { ChangelistCommitPanel, CommitComposer, CommitFormContainer, CommitPanel }

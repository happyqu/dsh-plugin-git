import { React, h } from '../../core/runtime.js'
import { ComboBox, Menu, useDialogFocus } from '../../ui/controls.js'
import { readWorkbenchStorage, writeWorkbenchStorage } from '../../core/preferences.js'
import { sameWorktree } from './model.js'
import { worktreeAssociations, worktreeWorkspace } from './workspace.js'
import { worktreePathKey } from './preferences.js'
import { WorktreeTask } from './task.js'
import { WorktreeRemovalDialog } from './removal.js'
import { navigate } from '../../core/navigation.js'
import { formatRelative } from '../../core/format.js'

function branchLabel(tree, t) { return tree.branch?.replace(/^refs\/heads\//, '') || (tree.detached ? t('wt.detached') + ' · ' + (tree.head || '').slice(0, 8) : t('wt.noBranch')) }
/**
 * A text button. When it is disabled, the reason goes on a wrapping span:
 * browsers show no tooltip for a disabled control, so a `title` on the button
 * itself would be the one thing the user cannot read.
 */
function button(key, label, action, disabled, danger, hint) {
  var node = h('button', { key: key, type: 'button', className: 'dshgit-btn' + (danger ? ' dshgit-btn-danger' : ''),
    disabled: disabled, onClick: action }, label)
  return disabled && hint ? h('span', { key: key + ':wrap', title: hint, style: { display: 'inline-flex' } }, node) : node
}

export function WorktreesSidebar(props) {
  var search = React.useState(''), sort = React.useState('recent'), t = props.t, model = props.model
  var opening = React.useState(null), openingRef = React.useRef(false), error = React.useState(null), alive = React.useRef(true)
  React.useEffect(function () { alive.current = true; return function () { alive.current = false } }, [])
  var quickOpen = function (tree, gitOnly) {
    var detail = model.details[tree.path]
    if (props.busy || openingRef.current || tree.bare || !detail || detail.error) return
    navigate(function () {
      if (openingRef.current || !alive.current) return
      openingRef.current = true; opening[1](tree.path); error[1](null)
      Promise.resolve().then(function () {
        return !gitOnly && props.onOpenWorkspace ? props.onOpenWorkspace(tree.path) : props.onOpenGit(tree.path)
      }).catch(function (failure) { if (alive.current) error[1](failure.message) })
        .finally(function () { openingRef.current = false; if (alive.current) opening[1](null) })
    })
  }
  var query = search[0].trim().toLowerCase()
  var trees = model.trees.filter(function (tree) { return !query || (tree.path + ' ' + tree.branch + ' ' + (model.metadata[worktreePathKey(tree.path)]?.note || '')).toLowerCase().includes(query) })
  return h('div', { className: 'dshgit-worktree-list' }, [
    h('div', { key: 'actions', className: 'dshgit-sidebar-search dshgit-worktree-toolbar' }, [
      button('create', t('wt.create'), props.onCreate, props.busy),
      button('refresh', t('action.refresh'), function () { navigate(model.refresh) }, props.busy || model.loading),
      button('prune', t('wt.prune'), function () { props.onManage('prune') }, props.busy || model.loading),
    ]),
    h('div', { key: 'filter', className: 'dshgit-worktree-filterrow' }, [
      h('input', { key: 'search', type: 'search', className: 'dshgit-input', value: search[0], placeholder: t('wt.search'), 'aria-label': t('wt.search'), onChange: function (event) { search[1](event.target.value) } }),
      h(ComboBox, { key: 'sort', t: t, label: t('wt.sort'), searchable: false, value: sort[0], onChange: sort[1], options: [{ value: 'recent', label: t('wt.sortRecent') }, { value: 'branch', label: t('wt.sortBranch') }] }),
    ]),
    model.error ? h('div', { key: 'error', role: 'alert', className: 'dshgit-error' }, model.error) : null,
    error[0] ? h('div', { key: 'openError', role: 'alert', className: 'dshgit-error', style: { padding: '0 12px' } }, error[0]) : null,
    model.loading ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading')) : null,
    h('div', { key: 'list', role: 'listbox', 'aria-label': t('tab.worktrees') }, trees.sort(function (a, b) {
      if (sameWorktree(a.path, props.root)) return -1
      if (sameWorktree(b.path, props.root)) return 1
      return (sort[0] === 'recent' ? (model.metadata[worktreePathKey(b.path)]?.lastUsed || 0) - (model.metadata[worktreePathKey(a.path)]?.lastUsed || 0) : 0) || (a.branch || a.path).localeCompare(b.branch || b.path)
    }).map(function (tree) {
      var detail = model.details[tree.path], tags = []
      var metadata = model.metadata[worktreePathKey(tree.path)] || {}, associations = worktreeAssociations(tree.path, model.context)
      if (sameWorktree(tree.path, props.root)) tags.push(t('wt.current'))
      if (sameWorktree(tree.path, model.trees[0]?.path)) tags.push(t('wt.main'))
      if (tree.locked) tags.push(t('wt.locked'))
      if (tree.prunable) tags.push(t('wt.prunable'))
      if (tree.bare) tags.push(t('wt.bare'))
      if (detail?.error) tags.push(t('wt.unavailable'))
      else if (detail) tags.push(detail.counts.total ? t('wt.changes', { count: detail.counts.total }) : t('wt.clean'))
      else if (!tree.bare) tags.push(t('state.loading'))
      var status = detail?.error ? t('wt.unavailable') : tree.locked ? t('wt.locked') : tree.prunable ? t('wt.prunable') : tree.bare ? t('wt.bare') : detail ? (detail.counts.total ? t('wt.changes', { count: detail.counts.total }) : t('wt.clean')) : t('state.loading')
      if (associations.length) tags.push(t('wt.linkedWorkspaces', { count: associations.length }))
      if (metadata.lastUsed) tags.push(t('wt.recentAt', { time: formatRelative(Math.floor(metadata.lastUsed / 1000), t) }))
      var canOpen = !tree.bare && !!detail && !detail.error
      return h('button', { key: tree.path, type: 'button', role: 'option', 'aria-selected': sameWorktree(tree.path, model.selected), 'aria-busy': opening[0] === tree.path, 'aria-disabled': !!opening[0],
        'aria-keyshortcuts': canOpen ? 'Enter Control+Enter Meta+Enter' : undefined,
        className: 'dshgit-worktree-row', title: [branchLabel(tree, t), tree.path, tags.join(' · '), metadata.note, canOpen ? t(props.onOpenWorkspace ? 'wt.quickOpenWorkspaceHint' : 'wt.quickOpenGitHint') : ''].filter(Boolean).join('\n'),
        onClick: function () { if (!openingRef.current) navigate(function () { error[1](null); props.onSelect?.(tree.path); model.select(tree.path) }) },
        onDoubleClick: function () { quickOpen(tree, false) },
        onKeyDown: function (event) {
          if (event.key !== 'Enter' || event.altKey || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return
          event.preventDefault(); event.stopPropagation()
          if (!event.repeat) quickOpen(tree, event.ctrlKey || event.metaKey)
        },
      }, [
        h('div', { key: 'heading', className: 'dshgit-worktree-rowhead' }, [
          h('strong', { key: 'branch' }, branchLabel(tree, t)),
          sameWorktree(tree.path, props.root) ? h('span', { key: 'current', className: 'dshgit-worktree-current' }, t('wt.current')) : null,
        ]),
        h('div', { key: 'meta', className: 'dshgit-worktree-rowmeta' }, [
          h('span', { key: 'path', className: 'dshgit-worktree-rowpath', title: tree.path }, tree.path),
          h('span', { key: 'status', className: 'dshgit-worktree-rowstatus' }, opening[0] === tree.path ? t('state.loading') : status),
        ]),
      ])
    }).concat(trees.length === 0 && !model.loading ? [h('div', { key: 'empty', className: 'dshgit-empty' }, t(query ? 'list.noMatches' : 'wt.none'))] : [])),
  ])
}

export function WorktreeDetails(props) {
  var t = props.t, tree = props.model.trees.find(function (tree) { return sameWorktree(tree.path, props.model.selected) })
  var error = React.useState(null), pending = React.useState(false), lock = React.useRef(false), removal = React.useState(false)
  var detail = tree && props.model.details[tree.path]
  React.useEffect(function () { error[1](null) }, [tree?.path])
  if (!tree) return h('div', { className: 'dshgit-empty' }, t(props.model.loading ? 'state.loading' : 'wt.select'))
  var busy = props.busy || pending[0], current = sameWorktree(tree.path, props.root), main = sameWorktree(tree.path, props.model.trees[0]?.path)
  var canOpen = !!detail && !detail.error && !tree.bare
  // Offline directories can still be locked or unlocked for protection.
  var manageBlocked = function (action) {
    if (main) return t('wt.cannotManageMain')
    if (action === 'lock' || action === 'unlock') return tree.bare ? t('wt.cannotManageBare') : null
    if (tree.locked) return t('wt.cannotManageLocked')
    if (current) return t('wt.cannotManageCurrent')
    if (action === 'repair') return tree.bare ? t('wt.cannotManageBare') : null
    if (!detail) return t('state.loading')
    if (detail?.error) return detail.error
    if (!canOpen) return t('wt.cannotManageUnavailable')
    if (detail?.operation) return t('wt.cannotRemoveOperation')
    return null
  }
  var act = async function (action) {
    if (lock.current) return
    lock.current = true; pending[1](true); error[1](null)
    try { await action() } catch (failure) { error[1](failure.message) }
    finally { lock.current = false; pending[1](false) }
  }
  var openHint = !detail ? t('state.loading') : detail.error ? detail.error : tree.bare ? t('wt.cannotManageBare') : null
  var values = [[t('wt.path'), tree.path], [t('wt.head'), h('span', { title: tree.head || '' }, tree.head ? tree.head.slice(0, 8) : '—')]]
  if (detail?.counts) values.push([t('wt.status'), detail.counts.total ? t('wt.changes', { count: detail.counts.total }) : t('wt.clean')])
  if (tree.locked) values.push([t('wt.locked'), tree.lockReason || '—'])
  if (tree.prunable) values.push([t('wt.prunable'), tree.pruneReason || '—'])
  if (detail?.operation) values.push([t('wt.operation'), detail.operation.kind])
  function facts(items) { return items.flatMap(function (item, index) { return [h('dt', { key: index + 'k' }, item[0]), h('dd', { key: index + 'v' }, item[1])] }) }
  var management = []
  if (!main && !tree.bare) {
    var lockAction = tree.locked ? 'unlock' : 'lock'
    management.push({ id: 'lock', label: t('wt.' + lockAction), disabled: busy || !!manageBlocked(lockAction), hint: manageBlocked(lockAction),
      run: function () { props.onManage(lockAction, tree) } })
    if (!current) {
      var maintenanceActions = ['move', 'repair']
      maintenanceActions.forEach(function (action) {
        management.push({ id: action, label: t('wt.' + action), disabled: busy || !!manageBlocked(action), hint: manageBlocked(action),
          run: function () { props.onManage(action, tree) } })
      })
      management.push({ separator: true }, {
        id: 'remove', label: t('wt.remove'), danger: true, disabled: busy,
        run: function () { navigate(function () { removal[1](true) }) },
      })
    }
  }
  return h('div', { className: 'dshgit-worktree-details' }, [
    h('div', { key: 'title', className: 'dshgit-worktree-title' }, branchLabel(tree, t)),
    h('dl', { key: 'facts', className: 'dshgit-worktree-facts' }, facts(values)),
    detail?.error ? h('div', { key: 'readError', role: 'alert', className: 'dshgit-error' }, detail.error) : null,
    h('div', { key: 'actions', className: 'dshgit-actions' }, [
      h('span', { key: 'git', title: t('wt.openGitHint') }, button('git', t(current ? 'wt.alreadyOpen' : 'wt.openGit'), function () { act(function () { return props.onOpen(tree.path) }) }, busy || current || !canOpen, false, current ? null : openHint)),
      h('span', { key: 'workspace', title: t('wt.openWorkspaceHint') }, button('workspace', t('wt.openWorkspace'), function () { navigate(function () { act(function () { return worktreeWorkspace().open(tree.path, props.model.common) }) }) }, busy || !canOpen || !worktreeWorkspace(), false, openHint)),
      button('history', t('wt.history'), function () { props.onHistory(tree.head) }, busy || !tree.head),
      !current && !tree.bare ? button('compare', t('wt.compare'), function () { navigate(function () { props.onCompare(tree.path) }) }, busy || !canOpen, false, openHint) : null,
      management.length ? h(Menu, { key: 'manage', t: t, portal: true, title: t('wt.manage'), label: t('wt.manage'), items: management, disabled: busy }) : null,
    ]),
    h(WorktreeTask, { key: tree.path + ':task', path: tree.path, model: props.model, t: t }),
    removal[0] ? h(WorktreeRemovalDialog, { key: 'removal', root: props.root, tree: tree, run: props.run, t: t, onRemove: props.onRemove,
      onOpen: props.onOpen, onClose: function () { removal[1](false) }, onRemoved: function () { removal[1](false); props.model.refresh() } }) : null,
    error[0] ? h('div', { key: 'error', role: 'alert', className: 'dshgit-error' }, error[0]) : null,
  ])
}

export function CreateWorktreeDialog(props) {
  var t = props.t, ref = React.useRef(null), pending = React.useRef(false), alive = React.useRef(true)
  var start = React.useState(props.subject?.ref || props.subject?.sha || 'HEAD'), name = React.useState(''), newBranch = React.useState(true)
  var parent = readWorkbenchStorage('worktreeParent:' + (props.repo.commonDir || props.repo.root), '')
  var directory = React.useState(null), after = React.useState('git'), busy = React.useState(false), error = React.useState(null), created = React.useState(null)
  var close = function () { if (!pending.current) props.onClose() }
  useDialogFocus(ref, close)
  React.useEffect(function () { alive.current = true; return function () { alive.current = false } }, [])
  var sourceRef = start[0].trim()
  var occupied = props.worktrees.some(function (tree) { return tree.branch === sourceRef })
  var needsBranch = occupied || !sourceRef.startsWith('refs/heads/'), creatingBranch = newBranch[0] || needsBranch
  var folderName = creatingBranch ? name[0].trim() : sourceRef.replace(/^refs\/heads\//, '')
  var folder = folderName.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'task'
  var root = props.repo.root.replace(/\\/g, '/').replace(/\/$/, '')
  var suggested = (parent || root + '-worktrees').replace(/[\\/]$/, '') + '/' + folder
  var target = directory[0] === null ? suggested : directory[0]
  var parameters = { ref: sourceRef, name: creatingBranch ? name[0].trim() : undefined, directory: target.trim(), track: sourceRef.startsWith('refs/remotes/') }
  var signature = JSON.stringify(parameters), validation = React.useState(null), validationEpoch = React.useRef(0), validationRetry = React.useState(0)
  React.useEffect(function () {
    if (created[0]) return
    var active = true, controller = new AbortController(), epoch = ++validationEpoch.current
    var timer = setTimeout(function () {
      if (!active || epoch !== validationEpoch.current) return
      props.run('worktreeCreatePreview', Object.assign({ root: props.repo.root }, parameters), { silent: true, silentError: true, signal: controller.signal })
        .then(function (result) { if (active && epoch === validationEpoch.current) validation[1]({ signature: signature, result: result }) })
        .catch(function (failure) { if (active && epoch === validationEpoch.current) validation[1]({ signature: signature, error: failure.message }) })
    }, 300)
    return function () { active = false; clearTimeout(timer); controller.abort() }
  }, [props.repo.root, props.run, signature, created[0], validationRetry[0]])
  var checked = validation[0]?.signature === signature ? validation[0] : null
  var fieldErrors = checked?.result?.errors || {}, ready = checked?.result?.valid === true
  var fieldError = function (field) { return fieldErrors[field] ? h('span', { key: 'error', id: 'dshgit-wt-create-' + field + '-error', role: 'status', className: 'dshgit-error' }, fieldErrors[field]) : null }
  // Same starting-point pattern as the branch workbench dialog: a searchable
  // ComboBox with HEAD first, grouped by ref kind so a remote "main" cannot be
  // picked for a local one. Free input also accepts commit SHAs and revision
  // expressions; append the current value so it always renders.
  var startOptions = [{ value: 'HEAD', label: t('label.startPointHead'), group: '' }]
    .concat((props.refs?.branches || []).filter(function (item) { return !item.symbolic }).map(function (item) { return { value: item.ref, label: item.name, group: t('wb.local') } }))
    .concat((props.refs?.remotes || []).filter(function (item) { return !item.symbolic }).map(function (item) { return { value: item.ref, label: item.name, group: t('wb.remote') } }))
    .concat((props.refs?.tags || []).filter(function (item) { return !item.symbolic }).map(function (item) { return { value: item.ref, label: item.name, group: t('wb.tags') } }))
  if (start[0] && !startOptions.some(function (option) { return option.value === start[0] })) startOptions.push({ value: start[0], label: start[0], group: '' })
  var submit = async function (event) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true; busy[1](true); error[1](null)
    try {
      var path = created[0]
      if (!path) {
        validationEpoch.current++
        // Recheck even if a previous preview passed: external Git tools can race it.
        var preview = await props.run('worktreeCreatePreview', Object.assign({ root: props.repo.root }, parameters), { silent: true, silentError: true })
        if (!alive.current) return
        validation[1]({ signature: signature, result: preview })
        if (!preview.valid) return
        await props.onCreate(parameters)
        path = target.trim()
        if (!alive.current) return
        created[1](path)
        writeWorkbenchStorage('worktreeParent:' + (props.repo.commonDir || props.repo.root), path.replace(/[\\/][^\\/]+$/, ''))
      }
      if (after[0] === 'git') await props.onOpen(path)
      if (after[0] === 'workspace') await worktreeWorkspace().open(path, props.repo.commonDir || props.repo.root)
      if (alive.current) props.onClose()
    } catch (failure) { if (alive.current) error[1](failure.message) }
    finally { pending.current = false; if (alive.current) busy[1](false) }
  }
  return h('div', { className: 'dshgit-modal', onClick: close }, h('form', { ref: ref, tabIndex: -1, role: 'dialog', 'aria-modal': true, 'aria-label': t('wt.create'), className: 'dshgit-dialog dshgit-worktree-form', onClick: function (event) { event.stopPropagation() }, onSubmit: submit }, [
    h('div', { key: 'title', className: 'dshgit-dialogtitle' }, t('wt.create')),
    created[0] ? h('p', { key: 'created', role: 'status' }, t('wt.created', { path: created[0] })) : h('fieldset', { key: 'fields', disabled: busy[0], style: { border: 0, padding: 0, margin: 0 }, className: 'dshgit-worktree-form' }, [
      h('label', { key: 'ref' }, [t('wt.start'), h(ComboBox, { key: 'input', t: t, label: t('wt.start'), name: 'ref', required: true, allowCustom: true, invalid: !!fieldErrors.ref, describedBy: fieldErrors.ref ? 'dshgit-wt-create-ref-error' : undefined, value: start[0], disabled: busy[0], onChange: function (value) { start[1](value) }, options: startOptions, placeholder: t('wt.start') }), fieldError('ref')]),
      h('label', { key: 'new', className: 'dshgit-check' }, [h('input', { key: 'input', type: 'checkbox', checked: newBranch[0] || needsBranch, disabled: needsBranch, onChange: function (event) { newBranch[1](event.target.checked) } }), t('wb.worktreeNewBranch')]),
      occupied ? h('p', { key: 'occupied', className: 'dshgit-muted' }, t('wb.worktreeOccupied')) : null,
      newBranch[0] || needsBranch ? h('label', { key: 'name' }, [t('wb.name'), h('input', { key: 'input', name: 'name', className: 'dshgit-input', required: true, 'aria-invalid': !!fieldErrors.name, 'aria-describedby': fieldErrors.name ? 'dshgit-wt-create-name-error' : undefined, value: name[0], onChange: function (event) { name[1](event.target.value) } }), fieldError('name')]) : fieldError('name'),
      h('label', { key: 'path' }, [t('wt.path'), h('div', { key: 'row', className: 'dshgit-worktree-pathrow' }, [
        h('input', { key: 'input', name: 'directory', className: 'dshgit-input', required: true, 'aria-invalid': !!fieldErrors.directory, 'aria-describedby': fieldErrors.directory ? 'dshgit-wt-create-directory-error' : undefined, value: target, onChange: function (event) { directory[1](event.target.value) } }),
        button('pick', t('wt.pickParent'), async function () {
          if (pending.current) return
          pending.current = true; busy[1](true)
          try { var path = await worktreeWorkspace().pickDirectory(); if (alive.current && path) directory[1](path.replace(/[\\/]$/, '') + '/' + folder) }
          catch (failure) { if (alive.current) error[1](failure.message) }
          finally { pending.current = false; if (alive.current) busy[1](false) }
        }, !worktreeWorkspace() || busy[0]),
      ]), fieldError('directory')]),
    ]),
    !created[0] && !checked ? h('div', { key: 'checking', role: 'status', className: 'dshgit-muted' }, t('wt.checkingCreate')) : null,
    checked?.error ? h('div', { key: 'validationError', className: 'dshgit-worktree-form' }, [
      h('span', { key: 'message', role: 'alert', className: 'dshgit-error' }, checked.error),
      h('div', { key: 'retry' }, button('retry', t('action.retryRead'), function () { validation[1](null); validationRetry[1](function (value) { return value + 1 }) }, busy[0])),
    ]) : null,
    h('label', { key: 'after' }, [t('wt.afterCreate'), h(ComboBox, { key: 'select', t: t, label: t('wt.afterCreate'), value: after[0], disabled: busy[0], searchable: false, onChange: after[1], options: [
      { value: 'git', label: t('wt.openGit') }, { value: 'workspace', label: t('wt.openWorkspace'), disabled: !worktreeWorkspace() }, { value: 'none', label: t('wt.stay') },
    ] })]),
    error[0] ? h('div', { key: 'error', className: 'dshgit-error', role: 'alert' }, error[0]) : null,
    h('div', { key: 'buttons', className: 'dshgit-dialogactions' }, [button('cancel', t('action.cancel'), close, busy[0]), h('button', { key: 'submit', type: 'submit', className: 'dshgit-btn dshgit-btn-primary', disabled: busy[0] || (!created[0] && !ready) }, t(busy[0] ? 'state.loading' : created[0] ? 'wt.finish' : 'wt.create'))]),
  ]))
}

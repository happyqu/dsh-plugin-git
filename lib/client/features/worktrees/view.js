import { React, h } from '../../core/runtime.js'
import { ComboBox, useDialogFocus } from '../../ui/controls.js'
import { readWorkbenchStorage, writeWorkbenchStorage } from '../../core/preferences.js'
import { sameWorktree } from './model.js'
import { worktreeAssociations, worktreeWorkspace } from './workspace.js'
import { worktreePathKey } from './preferences.js'
import { WorktreeTask } from './task.js'
import { navigate } from '../../core/navigation.js'
import { formatRelative } from '../../core/format.js'

var styles = '.dshgit-worktrees{display:flex;flex-direction:column;gap:12px;padding:16px;overflow:auto;min-height:0}.dshgit-worktrees dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:10px 20px;margin:0}.dshgit-worktrees dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}.dshgit-worktrees .dshgit-actions{display:flex;gap:8px;flex-wrap:wrap}.dshgit-worktree-list{padding:8px;overflow:auto;min-height:0}.dshgit-worktree-row{display:flex;flex-direction:column;gap:4px;text-align:left;width:100%;padding:10px;border:0;border-radius:6px;color:inherit;background:transparent;cursor:pointer}.dshgit-worktree-row[aria-selected=true]{background:var(--dshgit-hover,rgba(128,128,128,.16))}.dshgit-worktree-row small{overflow-wrap:anywhere}.dshgit-worktree-form{display:flex;flex-direction:column;gap:12px}.dshgit-worktree-form label{display:flex;flex-direction:column;gap:5px}.dshgit-worktree-form input,.dshgit-worktree-form select{width:100%;box-sizing:border-box}.dshgit-worktree-form .dshgit-check{flex-direction:row;align-items:center}.dshgit-worktree-form .dshgit-check input{width:auto}'
function branchLabel(tree, t) { return tree.branch?.replace(/^refs\/heads\//, '') || (tree.detached ? t('wt.detached') + ' · ' + (tree.head || '').slice(0, 8) : t('wt.noBranch')) }
function button(key, label, action, disabled, danger) {
  return h('button', { key: key, type: 'button', className: 'dshgit-btn' + (danger ? ' dshgit-btn-danger' : ''), disabled: disabled, onClick: action }, label)
}

export function WorktreesSidebar(props) {
  var search = React.useState(''), sort = React.useState('recent'), t = props.t, model = props.model
  return h('div', { className: 'dshgit-worktree-list' }, [
    h('style', { key: 'style' }, styles),
    h('div', { key: 'actions', className: 'dshgit-actions' }, [button('create', t('wt.create'), props.onCreate, props.busy), button('refresh', t('action.refresh'), function () { navigate(model.refresh) }, props.busy || model.loading), button('prune', t('wt.prune'), function () { props.onManage('prune') }, props.busy || model.loading)]),
    h('input', { key: 'search', className: 'dshgit-input', style: { width: '100%', margin: '10px 0', boxSizing: 'border-box' }, value: search[0], placeholder: t('wt.search'), 'aria-label': t('wt.search'), onChange: function (event) { search[1](event.target.value) } }),
    h(ComboBox, { key: 'sort', t: t, value: sort[0], searchable: false, onChange: sort[1], options: [{ value: 'recent', label: t('wt.sortRecent') }, { value: 'branch', label: t('wt.sortBranch') }] }),
    model.error ? h('div', { key: 'error', role: 'alert', className: 'dshgit-error' }, model.error) : null,
    model.loading ? h('div', { key: 'loading', className: 'dshgit-muted' }, t('state.loading')) : null,
    h('div', { key: 'list', role: 'listbox', 'aria-label': t('tab.worktrees') }, model.trees.filter(function (tree) { return (tree.path + ' ' + tree.branch + ' ' + (model.metadata[worktreePathKey(tree.path)]?.note || '')).toLowerCase().includes(search[0].toLowerCase()) }).sort(function (a, b) {
      if (sameWorktree(a.path, props.root)) return -1
      if (sameWorktree(b.path, props.root)) return 1
      return (sort[0] === 'recent' ? (model.metadata[worktreePathKey(b.path)]?.lastUsed || 0) - (model.metadata[worktreePathKey(a.path)]?.lastUsed || 0) : 0) || (a.branch || a.path).localeCompare(b.branch || b.path)
    }).map(function (tree, index) {
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
      if (associations.length) tags.push(t('wt.linkedWorkspaces', { count: associations.length }))
      if (metadata.lastUsed) tags.push(t('wt.recentAt', { time: formatRelative(Math.floor(metadata.lastUsed / 1000)) }))
      return h('button', { key: tree.path, type: 'button', role: 'option', 'aria-selected': sameWorktree(tree.path, model.selected), className: 'dshgit-worktree-row', onClick: function () { navigate(function () { props.onSelect?.(tree.path); model.select(tree.path) }) } }, [
        h('strong', { key: 'branch' }, branchLabel(tree, t)),
        h('small', { key: 'path', title: tree.path }, tree.path),
        h('small', { key: 'tags', className: 'dshgit-muted' }, tags.join(' · ')),
        metadata.note ? h('small', { key: 'note', className: 'dshgit-muted' }, metadata.note.slice(0, 100)) : null,
      ])
    })),
  ])
}

export function WorktreeDetails(props) {
  var t = props.t, tree = props.model.trees.find(function (tree) { return sameWorktree(tree.path, props.model.selected) })
  var confirm = React.useState(false), error = React.useState(null), pending = React.useState(false), lock = React.useRef(false)
  var detail = tree && props.model.details[tree.path]
  React.useEffect(function () { confirm[1](false); error[1](null) }, [tree?.path])
  if (!tree) return h('div', { className: 'dshgit-empty' }, t(props.model.loading ? 'state.loading' : 'wt.select'))
  var busy = props.busy || pending[0], current = sameWorktree(tree.path, props.root), main = sameWorktree(tree.path, props.model.trees[0]?.path)
  var canOpen = !!detail && !detail.error && !tree.bare
  var reason = current ? t('wt.cannotRemoveCurrent') : main ? t('wt.cannotRemoveMain') : tree.locked ? t('wt.cannotRemoveLocked') : detail?.error ? detail.error : !detail ? t('state.loading') : detail.operation ? t('wt.cannotRemoveOperation') : detail.counts.total ? t('wt.cannotRemoveDirty') : detail.counts.ignored ? t('wt.cannotRemoveIgnored') : null
  var act = async function (action) {
    if (lock.current) return
    lock.current = true; pending[1](true); error[1](null)
    try { await action() } catch (failure) { error[1](failure.message) }
    finally { lock.current = false; pending[1](false) }
  }
  var values = [[t('wt.path'), tree.path], [t('wt.branch'), branchLabel(tree, t)], [t('wt.head'), tree.head || '—'],
    [t('wt.kind'), t(main ? 'wt.main' : 'wt.linked')]]
  if (tree.locked) values.push([t('wt.locked'), tree.lockReason || '—'])
  if (tree.prunable) values.push([t('wt.prunable'), tree.pruneReason || '—'])
  if (detail?.counts) values.push([t('wt.status'), t('wt.statusCounts', detail.counts)], [t('wt.ignored'), String(detail.counts.ignored || 0)])
  if (detail?.operation) values.push([t('wt.operation'), detail.operation.kind])
  return h('div', { className: 'dshgit-worktrees' }, [
    h('h3', { key: 'title' }, branchLabel(tree, t)),
    h('dl', { key: 'facts' }, values.flatMap(function (item, index) { return [h('dt', { key: index + 'k', className: 'dshgit-muted' }, item[0]), h('dd', { key: index + 'v' }, item[1])] })),
    detail?.error ? h('div', { key: 'readError', role: 'alert', className: 'dshgit-error' }, detail.error) : null,
    h('div', { key: 'actions', className: 'dshgit-actions' }, [
      button('git', t('wt.openGit'), function () { act(function () { return props.onOpen(tree.path) }) }, busy || !canOpen),
      button('workspace', t('wt.openWorkspace'), function () { navigate(function () { act(function () { return worktreeWorkspace().open(tree.path, props.model.common) }) }) }, busy || !canOpen || !worktreeWorkspace()),
      button('history', t('wt.history'), function () { props.onHistory(tree.head) }, busy || !tree.head),
      button('remove', t('wt.remove'), function () { navigate(function () { confirm[1](true) }) }, busy || !!reason, true),
      button('compare', t('wt.compare'), function () { navigate(function () { props.onCompare(tree.path) }) }, busy || !canOpen || current),
      button('lock', t(tree.locked ? 'wt.unlock' : 'wt.lock'), function () { props.onManage(tree.locked ? 'unlock' : 'lock', tree) }, busy || main || tree.bare),
      button('move', t('wt.move'), function () { props.onManage('move', tree) }, busy || main || current || tree.locked || !canOpen || !!detail?.operation),
      button('repair', t('wt.repair'), function () { props.onManage('repair', tree) }, busy || main || current || tree.locked || tree.bare),
    ]),
    h('p', { key: 'hint', className: 'dshgit-muted' }, t('wt.openHint')),
    h(WorktreeTask, { key: tree.path + ':task', path: tree.path, model: props.model, t: t, busy: busy || !canOpen,
      onOpenWorkspace: function (workspaceId) { navigate(function () { act(function () { return worktreeWorkspace().open(tree.path, props.model.common, workspaceId) }) }) } }),
    reason ? h('div', { key: 'reason', className: 'dshgit-muted' }, reason) : null,
    confirm[0] ? h('div', { key: 'confirm', role: 'alert', className: 'dshgit-worktree-form' }, [
      h('p', { key: 'text' }, t('wt.removeConfirm', { path: tree.path })),
      h('div', { key: 'buttons', className: 'dshgit-actions' }, [
        button('yes', t('wt.remove'), function () { act(async function () { await props.onRemove(tree); confirm[1](false); props.model.refresh() }) }, busy || !!reason, true),
        button('no', t('action.cancel'), function () { confirm[1](false) }, busy),
      ]),
    ]) : null,
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
  var occupied = props.worktrees.some(function (tree) { return tree.branch === start[0] })
  var needsBranch = occupied || !start[0].startsWith('refs/heads/')
  var folder = name[0].trim().replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'task'
  var root = props.repo.root.replace(/\\/g, '/').replace(/\/$/, '')
  var suggested = (parent || root + '-worktrees').replace(/[\\/]$/, '') + '/' + folder
  var target = directory[0] === null ? suggested : directory[0]
  var refs = [].concat(props.refs?.branches || [], props.refs?.remotes || [], props.refs?.tags || []).filter(function (item) { return !item.symbolic })
  var submit = async function (event) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true; busy[1](true); error[1](null)
    try {
      var path = created[0]
      if (!path) {
        await props.onCreate({ ref: start[0].trim(), name: newBranch[0] || needsBranch ? name[0].trim() : undefined,
          directory: target.trim(), track: start[0].startsWith('refs/remotes/') })
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
    h('style', { key: 'style' }, styles), h('h3', { key: 'title' }, t('wt.create')),
    created[0] ? h('p', { key: 'created', role: 'status' }, t('wt.created', { path: created[0] })) : h('fieldset', { key: 'fields', disabled: busy[0], style: { border: 0, padding: 0, margin: 0 }, className: 'dshgit-worktree-form' }, [
      h('label', { key: 'ref' }, [t('wt.start'), h('input', { key: 'input', name: 'ref', className: 'dshgit-input', list: 'dshgit-worktree-refs', value: start[0], required: true, onChange: function (event) { start[1](event.target.value) } })]),
      h('datalist', { key: 'refs', id: 'dshgit-worktree-refs' }, refs.map(function (item) { return h('option', { key: item.ref, value: item.ref }, item.name) })),
      h('label', { key: 'new', className: 'dshgit-check' }, [h('input', { key: 'input', type: 'checkbox', checked: newBranch[0] || needsBranch, disabled: needsBranch, onChange: function (event) { newBranch[1](event.target.checked) } }), t('wb.worktreeNewBranch')]),
      occupied ? h('p', { key: 'occupied', className: 'dshgit-muted' }, t('wb.worktreeOccupied')) : null,
      newBranch[0] || needsBranch ? h('label', { key: 'name' }, [t('wb.name'), h('input', { key: 'input', name: 'name', className: 'dshgit-input', required: true, value: name[0], onChange: function (event) { name[1](event.target.value) } })]) : null,
      h('label', { key: 'path' }, [t('wt.path'), h('input', { key: 'input', name: 'directory', className: 'dshgit-input', required: true, value: target, onChange: function (event) { directory[1](event.target.value) } })]),
      button('pick', t('wt.pickParent'), async function () {
        if (pending.current) return
        pending.current = true; busy[1](true)
        try { var path = await worktreeWorkspace().pickDirectory(); if (alive.current && path) directory[1](path.replace(/[\\/]$/, '') + '/' + folder) }
        catch (failure) { if (alive.current) error[1](failure.message) }
        finally { pending.current = false; if (alive.current) busy[1](false) }
      }, !worktreeWorkspace() || busy[0]),
    ]),
    h('label', { key: 'after' }, [t('wt.afterCreate'), h(ComboBox, { key: 'select', t: t, value: after[0], disabled: busy[0], searchable: false, onChange: after[1], options: [
      { value: 'git', label: t('wt.openGit') }, { value: 'workspace', label: t('wt.openWorkspace'), disabled: !worktreeWorkspace() }, { value: 'none', label: t('wt.stay') },
    ] })]),
    h('p', { key: 'hint', className: 'dshgit-muted' }, t('wt.openHint')),
    error[0] ? h('div', { key: 'error', className: 'dshgit-error', role: 'alert' }, error[0]) : null,
    h('div', { key: 'buttons', className: 'dshgit-actions' }, [button('cancel', t('action.cancel'), close, busy[0]), h('button', { key: 'submit', type: 'submit', className: 'dshgit-btn dshgit-btn-primary', disabled: busy[0] }, t(busy[0] ? 'state.loading' : created[0] ? 'wt.finish' : 'wt.create'))]),
  ]))
}

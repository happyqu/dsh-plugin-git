import { Fragment, React, h } from '../../core/runtime.js'
import { readWorkbenchStorage } from '../../core/preferences.js'
import { laneColor, sortedBranches, workbenchUpstream } from './model.js'
import { IconBranch, IconBranchAction, IconBranchSync, IconChangeAction, IconChevron, IconFolder, IconHistory, IconMore, IconRemote, IconStar, IconSweep, IconTag, svg } from '../../ui/icons.js'
import { ComboBox, Menu, useDialogFocus } from '../../ui/controls.js'
import { FileDiffCard } from '../../ui/file-diff.js'
import { DiffBody } from '../../preview/code.js'
import { formatRelative } from '../../core/format.js'
import { HistoryCommitDetails } from '../history/details.js'

function WorkbenchBranchSidebar(props) {
  var t = props.t, search = React.useState('')
  var mergeFilter = React.useState('all')
  var refreshing = React.useState(false), refreshPending = React.useRef(false)
  var refreshBranches = function () {
    if (refreshPending.current || props.busy || props.refreshing) return
    refreshPending.current = true; refreshing[1](true)
    Promise.resolve().then(function () { return props.onRefresh() }).catch(function () {}).finally(function () {
      refreshPending.current = false; refreshing[1](false)
    })
  }
  var folded = React.useState({})
  var favorites = [readWorkbenchStorage('favorites:' + props.root, [])]
  var query = search[0].trim().toLowerCase()
  var all = React.useMemo(function () {
    var seen = new Set()
    // Older hosts omit symref and shorten origin/HEAD to just origin.
    return sortedBranches([].concat(props.refs?.branches || [], props.refs?.remotes || []).filter(function (branch) {
      if (branch.symbolic || !/^refs\/(heads|remotes)\/[^/]+(?:\/[^/]+)*$/.test(branch.ref || '') || /^refs\/remotes\/.+\/HEAD$/.test(branch.ref) || seen.has(branch.ref)) return false
      seen.add(branch.ref); return true
    }))
  }, [props.refs?.branches, props.refs?.remotes])
  var branches = all.map(function (branch) {
    var normalizedRoot = props.root.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
    var occupied = (props.worktrees || []).find(function (tree) { return tree.branch === branch.ref && tree.path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() !== normalizedRoot })
    var remote = (props.remotes || []).filter(function (remote) { return branch.ref.startsWith('refs/remotes/' + remote.name + '/') })
      .sort(function (a, b) { return b.name.length - a.name.length })[0]
    return Object.assign({}, branch, { name: branch.ref.replace(/^refs\/(heads|remotes)\//, ''), remoteName: remote?.name, occupied: occupied?.path || null })
  })
  var matches = branches.filter(function (branch) { return (!query || branch.name.toLowerCase().includes(query))
    && (mergeFilter[0] === 'all' || branch.merged === (mergeFilter[0] === 'merged')) })
  var matchedTags = mergeFilter[0] === 'all' ? (props.refs?.tags || []).filter(function (tag) { return !query || tag.name.toLowerCase().includes(query) }) : []
  var branchGroup = function (branch) {
    if (branch.ref.startsWith('refs/heads/')) return 'local'
    var remote = (props.remotes || []).filter(function (remote) { return branch.ref.startsWith('refs/remotes/' + remote.name + '/') })
      .sort(function (a, b) { return b.name.length - a.name.length })[0]
    return 'remote:' + (remote ? remote.name : branch.name.split('/')[0])
  }
  var folder = function (key, label, children, prefix) {
    var defaultOpen = key === 'favorites' || key === 'locals' || key === 'remotes' || (props.remotes || []).some(function (remote) { return key === 'remote:' + remote.name })
    if (prefix) defaultOpen = defaultOpen || matches.some(function (branch) {
      return (branch.head || branch.ref === props.selected) && (branchGroup(branch) === 'local' ? key.startsWith('local::') : key.startsWith(branchGroup(branch) + ':'))
        && branch.ref.startsWith((branchGroup(branch) === 'local' ? 'refs/heads/' : 'refs/remotes/' + branchGroup(branch).slice(7) + '/') + prefix + '/')
    })
    var remote = (props.remotes || []).find(function (entry) { return key === 'remote:' + entry.name })
    var icon = key === 'locals' ? IconBranch : key === 'remotes' || remote ? IconRemote : key === 'tags' ? IconTag : key === 'favorites' ? IconStar : IconFolder
    var menu = function (event) { event.preventDefault(); event.stopPropagation?.(); props.onMenu(event, { name: label, folder: true, prefix: prefix || '', remoteName: remote?.name }) }
    var open = query ? true : folded[0][key] === undefined ? defaultOpen : folded[0][key] === true
    return h('details', { key: key, className: 'dshgit-branch-folder', 'data-branch-group': key, open: open,
      onToggle: function (event) { if (query) return; var open = event.currentTarget.open
        folded[1](function (value) { if (value[key] === open) return value; var next = Object.assign({}, value); next[key] = open; return next }) },
    }, [h('summary', { key: 'label', onContextMenu: menu }, [h('span', { key: 'caret', className: 'dshgit-branch-caret', 'aria-hidden': true }, h(IconChevron, { size: 12 })),
      h('span', { key: 'icon', className: 'dshgit-branch-groupicon', 'aria-hidden': true }, h(icon, { size: 16 })),
      h('span', { key: 'name', className: 'dshgit-name', title: label }, label),
      remote ? h('span', { key: 'actions', className: 'dshgit-remote-actions dshgit-branch-actions',
        'data-busy': props.busyAction === 'fetch' && props.busyRef === key,
      }, ['fetch', 'prune'].map(function (action) {
        var prune = action === 'prune', label = t(prune ? 'wb.pruneRemote' : 'wb.fetch')
        var command = 'git fetch ' + (prune ? '--prune ' : '') + remote.name
        return h('button', { key: action, type: 'button', className: 'dshgit-iconbtn',
          title: label + ' · ' + command, 'aria-label': label + ' · ' + remote.name,
          'data-remote-action': action, 'data-remote-target': remote.name, disabled: props.busy,
          onClick: function (event) { event.preventDefault(); event.stopPropagation(); props.onFetch(remote.name, prune) },
        }, h(prune ? IconSweep : IconBranchSync, { size: 16, kind: 'fetch', horizontal: true }))
      })) : null,
    ]), h('div', { key: 'children', className: 'dshgit-branch-children' }, open ? children() : null)])
  }
  var leaf = function (branch, name) {
    var current = branch.head === true, selected = props.selected === branch.ref
    var upstreamUpdates = branch.ref.startsWith('refs/heads/') && branch.behind > 0
    var pushPending = branch.ref.startsWith('refs/heads/') && branch.ahead > 0
    var updateHint = upstreamUpdates ? t('wb.upstreamUpdates', { count: branch.behind }) : ''
    var upstream = branch.ref.startsWith('refs/heads/') ? workbenchUpstream(branch).replace(/^refs\/(remotes|heads)\//, '') : ''
    return h('div', { key: branch.ref, className: 'dshgit-branch-item', 'data-selected': selected, 'data-upstream-updates': upstreamUpdates,
      'data-push-pending': pushPending,
      'data-busy': props.busyAction && props.busyRef === branch.ref,
      onContextMenu: function (event) { props.onMenu(event, branch) },
    }, [h('button', { key: 'select', type: 'button', className: 'dshgit-branch-select', 'data-branch-ref': branch.ref, 'aria-pressed': selected,
      title: branch.name + (pushPending ? '\n' + t('state.readyPush', { count: branch.ahead }) : '') + (updateHint ? '\n' + updateHint : '') + (upstream ? '\n' + t('wb.upstream') + ': ' + upstream : '') + (branch.occupied ? '\n' + t('wb.occupied') + ': ' + branch.occupied : ''),
      onClick: function () { props.onSelect(branch) }, onDoubleClick: function () { if (!current && !branch.occupied && !props.busy) props.onWorkflow('checkout', branch) },
    }, [h('span', { key: 'status', className: 'dshgit-branch-statusicon' }, [
      h(IconBranch, { key: 'icon', size: 16 }),
      current ? h('span', { key: 'current', className: 'dshgit-tipdot dshgit-branch-current-dot', role: 'img', 'aria-label': t('wb.current') }) : null,
      upstreamUpdates ? h('span', { key: 'updates', className: 'dshgit-branch-update-dot', role: 'img', 'aria-label': updateHint }) : null,
    ]),
      h('span', { key: 'name', className: 'dshgit-name' }, name),
      branch.ahead || branch.behind ? h('span', { key: 'tracking', className: 'dshgit-muted dshgit-branch-tracking' }, (branch.ahead ? '↑' + branch.ahead : '') + (branch.behind ? ' ↓' + branch.behind : '')) : null,
    ]), h('div', { key: 'actions', className: 'dshgit-branch-actions' }, (branch.ref.startsWith('refs/remotes/') ? ['checkout', 'fetch', 'createBranch', 'more'] : ['checkout', 'push', 'pull', 'fetch', 'more']).map(function (action) {
      var unavailable = action === 'pull' && (!!branch.occupied || !(branch.upstreamRef || branch.upstream))
      if (action === 'checkout') unavailable = current || !!branch.occupied
      if (action === 'fetch' && branch.ref.startsWith('refs/heads/')) unavailable = !/^refs\/remotes\//.test(workbenchUpstream(branch))
      var label = t(action === 'more' ? 'menu.actions' : action === 'fetch' ? (branch.ref.startsWith('refs/remotes/') ? 'wb.fetchBranch' : branch.upstreamRef || branch.upstream ? 'wb.fetchLocal' : 'wb.fetch') : action === 'pull' && !current ? 'wb.pullLocalFastForward' : 'wb.' + action)
      var hint = unavailable ? t(action === 'pull' && branch.occupied ? 'wb.occupied' : 'wb.pullNeedsUpstream') : action === 'pull' && !current ? label + '\n' + t('wb.pullLocalHint') : action === 'fetch' && branch.ref.startsWith('refs/heads/') ? label + '\n' + t('wb.fetchLocalHint') : label
      if (action === 'checkout' && unavailable) hint = t(current ? 'wb.current' : 'wb.occupied')
      return h('button', { key: action, type: 'button', className: 'dshgit-iconbtn', title: hint,
        'aria-label': label, 'data-branch-action': action, 'data-branch-target': branch.ref,
        'data-push-pending': action === 'push' && pushPending,
        'aria-busy': props.busyAction === action && props.busyRef === branch.ref,
        disabled: action !== 'more' && (props.busy || unavailable),
        onClick: function (event) { if (action === 'more') props.onMenu(event, branch); else props.onWorkflow(action, branch) },
      }, props.busyAction === action && props.busyRef === branch.ref ? h('span', { className: 'dshgit-spinner' })
        : h(action === 'more' ? IconMore : action === 'checkout' || action === 'createBranch' || action === 'merge' ? IconBranchAction : IconBranchSync, { size: 16, kind: action, horizontal: true }))
    }))])
  }
  var compareNames = function (a, b) {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.name.localeCompare(b.name)
  }
  var tree = function (items, prefix) {
    var node = { dirs: Object.create(null), files: [] }
    items.forEach(function (branch) {
      var name = branch.ref.slice((prefix ? 'refs/remotes/' + prefix + '/' : 'refs/heads/').length)
      if (!name || name.split('/').some(function (part) { return !part })) return
      var parts = name.split('/'), current = node
      parts.slice(0, -1).forEach(function (part) {
        if (!current.dirs[part]) current.dirs[part] = { dirs: Object.create(null), files: [] }
        current = current.dirs[part]
      })
      current.files.push({ branch: branch, name: parts[parts.length - 1] })
    })
    var render = function (entry, path) {
      var children = Object.keys(entry.dirs).map(function (name) { return { name: name, directory: entry.dirs[name] } })
        .concat(entry.files.map(function (file) { return { name: file.name, branch: file.branch } }))
      return children.sort(function (a, b) { return Number(!!b.directory) - Number(!!a.directory) || compareNames(a, b) }).map(function (item) {
        if (item.branch) return leaf(item.branch, item.name)
        var name = item.name, child = item.directory, label = name, full = path ? path + '/' + name : name
        while (!child.files.length && Object.keys(child.dirs).length === 1) { var next = Object.keys(child.dirs)[0]; label += '/' + next; full += '/' + next; child = child.dirs[next] }
        return folder((prefix ? 'remote:' + prefix : 'local:') + ':' + full, label, function () { return render(child, full) }, full)
      })
    }
    return render(node, '')
  }
  var favorited = matches.filter(function (branch) { return favorites[0].includes(branch.ref) }).sort(compareNames)
  var remoteFolders = function () {
    return (props.remotes || []).map(function (remote) {
      var group = 'remote:' + remote.name
      var items = matches.filter(function (branch) { return branchGroup(branch) === group })
      var label = remote.name + ' (' + items.length + ')'
      return folder(group, label, function () { return items.length ? tree(items, remote.name)
        : h('div', { className: 'dshgit-sidebar-hint' }, [t(query || mergeFilter[0] !== 'all' ? 'list.noMatches' : 'wb.emptyRemote'),
          query || mergeFilter[0] !== 'all' ? null : h('button', { type: 'button', className: 'dshgit-iconbtn', disabled: props.busy, onClick: function () { props.onFetch(remote.name) } }, t('action.fetch'))]) })
    })
  }
  var selectCurrent = function () {
    var branch = branches.find(function (branch) { return branch.head })
    if (!branch) return
    search[1](''); mergeFilter[1]('all')
    var next = { locals: true }, parts = branch.name.split('/')
    parts.slice(0, -1).forEach(function (_, index) { next['local::' + parts.slice(0, index + 1).join('/')] = true })
    folded[1](next); props.onSelect(branch)
  }
  React.useEffect(function () {
    var node = document.querySelector?.('[data-branch-ref="' + String(props.selected || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]')
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [props.selected, search[0]])
  return h(Fragment, null, [
    h('div', { key: 'tools', className: 'dshgit-branch-tools dshgit-branch-toolbar' }, [
      h('button', { key: 'new', type: 'button', className: 'dshgit-iconbtn', title: t('wb.createBranch'), 'aria-label': t('wb.createBranch'), disabled: props.busy,
        onClick: function () { props.onWorkflow('createBranch') } }, h(IconChangeAction, { kind: 'stage' })),
      h('button', { key: 'refresh', type: 'button', className: 'dshgit-iconbtn', title: t('wb.refreshBranches'), 'aria-label': t('wb.refreshBranches'),
        disabled: props.busy || props.refreshing || refreshing[0], 'aria-busy': refreshing[0],
        onClick: refreshBranches }, refreshing[0] ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : h(IconChangeAction, { kind: 'refresh' })),
      h('button', { key: 'locate', type: 'button', className: 'dshgit-iconbtn', title: t('wb.locate'), 'aria-label': t('wb.locate'), onClick: selectCurrent }, h(IconBranch, { size: 16 })),
      h('button', { key: 'reflog', type: 'button', className: 'dshgit-iconbtn', title: t('wb.reflogHint'), 'aria-label': t('wb.reflog'), onClick: props.onReflog }, h(IconHistory, { size: 18 })),
    ]),
    h('div', { key: 'search', className: 'dshgit-sidebar-search dshgit-branch-search' }, [
      h('input', { key: 'input', type: 'search', className: 'dshgit-input', value: search[0], placeholder: t('wb.search'), 'aria-label': t('wb.search'),
        onChange: function (event) { search[1](event.currentTarget.value) } }),
      h(Menu, { key: 'filter', t: t, portal: true, align: 'right', title: t('wb.branchFilter'), triggerClass: 'dshgit-iconbtn',
        rootClass: mergeFilter[0] !== 'all' ? 'dshgit-branch-filter-active' : undefined,
        label: svg({ size: 16 }, h('path', { d: 'M2 3h12M4 8h8M6 13h4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })),
        items: ['all', 'merged', 'unmerged'].map(function (value) { return {
          id: value, label: (mergeFilter[0] === value ? '✓ ' : '') + t('wb.' + (value === 'all' ? 'allBranches' : value === 'merged' ? 'mergedBranches' : 'unmergedBranches')),
          run: function () { mergeFilter[1](value) },
        } }),
      }),
    ]),
    mergeFilter[0] !== 'all' ? h('div', { key: 'mergeFilter', className: 'dshgit-filterchip' }, [
      h('span', { key: 'label', className: 'dshgit-name' }, t('wb.' + (mergeFilter[0] === 'merged' ? 'mergedBranches' : 'unmergedBranches'))),
      h('button', { key: 'clear', type: 'button', className: 'dshgit-iconbtn', title: t('action.close'), 'aria-label': t('action.close'),
        onClick: function () { mergeFilter[1]('all') } }, '×'),
    ]) : null,
    mergeFilter[0] !== 'all' && branches.some(function (branch) { return typeof branch.merged !== 'boolean' }) ? h('div', { key: 'mergeUnknown', className: 'dshgit-sidebar-hint' }, t('wb.mergedUnknown')) : null,
    readWorkbenchStorage('fetch:' + props.root, null) ? h('div', { key: 'lastFetch', className: 'dshgit-sidebar-hint' }, t('wb.fetched') + ' · ' + new Date(readWorkbenchStorage('fetch:' + props.root, null)).toLocaleString()) : null,
    h('div', { key: 'tree', className: 'dshgit-branch-tree' }, props.refs === null ? h('div', { className: 'dshgit-empty' }, t('state.loading')) : [
      favorited.length ? folder('favorites', t('wb.favorites') + ' (' + favorited.length + ')', function () { return favorited.map(function (branch) { return leaf(branch, branch.name) }) }) : null,
      folder('locals', t('wb.local') + ' (' + (query || mergeFilter[0] !== 'all' ? matches.filter(function (branch) { return branch.ref.startsWith('refs/heads/') }).length + '/' : '') + branches.filter(function (branch) { return branch.ref.startsWith('refs/heads/') }).length + ')',
        function () { return tree(matches.filter(function (branch) { return branch.ref.startsWith('refs/heads/') }), '') }),
      folder('remotes', t('wb.remote'), remoteFolders),
      mergeFilter[0] === 'all' && matchedTags.length > 0 ? folder('tags', t('wb.tags') + ' (' + matchedTags.length + ')', function () { return matchedTags.map(function (tag) {
        return h('button', { key: tag.ref, type: 'button', className: 'dshgit-rowbtn dshgit-row dshgit-branch-tag', onClick: function () { props.onSelect(tag) }, title: tag.ref }, [
          h('span', { key: 'icon', className: 'dshgit-branch-groupicon', 'aria-hidden': true }, h(IconTag, { size: 16 })),
          h('span', { key: 'name', className: 'dshgit-name' }, tag.name),
        ])
      }) }) : null,
      matches.length === 0 && matchedTags.length === 0 && (query || mergeFilter[0] !== 'all') ? h('div', { key: 'empty', className: 'dshgit-sidebar-hint' }, t('list.noMatches')) : null,
    ]),
  ])
}


function WorkbenchPatchPreview(props) {
  var fileState = React.useState(props.preview.diffFiles?.[0]?.path || ''), searchState = React.useState(''), limitState = React.useState(100)
  var valueState = React.useState(null), errorState = React.useState(''), retryState = React.useState(0)
  var coordinates = props.preview.coordinates
  var files = (props.preview.diffFiles || []).filter(function (file) { return file.path.toLowerCase().includes(searchState[0].toLowerCase()) })
  React.useEffect(function () {
    if (!fileState[0]) return
    var active = true; valueState[1](null); errorState[1]('')
    var original = (props.preview.diffFiles || []).find(function (file) { return file.path === fileState[0] })
    props.run('diff', Object.assign({ root: props.repo.root }, coordinates, { path: fileState[0], originalPath: original?.originalPath }), { silentError: true }).then(function (value) { if (active) valueState[1](value) }).catch(function (error) { if (active) errorState[1](error.message) })
    return function () { active = false }
  }, [fileState[0], retryState[0]])
  var patch = valueState[0]?.files?.[0]
  return h('details', null, [h('summary', { key: 'summary' }, (props.label || props.t('wb.preview')) + ' (' + (props.preview.diffFiles || []).length + ')'),
    h('input', { key: 'search', type: 'search', value: searchState[0], placeholder: props.t('list.searchFiles'), 'aria-label': props.t('list.searchFiles'), onChange: function (event) { searchState[1](event.currentTarget.value); limitState[1](100) } }),
    h('div', { key: 'files', className: 'dshgit-workbench-preview' }, files.slice(0, limitState[0]).map(function (file) { return h('button', { key: file.path, type: 'button', className: 'dshgit-rowbtn dshgit-row', 'aria-pressed': fileState[0] === file.path, onClick: function () { fileState[1](file.path) } }, file.path) })),
    files.length > limitState[0] ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn', onClick: function () { limitState[1](limitState[0] + 100) } }, props.t('action.loadMore')) : null,
    errorState[0] ? h('div', { key: 'error', role: 'alert' }, [errorState[0], h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () { retryState[1](retryState[0] + 1) } }, props.t('stash.retry'))]) : null,
    h('div', { key: 'patch', className: 'dshgit-workbench-preview' }, patch ? h(FileDiffCard, { file: patch, t: props.t }, h(DiffBody, { path: patch.path, hunks: patch.hunks, emptyText: props.t(patch.binary ? 'state.fileBinary' : 'state.emptyDiff') })) : props.t(fileState[0] && valueState[0] === null ? 'state.loading' : 'state.emptyDiff')),
  ])
}


function WorkbenchRecovery(props) {
  var t = props.t, panel = React.useRef(null), recordsState = React.useState([]), errorState = React.useState(''), retryState = React.useState(0), loadingState = React.useState(true)
  useDialogFocus(panel, props.onClose)
  React.useEffect(function () {
    var active = true; loadingState[1](true); errorState[1]('')
    props.run('reflog', { root: props.repo.root, limit: 100 }, { silentError: true }).then(function (result) { if (active) { recordsState[1](result); loadingState[1](false) } }).catch(function (error) { if (active) { errorState[1](error.message); loadingState[1](false) } })
    return function () { active = false }
  }, [props.repo.root, retryState[0]])
  var restore = function (sha) { props.onWorkflow('createBranch', { sha: sha }, { prefix: 'recovery/' }) }
  return h('div', { className: 'dshgit-modal', onClick: props.onClose }, h('div', { className: 'dshgit-dialog dshgit-workbench-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': t('wb.reflog'), ref: panel, tabIndex: -1, onClick: function (event) { event.stopPropagation() } }, [
    h('div', { key: 'title', className: 'dshgit-dialogtitle' }, t('wb.reflog')),
    h('div', { key: 'description', className: 'dshgit-muted' }, t('wb.reflogDescription')),
    (props.recovery || []).map(function (record, index) { return h('div', { key: 'recovery' + index, className: 'dshgit-workbench-preview' }, [
      h('div', { key: 'title' }, t('wb.' + record.kind) + ' · ' + new Date(record.at).toLocaleString()),
      record.backup ? h('div', { key: 'backup' }, record.backup) : null,
      record.stash ? h('div', { key: 'stash' }, t('wb.protectedStash') + ' · ' + record.stash.slice(0, 10)) : null,
      record.stash && props.onStash ? h('button', { key: 'viewStash', className: 'dshgit-btn', onClick: function () { props.onStash(record.stash) } }, t('wb.savedChanges')) : null,
      record.head ? h('button', { key: 'recover', className: 'dshgit-btn', onClick: function () { restore(record.head) } }, t('wb.recoverBranch')) : null,
    ]) }),
    loadingState[0] ? h('span', { key: 'loading', className: 'dshgit-spinner' }) : null,
    errorState[0] ? h('div', { key: 'error', role: 'alert' }, [errorState[0], h('button', { key: 'retry', className: 'dshgit-btn', onClick: function () { retryState[1](function (value) { return value + 1 }) } }, t('stash.retry'))]) : null,
    h('div', { key: 'records', className: 'dshgit-workbench-preview' }, recordsState[0].map(function (record, index) { return h('div', { key: record.ref + index, className: 'dshgit-recovery-record' }, [
      h('span', { key: 'message', title: record.sha }, record.sha.slice(0, 8) + ' · ' + record.message),
      h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [h('button', { key: 'branch', className: 'dshgit-btn', onClick: function () { restore(record.sha) } }, t('wb.createBranch')), h('button', { key: 'reset', className: 'dshgit-btn', onClick: function () { props.onWorkflow('resetTo', { sha: record.sha }) } }, t('wb.resetTo'))]),
    ]) })),
    h('div', { key: 'actions', className: 'dshgit-dialogactions' }, h('button', { className: 'dshgit-btn', onClick: props.onClose }, t('action.close'))),
  ]))
}


function WorkbenchGraph(props) {
  var t = props.t, scrollNode = React.useRef(null), scrollPosition = React.useRef(0), lastCommit = React.useRef(null), previewOpen = React.useState(false)
  var panel = React.useRef(null), filePane = React.useRef(null), filesWidth = React.useState(null), resize = React.useRef(null)
  var applyFilesWidth = function (value, separator) {
    var maximum = Math.max(160, (panel.current?.clientWidth || 800) - 186)
    var width = Math.max(160, Math.min(maximum, value))
    panel.current?.style.setProperty('--dshgit-history-files-width', width + 'px')
    separator?.setAttribute('aria-valuenow', Math.round(width))
    return width
  }
  var startFilesResize = function (event) {
    if (event.button !== 0) return
    event.preventDefault()
    resize.current = { id: event.pointerId, x: event.clientX, width: filePane.current.getBoundingClientRect().width, value: null }
    panel.current.style.userSelect = 'none'
    event.currentTarget.setAttribute('data-dragging', 'true')
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  var moveFilesResize = function (event) {
    var drag = resize.current
    if (!drag || drag.id !== event.pointerId) return
    // Resize the DOM during dragging; commit React state once on release.
    drag.value = applyFilesWidth(drag.width + drag.x - event.clientX, event.currentTarget)
  }
  var finishFilesResize = function (event) {
    var drag = resize.current
    if (!drag || drag.id !== event.pointerId) return
    resize.current = null
    if (drag.value !== null) filesWidth[1](drag.value)
    panel.current?.style.removeProperty('user-select')
    event.currentTarget.removeAttribute('data-dragging')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  var rows = props.graph?.rows || [], incoming = new Set(), width = Math.max(1, props.graph?.laneCount || 1) * 16 + 12
  var selected = props.selection?.kind === 'commit' ? props.selection.sha : null
  var context = JSON.stringify([props.config.scope, props.config.selected, props.config.ordering])
  var previousContext = React.useRef(context)
  React.useLayoutEffect(function () {
    if (previousContext.current !== context) { scrollPosition.current = 0; lastCommit.current = null; previousContext.current = context }
    if (selected) lastCommit.current = selected
    if (!selected || !previewOpen[0]) { if (scrollNode.current) scrollNode.current.scrollTop = scrollPosition.current }
  }, [selected, context, previewOpen[0]])
  React.useLayoutEffect(function () { previewOpen[1](false) }, [selected])
  var openCommit = function (sha) {
    if (!previewOpen[0] && scrollNode.current) scrollPosition.current = scrollNode.current.scrollTop
    previewOpen[1](false); lastCommit.current = sha; props.onOpenCommit(sha)
  }
  var selectedIndex = rows.findIndex(function (row) { return row.sha === selected })
  var records = rows.map(function (row) {
    var tips = [].concat(props.refs?.branches || [], props.refs?.remotes || [], props.refs?.tags || []).filter(function (ref) {
      return !ref.symbolic && (ref.commitSha || ref.sha) === row.sha && (props.config.scope !== 'all' || props.config.showRemote || !ref.ref.startsWith('refs/remotes/'))
    })
    if (!tips.length) tips = (row.tips || []).map(function (tip) { return { ref: tip, name: tip } })
    var x = row.lane * 16 + 8, paths = (row.through || []).map(function (lane) { return h('path', { key: 'through' + lane,
      d: 'M' + (lane * 16 + 8) + ' 0V32', stroke: laneColor(lane), strokeWidth: 1.5 }) })
    if (incoming.has(row.sha)) paths.push(h('path', { key: 'incoming', d: 'M' + x + ' 0V16', stroke: laneColor(row.lane), strokeWidth: 1.5 }))
    ;(row.edges || []).forEach(function (edge, index) {
      var target = edge.to * 16 + 8
      paths.push(h('path', { key: 'edge' + index, d: 'M' + x + ' 16C' + x + ' 25 ' + target + ' 25 ' + target + ' 32', fill: 'none', stroke: laneColor(edge.to), strokeWidth: 1.5 }))
      incoming.add(edge.parent)
    })
    paths.push(h('circle', { key: 'dot', cx: x, cy: 16, r: (row.parents || []).length > 1 ? 4 : 3.5, fill: laneColor(row.lane) }))
    return h('div', { key: row.sha, className: 'dshgit-graph-record', 'data-selected': (selected || lastCommit.current) === row.sha, 'data-unpublished': row.unpublished === true,
      onContextMenu: function (event) { props.onMenu(event, row.sha) } }, [
      h('button', { key: 'select', type: 'button', className: 'dshgit-graph-select', 'data-graph-sha': row.sha, 'aria-pressed': selected === row.sha,
        title: row.sha + '\n' + row.subject, onClick: function () { openCommit(row.sha) },
      }, [h('svg', { key: 'lanes', width: width, height: 32, viewBox: '0 0 ' + width + ' 32', 'aria-hidden': true, style: { flex: 'none' } }, paths),
        h('span', { key: 'sha', className: 'dshgit-muted dshgit-graph-sha' }, row.shortSha),
        row.unpublished ? h('span', { key: 'unpushed', className: 'dshgit-push-indicator', title: t('state.unpublished'), 'aria-label': t('state.unpublished') }, '↑') : null,
        h('span', { key: 'subject', className: 'dshgit-subject' }, row.subject),
        h('span', { key: 'author', className: 'dshgit-muted dshgit-graph-author', title: row.author }, row.author),
        h('span', { key: 'time', className: 'dshgit-muted dshgit-graph-time' }, formatRelative(row.authorDate)),
        tips.length ? h('span', { key: 'tips', className: 'dshgit-graph-tips' }, tips.slice(0, 2).map(function (tip, index) { var kind = tip.ref.startsWith('refs/tags/') ? 'tag' : tip.ref.startsWith('refs/remotes/') ? 'remote' : 'local'
          return h('span', { key: 'tip' + index, className: 'dshgit-graph-tip', 'data-kind': kind, title: tip.ref }, tip.name) })) : null,
      ]), tips.length > 2 ? h(Menu, { key: 'moreTips', t: t, portal: true, menuClass: 'dshgit-graph-refs', title: t('wb.branches'), label: '+' + (tips.length - 2), items: tips.map(function (tip) {
        return { label: tip.name, hint: tip.ref, run: function () { props.onConfig({ scope: 'selected', selected: tip.ref, limit: 200 }) } }
      }) }) : null, h('button', { key: 'more', type: 'button', className: 'dshgit-iconbtn', title: t('menu.actions'), 'aria-label': t('menu.actions'),
        onClick: function (event) { props.onMenu(event, row.sha) } }, h(IconMore, { size: 16 })),
    ])
  })
  return h('div', { ref: panel, className: 'dshgit-graph-workbench', 'data-browse-files': !!selected && !previewOpen[0],
    style: filesWidth[0] === null ? undefined : { '--dshgit-history-files-width': filesWidth[0] + 'px' } }, [
    h('div', { key: 'tools', className: 'dshgit-graph-tools', style: selected && previewOpen[0] ? { display: 'none' } : undefined }, [
      h(ComboBox, { key: 'scope', style: { width: '160px' }, value: props.config.scope, t: t, label: t('wb.viewing'),
        onChange: function (value) { props.onConfig({ scope: value, limit: 200 }) }, options: ['all', 'current', 'selected'].filter(function (scope) { return scope !== 'selected' || props.config.selected }).map(function (scope) {
          return { value: scope, label: t('wb.' + (scope === 'current' ? 'currentScope' : scope)) } }) }),
      h('label', { key: 'remote', className: 'dshgit-commit-check' }, [h('input', { type: 'checkbox', checked: props.config.showRemote, disabled: props.config.scope !== 'all',
        onChange: function (event) { props.onConfig({ showRemote: event.currentTarget.checked, limit: 200 }) } }), t('wb.showRemote')]),
      h(ComboBox, { key: 'order', style: { width: '130px' }, value: props.config.ordering, t: t, label: t('wb.date'),
        onChange: function (value) { props.onConfig({ ordering: value, limit: 200 }) }, options: ['date', 'topo'].map(function (order) { return { value: order, label: t('wb.' + order) } }) }),
      props.loading && !props.graph ? h('span', { key: 'loading', className: 'dshgit-spinner', role: 'status', 'aria-label': t('state.loading') }) : null,
      h('span', { key: 'count', className: 'dshgit-muted' }, String(rows.length)),
      props.config.scope === 'selected' ? h('span', { key: 'viewing', className: 'dshgit-muted' }, props.config.selected.replace(/^refs\/(heads|remotes|tags)\//, '')) : null,
    ]),
    h('div', { key: 'graph', ref: scrollNode, className: 'dshgit-graph-scroll', style: selected && previewOpen[0] ? { display: 'none' } : undefined,
      onScroll: function (event) { if (!previewOpen[0]) scrollPosition.current = event.currentTarget.scrollTop } }, [
      props.error ? h('div', { key: 'error', className: 'dshgit-card', role: 'alert' }, [props.error,
        h('button', { type: 'button', className: 'dshgit-btn', onClick: function () { props.onConfig({ refresh: props.config.refresh + 1 }) } }, t('stash.retry'))]) : null,
      rows.length ? records : h('div', { key: 'empty', className: 'dshgit-empty' }, t(props.loading ? 'state.loading' : 'state.noCommits')),
      props.graph?.hasMore && props.config.limit < 2000 ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn dshgit-list-more', disabled: props.loading,
        onClick: function () { props.onConfig({ limit: Math.min(2000, props.config.limit + 200) }) } }, props.loading ? t('state.loading') : t('action.loadMore')) : null,
      props.graph?.hasMore && props.config.limit >= 2000 ? h('div', { key: 'maximum', className: 'dshgit-sidebar-hint' }, t('wb.maximum')) : null,
    ]),
    selected && !previewOpen[0] ? h('button', { key: 'files-resize', type: 'button', className: 'dshgit-history-files-resizer', role: 'separator', 'aria-orientation': 'vertical',
      'aria-label': t('history.resizeFiles'), title: t('history.resizeFiles'), 'aria-valuemin': 160, 'aria-valuenow': Math.round(filesWidth[0] || 260),
      onFocus: function (event) { event.currentTarget.setAttribute('aria-valuenow', Math.round(filePane.current.getBoundingClientRect().width)) },
      onPointerDown: startFilesResize, onPointerMove: moveFilesResize, onPointerUp: finishFilesResize, onPointerCancel: finishFilesResize, onLostPointerCapture: finishFilesResize,
      onDoubleClick: function () { filesWidth[1](null); panel.current?.style.removeProperty('--dshgit-history-files-width') },
      onKeyDown: function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        filesWidth[1](applyFilesWidth(filePane.current.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 16 : -16), event.currentTarget))
      } }) : null,
    selected ? h('div', { key: 'detail', ref: filePane, className: 'dshgit-graph-detail' }, [
      h(HistoryCommitDetails, { key: props.repo.root + ':' + selected, compact: true, actions: h('div', { key: 'head', className: 'dshgit-graph-detailtools' }, [
        h('span', { key: 'position', className: 'dshgit-muted' }, selectedIndex >= 0 ? (selectedIndex + 1) + ' / ' + rows.length : ''),
        h('button', { key: 'previous', type: 'button', className: 'dshgit-iconbtn', title: t('action.previousCommit'), 'aria-label': t('action.previousCommit'), disabled: selectedIndex <= 0,
          onClick: function () { openCommit(rows[selectedIndex - 1].sha) } }, '‹'),
        h('button', { key: 'next', type: 'button', className: 'dshgit-iconbtn', title: t('action.nextCommit'), 'aria-label': t('action.nextCommit'), disabled: selectedIndex < 0 || selectedIndex >= rows.length - 1,
          onClick: function () { openCommit(rows[selectedIndex + 1].sha) } }, '›'),
        h('button', { key: 'close', type: 'button', className: 'dshgit-iconbtn dshgit-graph-detail-close', title: t(previewOpen[0] ? 'action.backToFiles' : 'action.close'),
          'aria-label': t(previewOpen[0] ? 'action.backToFiles' : 'action.close'), onClick: function () { if (previewOpen[0]) previewOpen[1](false); else props.onCloseDetail() } }, '×'),
        props.onMenu ? h('span', { key: 'more', className: 'dshgit-graph-detail-more' }, h('button', { type: 'button', className: 'dshgit-iconbtn', title: t('menu.actions'), 'aria-label': t('menu.actions'), onClick: function (event) { props.onMenu(event, selected) } }, h(IconMore, { size: 16, horizontal: true }))) : null,
      ]), previewOpen: previewOpen[0], onPreviewOpen: function () {
        if (!previewOpen[0] && scrollNode.current) scrollPosition.current = scrollNode.current.scrollTop
        previewOpen[1](true)
      }, sha: selected, repo: props.repo, run: props.run, onMenu: props.onMenu, onFileMenu: props.onFileMenu, onFileRestore: props.onFileRestore, t: t }),
    ]) : null,
    props.recovery ? h('div', { key: 'recovery', className: 'dshgit-workbench-recovery' }, [h('span', { key: 'kind', className: 'dshgit-muted' }, t('wb.' + props.recovery.kind)),
      h('button', { key: 'open', type: 'button', className: 'dshgit-btn', onClick: props.onRecovery }, t('wb.recovery'))]) : null,
  ])
}


function GraphSidebar(props) {
  var t = props.t
  var graph = props.graph
  if (graph === null) {
    return h('div', { className: 'dshgit-empty' }, t('state.loading'))
  }
  var rows = graph.rows || []
  var tips = []
  for (var i = 0; i < rows.length; i++) {
    for (var k = 0; k < (rows[i].tips || []).length; k++) {
      if (tips.indexOf(rows[i].tips[k]) === -1) tips.push(rows[i].tips[k])
    }
  }
  return h(Fragment, null, [
    h('div', { key: 'stats', className: 'dshgit-section' }, [
      h('div', { key: 'l', className: 'dshgit-kvrow' }, [
        h('span', { key: 'k', className: 'dshgit-muted' }, t('graph.lanesLabel')),
        h('span', { key: 'v' }, String(graph.laneCount)),
      ]),
      h('div', { key: 'c', className: 'dshgit-kvrow' }, [
        h('span', { key: 'k', className: 'dshgit-muted' }, t('label.commits')),
        h('span', { key: 'v' }, String(rows.length)),
      ]),
    ]),
    tips.length === 0
      ? null
      : h('div', { key: 'tips', className: 'dshgit-section' }, [
          h('div', { key: 'h', className: 'dshgit-subgroup' }, t('graph.tips')),
          h('div', { key: 'l' }, tips.map(function (tip) {
            return h('div', { key: tip, className: 'dshgit-row' }, [
              h('span', { key: 'i', className: 'dshgit-tipdot', 'aria-hidden': 'true' }),
              h('span', { key: 'n', className: 'dshgit-name' }, tip),
            ])
          })),
        ]),
  ])
}


/** The commit graph with lane rendering. */
function GraphView(props) {
  var t = props.t
  var graph = props.graph
  if (graph === null) return h('div', { className: 'dshgit-empty' }, t('state.loading'))

  var rows = graph.rows || []
  if (rows.length === 0) return h('div', { className: 'dshgit-empty' }, t('state.noCommits'))

  var laneWidth = 14
  return h(Fragment, null, [
    h('div', { key: 'head', className: 'dshgit-card' },
      t('graph.lanes', { count: graph.laneCount }) + ' · ' + rows.length),
    h('div', { key: 'rows' }, rows.map(function (row) {
      var selected = props.selection !== null && props.selection.kind === 'commit' && props.selection.sha === row.sha
      var lanes = []
      for (var lane = 0; lane < row.laneCount; lane++) {
        var isOwn = lane === row.lane
        var isThrough = row.through.indexOf(lane) !== -1
        lanes.push(
          h('span', {
            key: 'l' + lane,
            className: 'dshgit-dot' + (isOwn ? '' : ''),
            style: {
              background: isOwn || isThrough ? laneColor(lane) : 'transparent',
              opacity: isOwn ? 1 : 0.35,
              width: isOwn ? '8px' : '2px',
              borderRadius: isOwn ? '50%' : '1px',
              height: isOwn ? '8px' : '14px',
            },
          }),
        )
      }
      return h(
        'div',
        {
          key: row.sha,
          className: 'dshgit-graphrow',
          'data-selected': selected,
          onClick: function () { props.onOpenCommit(row.sha) },
          title: row.sha,
        },
        [
          h('span', {
            key: 'lanes',
            className: 'dshgit-lanes',
            style: { width: (row.laneCount * laneWidth + 6) + 'px' },
          }, lanes),
          row.parents.length > 1 ? h('span', { key: 'merge', className: 'dshgit-badge' }, 'M') : null,
          h('span', { key: 'sha', className: 'dshgit-muted', style: { fontFamily: 'ui-monospace, monospace' } }, row.shortSha),
          h('span', { key: 's', className: 'dshgit-subject' }, row.subject),
          row.tips.length > 0
            ? h('span', { key: 'tips', className: 'dshgit-badge' }, row.tips.slice(0, 3).join(', '))
            : null,
        ],
      )
    })),
  ])
}

export { GraphView, WorkbenchBranchSidebar, WorkbenchGraph, WorkbenchPatchPreview, WorkbenchRecovery }

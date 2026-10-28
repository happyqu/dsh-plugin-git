import { React, h } from '../../core/runtime.js'
import { IconChangeAction, IconChevron } from '../../ui/icons.js'
import { isStaged, isUnstaged, statusLetter } from '../../core/files.js'
import { CopyFilePathsButton } from '../../ui/notifications.js'
import { changelistHasFile } from './model.js'
import { FileContextMenu } from '../../ui/controls.js'

/** The same hover toolbar in the compact and full change lists. */
function ChangeRowActions(props) {
  var t = props.t
  var staged = props.section === 'staged'
  var button = function (key, label, kind, run) {
    return h('button', {
      key: key, type: 'button', className: 'dshgit-change-action',
      'data-file-action': key, title: label, 'aria-label': label,
      disabled: key !== 'open' && props.busy === true,
      onClick: function (event) { event.stopPropagation(); run() },
    }, h(IconChangeAction, { kind: kind }))
  }
  return h('span', { className: 'dshgit-change-actions' }, [
    staged || props.simple ? null : button('discard', t('action.discard'), 'discard', props.onDiscard),
    button(staged ? 'unstage' : 'stage',
      t(staged ? 'action.unstage' : 'action.stage'),
      staged ? 'unstage' : 'stage', props.onToggleStage),
  ])
}


function changelistFileActions(props, file, open) {
  if (!props.onWrite || file.kind === 'unmerged') return null
  var staged = isStaged(file) && !isUnstaged(file)
  return h(ChangeRowActions, { key: 'actions', t: props.t, busy: props.busy,
    section: staged ? 'staged' : 'unstaged', onOpen: open,
    onToggleStage: function () { props.onWrite(staged ? 'unstage' : 'stage', { paths: [file.path] }, { after: props.afterWrite }) },
    onDiscard: function () {
      var text = props.t('confirm.discard', { path: file.path })
      if (file.kind === 'untracked') text += props.t('confirm.discardUntrackedSuffix')
      props.requestConfirm(text, function () {
        props.onWrite('discardPath', { path: file.path, untracked: file.kind === 'untracked' }, { confirm: true, after: props.afterWrite, onError: props.afterWrite })
      }, props.t('action.discard'))
    },
  })
}


function batchTargets(files, action) {
  return files.filter(function (file) { return file.kind !== 'unmerged' && file.kind !== 'ignored' && (action === 'stash' ? isStaged(file) || isUnstaged(file) : action === 'unstage' ? isStaged(file) : isUnstaged(file)) })
}


function WorkingFileStatus(props) {
  var state = isStaged(props.file) ? isUnstaged(props.file) ? 'partial' : 'staged' : 'unstaged'
  var label = props.t('batch.' + state)
  return h('span', { className: 'dshgit-status', 'data-staging': state, 'data-status': statusLetter(props.file),
    title: statusLetter(props.file) + ' · ' + label }, statusLetter(props.file))
}


/**
 * The 全部/未暂存/已暂存 filter shared by every change list.
 *
 * The default is ALL, and that is load-bearing for the commit surface: the
 * staged rows ARE the commit scope, so starting on "unstaged" made a freshly
 * staged file vanish from the popover — no row to click for its diff, an
 * empty list, and a disabled Commit button over a scope that still existed
 * on disk. Narrowing stays one click away for anyone who wants it.
 */
function useFileFilter(files, t) {
  var state = React.useState('all')
  var groups = React.useMemo(function () {
    var staged = [], unstaged = []
    files.forEach(function (file) { if (isStaged(file)) staged.push(file); if (isUnstaged(file)) unstaged.push(file) })
    return { all: files, staged: staged, unstaged: unstaged }
  }, [files])
  var shown = groups[state[0]]
  return { files: shown, control: h('div', { key: 'filefilter', className: 'dshgit-file-filters' }, ['all', 'unstaged', 'staged'].map(function (mode) {
    var count = groups[mode].length
    return h('button', { key: mode, type: 'button', className: 'dshgit-btn', 'aria-pressed': state[0] === mode, onClick: function () { state[1](mode) } }, t('batch.' + mode) + ' ' + count)
  }).concat(h(CopyFilePathsButton, { key: 'copy-paths', files: shown, t: t }))) }
}


function runFileBatch(props, files, action) {
  var targets = batchTargets(files, action)
  if (props.busy || !targets.length) return
  var paths = Array.from(new Set(targets.map(function (file) { return file.path })))
  var write = function () { return props.onWrite(action === 'discard' ? 'discardPaths' : action === 'stash' ? 'stashPush' : action,
    Object.assign({ paths: paths }, action === 'discard' ? { untrackedPaths: targets.filter(function (file) { return file.kind === 'untracked' }).map(function (file) { return file.path }) } : {}, action === 'stash' ? { includeUntracked: targets.some(function (file) { return file.kind === 'untracked' }) } : {}),
    { confirm: action === 'discard', after: props.afterWrite, onError: props.afterWrite }) }
  if (action !== 'discard') return write()
  var untracked = targets.filter(function (file) { return file.kind === 'untracked' }).length
  var message = props.t('batch.confirm', { count: paths.length }) + '\n\n' + paths.slice(0, 20).join('\n')
  if (paths.length > 20) message += '\n' + props.t('batch.more', { count: paths.length - 20 })
  if (untracked) message += '\n\n' + props.t('batch.untracked', { count: untracked })
  props.requestConfirm(message, write, props.t('action.discard'))
}


function FileBatchActions(props) {
  return h('span', { className: 'dshgit-change-actions' }, ['stash', 'discard', 'stage', 'unstage'].map(function (action) {
    var count = batchTargets(props.files, action).length
    if (!count) return null
    var label = (props.filtered ? props.t('batch.matched', { count: count }) + ' · ' : '') + props.t('batch.' + action, { count: count })
    return h('button', { key: action, type: 'button', className: 'dshgit-change-action', 'data-file-action': action,
      title: label, 'aria-label': label, disabled: props.busy || (action === 'stash' && (!!props.status?.operation || props.status?.files?.some(function (file) { return file.kind === 'unmerged' }))),
      onClick: function (event) { event.stopPropagation(); runFileBatch(props, props.files, action) },
    }, h(IconChangeAction, { kind: action }))
  }))
}


/** One action selection, independent of the commit checkboxes. */
function groupBatchActions(batch, props, files, staged) {
  var action = staged ? 'unstage' : 'stage', count = batchTargets(files, action).length
  return [
    batchTargets(files, 'stash').length ? { key: 'stash', icon: 'stash', label: props.t('batch.stash', { count: batchTargets(files, 'stash').length }), run: function () { runFileBatch(props, files, 'stash') } } : null,
    count ? { key: action, icon: action, label: props.t('batch.' + action, { count: count }), run: function () { runFileBatch(props, files, action) } } : null,
    batchTargets(files, 'discard').length ? { key: 'discard', icon: 'discard', label: props.t('batch.discard', { count: batchTargets(files, 'discard').length }), run: function () { runFileBatch(props, files, 'discard') } } : null,
    { key: 'more', text: true, label: '···', run: function (event) { batch.folderMenu(event, files) } },
  ].filter(Boolean)
}


function useFileBatch(props, files, query, extraMatch) {
  props = Object.assign({}, props, { filtered: !!query })
  var focusedPath = props.selectedPath || (props.selection?.kind === 'file' ? props.selection.path : null)
  var selected = React.useState(focusedPath ? [focusedPath] : []), anchor = React.useRef(focusedPath), lists = React.useRef(new Map()), menu = React.useState(null)
  var collapsed = React.useState({}), scrolls = React.useRef(new Map())
  var dropTarget = React.useState(null), dragHover = React.useRef({ id: null, timer: null })
  React.useEffect(function () { return function () { clearTimeout(dragHover.current.timer) } }, [])
  var draggable = props.changelists?.mode === 'lists' && !props.busy && !props.changelists.loading && !props.changelists.pending
  var available = files.filter(function (file) { return !query || file.path.toLowerCase().includes(query) || extraMatch?.(file) })
  var availablePaths = new Set(available.map(function (file) { return file.path }))
  var paths = selected[0].filter(function (path) { return availablePaths.has(path) })
  var chosenPaths = new Set(paths)
  var chosen = available.filter(function (file) { return chosenPaths.has(file.path) })
  React.useEffect(function () { if (focusedPath) { selected[1]([focusedPath]); anchor.current = focusedPath } }, [focusedPath])
  React.useEffect(function () { selected[1](function (old) { return old.length === paths.length ? old : paths }) }, [files, query])
  var clear = function () { selected[1]([]); anchor.current = null }
  var pick = function (file, event, open) {
    // A write in flight must not START a new batch action, and every verb that
    // consumes this selection gates on `busy` at its own call site
    // (`runFileBatch`, `itemsFor`, the drag handlers). Bailing out HERE instead
    // also killed the read-only half of the row: while a commit was running the
    // list looked normal but every row was dead, with no error and no hint — so
    // the one thing you want mid-commit, reading the diff you are about to land,
    // was impossible. Selection is local view state; opening a file is a read.
    // Only plain clicks reach the modifiers below, but the row is also activated
    // programmatically (a synthetic click, a test, an assistive tool), where there
    // is no event object at all. Reading `event.shiftKey` unguarded turned those
    // into a TypeError, so treat a missing event as "no modifier held".
    var modifier = event || {}
    if (modifier.shiftKey && anchor.current) {
      var order = Array.from(new Set(Array.from(lists.current.values()).flat()))
      var from = order.indexOf(anchor.current), to = order.indexOf(file.path)
      selected[1](from >= 0 && to >= 0 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : [file.path])
    } else if (modifier.ctrlKey || modifier.metaKey) selected[1](paths.includes(file.path) ? paths.filter(function (path) { return path !== file.path }) : paths.concat(file.path))
    else { selected[1]([file.path]); open?.() }
    if (!modifier.shiftKey) anchor.current = file.path
  }
  var itemsFor = function (targets, options) {
    var items = ['stage', 'unstage', 'stash', 'discard'].filter(function (action) { return batchTargets(targets, action).length }).map(function (action) {
        var count = batchTargets(targets, action).length
        return { id: action, label: props.t('batch.' + action, { count: count }), command: action === 'stage' ? 'add' : action === 'unstage' ? 'reset' : action === 'stash' ? 'stash push' : 'restore / clean',
          disabled: props.busy || !count || (action === 'stash' && (!!props.status?.operation || props.status?.files?.some(function (file) { return file.kind === 'unmerged' }))), danger: action === 'discard', run: function () { runFileBatch(props, targets, action) } }
      })
    if (props.onCreateList) {
      if (items.length) items.push({ separator: true })
      items.push({ id: 'new-list', label: props.t('cl.create'), disabled: props.busy || props.changelists?.loading || props.changelists?.pending,
        run: function () { props.onCreateList(options?.createEmpty ? [] : targets.filter(function (file) { return file.kind !== 'unmerged' }).map(function (file) { return file.path })) } })
    }
    return items
  }
  var showMenu = function (event, items) {
    event.preventDefault(); event.stopPropagation()
    menu[1](items.length ? { x: event.clientX || event.currentTarget.getBoundingClientRect().left, y: event.clientY || event.currentTarget.getBoundingClientRect().bottom, items: items } : null)
  }
  var show = function (event, targets, options) { showMenu(event, itemsFor(targets, options)) }
  return { paths: paths, lists: lists.current, collapsed: collapsed, scrolls: scrolls.current, pick: pick, clear: clear,
    draggable: draggable,
    drag: function (event, file, from) {
      var targets = paths.includes(file.path) ? chosen : [file]
      targets = targets.filter(function (entry) { return entry.kind !== 'unmerged' })
      if (!draggable || !targets.length) { event.preventDefault(); return }
      if (!paths.includes(file.path)) { selected[1]([file.path]); anchor.current = file.path }
      var data = props.changelists.data
      var sameList = data?.lists.some(function (list) { return list.id === from }) && targets.every(function (entry) { return changelistHasFile(data, from, entry.path) })
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('application/x-dshgit-paths', JSON.stringify({ root: props.repo?.root, paths: targets.map(function (entry) { return entry.path }), from: sameList ? from : undefined }))
    },
    endDrag: function () { clearTimeout(dragHover.current.timer); dragHover.current.id = null; dropTarget[1](null) },
    drop: function (id, open, expand) {
      var accepts = function (event) { return draggable && props.changelists.data?.lists.some(function (list) { return list.id === id }) && Array.from(event.dataTransfer?.types || []).includes('application/x-dshgit-paths') }
      var reset = function () { clearTimeout(dragHover.current.timer); dragHover.current.id = null; dropTarget[1](null) }
      return {
        'data-drop-target': dropTarget[0] === id,
        onDragOver: function (event) {
          if (!accepts(event)) return
          event.preventDefault(); event.dataTransfer.dropEffect = 'move'
          if (dragHover.current.id !== id) {
            clearTimeout(dragHover.current.timer); dragHover.current.id = id; dropTarget[1](id)
            if (!open) dragHover.current.timer = setTimeout(function () { expand() }, 500)
          }
        },
        onDragLeave: function (event) { if (!event.currentTarget.contains(event.relatedTarget)) reset() },
        onDrop: function (event) {
          if (!accepts(event)) return
          event.preventDefault(); event.stopPropagation(); reset()
          try {
            var transfer = JSON.parse(event.dataTransfer.getData('application/x-dshgit-paths'))
            if (transfer.root !== props.repo?.root || !Array.isArray(transfer.paths)) return
            var valid = new Set(files.filter(function (file) { return file.kind !== 'unmerged' }).map(function (file) { return file.path }))
            var moved = Array.from(new Set(transfer.paths)).filter(function (path) { return valid.has(path) })
            if (moved.length && transfer.from !== id) props.changelists.mutate({ action: 'move', id: id, paths: moved, from: transfer.from }).catch(function () {})
          } catch (error) {}
        },
      }
    },
    context: function (event, file, fallback) {
      var targets = paths.includes(file.path) ? chosen : [file]
      if (!paths.includes(file.path)) { selected[1]([file.path]); anchor.current = file.path }
      if (targets.length > 1 || !fallback) show(event, targets); else fallback(event, file)
    }, folderMenu: show, menuItems: itemsFor, showMenu: showMenu,
    actions: function (targets) { return h(FileBatchActions, Object.assign({}, props, { key: 'actions', files: targets })) },
    status: function (file) { return h(WorkingFileStatus, { key: 'status', file: file, t: props.t }) },
    keydown: function (event) {
      if (event.key === 'Escape' && paths.length) { event.preventDefault(); event.stopPropagation(); clear() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !event.target.closest?.('input,textarea,[contenteditable="true"]')) {
        event.preventDefault(); event.stopPropagation()
        selected[1](available.filter(function (file) { return file.kind !== 'unmerged' }).map(function (file) { return file.path }))
      }
    },
    blank: function (event) {
      if (!event.defaultPrevented && !event.target.closest?.('.dshgit-change,.dshgit-cl-head,.dshgit-changegroupbar,input,textarea,button,a,[role="menu"]')) clear()
    },
    overlay: h(FileContextMenu, { key: 'batchmenu', menu: menu[0], onClose: function () { menu[1](null) } }),
  }
}


/** VS Code style SCM group header shared by the compact and full lists. */
function ChangeGroup(props) {
  var state = React.useState(true)
  var open = state[0]
  var setOpen = state[1]
  return h('div', { className: 'dshgit-changegroup', 'data-change-group': props.kind }, [
    h('div', { key: 'bar', className: 'dshgit-changegroupbar' }, [
      h('button', { key: 'head', type: 'button', className: 'dshgit-changegrouphead',
        'aria-expanded': open, onClick: function () { setOpen(!open) },
      }, [
        h('span', { key: 'caret', className: 'dshgit-caret' }, h(IconChevron, { open: open, size: 13 })),
        h('span', { key: 'title' }, props.title),
      ]),
      h('span', { key: 'actions', className: 'dshgit-changegroupactions' + (props.simple ? ' dshgit-group-primary' : '') }, props.actions.map(function (action) {
        return h('button', { key: action.key, type: 'button', className: 'dshgit-iconbtn',
          'data-group-action': action.key, title: action.label, 'aria-label': action.key === 'more' ? props.t('menu.actions') : action.label,
          'aria-haspopup': action.key === 'more' ? 'menu' : undefined,
          disabled: props.busy === true && action.key !== 'view',
          onClick: action.run,
        }, action.text ? action.label : h(IconChangeAction, { kind: action.icon }))
      })),
      h('span', { key: 'count', className: 'dshgit-sectioncount' }, String(props.count)),
    ]),
    open ? h('div', { key: 'body', className: 'dshgit-changegroupbody' }, props.children) : null,
  ])
}


/** Ask before a destructive discard, showing exactly which path. */
function setDiscardTarget(file, props) {
  // The message names the path and the untracked case, because "discard
  // changes?" with no filename is how people lose work — and undoing an
  // untracked file is impossible, unlike a tracked one restored from git.
  var message = props.t('confirm.discard', { path: file.path })
  if (file.kind === 'untracked') message += props.t('confirm.discardUntrackedSuffix')
  props.requestConfirm(message, function () {
    props.onWrite('discardPath', { path: file.path, untracked: file.kind === 'untracked' }, {
      after: props.afterWrite,
      onError: props.afterWrite,
      confirm: true,
    })
  })
}

export { ChangeGroup, ChangeRowActions, FileBatchActions, changelistFileActions, groupBatchActions, setDiscardTarget, useFileBatch, useFileFilter }

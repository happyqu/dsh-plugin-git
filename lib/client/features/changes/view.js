import { changelistListMenu, moveWholeFilesMenu } from './list-menu.js'
import { useChangelistOrder } from './list-order.js'
import { React, h } from '../../core/runtime.js'
import { baseName, isPartial, isStaged, isUnstaged, statusLetter } from '../../core/files.js'
import { ChangeGroup, ChangeRowActions, FileBatchActions, changelistFileActions, groupBatchActions, useFileBatch, useFileFilter } from './actions.js'
import { IconChevron, IconFileList, IconFileTree, IconFolder, IconPlus } from '../../ui/icons.js'
import { changeFileLabel } from '../../ui/file-icons.js'
import { changelistHasFile, changelistSelection } from './model.js'
import { FileDiffCard } from '../../ui/file-diff.js'
import { PreviewModeControls, PreviewRefreshButton } from '../../preview/controls.js'
import { DiffBody, FilePreview } from '../../preview/code.js'
import { ComboBox } from '../../ui/controls.js'
import { NestedRepositories } from './nested-repositories.js'

function ChangelistCheckbox(props) {
  var input = React.useRef(null)
  React.useEffect(function () { if (input.current) input.current.indeterminate = props.mixed === true }, [props.mixed])
  return h('input', { ref: input, type: 'checkbox', className: 'dshgit-cl-checkbox', checked: props.checked,
    disabled: props.disabled, 'aria-label': props.label,
    onClick: function (event) { event.stopPropagation() }, onChange: props.onChange })
}


function changelistFileTree(files) {
  var root = { children: new Map(), files: [], members: [], path: '' }
  files.forEach(function (file) {
    var segments = file.path.replace(/\/+$/, '').split('/'), node = root, path = ''
    segments.slice(0, -1).forEach(function (name) {
      path = path ? path + '/' + name : name
      if (!node.children.has(name)) node.children.set(name, { name: name, path: path, children: new Map(), files: [], members: [] })
      node = node.children.get(name); node.members.push(file)
    })
    node.files.push(file)
  })
  return root
}


/** Flatten only open directories, then virtualize folders and files together. */
function ChangelistFiles(props) {
  var savedScroll = props.batch?.scrolls.get(props.listId || 'files')
  var scroll = React.useState(savedScroll?.layout === props.layout && savedScroll?.filter === props.filterKey ? savedScroll.top : 0), height = 28
  var visibleRows = React.useState(16), windowSize = visibleRows[0]
  var localCollapsed = React.useState({}), collapsed = props.batch?.collapsed || localCollapsed
  var tree = React.useMemo(function () { return props.layout === 'flat' ? null : changelistFileTree(props.files) }, [props.files, props.layout])
  var rows = React.useMemo(function () {
    if (props.layout === 'flat') return props.files.slice().sort(function (a, b) { return a.path.localeCompare(b.path, undefined, { numeric: true }) }).map(function (file) { return { file: file, depth: 0 } })
    var result = []
    var walk = function (node, depth) {
      Array.from(node.children.values()).sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }) }).forEach(function (folder) {
        var name = folder.name
        // Compact a chain such as src/features/payments into one folder row.
        while (!folder.files.length && folder.children.size === 1) { folder = folder.children.values().next().value; name += '/' + folder.name }
        var open = !!props.filterKey || (Object.prototype.hasOwnProperty.call(collapsed[0], folder.path) ? !collapsed[0][folder.path] : props.files.length <= 200 || depth === 0)
        result.push({ folder: folder, name: name, depth: depth, open: open })
        if (open) walk(folder, depth + 1)
      })
      node.files.slice().sort(function (a, b) { return baseName(a.path).localeCompare(baseName(b.path), undefined, { numeric: true }) }).forEach(function (file) { result.push({ file: file, depth: depth }) })
    }
    walk(tree, 0); return result
  }, [tree, collapsed[0], props.filterKey, props.files, props.layout])
  var viewport = React.useRef(null)
  var batch = props.batch
  var listKey = props.listId || 'files'
  React.useLayoutEffect(function () {
    if (!batch) return
    batch.lists.set(listKey, rows.filter(function (row) { return row.file }).map(function (row) { return row.file.path }))
    return function () { batch.lists.delete(listKey) }
  }, [batch?.lists, listKey, rows])
  React.useLayoutEffect(function () {
    var node = viewport.current
    var owner = node.parentElement.closest('[data-file-scroll]')
    if (!owner) return
    var update = function () {
      var offset = Math.max(0, owner.getBoundingClientRect().top - node.getBoundingClientRect().top)
      scroll[1](Math.floor(offset / height) * height)
      visibleRows[1](Math.max(16, Math.ceil(owner.clientHeight / height) + 4))
    }
    update(); owner.addEventListener('scroll', update, { passive: true })
    var observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(owner); observer?.observe(node)
    return function () { owner.removeEventListener('scroll', update); observer?.disconnect() }
  }, [props.listId, props.filterKey, props.layout, rows])
  var checkedPaths = new Set(props.checked || []), mixedPaths = new Set(props.mixed || []), multiPaths = new Set(batch ? batch.paths : props.multi || [])
  var decorate = function (file, element) {
    var children = React.Children.toArray(element.props.children)
    if (props.layout !== 'flat') {
      children.unshift(h('span', { key: 'chevron-space', className: 'dshgit-tree-spacer', 'aria-hidden': true }))
    }
    if (!batch) return React.cloneElement(element, { children: children })
    return React.cloneElement(element, {
      style: Object.assign({}, element.props.style, { '--dshgit-status-width': '12px' }),
      'data-staging': isStaged(file) ? isUnstaged(file) ? 'partial' : 'staged' : 'unstaged',
      tabIndex: 0, 'data-selected': multiPaths.has(file.path), 'data-file-path': file.path, draggable: batch.draggable && file.kind !== 'unmerged',
      onDragStart: function (event) { batch.drag(event, file, listKey) }, onDragEnd: batch.endDrag,
      onClick: function (event) { batch.pick(file, event, function () { element.props.onClick?.(event) }) },
      onMouseDown: function (event) { if (event.shiftKey) event.preventDefault() },
      onKeyDown: function (event) { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); batch.pick(file, event, function () { element.props.onClick?.(event) }) } },
      onContextMenu: function (event) { batch.context(event, file, element.props.onContextMenu ? function () { element.props.onContextMenu(event) } : null) },
      children: children.map(function (child) {
        if (!React.isValidElement(child)) return child
        if (child.type === ChangeRowActions) return batch.actions([file])
        if (child.props.className === 'dshgit-status') return batch.status(file)
        return child
      }),
    })
  }
  var start = Math.max(0, Math.floor(scroll[0] / height) - 2)
  start = Math.min(start, Math.max(0, rows.length - windowSize))
  var end = Math.min(rows.length, start + windowSize)
  // Flat rows align with the group checkbox; tree rows reserve an arrow
  // column and retain their folder indentation.
  var indentBase = props.layout === 'flat' ? 15 : 6
  // A child checkbox starts at its parent's folder icon: 14px checkbox + 4px gap.
  var indentStep = 18
  return h('div', { ref: viewport, className: 'dshgit-cl-viewport', onScroll: function (event) {
    var offset = Math.floor(event.currentTarget.scrollTop / height) * height
    batch?.scrolls.set(listKey, { top: event.currentTarget.scrollTop, layout: props.layout, filter: props.filterKey })
    scroll[1](function (current) { return current === offset ? current : offset })
  } },
    h('div', { style: { height: rows.length * height + 'px', position: 'relative' } },
      h('div', { style: { position: 'absolute', top: start * height + 'px', left: 0, right: 0 } }, rows.slice(start, end).map(function (row) {
        var style = { height: height + 'px', minHeight: height + 'px', boxSizing: 'border-box', paddingLeft: indentBase + row.depth * indentStep + 'px' }
        if (row.folder) {
          var folder = row.folder, count = folder.members.filter(function (file) { return checkedPaths.has(file.path) }).length
          var mixed = folder.members.some(function (file) { return mixedPaths.has(file.path) }) || (count > 0 && count < folder.members.length)
          return h('div', { key: 'directory:' + folder.path, className: 'dshgit-cl-directory dshgit-change', style: style,
            'data-folder-path': folder.path, tabIndex: 0,
            onContextMenu: batch ? function (event) { batch.folderMenu(event, folder.members) } : undefined,
          }, [
            h('button', { key: 'arrow', type: 'button', className: 'dshgit-cl-folder-toggle', tabIndex: -1, 'aria-hidden': true,
              onClick: function () { collapsed[1](function (current) { return Object.assign({}, current, { [folder.path]: row.open }) }) },
            }, h(IconChevron, { size: 12, open: row.open })),
            props.onCheck ? h(ChangelistCheckbox, { key: 'check', label: folder.path, checked: count === folder.members.length, mixed: mixed, disabled: props.busy || props.commitBlocked || folder.members.every(function (file) { return file.kind === 'unmerged' }),
              onChange: function (event) { props.onCheck(folder.members.filter(function (file) { return file.kind !== 'unmerged' }).map(function (file) { return file.path }), event.currentTarget.checked) } }) : null,
            h('button', { key: 'folder', type: 'button', className: 'dshgit-cl-directory-name', title: folder.path, 'aria-expanded': row.open,
              onClick: function () { collapsed[1](function (current) { return Object.assign({}, current, { [folder.path]: row.open }) }) },
            }, [h(IconFolder, { key: 'icon', size: 17 }), h('span', { key: 'name' }, row.name)]),
            batch ? batch.actions(folder.members) : null,
            h('span', { key: 'count', className: 'dshgit-cl-count' }, folder.members.length),
          ])
        }
        var file = row.file
        if (props.renderFile) return decorate(file, props.renderFile(file, style))
        return decorate(file, h('div', { key: 'file:' + file.path, className: 'dshgit-row dshgit-change', style: style,
          'data-selected': multiPaths.has(file.path) || props.selection?.path === file.path, tabIndex: 0,
          onClick: function (event) { props.onSelect(file, event, rows.filter(function (entry) { return entry.file }).map(function (entry) { return entry.file.path })) },
          onKeyDown: function (event) { if (event.target === event.currentTarget && event.key === 'Enter') props.onOpenFile(file) },
          onContextMenu: function (event) { props.onMenu(event, file) }, title: file.path,
        }, [h(ChangelistCheckbox, { key: 'check', label: file.path, checked: checkedPaths.has(file.path), mixed: mixedPaths.has(file.path), disabled: props.busy || props.commitBlocked || file.kind === 'unmerged',
          onChange: function (event) { props.onCheck([file.path], event.currentTarget.checked) } })].concat(changeFileLabel(props.layout === 'flat' ? file.path : baseName(file.path), file.lfs), [
          batch ? batch.actions([file]) : props.renderActions ? props.renderActions(file) : null,
          h('span', { key: 'status', className: 'dshgit-status' }, statusLetter(file)),
        ])))
      }))))
}


function ChangelistLayoutSwitch(props) {
  var model = props.changelists, layout = model.data?.fileLayout || 'tree'
  return h('div', { className: 'dshgit-cl-layout', role: 'group', 'aria-label': props.t('batch.view') }, ['tree', 'flat'].map(function (value) {
    return h('button', { key: value, type: 'button', className: 'dshgit-iconbtn', title: props.t('cl.' + value), 'aria-label': props.t('cl.' + value), 'aria-pressed': layout === value,
      disabled: props.busy || model.loading, onClick: function () { if (layout !== value) model.mutate({ action: 'layout', layout: value }).catch(function () {}) },
    }, h(value === 'tree' ? IconFileTree : IconFileList, { size: 16 }))
  }))
}


function ChangelistModeToolbar(props) {
  var model = props.changelists, t = props.t
  return h('div', { className: 'dshgit-cl-toolbar dshgit-cl-modebar' }, [
    h('button', { key: 'mode', type: 'button', className: 'dshgit-cl-mode', title: t('cl.switchMode') + ' · ' + t(model.mode === 'lists' ? 'cl.title' : 'cl.staging'),
      'aria-label': t('cl.switchMode'), 'aria-haspopup': 'menu', disabled: props.busy || model.loading,
      onClick: function (event) { props.showMenu(event, ['lists', 'staging'].map(function (mode) { return {
        id: mode, label: t(mode === 'lists' ? 'cl.title' : 'cl.staging'), disabled: model.mode === mode,
        run: function () { model.mutate({ action: 'mode', mode: mode }).catch(function () {}) },
      } })) },
    }, [h('span', { key: 'label' }, props.label || t(model.mode === 'lists' ? 'cl.title' : 'cl.staging')), h(IconChevron, { key: 'arrow', open: true, size: 16 })]),
    props.onCreate ? h('button', { key: 'new', type: 'button', className: 'dshgit-iconbtn', disabled: props.busy,
      title: t('cl.create'), 'aria-label': t('cl.create'), onClick: props.onCreate }, h(IconPlus, { size: 16 })) : null,
  ])
}


function ChangelistPane(props) {
  var model = props.changelists, data = model.data, t = props.t
  var search = React.useState('')
  var folded = React.useState({})
  var busy = props.busy
  var act = function (operation) { model.mutate(operation).catch(function () {}) }
  var files = props.status?.files || [], query = search[0].trim().toLowerCase()
  var fileFilter = useFileFilter(files, t)
  files = fileFilter.files
  var batch = useFileBatch(props, files, query, function (file) { return data?.lists.some(function (list) { return list.name.toLowerCase().includes(query) && changelistHasFile(data, list.id, file.path) }) })
  var order = useChangelistOrder(props)
  if (!data) return h('div', { className: 'dshgit-empty' }, model.error ? [model.error, h('button', { key: 'retry', className: 'dshgit-btn', onClick: model.retry }, t('action.retryRead'))] : t('state.loading'))
  var create = function (paths, from) { props.prompt({ title: t('cl.create'), compact: true, fields: [
    { key: 'name', label: t('cl.name'), value: '' }, { key: 'makeActive', label: t('cl.active'), type: 'checkbox', value: false },
  ], submit: t('action.ok'), onSubmit: function (values) { return model.mutate({ action: 'create', name: values.name, makeActive: values.makeActive, paths: paths, from: from }) } }) }
  var targetPrompt = function (paths, from) {
    var targets = data.lists.filter(function (list) { return list.id !== from })
    if (!targets.length) return
    props.prompt({ title: t('cl.move'), fields: [
    { key: 'id', type: 'select', label: t('cl.target'), value: targets.some(function (list) { return list.id === data.active }) ? data.active : targets[0].id,
      options: targets.map(function (list) { return { value: list.id, label: list.id === 'default' && list.name === '默认' ? t('cl.default') : list.name } }) },
  ], submit: t('action.ok'), onSubmit: function (values) { return model.mutate({ action: 'move', id: values.id, paths: paths, from: from }) } }) }
  var fileMenu = function (event, file, from) {
    var paths = batch.paths.includes(file.path) ? batch.paths : [file.path]
    props.fileMenu(event, file, [
      moveWholeFilesMenu(props, paths.filter(function (path) { return files.some(function (entry) { return entry.path === path && entry.kind !== 'unmerged' }) }), from),
      { id: 'move', label: t('cl.move'), disabled: busy || !data.lists.some(function (list) { return list.id !== from }), run: function () { targetPrompt(paths, from) } },
      { id: 'new-list', label: t('cl.create'), disabled: busy, run: function () { create(paths, from) } },
      { id: 'include', label: t(model.paths.includes(file.path) ? 'cl.exclude' : 'cl.select'), disabled: busy || file.kind === 'unmerged' || data.lists.some(function (list) { return list.id === from && list.commitBlocked === true }),
        run: function () { act({ action: 'select', paths: paths, checked: !model.paths.includes(file.path) }) } },
    ])
  }
  var group = function (list, entries, special) {
    var matched = entries.filter(function (file) { return !query || file.path.toLowerCase().includes(query) })
    if (query && !matched.length && special) return null
    var choice = changelistSelection(data, list.id, matched), checked = choice.checked.length
    var open = !!query || (special ? !folded[0][list.id] : list.expanded !== false)
    var toggle = function () { if (special) folded[1](function (current) { return Object.assign({}, current, { [list.id]: open }) }); else act({ action: 'expand', id: list.id, expanded: !open }) }
    var label = special ? t(special) : list.id === 'default' && list.name === '默认' ? t('cl.default') : list.name
    var menu = function (event) {
      var items = changelistListMenu(Object.assign({}, props, { onCreateList: function () { create() } }), list, entries)
      var fileItems = batch.menuItems(matched)
      props.showMenu(event, fileItems.length ? fileItems.concat([{ separator: true }], items) : items)
    }
    return h('div', { key: list.id, className: 'dshgit-cl-group', 'data-commit-blocked': list.commitBlocked === true }, [
      h('div', Object.assign({ key: 'head', className: 'dshgit-cl-head', 'data-active': data.active === list.id, 'data-changelist-id': list.id,
        onContextMenu: !special ? menu : undefined,
      }, special ? {} : order.header(list.id, batch.drop(list.id, open, toggle))), [
        h('button', { key: 'fold', type: 'button', className: 'dshgit-iconbtn', 'aria-label': label, 'aria-expanded': !!open,
          onClick: toggle, disabled: busy }, h(IconChevron, { open: !!open, size: 12 })),
        special === 'cl.conflicts' ? null : h(ChangelistCheckbox, { key: 'check', label: label, checked: !!matched.length && checked === matched.length, mixed: choice.mixed.length > 0 || (checked > 0 && checked < matched.length), disabled: busy || list.commitBlocked === true || !matched.length,
          onChange: function (event) { act({ action: 'select', id: special ? undefined : list.id, paths: matched.map(function (file) { return file.path }), checked: event.currentTarget.checked }) } }),
        h('button', Object.assign({ key: 'name', type: 'button', className: 'dshgit-name dshgit-cl-toggle', title: list.description || label, 'aria-expanded': !!open, disabled: busy, onClick: toggle }, special ? {} : order.handle(list.id)), [h('span', { key: 'title', className: 'dshgit-cl-title' }, label), data.active === list.id ? h('span', { key: 'active', className: 'dshgit-cl-active', title: t('cl.activeHint'), 'aria-label': t('cl.activeHint') }, '●') : null]),
        h(FileBatchActions, Object.assign({}, props, { key: 'batch', files: matched })),
        h('span', { key: 'count', className: 'dshgit-cl-count' }, query ? matched.length + '/' + entries.length : entries.length),
      ]),
      open ? h(ChangelistFiles, { key: 'files', listId: list.id, batch: batch, layout: data.fileLayout || 'tree', filterKey: query, files: matched, busy: busy, commitBlocked: list.commitBlocked === true, checked: choice.checked, mixed: choice.mixed, selection: props.selection,
        renderActions: function (file) { return changelistFileActions(props, file, function () { props.onOpenFile(file, undefined, 'working') }) },
        onMenu: function (event, file) { fileMenu(event, file, special ? undefined : list.id) }, onCheck: function (paths, checked) { act({ action: 'select', id: special ? undefined : list.id, paths: paths, checked: checked }) },
        onOpenFile: function (file) { props.onOpenFile(file, undefined, 'working') },
        onSelect: function (file) { props.onOpenFile(file, undefined, 'working') },
      }) : null,
    ])
  }
  return h('div', { className: 'dshgit-cl-pane', onKeyDown: batch.keydown, onClick: batch.blank, onContextMenu: function (event) {
    if (event.defaultPrevented || event.target?.closest?.('.dshgit-cl-head,.dshgit-row,input,button,select,.dshgit-cl-error')) return
    props.showMenu(event, [{ id: 'new-list', label: t('cl.create'), disabled: busy, run: function () { create() } }], { compact: true })
  } }, [
    h(NestedRepositories, Object.assign({}, props, { key: 'nested-repositories' })),
    props.hideToolbar ? null : h(ChangelistModeToolbar, { key: 'tools', changelists: model, t: t, busy: busy, showMenu: props.showMenu, onCreate: function () { create() } }),
    model.error ? h('div', { key: 'error', className: 'dshgit-cl-error', role: 'alert' }, [model.error, h('button', { key: 'retry', className: 'dshgit-btn', onClick: model.retry }, t('action.retryRead'))]) : null,
    h('div', { key: 'filetools', className: 'dshgit-file-list-tools' }, [
    h('div', { key: 'search', className: 'dshgit-cl-search' }, [h('input', { key: 'input', type: 'search', className: 'dshgit-input', value: search[0], placeholder: t('cl.search'), 'aria-label': t('cl.search'), onChange: function (event) { search[1](event.currentTarget.value) } }), h(ChangelistLayoutSwitch, { key: 'layout', changelists: model, t: t, busy: busy })]), fileFilter.control]),
    batch.overlay,

    files.some(function (file) { return file.kind === 'unmerged' }) ? group({ id: 'conflicts', expanded: true }, files.filter(function (file) { return file.kind === 'unmerged' }), 'cl.conflicts') : null,
    data.lists.map(function (list) { return group(list, files.filter(function (file) { return file.kind !== 'unmerged' && changelistHasFile(data, list.id, file.path) })) }),
    files.some(function (file) { return !data.assignments[file.path] && file.kind !== 'unmerged' }) ? group({ id: 'untracked', expanded: true }, files.filter(function (file) { return !data.assignments[file.path] && file.kind !== 'unmerged' }), 'cl.untracked') : null,
    query && !files.some(function (file) { return file.path.toLowerCase().includes(query) }) ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('list.noMatches')) : null,
  ])
}


/* ------------------------------------------------------------------ *
 * Changes sidebar: staged and unstaged files
 * ------------------------------------------------------------------ */

/** Render the current working tree and its file actions. */
function LeftPane(props) {
  var t = props.t
  var searchState = React.useState('')
  var query = searchState[0].trim().toLowerCase()
  var layout = props.changelists?.data?.fileLayout || 'tree'
  var files = props.status === null ? [] : props.status.files || []
  var fileFilter = useFileFilter(files, t)
  files = fileFilter.files
  var batch = useFileBatch(props, files, query)
  var staged = files.filter(isStaged)
  var unstaged = files.filter(isUnstaged)
  var fileRow = function (file, section, style) {
    var selected = props.selection !== null && props.selection.kind === 'file' &&
      props.selection.path === file.path && props.selection.section === section
    var open = function () { props.onOpenFile(file, undefined, section) }
    return h('div', {
      key: section + ':' + file.path,
      className: 'dshgit-row dshgit-change' + (isPartial(file) ? ' dshgit-partial' : ''),
      style: style,
      'data-selected': selected, 'data-status': statusLetter(file),
      tabIndex: 0, role: 'button', 'aria-pressed': selected,
      onClick: open,
      onKeyDown: function (event) {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() }
      },
      onContextMenu: function (event) { props.onFileContextMenu(event, file, section) },
      title: file.originalPath ? file.originalPath + ' → ' + file.path : file.path,
    }, changeFileLabel(layout === 'flat' ? file.path : baseName(file.path), file.lfs).concat([
      file.kind !== 'unmerged' ? h(ChangeRowActions, {
        key: 'actions', t: t, section: section, busy: props.busy, simple: true,
        onToggleStage: function () {
          props.onWrite(section === 'staged' ? 'unstage' : 'stage',
            { paths: [file.path] }, { after: props.afterWrite })
        },
      }) : null,
      h('span', { key: 'status', className: 'dshgit-status' }, statusLetter(file)),
    ]))
  }
  var group = function (section, entries) {
    if (entries.length === 0) return null
    var isIndex = section === 'staged'
    var matched = entries.filter(function (file) { return !query || file.path.toLowerCase().indexOf(query) !== -1 })
    if (matched.length === 0) return null
    return h(ChangeGroup, {
      key: section, kind: section, title: t(isIndex ? 'commit.stagedSection' : 'commit.unstagedSection'),
      count: query ? matched.length + '/' + entries.length : entries.length, busy: props.busy, simple: true, t: t,
      actions: groupBatchActions(batch, props, matched, isIndex),
    }, h(ChangelistFiles, { files: matched, listId: section, batch: batch, layout: layout, filterKey: query, busy: props.busy,
      renderFile: function (file, style) { return fileRow(file, section, style) },
    }))
  }
  return h('div', { className: 'dshgit-changes-list', onKeyDown: batch.keydown, onClick: batch.blank }, [batch.overlay,
    h(NestedRepositories, Object.assign({}, props, { key: 'nested-repositories' })),
    props.changelists && !props.hideToolbar ? h(ChangelistModeToolbar, { key: 'lists-mode', changelists: props.changelists, t: t, busy: props.busy, showMenu: props.showMenu }) : null,
  ].concat(files.length === 0
    ? [h('div', { className: 'dshgit-empty' }, t(props.status === null ? 'state.loading' : 'state.noChanges'))]
    : [h('div', { key: 'filetools', className: 'dshgit-file-list-tools' }, [h('div', { key: 'search', className: 'dshgit-cl-search' }, [h('input', { key: 'input', type: 'search', className: 'dshgit-input',
      placeholder: t('list.searchFiles'), 'aria-label': t('list.searchFiles'), value: searchState[0],
      onChange: function (event) { searchState[1](event.currentTarget.value) },
    }), props.changelists ? h(ChangelistLayoutSwitch, { key: 'layout', changelists: props.changelists, t: t, busy: props.busy }) : null]), fileFilter.control]), group('unstaged', unstaged), group('staged', staged),
      query && !files.some(function (file) { return file.path.toLowerCase().indexOf(query) !== -1 })
        ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('list.noMatches')) : null]))
}


/* ------------------------------------------------------------------ *
 * Center pane: diff, history, graph, compare
 * ------------------------------------------------------------------ */

/** Render the main content area for the active tab. */
function ChangelistDiffPanel(props) {
  var model = props.changelists, t = props.t, file = props.selection.file
  var patch = props.diff?.files?.find(function (entry) { return entry.path === file.path })
  var renderedRecord = React.useRef(null)
  if (renderedRecord.current?.diff !== props.diff || !props.previewStale) renderedRecord.current = { diff: props.diff, record: model.data?.chunks?.[file.path] }
  var record = renderedRecord.current.record, parts = record?.parts || []
  var act = function (operation) { model.mutate(Object.assign({ path: file.path }, operation)).catch(function () {}) }
  if (!props.diff && props.fileDisplay !== 'content') return h('div', { className: 'dshgit-empty' }, t('state.loading'))
  // The toolbar is passed as `tools`, not as a child, so it renders outside
  // the scrolling body: the head, the mode controls and the overview rail
  // stay put while the patch or file content moves under them.
  return h(FileDiffCard, { file: Object.assign({}, file, patch || {}), t: t, onFileMenu: props.onFileMenu, fill: true, tools: h('div', { key: 'tools', className: 'dshgit-cl-toolbar' }, [
    h(PreviewRefreshButton, { key: 'refresh', stale: props.previewStale, onRefresh: props.onPreviewRefresh, busy: props.busy, t: t }),
    h('button', { key: 'split', className: 'dshgit-rowbtn', disabled: props.fileDisplay === 'content' || props.previewStale || props.busy || model.pending || model.loading || file.binary || file.kind === 'untracked' || file.kind === 'unmerged' || !!file.originalPath,
      onClick: function () { act(record ? { action: 'move', id: model.data.assignments[file.path] || model.data.active, paths: [file.path] } : { action: 'split' }) } }, t(record ? 'cl.whole' : 'cl.split')),
    parts.some(function (part) { return !part.list }) || record?.invalid ? h('span', { key: 'review', className: 'dshgit-muted' }, t('cl.reassign')) : null,
    h('span', { key: 'controls', style: { marginLeft: 'auto' } }, h(PreviewModeControls, { t: t, content: props.fileDisplay === 'content', onToggle: function () {
      props.onOpenFile(file, props.fileDisplay === 'content' ? 'diff' : 'content', 'working')
    } })),
  ]) }, [
    model.error ? h('div', { key: 'error', className: 'dshgit-cl-error', role: 'alert' }, model.error) : null,
    props.fileDisplay === 'content' ? h(FilePreview, { key: 'content', blob: props.fileView, path: file.path, t: t }) : record && !record.invalid && parts.length === patch?.hunks?.length ? patch.hunks.map(function (hunk, index) {
      var part = parts[index]
      return h('div', { key: part.id }, [
        h('div', { key: 'bar', className: 'dshgit-cl-toolbar' }, [
          h(ChangelistCheckbox, { key: 'check', label: t('cl.chunk', { number: index + 1 }), checked: part.selected,
            disabled: props.previewStale || props.busy || model.pending || !part.list || model.data?.lists.some(function (list) { return list.id === part.list && list.commitBlocked === true }), onChange: function (event) { act({ action: 'selectChunk', chunk: part.id, checked: event.currentTarget.checked }) } }),
          h('span', { key: 'label', className: 'dshgit-muted' }, t('cl.chunk', { number: index + 1 })),
          h('div', { key: 'list', style: { width: '180px', marginLeft: 'auto', minWidth: 0 } }, h(ComboBox, {
            t: t, value: part.list || '', placeholder: t('cl.assign'), disabled: props.previewStale || props.busy || model.pending,
            options: model.data.lists.map(function (list) { return { value: list.id, label: list.name } }),
            onChange: function (id) { if (!props.busy && !model.pending) act({ action: 'moveChunk', chunk: part.id, id: id }) },
          })),
        ]), h(DiffBody, { t: t, key: 'diff', path: file.path, hunks: [hunk], emptyText: t('state.emptyDiff') }),
      ])
    }) : h(DiffBody, { t: t, key: 'diff', path: file.path, hunks: patch?.hunks || props.diff.hunks, emptyText: file.binary ? t('state.fileBinary') : t('state.emptyDiff') }),
  ])
}

export { ChangelistCheckbox, ChangelistDiffPanel, ChangelistFiles, ChangelistLayoutSwitch, ChangelistModeToolbar, ChangelistPane, LeftPane }

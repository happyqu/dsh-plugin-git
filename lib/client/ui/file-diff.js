import { Fragment, React, h } from '../core/runtime.js'
import { IconChevron, IconCopyPath, IconFileList, IconFileTree, IconFolder } from './icons.js'
import { DiffBody } from '../preview/code.js'
import { isImagePath, statusLetter } from '../core/files.js'
import { ImageDiffView } from '../preview/images.js'
import { fileListLayout, fileListLayoutListeners, setFileListLayout } from '../core/preferences.js'
import { changeFileLabel } from './file-icons.js'

function fileDiffStats(file) {
  if (typeof file.added === 'number' && typeof file.deleted === 'number') return { added: file.added, deleted: file.deleted }
  if (!Array.isArray(file.hunks)) return null
  if (file.hunks.some(function (hunk) { return hunk.wordDiff })) return null
  var added = 0, deleted = 0
  file.hunks.forEach(function (hunk) { (hunk.lines || []).forEach(function (line) {
    if (line.charAt(0) === '+') added++
    else if (line.charAt(0) === '-') deleted++
  }) })
  return { added: added, deleted: deleted }
}

function DiffStats(props) {
  var counts = fileDiffStats(props.file)
  return counts === null ? null : h('span', { className: 'dshgit-diffstats' }, [
    h('span', { key: 'added', className: 'dshgit-diff-added' }, '+' + counts.added),
    h('span', { key: 'deleted', className: 'dshgit-diff-deleted' }, '−' + counts.deleted),
  ])
}


/** File header with an adjacent copy icon and line counts. */
function FileDiffCard(props) {
  var copyState = React.useState(null)
  var file = props.file, t = props.t
  return h('div', { className: 'dshgit-filediff', 'data-compact': props.compact === true, 'data-fill': props.fill === true, 'data-diff-file': file.path }, [
    props.hideHeader ? null : h('div', { key: 'head', className: props.compact ? 'dshgit-filediff-head dshgit-history-filesbar' : 'dshgit-filediff-head',
      onContextMenu: props.onFileMenu ? function (event) { props.onFileMenu(event, file) } : undefined,
    }, props.compact ? [props.fileControls, props.tools, h(DiffStats, { key: 'stats', file: file })] : [
      h('span', { key: 'pathcopy', className: 'dshgit-diff-pathcopy' }, [
        h('span', { key: 'path', className: 'dshgit-previewpath', title: file.path }, file.path),
        h('button', { key: 'copy', type: 'button', className: 'dshgit-iconbtn',
          'data-diff-action': 'copy', title: t('diff.copyPath'), 'aria-label': t('diff.copyPath'),
          onClick: function () { Promise.resolve().then(function () { return navigator.clipboard.writeText(file.path) })
            .then(function () { copyState[1]('diff.copied') }).catch(function () { copyState[1]('diff.copyFailed') }) },
        }, h(IconCopyPath, { size: 16 })),
      ]),
      copyState[0] ? h('span', { key: 'copy-result', role: 'status', className: 'dshgit-muted' }, t(copyState[0])) : null,
      h(DiffStats, { key: 'stats', file: file }),
    ]),
    !props.hideHeader && !props.compact ? props.tools || null : null,
    h('div', { key: 'body', className: 'dshgit-filediff-body' }, props.children || [
      file.from ? h('div', { key: 'from', className: 'dshgit-muted' }, '← ' + file.from) : null,
      h(DiffBody, { t: t, key: 'diff', path: file.path, hunks: file.hunks, emptyText: file.binary ? t('state.fileBinary') : t('state.emptyDiff') }),
    ]),
  ])
}


/** Load only the selected file, ignoring results after selection changes. */
function LazyStashFile(props) {
  var valueState = React.useState(null), errorState = React.useState(null), retryState = React.useState(0)
  React.useEffect(function () {
    var active = true
    errorState[1](null)
    props.loadFile(props.file).then(function (value) { if (active) valueState[1](value) })
      .catch(function (failure) { if (active) errorState[1](failure.message) })
    return function () { active = false }
  }, [props.file.path, props.loadFile, retryState[0]])
  var patch = (valueState[0]?.files || []).find(function (file) { return file.path === props.file.path })
  return h(FileDiffCard, { file: Object.assign({}, props.file, patch || {}), onFileMenu: props.onFileMenu, t: props.t },
    errorState[0] ? h('div', { className: 'dshgit-card', role: 'alert' }, [
      h('span', { key: 'error' }, errorState[0]),
      h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () {
        props.clearFile(props.file.path); retryState[1](retryState[0] + 1)
      } }, props.t('stash.retry')),
    ]) : valueState[0] === null ? h('div', { className: 'dshgit-empty' }, props.t('state.loading'))
      // A stashed image has no text diff either; compare the stash against
      // its parent commit, which is what the stash was taken from.
      : isImagePath(props.file.path) && props.loadImage
        ? h(ImageDiffView, { run: props.loadImage.run, root: props.loadImage.root, path: props.file.path,
            originalPath: props.file.from, from: props.loadImage.from, to: props.loadImage.to, t: props.t })
        : h(DiffBody, { t: props.t, path: props.file.path, hunks: patch?.hunks || [], emptyText: props.file.binary ? props.t('state.fileBinary') : props.t('state.emptyDiff') }))
}


function StashFileNavigation(props) {
  // The chosen layout is a user preference, not per-view state: it is stored
  // once and shared by every file list that offers the toggle. Local state
  // alone lost it on each remount — switching commits, stashes or the
  // compare tab and coming back reset the list to its default, which reads
  // as the toggle not working at all.
  var modeState = React.useState(function () { return fileListLayout(props.layout) })
  // Another list's toggle must be reflected here, so the preference is read
  // through the shared store rather than seeded once at mount.
  React.useEffect(function () {
    var listener = function (value) { modeState[1](value === 'flat' ? 'list' : 'tree') }
    fileListLayoutListeners.add(listener)
    return function () { fileListLayoutListeners.delete(listener) }
  }, [])
  var row = function (file) {
    return h('button', { key: file.path, type: 'button', className: 'dshgit-row dshgit-rowbtn',
      'data-stash-file': file.path, 'data-selected': props.selected === file.path, 'data-status': statusLetter(file),
      'aria-pressed': props.selected === file.path,
      title: file.path, onClick: function () { props.onSelect(file.path) },
      onContextMenu: props.onFileMenu ? function (event) { props.onFileMenu(event, file) } : undefined,
    }, (modeState[0] === 'tree' ? [h('span', { key: 'chevron-space', className: 'dshgit-tree-spacer', 'aria-hidden': true })] : []).concat(changeFileLabel(modeState[0] === 'tree' ? file.path.split('/').pop() : file.path, file.lfs), [
      props.showStatus ? h('span', { key: 'status', className: 'dshgit-status', 'data-status': statusLetter(file) }, statusLetter(file)) : h(DiffStats, { key: 'stats', file: file }),
    ]))
  }
  var tree = { children: {}, files: [] }
  props.files.forEach(function (file) {
    var parts = file.path.split('/'), current = tree
    parts.slice(0, -1).forEach(function (name) {
      if (!current.children[name]) current.children[name] = { children: {}, files: [] }
      current = current.children[name]
    })
    current.files.push(file)
  })
  var folder = function (node) {
    return Object.keys(node.children).sort().map(function (name) {
      var child = node.children[name], label = name, path = name
      // Compact a chain such as lib/client/features into one row: every level of
      // an unbranched chain costs 16px of indent, so a deep path squeezes the
      // basename — the one part that identifies the file — down to `actio…`.
      while (!child.files.length && Object.keys(child.children).length === 1) {
        var next = Object.keys(child.children)[0]
        child = child.children[next]
        label += '/' + next
        path += '/' + next
      }
      return h('details', { key: path, open: true, className: 'dshgit-filefolder' }, [
        h('summary', { key: 'name', title: path }, [h(IconChevron, { key: 'arrow', size: 16, open: true, className: 'dshgit-folder-chevron' }), h(IconFolder, { key: 'folder', size: 17 }), h('span', { key: 'label' }, label)]),
        h('div', { key: 'children' }, folder(child)),
      ])
    }).concat(node.files.map(row))
  }
  // The toggle is built once and placed either beside the caller's search box
  // (the normal case) or alone, so the two arrangements cannot drift apart.
  var toggle = h('div', { key: 'switch', className: 'dshgit-fileview-switch' }, ['list', 'tree'].map(function (mode) {
    return h('button', { key: mode, type: 'button', className: 'dshgit-iconbtn', 'data-file-view': mode,
      'aria-pressed': modeState[0] === mode, title: props.t(mode === 'tree' ? 'diff.fileTree' : 'diff.fileList'),
      'aria-label': props.t(mode === 'tree' ? 'diff.fileTree' : 'diff.fileList'),
      onClick: function () { setFileListLayout(mode === 'tree' ? 'tree' : 'flat') },
    }, mode === 'tree' ? h(IconFileTree, { size: 16 }) : h(IconFileList, { size: 16 }))
  }))
  return h(Fragment, null, [
    props.search === undefined
      ? toggle
      : h('div', { key: 'searchrow', className: 'dshgit-stash-searchrow' }, [props.search, toggle]),
    h('div', { key: 'files', className: 'dshgit-stash-filelist', 'data-layout': modeState[0] }, modeState[0] === 'tree' ? folder(tree) : props.files.map(row)),
  ])
}

export { DiffStats, FileDiffCard, LazyStashFile, StashFileNavigation, fileDiffStats }

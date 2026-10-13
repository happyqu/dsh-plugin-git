import { Fragment, React, h } from '../../core/runtime.js'
import { StashFileNavigation } from '../../ui/file-diff.js'
import { IconCompare } from '../../ui/icons.js'
import { HistoryFilePreview } from '../history/details.js'

/** Changed files for the temporary comparison view. */
function CompareSidebar(props) {
  var search = React.useState(''), limit = React.useState(100)
  var query = search[0].trim().toLowerCase()
  var files = props.files.filter(function (file) { return file.path.toLowerCase().includes(query) }), visible = files.slice(0, limit[0])
  // Hoisted so the search box survives the loading state: it used to be a
  // sibling of the navigation, and folding it into that row would otherwise
  // make it vanish while the file list is still being fetched.
  var searchInput = h('input', {
    key: 'search', type: 'search', className: 'dshgit-input', value: search[0], placeholder: props.t('list.searchFiles'), 'aria-label': props.t('list.searchFiles'),
    onChange: function (event) { search[1](event.currentTarget.value); limit[1](100) },
  })
  return h(Fragment, null, [
    h('div', { key: 'count', className: 'dshgit-sidebar-hint' }, props.t('count.files', { count: props.files.length })),
    props.loading
      ? h('div', { key: 'searchrow', className: 'dshgit-stash-searchrow' }, searchInput)
      : h(StashFileNavigation, { key: 'files', root: props.root, files: visible, selected: props.selected, onSelect: props.onSelect, onFileMenu: props.onFileMenu, t: props.t,
          search: searchInput }),
    props.loading ? h('div', { key: 'loading', className: 'dshgit-empty', role: 'status' }, props.t('state.loading')) : null,
    !props.loading && !props.error && files.length === 0 ? h('div', { key: 'empty', className: 'dshgit-sidebar-hint' }, props.t(query ? 'list.noMatches' : 'state.emptyDiff')) : null,
    files.length > visible.length ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn dshgit-list-more',
      onClick: function () { limit[1](limit[0] + 100) },
    }, props.t('action.loadMore') + ' (' + visible.length + '/' + files.length + ')') : null,
  ])
}


/** A temporary comparison opened from a branch or commit. */
function CompareTab(props) {
  var t = props.t, fromState = React.useState(props.from), toState = React.useState(props.to), cacheRef = React.useRef(new Map())
  var data = props.data, selected = (data?.files || []).find(function (file) { return file.path === props.selected })
  var submit = function (event) {
    event?.preventDefault()
    var from = fromState[0].trim(), to = toState[0].trim()
    if (from && to) props.onCompare(from, to)
  }
  var options = [{ value: 'HEAD', label: 'HEAD' }].concat((props.refs || []).map(function (ref) { return { value: ref.ref, label: ref.name } }))
  var loadFile = React.useCallback(function (file, mode) {
    var key = mode + ':' + file.path, cache = cacheRef.current
    if (cache.has(key)) return cache.get(key)
    var promise = mode === 'diff'
      ? props.run('diff', { root: props.repo.root, from: data.from, to: data.to, path: file.path, originalPath: file.from }, { silentError: true })
      : props.run('fileContent', { root: props.repo.root, rev: mode === 'before' ? data.from : data.to, path: mode === 'before' ? file.from || file.path : file.path }, { silentError: true })
    cache.set(key, promise)
    promise.then(function () { while (cache.size > 64) cache.delete(cache.keys().next().value) }, function () { cache.delete(key) })
    return promise
  }, [props.repo.root, data])
  var fileMenu = function (event, file) { props.onFileMenu?.(event, file, data?.to || props.to) }
  return h(Fragment, null, [
    h('form', { key: 'form', className: 'dshgit-card', onSubmit: submit }, [
      h('div', { key: 'row', className: 'dshgit-tools', style: { flexWrap: 'wrap' } }, [
        h('button', { key: 'back', type: 'button', className: 'dshgit-btn', 'data-compare-action': 'back', onClick: props.onBack }, t('compare.back')),
        h('input', { key: 'from', className: 'dshgit-input', list: 'dshgit-compare-refs', value: fromState[0],
          'aria-label': t('compare.from'), placeholder: t('compare.from'), style: { flex: 1, minWidth: '140px' },
          onChange: function (event) { fromState[1](event.currentTarget.value) } }),
        h('button', { key: 'swap', type: 'button', className: 'dshgit-iconbtn', title: t('compare.swap'), 'aria-label': t('compare.swap'), 'data-compare-action': 'swap',
          disabled: !fromState[0].trim() || !toState[0].trim(), onClick: function () { props.onCompare(toState[0].trim(), fromState[0].trim()) },
        }, h(IconCompare, { size: 16 })),
        h('input', { key: 'to', className: 'dshgit-input', list: 'dshgit-compare-refs', value: toState[0],
          'aria-label': t('compare.to'), placeholder: t('compare.to'), style: { flex: 1, minWidth: '140px' },
          onChange: function (event) { toState[1](event.currentTarget.value) } }),
        h('button', { key: 'go', type: 'submit', className: 'dshgit-btn', 'data-compare-action': 'compare',
          disabled: !fromState[0].trim() || !toState[0].trim() }, t('tab.compare')),
      ]),
      h('datalist', { key: 'refs', id: 'dshgit-compare-refs' }, options.map(function (option) {
        return h('option', { key: option.value, value: option.value }, option.label)
      })),
      h('div', { key: 'direction', className: 'dshgit-meta', style: { marginTop: '8px' } },
        props.from.replace(/^refs\/(heads|remotes|tags)\//, '') + ' → ' + props.to.replace(/^refs\/(heads|remotes|tags)\//, '')),
    ]),
    props.error ? h('div', { key: 'error', className: 'dshgit-card', role: 'alert' }, [
      h('span', { key: 'message' }, props.error),
      h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () { props.onCompare(props.from, props.to) } }, t('stash.retry')),
    ]) : !data ? h('div', { key: 'loading', className: 'dshgit-empty', role: 'status' }, t('state.loading')) : null,
    data ? h('details', { key: 'history', className: 'dshgit-card' }, [
      h('summary', { key: 'summary' }, t('compare.commits') + (props.history?.commits ? ' (' + props.history.commits.length + ')' : '')),
      !props.history ? h('div', { key: 'loading', role: 'status' }, t('state.loading'))
        : props.history.error ? h('div', { key: 'error', role: 'alert' }, props.history.error)
          : !props.history.commits?.length ? h('div', { key: 'empty', className: 'dshgit-muted' }, t('state.noCommits'))
            : (props.history.commits || []).map(function (commit) { return h('div', { key: commit.sha, className: 'dshgit-meta' }, [
              h('span', { key: 'sha' }, commit.shortSha), h('span', { key: 'subject' }, commit.subject),
            ]) }),
    ]) : null,
    data ? selected ? h(HistoryFilePreview, { key: data.from + ':' + data.to + ':' + selected.path, file: selected, loadFile: loadFile, onFileMenu: fileMenu,
        loadImage: { run: props.run, root: props.repo.root, from: data.from, to: data.to }, t: t })
      : h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.emptyDiff')) : null,
  ])
}

export { CompareSidebar, CompareTab }

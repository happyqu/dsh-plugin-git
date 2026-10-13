import { Fragment, React, h } from '../../core/runtime.js'
import { IconChevron, IconStashApply, IconStashPop, IconTrash } from '../../ui/icons.js'
import { formatRelative, formatTime } from '../../core/format.js'
import { DiffStats, LazyStashFile, StashFileNavigation, fileDiffStats } from '../../ui/file-diff.js'

function StashTreeItem(props) {
  var openState = React.useState(false)
  var open = openState[0]
  var setOpen = openState[1]
  var diffState = React.useState(null)
  var stashDiff = diffState[0]
  var setStashDiff = diffState[1]
  React.useEffect(function () {
    if (!open || stashDiff !== null) return
    props.run('stashDiff', { root: props.repo.root, ref: props.stash.ref }, { silentError: true })
      .then(setStashDiff).catch(function () { setStashDiff({ files: [] }) })
  }, [open, props.repo.root, props.stash.ref])
  var stash = props.stash
  var t = props.t
  var apply = function (pop) {
    props.onWrite('stashApply', { ref: stash.ref, pop: pop }, { after: props.afterWrite })
  }
  return h('div', { className: 'dshgit-treeitem' }, [
    h('div', { key: 'row', className: 'dshgit-treerow',
      onClick: function () { props.onOpenStash(stash) },
      onContextMenu: function (event) { props.showMenu(event, [
        { id: 'view', label: t('action.openChanges'), run: function () { props.onOpenStash(stash) } },
        { id: 'apply', label: t('action.stashApply'), run: function () { apply(false) } },
        { id: 'pop', label: t('action.stashPop'), run: function () { apply(true) } },
        { id: 'drop', label: t('action.stashDrop'), danger: true, run: function () {
          props.requestConfirm(t('confirm.dropStash'), function () {
            props.onWrite('stashDrop', { ref: stash.ref }, { confirm: true, after: props.afterWrite })
          })
        } },
      ]) },
    }, [
      h('button', { key: 'toggle', type: 'button', className: 'dshgit-iconbtn',
        'aria-label': t('label.files'), onClick: function (event) { event.stopPropagation(); setOpen(!open) },
      }, h(IconChevron, { open: open })),
      h('span', { key: 'name', className: 'dshgit-name', title: stash.message }, stash.message),
      h('span', { key: 'date', className: 'dshgit-muted' }, formatRelative(stash.date)),
      h('span', { key: 'actions', className: 'dshgit-treeactions' }, [
        h('button', { key: 'apply', type: 'button', className: 'dshgit-iconbtn',
          title: t('action.stashApply'), onClick: function (event) { event.stopPropagation(); apply(false) },
        }, '↓'),
        h('button', { key: 'pop', type: 'button', className: 'dshgit-iconbtn',
          title: t('action.stashPop'), onClick: function (event) { event.stopPropagation(); apply(true) },
        }, '↧'),
      ]),
    ]),
    open ? h('div', { key: 'files', className: 'dshgit-treechildren' },
      stashDiff === null ? h('div', { className: 'dshgit-empty' }, t('state.loading'))
        : (stashDiff.files || []).map(function (file) {
          return h('div', { key: file.path, className: 'dshgit-treerow',
            onClick: function () { props.onOpenStash(stash, file.path) },
          }, [
            h('span', { key: 'status', className: 'dshgit-status' }, file.status || 'M'),
            h('span', { key: 'path', className: 'dshgit-name', title: file.path }, file.path),
          ])
        })) : null,
  ])
}


/** The stash list is separate from the working tree and commit history. */
function StashesSidebar(props) {
  var t = props.t
  var searchState = React.useState('')
  var limitState = React.useState(100)
  var query = searchState[0].trim().toLowerCase()
  var matched = (props.stashes || []).filter(function (stash) { return !query ||
    (stash.ref + ' ' + stash.message).toLowerCase().indexOf(query) !== -1 })
  return h(Fragment, null, [
    h('div', { key: 'create', className: 'dshgit-sidebar-search' },
      h('button', { type: 'button', className: 'dshgit-btn', disabled: props.busy || !props.canCreate,
        onClick: props.onCreate,
      }, t('stash.create'))),
    h('div', { key: 'search', className: 'dshgit-sidebar-search' }, h('input', { type: 'search', className: 'dshgit-input',
      'aria-label': t('list.searchStashes'), placeholder: t('list.searchStashes'), value: searchState[0],
      onChange: function (event) { searchState[1](event.currentTarget.value); limitState[1](100) },
    })),
    props.error ? h('div', { key: 'error', className: 'dshgit-sidebar-hint', role: 'alert' }, [
      h('div', { key: 'message' }, t('stash.loadFailed', { message: props.error })),
      h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', disabled: props.busy,
        onClick: props.onRetry,
      }, t('stash.retry')),
    ]) : props.stashes === null ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))
      : props.stashes.length === 0 ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.noStashes'))
      : h('div', { key: 'list', className: 'dshgit-stash-list' }, matched.slice(0, limitState[0]).map(function (stash) {
          var branch = /^(?:WIP on|On) (.+?):/.exec(stash.message || '')
          var description = branch ? stash.message.slice(branch[0].length).trim() : stash.message
          return h('div', { key: stash.sha || stash.ref, className: 'dshgit-stash-item' }, [
            h('button', { key: 'select', type: 'button', className: 'dshgit-stash-row',
              'data-stash-ref': stash.ref, 'aria-pressed': props.selected === (stash.sha || stash.ref),
              title: stash.message + '\n' + stash.ref + ' · ' + formatTime(stash.date), onClick: function () { props.onSelect(stash) },
            }, [
              h('span', { key: 'message', className: 'dshgit-name' }, description || stash.message || stash.ref),
            ]),
            h('div', { key: 'footer', className: 'dshgit-stash-footer' }, [
            h('button', { key: 'meta', type: 'button', className: 'dshgit-stash-meta', tabIndex: -1,
              title: stash.ref + (branch ? ' · ' + branch[1] : '') + '\n' + formatTime(stash.date),
              onClick: function () { props.onSelect(stash) },
            }, (branch ? branch[1] + ' · ' : '') + formatRelative(stash.date)),
            h('div', { key: 'actions', className: 'dshgit-stash-row-actions', role: 'group',
              'aria-label': t('menu.actions') + ' · ' + stash.ref,
            }, ['apply', 'pop', 'drop'].map(function (action) {
              var loading = props.busyAction?.id === (stash.sha || stash.ref) && props.busyAction.action === action
              var label = t(action === 'apply' ? 'action.stashApply' : action === 'pop' ? 'action.stashPop' : 'action.stashDrop')
              var hint = t(action === 'apply' ? 'stash.applyHint' : action === 'pop' ? 'stash.popHint' : 'stash.dropHint')
              var Icon = action === 'apply' ? IconStashApply : action === 'pop' ? IconStashPop : IconTrash
              return h('button', { key: action, type: 'button', className: 'dshgit-stash-row-action',
                'data-stash-action': action, 'data-stash-target': stash.sha || stash.ref,
                disabled: props.busy, 'aria-busy': loading, title: label + '\n' + hint, 'aria-label': label,
                onClick: function () { if (action === 'drop') props.onDrop(stash); else props.onApply(stash, action === 'pop') },
              }, loading ? h('span', { key: 'spinner', className: 'dshgit-spinner', 'aria-hidden': true }) : h(Icon, { size: 16, 'aria-hidden': true }))
            })),
            ]),
          ])
        }).concat(matched.length > limitState[0] ? [h('button', { key: 'more', type: 'button', className: 'dshgit-btn dshgit-list-more',
          onClick: function () { limitState[1](limitState[0] + 100) },
        }, t('action.loadMore') + ' (' + limitState[0] + '/' + matched.length + ')')] : [])),
    props.stashes !== null && props.stashes.length > 0 && matched.length === 0
      ? h('div', { key: 'no-matches', className: 'dshgit-empty' }, t('list.noMatches')) : null,
  ])
}


/** Review all saved files, including untracked files, before restoring them. */
function StashDetails(props) {
  var t = props.t
  var filesState = React.useState(null), errorState = React.useState(null), retryState = React.useState(0)
  var searchState = React.useState(''), limitState = React.useState(100), pathState = React.useState(null)
  var bucketRef = React.useRef(null)
  React.useEffect(function () {
    if (props.stash === null) return
    var active = true
    var bucket = { cache: new Map(), queue: [], active: 0, closed: false, legacy: null, fallback: null }
    bucketRef.current = bucket
    filesState[1](null); errorState[1](null)
    props.run('stashDiff', { root: props.repo.root, ref: props.stash.ref, expectedSha: props.stash.sha, summaryOnly: true },
      { silent: true, silentError: true }).then(function (value) {
        if (!active) return
        if (typeof value.text === 'string' || Array.isArray(value.hunks)) bucket.legacy = value
        var files = value.files || []
        filesState[1](files)
        pathState[1](function (current) { return files.some(function (file) { return file.path === current }) ? current : files[0]?.path || null })
      }).catch(function (failure) { if (active) errorState[1](failure.message) })
    return function () {
      active = false; bucket.closed = true
      bucket.queue.splice(0).forEach(function (job) { job.reject(new Error('Cancelled')) })
    }
  }, [props.repo.root, props.stash?.sha, props.stash?.ref, retryState[0], props.run])
  var loadFile = React.useCallback(function (file) {
    var bucket = bucketRef.current
    if (!bucket || bucket.closed) return Promise.reject(new Error('Cancelled'))
    if (bucket.cache.has(file.path)) return bucket.cache.get(file.path)
    var payload = { root: props.repo.root, ref: props.stash.ref, expectedSha: props.stash.sha }
    var read = function () {
      if (bucket.legacy) return Promise.resolve(bucket.legacy)
      if (bucket.fallback) return bucket.fallback
      return props.run('stashDiff', Object.assign({ path: file.path, originalPath: file.from || undefined }, payload), { silent: true, silentError: true })
        .catch(function (failure) {
          if (!/Too many revisions specified/i.test(failure.message || '')) throw failure
          if (!bucket.fallback) bucket.fallback = props.run('stashDiff', payload, { silent: true, silentError: true })
            .then(function (value) { bucket.legacy = value; return value })
            .catch(function (error) { bucket.fallback = null; throw error })
          return bucket.fallback
        })
    }
    var pump = function () {
      while (!bucket.closed && bucket.active < 3 && bucket.queue.length) {
        var job = bucket.queue.shift()
        bucket.active++
        Promise.resolve().then(job.read).then(job.resolve, job.reject).finally(function () {
          bucket.active--
          while (bucket.cache.size > 64) bucket.cache.delete(bucket.cache.keys().next().value)
          pump()
        })
      }
    }
    var promise = new Promise(function (resolve, reject) { bucket.queue.push({ read: read, resolve: resolve, reject: reject }) })
    bucket.cache.set(file.path, promise); pump()
    return promise
  }, [props.repo.root, props.stash?.sha, props.stash?.ref, props.run, filesState[0]])
  if (props.stash === null) return h('div', { className: 'dshgit-empty' }, t('stash.select'))
  var files = filesState[0] || [], query = searchState[0].trim().toLowerCase()
  var matched = files.filter(function (file) { return !query || file.path.toLowerCase().indexOf(query) !== -1 })
  var visible = matched.slice(0, limitState[0])
  var totals = { added: 0, deleted: 0 }, known = true
  files.forEach(function (file) { var stats = fileDiffStats(file)
    if (stats) { totals.added += stats.added; totals.deleted += stats.deleted }
    else if (!file.binary) known = false
  })
  var selectedFile = files.find(function (file) { return file.path === pathState[0] }) || null
  var select = function (path) { pathState[1](path) }
  return h('div', { className: 'dshgit-stash-details' }, [
    h('div', { key: 'header', className: 'dshgit-card' }, [
      h('div', { key: 'title', className: 'dshgit-name' }, props.stash.ref + ' · ' + props.stash.message),
      h('div', { key: 'date', className: 'dshgit-muted' }, formatTime(props.stash.date)),
    ]),
    h('div', { key: 'body', className: 'dshgit-stash-detailbody' }, [
      h('div', { key: 'nav', className: 'dshgit-stash-filenav' }, [
        h('div', { key: 'count', className: 'dshgit-sidebar-head' }, t('stash.allFiles') + ' (' + files.length + ')'),
        h(StashFileNavigation, { key: 'navigation', root: props.repo.root, files: visible, selected: pathState[0], onSelect: select, onFileMenu: props.onFileMenu, t: t,
          search: h('input', { key: 'search', type: 'search', className: 'dshgit-input', value: searchState[0],
            placeholder: t('list.searchFiles'), 'aria-label': t('list.searchFiles'),
            onChange: function (event) { searchState[1](event.currentTarget.value); limitState[1](100) },
          }) }),
        matched.length > visible.length ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn dshgit-list-more',
          onClick: function () { limitState[1](limitState[0] + 100) },
        }, t('action.loadMore') + ' (' + visible.length + '/' + matched.length + ')') : null,
      ]),
      h('div', { key: 'preview', className: 'dshgit-stash-preview' }, [
        h('div', { key: 'tools', className: 'dshgit-stash-previewtools' }, [
          h('span', { key: 'count', className: 'dshgit-muted', style: { marginRight: 'auto' } }, t('stash.allFiles') + ' (' + files.length + ')'),
          known && files.length ? h(DiffStats, { key: 'stats', file: totals }) : null,
        ]),
        h('div', { key: 'diffs', className: 'dshgit-stash-diff' },
          errorState[0] ? h('div', { className: 'dshgit-card', role: 'alert' }, [
            h('span', { key: 'message' }, t('stash.loadFailed', { message: errorState[0] })),
            h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () { retryState[1](retryState[0] + 1) } }, t('stash.retry')),
          ]) : filesState[0] === null ? h('div', { className: 'dshgit-empty' }, t('state.loading'))
            : selectedFile === null ? h('div', { className: 'dshgit-empty' }, t(files.length ? 'stash.select' : 'state.emptyDiff'))
              : h(LazyStashFile, { key: selectedFile.path, file: selectedFile, loadFile: loadFile, onFileMenu: props.onFileMenu,
                loadImage: { run: props.run, root: props.repo.root, from: props.stash.sha + '^', to: props.stash.sha },
                clearFile: function (path) { bucketRef.current?.cache.delete(path) }, t: t,
              })),
      ]),
    ]),
  ])
}

export { StashDetails, StashesSidebar }

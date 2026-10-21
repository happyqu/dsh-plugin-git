import { React, h } from '../../core/runtime.js'
import { formatRelative } from '../../core/format.js'
import { IconBranch, IconBranchAction, IconBranchSync, IconChevron, IconPlus, IconTag, IconGit } from '../../ui/icons.js'
import { sortedBranches, sortedTags } from './model.js'

function BranchPicker(props) {
  var t = props.t
  var listRef = React.useRef(null)
  var [tagsOpen, setTagsOpen] = React.useState(false)
  var [remotesOpen, setRemotesOpen] = React.useState(false)
  var limits = React.useState({ locals: 5, remotes: 5, tags: 5 })
  var query = props.query.trim().toLowerCase()
  var refs = props.refs

  /** Keep checkout targets easy to scan; commit details live in the tooltip. */
  var row = function (item, key, onPick, extra) {
    var remote = extra && extra.remote ? String(item.name).split('/')[0] : null
    var display = remote === null ? item.name : String(item.name).slice(remote.length + 1)
    var branch = item.ref ? item : (refs?.branches || []).find(function (branch) { return branch.name === item.name }) || Object.assign({}, item, { ref: 'refs/heads/' + item.name })
    var quick = props.mode !== 'merge' && props.branchItems && !extra?.tag ? props.branchItems(branch) : null
    var ahead = !extra?.tag && !extra?.remote && branch.ahead > 0 ? branch.ahead : 0
    var behind = !extra?.tag && !extra?.remote && branch.behind > 0 ? branch.behind : 0
    var tracking = (ahead ? '↑' + ahead : '') + (behind ? (ahead ? ' ' : '') + '↓' + behind : '')
    var trackingHint = [ahead ? t('chips.ahead', { count: ahead }) : '', behind ? t('chips.behind', { count: behind }) : ''].filter(Boolean).join(' · ')
    var details = [item.author, item.sha ? String(item.sha).slice(0, 7) : '', item.subject].filter(Boolean).join(' · ')
    var tooltip = [item.name, details, trackingHint, item.committerDate !== null && item.committerDate !== undefined ? formatRelative(item.committerDate) : ''].filter(Boolean).join('\n')
    var pick = h('button', {
      key: key,
      type: 'button',
      className: 'dshgit-pickrow',
      'data-ref': item.name,
      'aria-current': extra?.current === true ? 'true' : undefined,
      disabled: props.busy === true || extra?.current === true,
      title: tooltip,
      onClick: onPick,
    }, [
      h('span', { key: 'top', className: 'dshgit-pickrowtop', 'data-tracking': tracking ? true : undefined }, [
        h('span', { key: 'i', className: 'dshgit-pickicon dshgit-branch-statusicon' }, [
          h(extra?.tag ? IconTag : IconBranch, { key: 'icon', size: 16 }),
          extra?.current === true ? h('span', { key: 'current', className: 'dshgit-tipdot dshgit-branch-current-dot', role: 'img', 'aria-label': t('wb.current') }) : null,
        ]),
        h('span', { key: 'n', className: 'dshgit-pickname' }, [
          remote === null ? null : h('span', { key: 'r', className: 'dshgit-pickremote' }, remote + '/'),
          display,
        ]),
        tracking ? h('span', { key: 'tracking', className: 'dshgit-picker-tracking', 'aria-label': trackingHint, title: trackingHint }, [
          ahead ? h('span', { key: 'ahead', className: 'dshgit-picker-ahead' }, '↑' + ahead) : null,
          behind ? h('span', { key: 'behind', className: 'dshgit-picker-behind' }, '↓' + behind) : null,
        ]) : null,
      ]),
    ])
    if (!quick) return pick
    var remoteBranch = branch.ref.startsWith('refs/remotes/')
    return h('div', { key: key, className: 'dshgit-branch-item', 'data-picker-branch': branch.ref,
      'data-current': extra?.current === true,
      'data-push-pending': !remoteBranch && branch.ahead > 0,
      onContextMenu: function (event) { props.onBranchMenu(event, branch) },
    }, [pick, h('div', { key: 'shortcuts', className: 'dshgit-branch-actions' }, (remoteBranch ? ['checkout', 'fetch', 'merge', 'createBranch'] : ['checkout', 'merge', 'push', 'pull', 'fetch']).map(function (action) {
      var item = quick.find(function (entry) { return entry.id === action })
      if (action === 'merge') {
        if (!props.onMerge || extra?.current === true) return null
        item = { label: t('action.merge') + ' · ' + branch.name, disabled: props.busy === true || props.mergeDisabled === true, run: function () { props.onMerge(branch.name, branch.ref) } }
      }
      if (!item) return null
      return h('button', { key: action, type: 'button', className: 'dshgit-iconbtn', title: [item.label, item.hint].filter(Boolean).join('\n'),
        'aria-label': item.label, 'data-branch-action': action, 'data-branch-target': branch.ref,
        'data-push-pending': action === 'push' && branch.ahead > 0, disabled: item.disabled === true,
        onClick: function (event) { event.preventDefault(); event.stopPropagation(); item.run() },
      }, h(action === 'checkout' || action === 'createBranch' || action === 'merge' ? IconBranchAction : IconBranchSync, { size: 16, kind: action, horizontal: true }))
    }))])
  }

  var match = function (item) {
    return query === '' || String(item.name).toLowerCase().indexOf(query) !== -1
  }

  var orderedLocals = React.useMemo(function () { return sortedBranches(refs?.branches) }, [refs?.branches])
  var orderedRemotes = React.useMemo(function () { return sortedBranches(refs?.remotes) }, [refs?.remotes])
  var isCurrent = function (branch) { return branch.head === true || branch.name === props.current }
  var locals = refs === null ? [] : orderedLocals.filter(function (branch) {
    return (props.mode !== 'merge' || !isCurrent(branch)) && match(branch)
  })
  var remotes = refs === null ? [] : orderedRemotes.filter(function (branch) {
    // `origin/HEAD` is a symbolic pointer, not a checkout target.
    return !/\/HEAD$/.test(branch.ref) && match(branch)
  })
  var tags = props.mode === 'merge' || refs === null ? [] : sortedTags(refs.tags).filter(match)
  var nothing = locals.length === 0 && remotes.length === 0 && tags.length === 0
  var currentLocal = locals.find(isCurrent)
  var visibleLocals = query !== '' ? locals : currentLocal
    ? [currentLocal].concat(locals.filter(function (branch) { return !isCurrent(branch) }).slice(0, limits[0].locals - 1))
    : locals.slice(0, limits[0].locals)
  var remotesCollapsed = props.compact && locals.length > 0 && !remotesOpen && query === ''
  var visibleRemotes = remotesCollapsed ? [] : query !== '' ? remotes : remotes.slice(0, limits[0].remotes)
  var visibleTags = query !== '' ? tags : tagsOpen ? tags.slice(0, limits[0].tags) : []
  var more = function (key, count) {
    if (query !== '' || count <= 5) return []
    var limit = limits[0][key], remaining = Math.max(0, count - limit)
    return [h('button', { key: 'more:' + key, type: 'button', className: 'dshgit-pickmore',
      'data-picker-more': key,
      onClick: function () { limits[1](function (value) {
        return Object.assign({}, value, { [key]: remaining ? Math.min(count, value[key] + 5) : 5 })
      }) },
    }, remaining ? t('picker.showMore', { count: Math.min(5, remaining), remaining: remaining }) : t('picker.showLess'))]
  }

  return h('div', { className: 'dshgit-picker' }, [
    h('input', {
      key: 'q',
      className: 'dshgit-pickerinput',
      value: props.query,
      placeholder: t(props.mode === 'merge' ? 'merge.search' : 'picker.placeholder'),
      autoFocus: true,
      onChange: function (event) { props.setQuery(event.currentTarget.value) },
      onKeyDown: function (event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return
        var rows = Array.from(listRef.current?.querySelectorAll?.('.dshgit-pickrow:not(:disabled), button[data-picker-toggle], button[data-picker-more]') || [])
        if (rows.length === 0) return
        event.preventDefault()
        var selected = event.key === 'ArrowUp' ? rows[rows.length - 1] : rows[0]
        if (event.key === 'Enter') selected.click?.()
        else selected.focus?.()
      },
    }),
    props.detached && props.mode !== 'merge' ? h('div', { key: 'detached', className: 'dshgit-sidebar-hint' }, t('wb.detachedNotice')) : null,
    // The one creation action VS Code puts above the list, so it is reachable
    // without scrolling past every branch. Fetch deliberately does NOT appear
    // here: it does nothing to the branch you are choosing, it sits in the
    // title bar's own Fetch control, and offering two ways to reach the same
    // network write from a picker invites a mis-click — and after a fetch the
    // list would rebuild under the pointer anyway.
    props.mode === 'merge' ? null : h('div', { key: 'actions', className: 'dshgit-pickactions' }, [
      h('button', { key: 'new', type: 'button', className: 'dshgit-pickrow',
        disabled: props.busy === true,
        onClick: function () { props.onNew('HEAD') },
      }, h('span', { key: 'top', className: 'dshgit-pickrowtop' }, [
        h('span', { key: 'i', className: 'dshgit-pickicon', 'aria-hidden': true }, h(IconPlus, { size: 14 })),
        h('span', { key: 'n', className: 'dshgit-pickname' }, t('picker.create')),
      ])),

    ]),
    h('div', { key: 'list', className: 'dshgit-picklist', ref: listRef,
      onKeyDown: function (event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        var rows = Array.from(listRef.current?.querySelectorAll?.('.dshgit-pickrow:not(:disabled), button[data-picker-toggle], button[data-picker-more]') || [])
        if (rows.length === 0) return
        event.preventDefault()
        var index = rows.indexOf(document.activeElement)
        rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus?.()
      },
    }, [
      locals.length > 0
        ? h('div', { key: 'lb', className: 'dshgit-pickgroup' }, t('picker.branches') + ' · ' + locals.length)
        : null,
    ].concat(visibleLocals.map(function (branch) {
      return row(branch, 'l:' + branch.ref, function () {
        if (props.mode === 'merge') props.onMerge(branch.name, branch.ref)
        else props.onSwitch(branch.name)
      }, { current: isCurrent(branch) })
    })).concat(more('locals', locals.length)).concat(remotes.length > 0
      ? [props.compact && query === '' && locals.length > 0
        ? h('button', { key: 'rb', type: 'button', className: 'dshgit-pickgroup dshgit-picktoggle',
            'data-picker-toggle': 'remotes', 'aria-expanded': remotesOpen,
            onClick: function () { setRemotesOpen(!remotesOpen) },
          }, [t('picker.remotes') + ' · ' + remotes.length,
            h('span', { key: 'arrow', className: 'dshgit-pickchev', 'aria-hidden': true }, h(IconChevron, { size: 12 }))])
        : h('div', { key: 'rb', className: 'dshgit-pickgroup' }, t('picker.remotes') + ' · ' + remotes.length)]
      : []).concat(visibleRemotes.map(function (branch) {
        return row(branch, 'r:' + branch.ref, function () {
          if (props.mode === 'merge') props.onMerge(branch.name, branch.ref)
          else props.onRemote(branch.name)
        }, { remote: true })
      })).concat(remotesCollapsed ? [] : more('remotes', remotes.length)).concat(tags.length > 0
        ? [query !== ''
          ? h('div', { key: 'tb', className: 'dshgit-pickgroup' }, t('picker.tags') + ' · ' + tags.length)
          : h('button', { key: 'tb', type: 'button', className: 'dshgit-pickgroup dshgit-picktoggle',
            'data-picker-toggle': 'tags', 'aria-expanded': tagsOpen,
            onClick: function () {
              setTagsOpen(!tagsOpen)
              limits[1](function (value) { return Object.assign({}, value, { tags: 5 }) })
            },
          }, [t('picker.tags') + ' · ' + tags.length,
            h('span', { key: 'arrow', className: 'dshgit-pickchev', 'aria-hidden': true }, h(IconChevron, { size: 12 }))])]
        : []).concat(visibleTags.map(function (tag) {
          return row(tag, 't:' + tag.ref, function () { if (props.onTag) props.onTag(tag) }, { tag: true })
        })).concat(tagsOpen ? more('tags', tags.length) : []).concat(nothing
          ? [h('div', { key: 'none', className: 'dshgit-empty' }, t('picker.noMatch'))]
          : [])),
    props.onOpenGit ? h('div', { key: 'workbench', className: 'dshgit-pickactions dshgit-picker-workbench' },
      h('button', { type: 'button', className: 'dshgit-pickrow', 'data-picker-open-git': true, onClick: props.onOpenGit, 'aria-label': t('window.open') },
        h('span', { className: 'dshgit-pickrowtop' }, [h(IconGit, { key: 'icon', size: 16 }), h('span', { key: 'label' }, t('window.open'))]))) : null,
  ])
}

export { BranchPicker }

import { React, h } from '../../core/runtime.js'
import { formatRelative } from '../../core/format.js'
import { IconBranchAction, IconBranchSync } from '../../ui/icons.js'
import { sortedBranches } from './model.js'

function BranchPicker(props) {
  var t = props.t
  var listRef = React.useRef(null)
  var query = props.query.toLowerCase()
  var refs = props.refs

  /**
   * One row: name (with its remote as a chip when it has one), relative date,
   * then author · sha · subject.
   *
   * A remote ref keeps its full name — it IS the identity — but its remote is
   * split out into a chip so `origin/feature/x` and a local `feature/x` are
   * told apart by shape rather than by re-reading a prefix.
   */
  var row = function (item, key, onPick, extra) {
    var remote = extra && extra.remote ? String(item.name).split('/')[0] : null
    var display = remote === null ? item.name : String(item.name).slice(remote.length + 1)
    var branch = item.ref ? item : (refs?.branches || []).find(function (branch) { return branch.name === item.name }) || Object.assign({}, item, { ref: 'refs/heads/' + item.name })
    var quick = props.mode !== 'merge' && props.branchItems && !extra?.tag ? props.branchItems(branch) : null
    var pick = h('button', {
      key: key,
      type: 'button',
      className: 'dshgit-pickrow' + (extra && extra.current === true ? ' dshgit-pickrowcurrent' : ''),
      'data-ref': item.name,
      disabled: props.busy === true || extra?.current === true,
      title: item.name,
      onClick: onPick,
    }, [
      h('span', { key: 'top', className: 'dshgit-pickrowtop' }, [
        // The remote keeps its trailing slash so the two spans concatenate back
        // into the real ref — `origin/` + `feature/x`. Dropping the separator
        // rendered `originfeature/x`, which is not a branch that exists.
        remote === null ? null : h('span', { key: 'r', className: 'dshgit-pickremote' }, remote + '/'),
        h('span', { key: 'n', className: 'dshgit-pickname' }, display),
        item.committerDate !== null && item.committerDate !== undefined
          ? h('span', { key: 'd', className: 'dshgit-pickdate' }, formatRelative(item.committerDate))
          : null,
      ]),
      extra?.current === true ? null : h('span', { key: 'meta', className: 'dshgit-pickmeta' },
        (item.author === null || item.author === undefined ? '' : item.author + ' · ') +
        (item.sha === undefined ? '' : String(item.sha).slice(0, 7)) +
        (item.subject === undefined || item.subject === '' ? '' : ' · ' + item.subject)),
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
  var locals = refs === null ? [] : orderedLocals.filter(function (branch) {
    return branch.head !== true && match(branch)
  })
  var remotes = refs === null ? [] : orderedRemotes.filter(function (branch) {
    // `origin/HEAD` is a symbolic pointer, not a checkout target.
    return !/\/HEAD$/.test(branch.ref) && match(branch)
  })
  var tags = props.mode === 'merge' || refs === null ? [] : (refs.tags || []).filter(match)
  var nothing = locals.length === 0 && remotes.length === 0 && tags.length === 0

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
        var rows = Array.from(listRef.current?.querySelectorAll?.('.dshgit-pickrow:not(:disabled)') || [])
        if (rows.length === 0) return
        event.preventDefault()
        var selected = event.key === 'ArrowUp' ? rows[rows.length - 1] : rows[0]
        if (event.key === 'Enter') selected.click?.()
        else selected.focus?.()
      },
    }),
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
      }, '+ ' + t('picker.create')),

    ]),
    h('div', { key: 'list', className: 'dshgit-picklist', ref: listRef,
      onKeyDown: function (event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        var rows = Array.from(listRef.current?.querySelectorAll?.('.dshgit-pickrow:not(:disabled)') || [])
        if (rows.length === 0) return
        event.preventDefault()
        var index = rows.indexOf(document.activeElement)
        rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus?.()
      },
    }, [
      // The current branch gets its own labelled section. Pinned above the
      // list it looked like a stray row floating under the search box, with no
      // relationship to the groups below it.
      props.mode !== 'merge' && props.current !== null && props.current !== undefined && query === ''
        ? h('div', { key: 'cb', className: 'dshgit-pickgroup' }, t('picker.current'))
        : null,
      props.mode !== 'merge' && props.current !== null && props.current !== undefined && query === ''
        ? row({ name: props.current, sha: undefined, subject: undefined, committerDate: undefined, author: undefined },
            'current', function () {}, { current: true })
        : null,
      locals.length > 0
        ? h('div', { key: 'lb', className: 'dshgit-pickgroup' }, t('picker.branches'))
        : null,
    ].concat(locals.map(function (branch) {
      return row(branch, 'l:' + branch.ref, function () {
        if (props.mode === 'merge') props.onMerge(branch.name, branch.ref)
        else props.onSwitch(branch.name)
      })
    })).concat(remotes.length > 0
      ? [h('div', { key: 'rb', className: 'dshgit-pickgroup' }, t('picker.remotes'))]
      : []).concat(remotes.map(function (branch) {
        return row(branch, 'r:' + branch.ref, function () {
          if (props.mode === 'merge') props.onMerge(branch.name, branch.ref)
          else props.onRemote(branch.name)
        }, { remote: true })
      })).concat(tags.length > 0
        ? [h('div', { key: 'tb', className: 'dshgit-pickgroup' }, t('picker.tags'))]
        : []).concat(tags.map(function (tag) {
          return row(tag, 't:' + tag.ref, function () { if (props.onTag) props.onTag(tag); else props.onSwitch(tag.name) }, { tag: true })
        })).concat(nothing
          ? [h('div', { key: 'none', className: 'dshgit-empty' }, t('picker.noMatch'))]
          : [])),
  ])
}

export { BranchPicker }

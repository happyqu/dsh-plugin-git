import { Fragment, React, h } from '../../core/runtime.js'
import { IconCheck, IconChevron, svg } from '../../ui/icons.js'
import { formatRelative, formatTime } from '../../core/format.js'
import { rewriteSelection } from './rewrite.js'

/** One ref's history is fetched only after the user expands it. */
function RefHistory(props) {
  var openState = React.useState(props.initialOpen === true)
  var open = openState[0]
  var setOpen = openState[1]
  var itemsState = React.useState([])
  var items = itemsState[0]
  var setItems = itemsState[1]
  var loadingState = React.useState(false)
  var loading = loadingState[0]
  var setLoading = loadingState[1]
  var moreState = React.useState(true)
  var more = moreState[0]
  var setMore = moreState[1]
  var t = props.t

  var load = function (skip) {
    if (loading) return
    setLoading(true)
    props.run('commits', { root: props.repo.root, ref: props.refName, limit: 20, skip: skip }, { silentError: true })
      .then(function (value) {
        var next = value.commits || []
        setItems(skip === 0 ? next : items.concat(next))
        setMore(next.length === 20)
      })
      .catch(function () { setMore(false) })
      .finally(function () { setLoading(false) })
  }
  React.useEffect(function () {
    if (open && items.length === 0 && more) load(0)
  }, [open, props.repo.root, props.refName])
  React.useEffect(function () {
    if (props.refreshToken === 0) return
    setMore(true)
    if (open) load(0)
    else setItems([])
  }, [props.refreshToken])

  return h('div', { className: 'dshgit-treeitem' }, [
    h('div', {
      key: 'row', className: 'dshgit-treerow',
      'data-ref': props.refName,
      data: props.data,
      onClick: function () { setOpen(!open) },
      onContextMenu: props.onContextMenu,
    }, [
      h('span', { key: 'caret', className: 'dshgit-caret' }, h(IconChevron, { open: open })),
      h('span', { key: 'name', className: 'dshgit-name', title: props.refName }, props.label),
      props.badge ? h('span', { key: 'badge', className: 'dshgit-muted' }, props.badge) : null,
      props.actions ? h('span', { key: 'actions', className: 'dshgit-treeactions' }, props.actions) : null,
    ]),
    open ? h('div', { key: 'children', className: 'dshgit-treechildren' }, [
      items.map(function (commit) {
        return h(TreeCommit, {
          key: commit.sha, commit: commit, repo: props.repo, run: props.run,
          selection: props.selection, onOpenCommit: props.onOpenCommit,
          onOpenRevisionFile: props.onOpenRevisionFile, t: t,
        })
      }),
      loading ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading')) : null,
      more && items.length > 0 ? h('button', {
        key: 'more', type: 'button', className: 'dshgit-btn',
        onClick: function () { load(items.length) },
      }, t('action.loadMore')) : null,
      !loading && items.length === 0 && !more
        ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.noCommits')) : null,
    ]) : null,
  ])
}


function TreeCommit(props) {
  var openState = React.useState(false)
  var open = openState[0]
  var setOpen = openState[1]
  var detailState = React.useState(null)
  var detail = detailState[0]
  var setDetail = detailState[1]
  var commit = props.commit
  React.useEffect(function () {
    if (!open || detail !== null) return
    props.run('commit', { root: props.repo.root, sha: commit.sha }, { silentError: true })
      .then(setDetail).catch(function () { setDetail({ files: [] }) })
  }, [open, props.repo.root, commit.sha])
  var selected = props.selection !== null && props.selection.sha === commit.sha
  return h('div', { className: 'dshgit-treeitem' }, [
    h('div', { key: 'row', className: 'dshgit-treerow', 'data-selected': selected,
      onClick: function () { props.onOpenCommit(commit.sha) },
    }, [
      h('button', { key: 'toggle', type: 'button', className: 'dshgit-iconbtn',
        'aria-label': props.t('label.files'), onClick: function (event) { event.stopPropagation(); setOpen(!open) },
      }, h(IconChevron, { open: open })),
      h('span', { key: 'subject', className: 'dshgit-name', title: commit.subject }, commit.subject),
      h('span', { key: 'date', className: 'dshgit-muted' }, formatRelative(commit.authorDate)),
    ]),
    open ? h('div', { key: 'files', className: 'dshgit-treechildren' },
      detail === null ? h('div', { className: 'dshgit-empty' }, props.t('state.loading'))
        : (detail.files || []).map(function (file) {
          return h('div', { key: file.path, className: 'dshgit-treerow',
            onClick: function () { props.onOpenRevisionFile(commit.sha, file.path, file.from) },
          }, [
            h('span', { key: 'status', className: 'dshgit-status' }, file.status || 'M'),
            h('span', { key: 'path', className: 'dshgit-name', title: file.path }, file.path),
          ])
        })) : null,
  ])
}


/**
 * The history module's sidebar: the searchable commit list.
 *
 * This is the old full-page history view minus its own padding assumptions —
 * the list was always the navigational half of that screen, so it moves into
 * the sidebar unchanged while the diff moves to the editor.
 */
function HistoryScope(props) {
  var ref = props.historyRef || 'HEAD'
  return h('div', { className: 'dshgit-sidebar-hint dshgit-history-scope' }, [
    h('span', { key: 'ref', className: 'dshgit-name', title: ref }, props.t('tree.commits') + ' · ' + ref.replace(/^refs\/(heads|remotes|tags)\//, '')),
    ref !== 'HEAD' && props.onResetHistory ? h('button', {
      key: 'reset', type: 'button', className: 'dshgit-iconbtn',
      title: props.t('wb.returnHead'), 'aria-label': props.t('wb.returnHead'),
      onClick: props.onResetHistory,
    }, svg({ size: 16 }, h('path', { d: 'M7 3L2 8l5 5M2 8h12', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))) : null,
  ])
}


/**
 * The action row that appears once something is ticked.
 *
 * One row, and only while there is a tick. It states what the action WILL do
 * ("Combine into 1 commit") rather than naming a mode, so the button label and
 * the outcome are the same sentence — there is no separate "enter/exit" verb
 * to learn, and no second exit control to collide with.
 *
 * When the ticks are not yet actionable it says exactly what is missing and
 * offers the one gesture that fixes it (tick the skipped rows, or clear the
 * filter hiding them), instead of disabling the action with a vague reason.
 *
 * @param props - `{ commits, selection, onTick, onClear, onRun, onClearFilter, t }`.
 */
function RewriteActionBar(props) {
  var t = props.t
  var verdict = rewriteSelection(props.commits, props.selection)
  var count = (props.selection || []).length
  if (count === 0) return null
  var reword = verdict.action === 'reword'
  var label = reword ? t('rewrite.actionReword') : t('rewrite.actionSquash')

  // The explanation line: only present when something must be fixed.
  //
  // An explicit table rather than `t('rewrite.' + reason)`, because the note needs
  // a count in two cases and none in the others — a computed key would need
  // every variant to tolerate the same parameters.
  var NOTES = { gap: 'gapNote', filtered: 'filteredNote', pushed: 'pushedNote', unordered: 'unorderedNote', stale: 'stale' }
  var note = null
  if (!verdict.ok) {
    var key = NOTES[verdict.reason]
    if (key !== undefined) {
      var hidden = verdict.reason === 'filtered'
        ? verdict.missing.filter(function (sha) { return props.visible.indexOf(sha) === -1 }).length
        : verdict.missing.length
      note = t('rewrite.' + key, { count: hidden })
    }
  }

  return h('div', { key: 'rewritebar', className: 'dshgit-rwbar', role: 'region', 'aria-label': t('rewrite.selectedCount', { count: count }), 'data-rewrite-bar': 'true' }, [
    h('div', { key: 'row', className: 'dshgit-rwbar-row' }, [
      h('span', { key: 'count', className: 'dshgit-rwbar-count' }, t('rewrite.selectedCount', { count: count })),
      note !== null ? h('span', { key: 'note', className: 'dshgit-rwbar-note' }, note) : null,
      h('span', { key: 'spacer', className: 'dshgit-rwbar-spacer' }),
      // The fix, offered only when it applies. "Tick the missing rows" is
      // deliberately not automatic: silently ticking rows the user did not
      // choose is how a rewrite ends up touching the wrong commits.
      verdict.reason === 'gap' ? h('button', { key: 'fill', type: 'button', className: 'dshgit-btn', 'data-rewrite-fill': 'true',
        onClick: function () { props.onTick(verdict.missing) } }, t('rewrite.fillGap')) : null,
      verdict.reason === 'filtered' && props.onClearFilter ? h('button', { key: 'filter', type: 'button', className: 'dshgit-btn', 'data-rewrite-clearfilter': 'true',
        onClick: props.onClearFilter }, t('rewrite.clearFilter')) : null,
      h('button', { key: 'run', type: 'button', className: 'dshgit-btn dshgit-btn-primary', 'data-rewrite-run': verdict.action || 'none',
        disabled: !verdict.ok, title: verdict.ok ? label : note || '',
        onClick: function () { if (verdict.ok) props.onRun(verdict) } }, label),
      h('button', { key: 'clear', type: 'button', className: 'dshgit-btn', onClick: props.onClear }, t('rewrite.clear')),
    ]),
  ])
}


function HistorySidebar(props) {
  var t = props.t
  var selection = props.selection2 || []
  // Alignment: the tick column is reserved when ANY row can be ticked, so a
  // list containing unpushed commits keeps its left edge straight. A list with
  // none — the common case — reserves nothing and looks exactly as it did
  // before this feature existed.
  var tickColumn = props.commits.some(function (commit) { return commit.unpublished === true })
  var visible = props.commits.map(function (commit) { return commit.sha })
  return h(Fragment, null, [
    h(HistoryScope, { key: 'ref', historyRef: props.historyRef, onResetHistory: props.onResetHistory, t: t }),
    // The action row sits directly under the scope chip and above the search
    // box, so it is visible without scrolling a long history to reach it.
    h(RewriteActionBar, { key: 'bar', commits: props.commits, selection: selection, visible: visible,
      onTick: props.onTickMany, onClear: props.onClearSelection, onRun: props.onRunRewrite,
      onClearFilter: props.onClearFilter, t: t }),
    h('div', { key: 'search', className: 'dshgit-sidebar-search' }, [
      h('input', {
        key: 'q',
        type: 'search', 'aria-label': t('placeholder.search'),
        className: 'dshgit-input',
        value: props.query,
        placeholder: t('placeholder.search'),
        onChange: function (event) { props.setQuery(event.currentTarget.value) },
      }),
    ]),
    // A path filter is active only after "File history" was chosen, so the
    // chip is shown only then rather than as a permanent empty row.
    props.historyPath
      ? h('div', { key: 'path', className: 'dshgit-filterchip', title: props.historyPath }, [
          h('span', { key: 'n', className: 'dshgit-name' }, props.historyPath),
          h('button', {
            key: 'x', type: 'button', className: 'dshgit-iconbtn',
            title: t('action.close'), 'aria-label': t('action.close'),
            onClick: props.clearHistoryPath,
          }, '×'),
        ])
      : null,
    props.error ? h('div', { key: 'error', className: 'dshgit-sidebar-hint', role: 'alert' }, [
      h('div', { key: 'message' }, t('history.loadFailed', { message: props.error })),
      h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: props.onRetry }, t('stash.retry')),
    ]) : props.loading && props.commits.length === 0
      ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))
      : props.commits.length === 0
      ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.noCommits'))
      : h('div', { key: 'list', className: 'dshgit-history-list', 'aria-busy': props.loading }, props.commits.map(function (commit) {
          var selected = props.selection !== null && (props.selection.kind === 'commit' || props.selection.kind === 'revisionFile') && props.selection.sha === commit.sha
          var ticked = props.selection2.indexOf(commit.sha) !== -1
          // Only unpushed commits can be ticked: rewriting a published commit
          // would rewrite history other clones already have.
          var tickable = commit.unpublished === true
          // The tick is its own control rather than the whole row. Ticking and
          // "show me this commit" are different intentions, and an unpushed
          // commit is exactly the one a user inspects before editing its
          // message — so the row keeps its original click behaviour.
          return h('div', { key: commit.sha, className: 'dshgit-commitwrap', 'data-ticked': ticked, 'data-unpublished': commit.unpublished === true }, [
            tickable
              ? h('button', { key: 'tick', type: 'button', className: 'dshgit-rwtick', 'data-rewrite-tick': commit.sha,
                  role: 'checkbox', 'aria-checked': ticked, title: t('rewrite.tickOne'), 'aria-label': t('rewrite.tickOne'),
                  onClick: function () { props.onTick(commit.sha) } }, ticked ? h(IconCheck, { size: 15 }) : null)
              // A spacer keeps every subject aligned when the column exists.
              : tickColumn ? h('span', { key: 'pad', className: 'dshgit-rwtick dshgit-rwtick-pad', 'aria-hidden': true }) : null,
            h('button', {
              key: 'row',
              type: 'button', 'aria-pressed': selected,
              className: 'dshgit-commitrow',
              'data-unpublished': commit.unpublished === true,
              'data-selected': selected,
              title: commit.sha + '\n' + commit.subject + '\n' + commit.author + ' · ' + formatTime(commit.authorDate) + ((commit.tips || []).length ? '\n' + commit.tips.join(', ') : ''),
              onClick: function () { props.onOpenCommit(commit.sha) },
              onContextMenu: props.onMenu ? function (event) { props.onMenu(event, commit.sha) } : undefined,
            }, [
              h('div', { key: 's', className: 'dshgit-commit-subject' }, [h('span', { key: 'text', className: 'dshgit-subject' }, commit.subject), commit.unpublished ? h('span', { key: 'unpushed', className: 'dshgit-push-indicator', title: t('state.unpublished') }, '↑ ' + t('state.unpublished')) : null]),
              h('div', { key: 'm', className: 'dshgit-meta' }, [
                h('span', { key: 'a' }, commit.author),
                h('span', { key: 'd' }, formatRelative(commit.authorDate)),
              ]),
            ]),
          ])
        })),
    props.hasMore ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn',
      disabled: props.loading, 'aria-busy': props.loading,
      style: { margin: '8px 10px' },
      onClick: props.onLoadMore,
    }, props.loading ? t('state.loading') : t('action.loadMore')) : null,
  ])
}


/** The commit list with a search box. */
function HistoryView(props) {
  var t = props.t
  return h(Fragment, null, [
    h(HistoryScope, { key: 'ref', historyRef: props.historyRef, onResetHistory: props.onResetHistory, t: t }),
    props.historyPath
      ? h('div', { key: 'path', className: 'dshgit-card dshgit-previewhead' }, [
          h('span', { key: 'name', className: 'dshgit-previewpath' }, props.historyPath),
          h('button', { key: 'clear', type: 'button', className: 'dshgit-iconbtn',
            title: t('action.close'), onClick: props.clearHistoryPath }, '×'),
        ])
      : null,
    h('div', { key: 'search', className: 'dshgit-card' }, [
      h('input', {
        key: 'q',
        className: 'dshgit-input',
        value: props.query,
        placeholder: t('placeholder.search'),
        onChange: function (event) { props.setQuery(event.currentTarget.value) },
      }),
    ]),
    props.commits.length === 0
      ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.noCommits'))
      : h('div', { key: 'list' }, props.commits.map(function (commit) {
          var selected = props.selection !== null && props.selection.kind === 'commit' && props.selection.sha === commit.sha
          return h(
            'div',
            {
              key: commit.sha,
              className: 'dshgit-commitrow', 'data-unpublished': commit.unpublished === true,
              'data-selected': selected,
              onClick: function () { props.onOpenCommit(commit.sha) },
            },
            [
              h('div', { key: 's', className: 'dshgit-commit-subject' }, [h('span', { key: 'text', className: 'dshgit-subject' }, commit.subject), commit.unpublished ? h('span', { key: 'unpushed', className: 'dshgit-push-indicator', title: t('state.unpublished') }, '↑ ' + t('state.unpublished')) : null]),
              h('div', { key: 'm', className: 'dshgit-meta' }, [
                commit.files.some(function (file) { return file.status === 'R' })
                  ? h('span', { key: 'rename', className: 'dshgit-badge' }, 'R') : null,
                h('span', { key: 'sha' }, commit.shortSha),
                h('span', { key: 'a' }, commit.author),
                h('span', { key: 'd' }, formatRelative(commit.authorDate)),
                commit.tips.length > 0 ? h('span', { key: 't' }, commit.tips.join(', ')) : null,
                commit.files.length > 0
                  ? h('span', { key: 'f' }, t('count.files', { count: commit.files.length }))
                  : null,
              ]),
            ],
          )
        })),
    props.hasMore ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn',
      onClick: props.onLoadMore,
    }, t('action.loadMore')) : null,
  ])
}

export { HistorySidebar, HistoryView }

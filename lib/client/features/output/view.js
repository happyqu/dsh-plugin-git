import { Fragment, React, h } from '../../core/runtime.js'
import { formatTime } from '../../core/format.js'

/**
 * The plugin's own git output — the `Show Git Output` view.
 *
 * Shows the argv, exit code and duration for every git command the plugin
 * ran, with stderr kept separate so a rejected push is readable. Values are
 * already credential-masked by the Host's command log.
 */
/**
 * The output module's editor: the command log itself.
 *
 * Split out of {@link OutputView} so the module can render as sidebar +
 * editor like every other module. The entries are owned by the caller now,
 * because the sidebar shows their count and would otherwise fetch the same
 * list a second time.
 *
 * @param props - `{ t, entries, filter }`.
 */
function isUnsetIdentityRead(entry) {
  return entry.code === 1 && !entry.error && !String(entry.stderr || '').trim() &&
    /^git config (?:(?:--local|--global) )?--get user\.(?:name|email)$/.test(entry.command || '')
}

function outputEntryFailed(entry) { return entry.code !== 0 && !isUnsetIdentityRead(entry) }

function OutputList(props) {
  var t = props.t
  if (props.entries === null) {
    return h('div', { className: 'dshgit-empty' }, t('state.loading'))
  }
  var entries = props.filter === 'failed'
    ? props.entries.filter(outputEntryFailed)
    : props.entries
  if (entries.length === 0) {
    return h('div', { className: 'dshgit-empty' },
      props.filter === 'failed' ? t('output.noFailures') : t('state.noChanges'))
  }
  return h('div', { className: 'dshgit-loglist' }, entries.map(function (entry) {
    return h('div', { key: entry.id, className: 'dshgit-logrow' }, [
      h('div', { key: 'head', className: 'dshgit-loghead' }, [
        h('span', {
          key: 'code',
          className: isUnsetIdentityRead(entry) ? 'dshgit-muted' : entry.code === 0 ? 'dshgit-add' : 'dshgit-logerr',
          title: entry.code === null ? undefined : 'Exit code: ' + entry.code,
        }, isUnsetIdentityRead(entry) ? '— ' + t('output.notConfigured') : entry.source === 'rpc' ? '✗ RPC' : entry.code === 0 ? '✓ 0' : '✗ ' + String(entry.code)),
        h('span', { key: 'cmd', className: 'dshgit-logcmd' }, entry.command),
        h('span', { key: 'meta', className: 'dshgit-muted' },
          formatTime(Math.floor(entry.at / 1000)) +
          (entry.durationMs === null ? '' : ' · ' + entry.durationMs + 'ms')),
      ]),
      entry.error !== null && entry.error !== undefined
        ? h('pre', { key: 'err', className: 'dshgit-logout dshgit-logerr' }, entry.error)
        : null,
      entry.stderr !== '' && entry.code !== 0
        ? h('pre', { key: 'stderr', className: 'dshgit-logout dshgit-logerr' }, entry.stderr)
        : null,
      entry.stdout !== ''
        ? h('pre', { key: 'stdout', className: 'dshgit-logout' },
            entry.stdout.length > 800 ? entry.stdout.slice(0, 800) + '…' : entry.stdout)
        : null,
    ])
  }))
}


function OutputView(props) {
  var t = props.t
  var entriesState = React.useState(null)
  var entries = entriesState[0]
  var setEntries = entriesState[1]

  var load = React.useCallback(
    function () {
      return props.run('gitOutput', { root: props.repo?.root, limit: 200 }, { silentError: true })
        .then(function (value) { setEntries(value.entries || []) })
        .catch(function () { setEntries([]) })
    },
    [props.run],
  )

  React.useEffect(function () { load() }, [load])

  return h(Fragment, null, [
    h('div', { key: 'bar', className: 'dshgit-card', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
      h('span', { key: 'n', className: 'dshgit-muted' },
        entries === null ? t('state.loading') : String(entries.length) + ' 条命令'),
      h('span', { key: 'spacer', style: { flex: '1' } }),
      h('button', { key: 'reload', type: 'button', className: 'dshgit-btn', onClick: load }, t('action.refresh')),
      h('button', {
        key: 'clear',
        type: 'button',
        className: 'dshgit-btn',
        onClick: function () {
          props.run('clearGitOutput', { root: props.repo?.root }, { silentError: true })
            .then(function () { setEntries([]) })
            .catch(function () {})
        },
      }, t('action.clearOutput')),
    ]),
    h(OutputList, { key: 'list', entries: entries, filter: 'all', t: t }),
  ])
}


/**
 * The output module's sidebar: how much is logged, and the controls.
 *
 * The filter is here rather than above the list because filtering is a
 * navigation decision ("show me only what failed"), and it keeps the editor
 * a pure reading surface.
 */
function OutputSidebar(props) {
  var t = props.t
  var entries = props.entries || []
  var failed = entries.filter(outputEntryFailed).length
  var filters = [
    { id: 'all', label: t('output.filterAll'), count: entries.length },
    { id: 'failed', label: t('output.filterFailed'), count: failed },
  ]
  return h(Fragment, null, [
    h('div', { key: 'filters', className: 'dshgit-section' }, filters.map(function (item) {
      return h('button', {
        key: item.id,
        type: 'button',
        className: 'dshgit-row dshgit-rowbtn',
        'data-selected': props.filter === item.id,
        onClick: function () { props.onFilter(item.id) },
      }, [
        h('span', { key: 'n', className: 'dshgit-name' }, item.label),
        h('span', { key: 'c', className: 'dshgit-sectioncount' }, String(item.count)),
      ])
    })),
    h('div', { key: 'actions', className: 'dshgit-sidebar-actions' }, [
      h('button', { key: 'r', type: 'button', className: 'dshgit-btn',
        onClick: props.onRefresh }, t('action.refresh')),
      h('button', { key: 'c', type: 'button', className: 'dshgit-btn',
        onClick: props.onClear }, t('action.clearOutput')),
    ]),
  ])
}

export { OutputList, OutputSidebar }

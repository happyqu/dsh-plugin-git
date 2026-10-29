/**
 * dsh-plugin-git — line attribution (blame) for the diff and file views.
 *
 * The Host half has been implemented and tested since the plugin's first month:
 * `blame`, `blameStream` and `lineHistory` all exist, with a `.git-blame-ignore-revs`
 * resolver and incremental range blaming. Nothing in the panel ever called them, so
 * the `autoBlame` / `blameChunkLines` settings existed with no effect, and the most
 * common review question — who changed this line, when, and in what commit — had no
 * answer in the GUI.
 *
 * Three decisions follow from the constraint that made the feature worth building:
 *
 * 1. **A RANGE, never the whole file by default.** Blaming a 40k-line generated file
 *    is seconds of work for lines nobody asked about. The Host caps the walk with
 *    `-L`, so this asks for a page and offers "blame the whole file" as an explicit act.
 * 2. **The commit is the unit of interaction.** A line's sha is only useful if it leads
 *    somewhere, so each row opens its commit.
 * 3. **It is a read.** `silent` requests, no busy counter, no write lock: looking at
 *    attribution must not disable the commit button.
 */
import { React, h } from '../../core/runtime.js'
import { formatRelative } from '../../core/format.js'
import { Spinner } from '../../ui/spinner.js'

/** How many lines one request asks for when blaming a page. */
const PAGE_LINES = 2000

/**
 * The blame side panel for one file.
 *
 * @param props - `{ repo, path, rev, range, run, onOpenCommit, t }`.
 *   `range` is `{ start, end }` for the visible page, or null for the whole file.
 */
function BlamePanel(props) {
  var t = props.t
  // The identity of "what was asked for". Caching by it means switching files (or
  // asking for a different page) never shows the previous answer while the new one
  // loads, which a plain `useState(null)` reset would get wrong on a fast switch.
  var key = JSON.stringify([props.repo.root, props.path, props.rev || '', props.range || null])
  var state = React.useState({ key: key, value: null, error: '', loading: true })
  var current = state[0].key === key ? state[0] : { key: key, value: null, error: '', loading: true }
  var retryState = React.useState(0)

  React.useEffect(function () {
    var active = true
    var controller = new AbortController()
    var payload = { root: props.repo.root, path: props.path }
    if (typeof props.rev === 'string' && props.rev !== '' && props.rev !== 'WORKTREE') payload.rev = props.rev
    // A range is what keeps this interactive on a large file: the Host turns it into
    // `-L`, so only the asked-for lines are walked.
    if (props.range) { payload.startLine = props.range.start; payload.endLine = props.range.end }
    // A read: no busy counter, so browsing attribution never disables a write.
    props.run('blame', payload, { silent: true, silentError: true, signal: controller.signal })
      .then(function (value) {
        if (!active) return
        state[1]({ key: key, value: value, error: '', loading: false })
      })
      .catch(function (failure) {
        // An aborted read is not a failure: the user moved on deliberately.
        if (!active || controller.signal.aborted) return
        state[1]({ key: key, value: null, error: failure.message, loading: false })
      })
    return function () { active = false; controller.abort() }
  }, [key, retryState[0]])

  var header = h('div', { key: 'head', className: 'dshgit-card' }, [
    h('div', { key: 'p', className: 'dshgit-name' }, props.path),
    h('div', { key: 'm', className: 'dshgit-meta' }, [
      current.value !== null
        ? h('span', { key: 'n' }, t('blame.lines', { count: current.value.fileLines }))
        : null,
      // A file too large to hold in the cache is still blamed for the page asked for;
      // saying so avoids "why does this stop at line 2000".
      current.value !== null && current.value.cacheable === false
        ? h('span', { key: 't', className: 'dshgit-del' }, t('state.blameTruncated'))
        : null,
    ]),
  ])

  if (current.error !== '') {
    return h('div', { key: 'panel', className: 'dshgit-blamepanel' }, [header,
      h('div', { key: 'error', role: 'alert', className: 'dshgit-card' }, [
        h('span', { key: 'm' }, current.error),
        h('button', {
          key: 'retry', type: 'button', className: 'dshgit-btn',
          onClick: function () { retryState[1](retryState[0] + 1) },
        }, t('stash.retry')),
      ]),
    ])
  }
  if (current.loading || current.value === null) {
    return h('div', { key: 'panel', className: 'dshgit-blamepanel' }, [header,
      h('div', { key: 'loading', className: 'dshgit-empty', role: 'status' }, t('state.loading')),
    ])
  }

  var blame = current.value
  var commits = {}
  for (var c = 0; c < (blame.commits || []).length; c++) commits[blame.commits[c].sha] = blame.commits[c]

  return h('div', { key: 'panel', className: 'dshgit-blamepanel', 'data-blame-path': blame.path }, [
    header,
    h('div', { key: 'rows', className: 'dshgit-blamelist' }, (blame.lines || []).map(function (line) {
      var commit = commits[line.sha] || {}
      // An unattributed line belongs to nobody yet; the zero sha is git's marker for
      // the working copy, so it gets its own label rather than an empty author cell.
      var pending = /^0+$/.test(String(line.sha))
      return h('button', {
        key: line.line, type: 'button',
        className: 'dshgit-blamerow',
        'data-blame-line': line.line,
        'data-blame-sha': line.sha,
        disabled: pending,
        title: pending ? t('blame.pending')
          : String(line.sha).slice(0, 12) + ' · ' + (commit.author || line.author || '') + '\n'
            + (commit.summary || line.summary || ''),
        onClick: function () { if (!pending) props.onOpenCommit(line.sha) },
      }, [
        h('span', { key: 'n', className: 'dshgit-blamecol dshgit-blameline' }, String(line.line)),
        h('span', { key: 'a', className: 'dshgit-blamecol' }, pending ? t('blame.pending') : (commit.author || line.author || '')),
        h('span', { key: 's', className: 'dshgit-blamecol dshgit-blamesubject' }, commit.summary || line.summary || ''),
        h('span', { key: 'd', className: 'dshgit-blamecol' },
          pending ? '' : formatRelative(line.authorTime, t)),
      ])
    })),
    props.onWholeFile
      ? h('div', { key: 'all', className: 'dshgit-blameactions' }, [
        h('button', {
          key: 'all', type: 'button', className: 'dshgit-btn', 'data-blame-all': 'true',
          onClick: props.onWholeFile,
        }, t('action.blameAll')),
      ])
      : null,
  ])
}

export { BlamePanel, PAGE_LINES }

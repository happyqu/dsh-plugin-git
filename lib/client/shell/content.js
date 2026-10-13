import { Fragment, h } from '../core/runtime.js'
import { ConflictEditor } from '../preview/conflict.js'
import { ChangelistDiffPanel } from '../features/changes/view.js'
import { DiffBody, FilePreview } from '../preview/code.js'
import { ImageDiffView } from '../preview/images.js'
import { GraphView } from '../features/branches/view.js'
import { CommitDiffView } from '../features/history/details.js'
import { HistoryView } from '../features/history/list.js'
import { PreviewModeControls, PreviewRefreshButton } from '../preview/controls.js'
import { FileDiffCard } from '../ui/file-diff.js'
import { formatRelative, formatTime } from '../core/format.js'

function CenterPane(props) {
  var t = props.t

  if (props.selection?.kind === 'file' && props.selection.file?.kind === 'unmerged') return h(ConflictEditor, { key: props.repo.root + ':' + props.selection.path, repo: props.repo, path: props.selection.path, run: props.run, onChanged: props.afterWrite, t: t })

  if (props.selection?.kind === 'file' && props.selection.section === 'working') return h(ChangelistDiffPanel, props)

  if (props.selection !== null && props.selection.kind === 'stash') {
    var stashFiles = props.diff?.files || []
    return h(Fragment, null, [
      h('div', { key: 'head', className: 'dshgit-card' },
        props.selection.ref + ' · ' + props.selection.message),
      props.diff === null ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))
        : stashFiles.length === 0 ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.emptyDiff'))
          : stashFiles.filter(function (file) {
            return props.selection.path === null || props.selection.path === file.path
          }).map(function (file) {
            return h('div', { key: file.path }, [
              h('div', { key: 'name', className: 'dshgit-card' }, file.path),
              h(DiffBody, { t: t, key: 'diff', path: file.path, hunks: file.hunks, emptyText: t('state.emptyDiff') }),
            ])
          }),
    ])
  }

  if (props.selection !== null && props.selection.kind === 'revisionFile') {
    var revision = props.selection
    var revisionDiff = (props.diff?.files || []).find(function (file) { return file.path === revision.path })
    return h(Fragment, null, [
      h('div', { key: 'head', className: 'dshgit-card dshgit-previewhead' }, [
        h('button', { key: 'back', type: 'button', className: 'dshgit-btn',
          onClick: function () { props.onOpenCommit(revision.sha) },
        }, '← ' + t('label.commit')),
        h('span', { key: 'path', className: 'dshgit-previewpath', title: revision.path,
          onContextMenu: props.onFileMenu ? function (event) { props.onFileMenu(event, { path: revision.path }) } : undefined,
        }, revision.path),
        h('button', { key: 'diff', type: 'button', className: 'dshgit-btn',
          onClick: function () { props.setFileDisplay('diff') },
        }, t('action.viewDiff')),
        h('button', { key: 'before', type: 'button', className: 'dshgit-btn',
          onClick: function () { props.viewRevisionSide('before') },
        }, t('action.viewBefore')),
        h('button', { key: 'after', type: 'button', className: 'dshgit-btn',
          onClick: function () { props.viewRevisionSide('after') },
        }, t('action.viewAfter')),
      ]),
      props.fileDisplay === 'content'
        ? h(FilePreview, { key: 'content', blob: props.fileView,
          path: props.revisionSide === 'before' ? revision.oldPath : revision.path, t: t })
        : props.diff === null
          ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))
          : props.imageDiff !== null && props.imageDiff !== undefined && props.imageDiff.image === true
            ? h(ImageDiffView, { key: 'imagediff', data: props.imageDiff, path: revision.path, t: t })
            : h(DiffBody, { t: t, key: 'diffbody', path: revision.path, hunks: revisionDiff?.hunks || props.diff.hunks,
              emptyText: t('state.emptyDiff') }),
    ])
  }

  if (props.tab === 'graph') {
    return h(GraphView, {
      graph: props.graph,
      selection: props.selection,
      onOpenCommit: props.onOpenCommit,
      t: t,
    })
  }
  if (props.tab === 'history') {
    // Selecting a commit replaces the list, so the diff for what was just
    // clicked appears where the click happened. Leaving the list up and
    // rendering the diff behind another tab made "show me this commit" a
    // no-op, which is the single most common thing a history view is for.
    if (props.selection !== null && props.selection.kind === 'commit') {
      return h(CommitDiffView, {
        commit: props.commitDetail,
        selection: props.selection,
        diff: props.diff,
        onBack: function () { props.clearSelection() },
        onOpenRevisionFile: props.onOpenRevisionFile,
        t: t,
      })
    }
    return h(HistoryView, {
      commits: props.commits,
      selection: props.selection,
      query: props.query,
      setQuery: props.setQuery,
      historyPath: props.historyPath,
      historyRef: props.historyRef,
      onResetHistory: props.onResetHistory,
      hasMore: props.commits.length >= props.historyLimit,
      onLoadMore: props.loadMoreHistory,
      clearHistoryPath: props.clearHistoryPath,
      onOpenCommit: props.onOpenCommit,
      t: t,
    })
  }

  // The changes editor shows only the current file preview.
  var parts = []
  if (props.selection !== null && props.selection.kind === 'file') {
    parts.push(h('div', { key: 'file-head', className: 'dshgit-card dshgit-previewhead' }, [
      h(PreviewRefreshButton, { key: 'refresh', stale: props.previewStale, onRefresh: props.onPreviewRefresh, busy: props.busy, t: t }),
      h('span', { key: 'path', className: 'dshgit-previewpath', title: props.selection.path,
        onContextMenu: props.onFileMenu ? function (event) { props.onFileMenu(event, props.selection.file) } : undefined,
      },
        props.selection.path + ' · ' + (props.selection.rev === 'HEAD' ? 'HEAD'
          : t(props.selection.section === 'staged' ? 'commit.stagedSection' : 'commit.unstagedSection'))),
      h(PreviewModeControls, { key: 'controls', t: t, content: props.fileDisplay === 'content', onToggle: function () {
        if (props.selection.rev === 'HEAD') props.onOpenFile(props.selection.file, 'diff', props.selection.section)
        else props.onOpenFile(props.selection.file, props.fileDisplay === 'content' ? 'diff' : 'content', props.selection.section)
      } }),
    ]))
    if (props.fileDisplay === 'content') {
      parts.push(h(FilePreview, { key: 'file-content', blob: props.fileView, path: props.selection.path, t: t }))
      return h(Fragment, null, parts)
    }
  }

  if (props.diff === null) {
    parts.push(h('div', {
      key: 'empty',
      className: 'dshgit-empty',
    }, t(props.selection === null && props.status !== null ? 'state.noChanges' : 'state.loading')))
  } else if (props.imageDiff !== null && props.imageDiff !== undefined && props.imageDiff.image === true) {
    // The text diff for an image is just "Binary files differ", so the
    // comparison replaces it rather than sitting next to it.
    parts.push(h(ImageDiffView, { key: 'imagediff', data: props.imageDiff, path: props.selection?.path, t: t }))
  } else {
    var files = props.diff.files || []
    var diffNodes = []
    for (var i = 0; i < files.length; i++) {
      diffNodes.push(h(FileDiffCard, { key: (props.selection?.section || '') + ':' + files[i].path,
        file: files[i], onFileMenu: props.onFileMenu, t: t }))
    }
    parts.push(h('div', { key: 'diff' }, diffNodes.length > 0
      ? diffNodes
      : h(DiffBody, { t: t, path: props.selection?.path, hunks: props.diff.hunks, emptyText: t('state.emptyDiff') })))
  }

  return h(Fragment, null, parts)
}


/* ------------------------------------------------------------------ *
 * Right pane: blame and commit details
 * ------------------------------------------------------------------ */

/** Render per-line attribution or commit metadata. */
function RightPane(props) {
  var t = props.t

  if (props.selection !== null && props.selection.kind === 'commit' && props.commitDetail !== null) {
    var detail = props.commitDetail
    return h(Fragment, null, [
      h('div', { key: 'card', className: 'dshgit-card' }, [
        h('div', { key: 'sha', style: { fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' } }, detail.sha),
        h('dl', { key: 'kv', className: 'dshgit-kv' }, [
          h('dt', { key: 'a' }, t('label.author')),
          h('dd', { key: 'av' }, detail.author + ' <' + detail.authorEmail + '>'),
          h('dt', { key: 'd' }, t('label.date')),
          h('dd', { key: 'dv' }, formatTime(detail.authorDate)),
          h('dt', { key: 'p' }, t('label.parents')),
          h('dd', { key: 'pv' }, detail.parents.length === 0
            ? '—'
            : detail.parents.map(function (parent) {
                return h(
                  'button',
                  {
                    key: parent,
                    type: 'button',
                    className: 'dshgit-btn',
                    style: { marginRight: '4px', fontFamily: 'ui-monospace, monospace' },
                    onClick: function () { props.onOpenCommit(parent) },
                  },
                  parent.slice(0, 7),
                )
              })),
        ]),
        h('div', { key: 'msg', className: 'dshgit-code', style: { whiteSpace: 'pre-wrap', marginTop: '6px' } }, detail.message),
        h('div', { key: 'actions', style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [
          h(
            'button',
            {
              key: 'explain',
              type: 'button',
              className: 'dshgit-btn',
              onClick: function () {
                props.run('ai.explainCommit', { root: props.repo.root, sha: detail.sha }, { silentError: true })
                  .then(function (value) {
                    if (value.available === false) {
                      alert(value.message)
                      return
                    }
                    alert(value.text)
                  })
                  .catch(function (failure) { alert(failure.message) })
              },
            },
            '✨ ' + t('action.explain'),
          ),
          h(
            'button',
            {
              key: 'copy',
              type: 'button',
              className: 'dshgit-btn',
              onClick: function () {
                try {
                  navigator.clipboard.writeText(detail.sha)
                } catch (error) {
                  // Clipboard access can be denied; the sha is on screen anyway.
                }
              },
            },
            t('action.copySha'),
          ),
        ]),
      ]),
      h('div', { key: 'files', className: 'dshgit-section' }, [
        h('div', { key: 'h', className: 'dshgit-sectionhead' }, t('label.files') + ' · ' + detail.files.length),
        h('div', { key: 'list' }, detail.files.map(function (file) {
          return h(
            'div',
            {
              key: file.path,
              className: 'dshgit-row',
              onClick: function () { props.onOpenFile({ path: file.path, kind: 'ordinary', staged: false, index: 'M', worktree: 'M' }) },
            },
            [
              h('span', { key: 's', className: 'dshgit-status' }, file.status !== undefined ? file.status : (file.added === null ? 'B' : 'M')),
              h('span', { key: 'n', className: 'dshgit-name' }, file.path),
              h('span', { key: 'c', className: 'dshgit-muted' }, [
                h('span', { key: 'a', className: 'dshgit-add' }, '+' + (file.added === null ? '?' : file.added)),
                ' ',
                h('span', { key: 'd', className: 'dshgit-del' }, '−' + (file.deleted === null ? '?' : file.deleted)),
              ]),
            ],
          )
        })),
      ]),
    ])
  }

  if (props.blameData === null || props.blameData === undefined) {
    return h('div', { className: 'dshgit-empty' }, t('state.noBlame'))
  }

  var blame = props.blameData
  var lineMap = {}
  for (var i = 0; i < blame.lines.length; i++) lineMap[blame.lines[i].line] = blame.lines[i]

  var blob = props.fileView
  var totalLines = blob !== null && blob !== undefined && typeof blob.text === 'string'
    ? blob.text.replace(/\n$/, '').split('\n')
    : null

  var header = h('div', { key: 'head', className: 'dshgit-card' }, [
    h('div', { key: 'p', className: 'dshgit-name' }, blame.path + '@' + blame.rev),
    h('div', { key: 'm', className: 'dshgit-meta' }, [
      h('span', { key: 'n' }, t('blame.lines', { count: blame.fileLines })),
      blame.cacheable === false ? h('span', { key: 't', className: 'dshgit-del' }, t('state.blameTruncated')) : null,
    ]),
    h('div', { key: 'authors', style: { marginTop: '6px' } }, (blame.authors || []).slice(0, 8).map(function (author) {
      return h('div', { key: author.name, className: 'dshgit-row' }, [
        h('span', { key: 'n', className: 'dshgit-name' }, author.name),
        h('span', { key: 'c', className: 'dshgit-muted' }, t('blame.lines', { count: author.lines })),
      ])
    })),
  ])

  var rows = []
  if (totalLines !== null) {
    for (var ln = 1; ln <= totalLines.length; ln++) {
      var entry = lineMap[ln]
      rows.push(
        h('div', { key: 'l' + ln, className: 'dshgit-coderow' }, [
          h('span', { key: 'g', className: 'dshgit-gutter' }, String(ln)),
          h(
            'span',
            {
              key: 'b',
              className: 'dshgit-blamecol',
              title: entry === undefined
                ? ''
                : entry.sha + '\n' + entry.author + '\n' + formatTime(entry.authorTime) + '\n' + entry.summary,
            },
            entry === undefined
              ? '·'
              : entry.sha.slice(0, 7) + '  ' + entry.author + '  ' + formatRelative(entry.authorTime),
          ),
          h('span', { key: 't', className: 'dshgit-codetext' }, totalLines[ln - 1]),
        ]),
      )
    }
  } else {
    for (var k = 0; k < blame.lines.length; k++) {
      var item = blame.lines[k]
      rows.push(
        h('div', { key: 'b' + item.line, className: 'dshgit-coderow' }, [
          h('span', { key: 'g', className: 'dshgit-gutter' }, String(item.line)),
          h('span', { key: 'b', className: 'dshgit-blamecol' },
            item.sha.slice(0, 7) + '  ' + item.author + '  ' + formatRelative(item.authorTime)),
        ]),
      )
    }
  }

  return h(Fragment, null, [header, h('div', { key: 'code', className: 'dshgit-code' }, rows)])
}

export { CenterPane }

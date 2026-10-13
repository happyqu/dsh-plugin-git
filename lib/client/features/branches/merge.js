import { React, h } from '../../core/runtime.js'
import { useDialogFocus } from '../../ui/controls.js'

/** Review the exact merge direction and each side's unique commits. */
function MergeReviewDialog(props) {
  var t = props.t
  var panelRef = React.useRef(null)
  useDialogFocus(panelRef, props.onClose, { opener: props.opener })
  var preview = props.preview
  var alreadyMerged = preview !== null && props.error === null && preview.incoming.length === 0
  var needsChanges = props.dirty > 0 && !alreadyMerged
  var column = function (key, title, commits) {
    return h('div', { key: key, className: 'dshgit-mergecolumn' }, [
      h('h3', { key: 'title' }, title),
      commits.length === 0
        ? h('div', { key: 'empty', className: 'dshgit-muted' }, t('merge.noCommits'))
        : commits.map(function (commit) {
            return h('div', { key: commit.sha, className: 'dshgit-mergecommit', title: commit.subject },
              String(commit.shortSha || commit.sha.slice(0, 7)) + ' · ' + commit.subject)
          }),
      commits.length >= 20
        ? h('div', { key: 'more', className: 'dshgit-muted' }, t('merge.moreCommits'))
        : null,
    ])
  }
  return h('div', { className: 'dshgit-modal', onClick: props.onClose },
    h('div', {
      className: 'dshgit-dialog', role: 'dialog', 'data-merge-review': props.source,
      ref: panelRef, tabIndex: -1, 'aria-modal': true, 'aria-label': t('merge.direction', { source: props.source, target: props.target }),
      style: { width: 'min(620px, 100%)', maxHeight: '85vh', overflowY: 'auto' },
      onClick: function (event) { event.stopPropagation() },
    }, [
      h('div', { key: 'direction', className: 'dshgit-mergehead' },
        t('merge.direction', { source: props.source, target: props.target })),
      props.remote ? h('div', { key: 'flow', className: 'dshgit-merge-remote' }, [
        h('span', { key: 'hint', className: 'dshgit-muted' }, t('merge.remoteFlow')),
        h('button', { key: 'fetch', type: 'button', className: 'dshgit-btn', 'data-merge-fetch': props.source,
          disabled: props.busy || props.fetching, 'aria-busy': props.fetching === true, title: 'git fetch', onClick: props.onFetch }, [
            props.fetching ? h('span', { key: 'spinner', className: 'dshgit-spinner', 'aria-hidden': true }) : null,
            h('span', { key: 'label' }, t('merge.fetchLatest')),
            h('span', { key: 'command', className: 'dshgit-menucommand', 'aria-hidden': true }, 'fetch'),
          ]),
      ]) : null,
      preview === null
        ? props.error === null ? h('div', { key: 'loading', className: 'dshgit-muted', role: 'status' }, t(props.fetching ? 'merge.fetching' : 'merge.loading')) : null
        : h('div', { key: 'columns', className: 'dshgit-mergecolumns' }, [
            column('incoming', t('merge.incoming'), preview.incoming),
            column('outgoing', t('merge.outgoing'), preview.outgoing),
          ]),
      props.error !== null
        ? h('div', { key: 'error', className: 'dshgit-chipnotice' }, props.error)
        : null,
      alreadyMerged
        ? h('div', { key: 'already', className: 'dshgit-hint' }, t('merge.already'))
        : props.dirty > 0
        ? h('div', { key: 'dirty', className: 'dshgit-hint' },
            t('merge.dirty', { count: props.dirty }))
        : null,
      h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
        props.error !== null && props.onRetry && !props.remote ? h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', disabled: props.busy,
          onClick: props.onRetry }, t('stash.retry')) : null,
        needsChanges
          ? h('button', { key: 'changes', type: 'button', className: 'dshgit-btn',
              'data-merge-changes': props.source, disabled: props.busy, onClick: props.onChanges }, t('merge.openChanges'))
          : null,
        needsChanges
          ? h('button', { key: 'stash', type: 'button', className: 'dshgit-btn',
              disabled: props.busy, onClick: props.onStash }, t('merge.stash'))
          : null,
        h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn',
          onClick: props.onClose }, t('action.cancel')),
        h('button', { key: 'merge', type: 'button', className: 'dshgit-btn dshgit-btn-primary',
          'data-merge-confirm': props.source,
          disabled: props.busy || props.dirty > 0 || preview === null ||
            preview.incoming.length === 0 || props.error !== null,
          onClick: props.onMerge }, t('merge.confirm')),
      ]),
    ]))
}

export { MergeReviewDialog }

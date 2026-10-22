import { React, h } from '../../core/runtime.js'
import { ComboBox } from '../../ui/controls.js'
import { HistoryFilePreview } from '../history/details.js'
import { sameWorktree } from './model.js'
import { formatTime } from '../../core/format.js'

export function WorktreeComparison(props) {
  var t = props.t, from = React.useState(props.from), to = React.useState(props.to), request = React.useState({ from: props.from, to: props.to, revision: 0 })
  var data = React.useState(null), error = React.useState(null), selected = React.useState(null), expired = React.useState(false)
  React.useEffect(function () {
    var active = true, controller = new AbortController()
    data[1](null); error[1](null); expired[1](false)
    props.run('worktreeCompare', { root: props.repo.root, from: request[0].from, to: request[0].to }, { silentError: true, signal: controller.signal })
      .then(function (result) { if (active) { data[1](result); selected[1](result.files[0]?.path || null) } })
      .catch(function (failure) { if (active) error[1](failure.message) })
    return function () { active = false; controller.abort() }
  }, [props.repo.root, props.run, request[0]])
  var compare = function (a, b) { if (a && b && !sameWorktree(a, b)) request[1](function (value) { return { from: a, to: b, revision: value.revision + 1 } }) }
  var loadFile = React.useCallback(function (file, mode, signal) {
    return props.run('worktreeCompareFile', { root: props.repo.root, token: data[0].token, path: file.path, mode: mode }, { silentError: true, signal: signal })
      .catch(function (failure) {
        if (!signal?.aborted && failure.code === 'git/worktree-snapshot-expired') expired[1](true)
        throw failure
      })
  }, [props.run, props.repo.root, data[0]?.token])
  var files = data[0]?.files || [], file = files.find(function (item) { return item.path === selected[0] })
  var options = props.trees.filter(function (tree) { return !tree.bare }).map(function (tree) { return { value: tree.path, label: tree.path, group: tree.branch?.replace(/^refs\/heads\//, '') } })
  var translatePreview = React.useCallback(function (key, values) { return t(key === 'action.viewBefore' ? 'wt.leftContent' : key === 'action.viewAfter' ? 'wt.rightContent' : key, values) }, [t])
  return h('div', { className: 'dshgit-worktree-details' }, [
    h('div', { key: 'heading', className: 'dshgit-actions' }, [
      h('div', { key: 'title', className: 'dshgit-worktree-title', style: { flex: 1 } }, t('wt.compare')),
      h('button', { key: 'back', type: 'button', className: 'dshgit-btn', onClick: props.onBack }, t('compare.back')),
    ]),
    h('p', { key: 'hint', className: 'dshgit-muted' }, t('wt.compareHint')),
    h('form', { key: 'form', className: 'dshgit-worktree-form', onSubmit: function (event) { event.preventDefault(); compare(from[0], to[0]) } }, [
      h('label', { key: 'left' }, [t('wt.left'), h(ComboBox, { key: 'select', t: t, label: t('wt.left'), value: from[0], options: options, onChange: from[1] })]),
      h('label', { key: 'right' }, [t('wt.right'), h(ComboBox, { key: 'select', t: t, label: t('wt.right'), value: to[0], options: options, onChange: to[1] })]),
      h('div', { key: 'buttons', className: 'dshgit-actions' }, [
        h('button', { key: 'compare', type: 'submit', className: 'dshgit-btn dshgit-btn-primary', disabled: sameWorktree(from[0], to[0]) }, t('wt.compareRefresh')),
        h('button', { key: 'swap', type: 'button', className: 'dshgit-btn', onClick: function () { var a = from[0]; from[1](to[0]); to[1](a); compare(to[0], a) } }, t('compare.swap')),
      ]),
    ]),
    error[0] ? h('div', { key: 'error', role: 'alert', className: 'dshgit-error' }, error[0]) : !data[0] ? h('div', { key: 'loading', role: 'status', className: 'dshgit-empty' }, t('state.loading')) : null,
    expired[0] ? h('div', { key: 'expired', role: 'alert', className: 'dshgit-worktree-form' }, [
      h('span', { key: 'message' }, t('wt.snapshotExpired')),
      h('button', { key: 'refresh', type: 'button', className: 'dshgit-btn', onClick: function () { compare(data[0].from, data[0].to) } }, t('wt.refreshSnapshot')),
    ]) : null,
    data[0] ? h('div', { key: 'scope', className: 'dshgit-muted', style: { overflowWrap: 'anywhere' } }, data[0].from + ' → ' + data[0].to + ' · ' + formatTime(Math.floor(data[0].createdAt / 1000)) + ' · ' + t('count.files', { count: files.length })) : null,
    data[0]?.skippedSubmodules?.length ? h('div', { key: 'skipped', className: 'dshgit-muted' }, t('wt.skippedSubmodules', { count: data[0].skippedSubmodules.length })) : null,
    files.length ? h(ComboBox, { key: 'files', t: t, label: t('list.searchFiles'), value: selected[0], options: files.map(function (item) { return { value: item.path, label: item.status + ' · ' + item.path } }), onChange: selected[1], placeholder: t('list.searchFiles') }) : data[0] ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.emptyDiff')) : null,
    file?.modeChanged ? h('div', { key: 'mode', className: 'dshgit-muted' }, t('wt.modeChanged')) : null,
    file && !expired[0] ? h(HistoryFilePreview, { key: data[0].token + ':' + file.path, file: file, loadFile: loadFile, t: translatePreview }) : null,
  ])
}

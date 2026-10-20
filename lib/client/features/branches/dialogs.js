import { React, h } from '../../core/runtime.js'
import { ComboBox, useDialogFocus } from '../../ui/controls.js'
import { sortedBranches } from './model.js'
import { WorkbenchPatchPreview } from './view.js'
import { usePluginConfig } from '../../core/state.js'
import { Toast } from '../../ui/notifications.js'

/** Reviewed operations share the same snapshot and confirmation surface. */
/**
 * The reword / squash dialog.
 *
 * Everything here exists to make one decision legible before it is made:
 * which commits are replaced, what the message becomes, and what the new SHAs
 * are. The dialog cannot execute anything the preview did not report, because
 * the same plan is recomputed server-side and the guard (head + branch) is
 * re-checked — so a commit landing while this is open fails the write instead
 * of being silently discarded.
 *
 * @param props - `{ repo, request: { mode, sha, shas }, run, onClose, onDone, t }`.
 */
function RewriteDialog(props) {
  var t = props.t
  var request = props.request
  // The panel hands this dialog a selection, not a mode-specific shape: one
  // ticked commit is a reword, several are a squash. Normalising here means
  // every entry point (ticks, the commit menu) speaks the same request.
  var shas = Array.isArray(request.shas) ? request.shas : (request.sha ? [request.sha] : [])
  var mode = shas.length > 1 ? 'squash' : 'reword'
  var target = { mode: mode, sha: shas[0], shas: mode === 'squash' ? shas : undefined }
  var panel = React.useRef(null)
  var planState = React.useState(null), errorState = React.useState('')
  var messageState = React.useState(''), busyState = React.useState(false)
  var config = usePluginConfig(props.run), aiBusy = React.useState(false), aiNotice = React.useState(null)
  var aiRequest = React.useRef(null), messageRef = React.useRef(messageState[0])
  messageRef.current = messageState[0]
  var pending = React.useRef(false)
  var close = function () { if (!pending.current) { aiRequest.current?.abort(); aiRequest.current = null; props.onClose() } }
  useDialogFocus(panel, close)
  var load = React.useCallback(function () {
    var active = true
    aiRequest.current?.abort(); aiRequest.current = null; aiBusy[1](false); aiNotice[1](null)
    planState[1](null)
    errorState[1]('')
    props.run('rewritePreview', {
      root: props.repo.root, mode: target.mode,
      sha: target.sha, shas: target.shas,
    }, { silent: true, silentError: true }).then(function (value) {
      if (!active) return
      planState[1](value)
      // Seed the editor with the message the operation would produce, so the
      // user edits real text rather than an empty box.
      messageState[1](value.message)
    }).catch(function (failure) { if (active) { planState[1](null); errorState[1](failure.message) } })
    return function () { active = false; aiRequest.current?.abort(); aiRequest.current = null }
  }, [props.repo.root, target.mode, target.sha, JSON.stringify(target.shas || [])])
  React.useEffect(load, [load])
  var plan = planState[0]
  var message = messageState[0]
  var messageValid = message.trim() !== '' && !message.includes('\0')
  var canRun = plan !== null && messageValid && !busyState[0] && !aiBusy[0] && (mode === 'squash' || message !== plan.message)
  var generate = async function () {
    if (!plan || busyState[0] || aiRequest.current || !config || config.aiEnabled === false) return
    var controller = new AbortController(), draft = messageRef.current
    aiRequest.current = controller; aiBusy[1](true); aiNotice[1](null)
    var notice = function (text) { aiNotice[1]({ seq: Date.now(), text: text }) }
    try {
      var value = await props.run('ai.rewriteMessage', Object.assign({ root: props.repo.root, guard: plan.guard }, target),
        { silent: true, silentError: true, signal: controller.signal })
      if (controller.signal.aborted || aiRequest.current !== controller) return
      if (value.available === false) return notice(value.message)
      if (typeof value.message !== 'string' || !value.message.trim()) return notice(t('ai.emptyResult'))
      if (messageRef.current !== draft) return notice(t('ai.draftChanged'))
      messageState[1](value.message)
    } catch (failure) {
      if (!controller.signal.aborted && aiRequest.current === controller) notice(failure.code === 'git/unknown-method' ? t('workflow.reloadHost') : failure.message)
    } finally {
      if (aiRequest.current === controller) { aiRequest.current = null; aiBusy[1](false) }
    }
  }
  var execute = function () {
    if (!canRun) return
    pending.current = true; busyState[1](true); errorState[1]('')
    props.run('write.rewriteCommits', {
      root: props.repo.root, mode: target.mode, sha: target.sha, shas: target.shas,
      message: message, guard: plan.guard, confirm: true,
    }, { silent: true, silentError: true }).then(function (value) {
      pending.current = false
      props.onDone(value)
    }).catch(function (failure) {
      pending.current = false; busyState[1](false)
      errorState[1](failure.message)
      // The plan is no longer trustworthy after a refusal, so reload it.
      load()
    })
  }
  return h('div', { className: 'dshgit-modal', onClick: close }, h('div', {
    className: 'dshgit-dialog dshgit-rewrite-dialog', role: 'dialog', 'aria-modal': true,
    'aria-label': t(mode === 'squash' ? 'rewrite.squashTitle' : 'rewrite.rewordTitle'),
    ref: panel, tabIndex: -1, 'data-rewrite-dialog': mode,
    onClick: function (event) { event.stopPropagation() },
  }, [
    h('div', { key: 'title', className: 'dshgit-dialogtitle' },
      t(mode === 'squash' ? 'rewrite.squashTitle' : 'rewrite.rewordTitle')),
    // The one sentence that matters before a history rewrite: none of this is
    // published yet, so only this clone is affected.
    h('div', { key: 'scope', className: 'dshgit-lfs-advice' }, t('rewrite.unpushedOnly')),
    errorState[0] ? h('div', { key: 'error', className: 'dshgit-lfs-danger', role: 'alert' }, errorState[0]) : null,
    plan === null && errorState[0] === ''
      ? h('div', { key: 'loading', className: 'dshgit-muted', role: 'status' }, t('state.loading'))
      : null,
    plan !== null ? h('div', { key: 'commits', className: 'dshgit-lfs-section' }, [
      h('div', { key: 'label', className: 'dshgit-lfs-steplabel' },
        t(mode === 'squash' ? 'rewrite.commitsToSquash' : 'rewrite.commitToReword')),
      h('div', { key: 'list', className: 'dshgit-rewrite-list' }, plan.commits.map(function (commit) {
        return h('div', { key: commit.sha, className: 'dshgit-rewrite-commit' }, [
          h('code', { key: 'sha', className: 'dshgit-rewrite-sha' }, commit.shortSha),
          h('span', { key: 'subject', className: 'dshgit-rewrite-subject', title: commit.message }, commit.subject),
          h('span', { key: 'author', className: 'dshgit-muted' }, commit.authorName),
        ])
      })),
      plan.replayed.length > 0 ? h('div', { key: 'replayed', className: 'dshgit-muted' },
        t('rewrite.willReplay', { count: plan.replayed.length })) : null,
    ]) : null,
    plan !== null ? h('label', { key: 'message', className: 'dshgit-field' }, [
      h('span', { key: 'label', className: 'dshgit-rewrite-message-head' }, [
        h('span', { key: 'text', className: 'dshgit-fieldlabel' }, t(mode === 'squash' ? 'rewrite.squashedMessage' : 'rewrite.newMessage')),
        config && config.aiEnabled !== false ? h('button', { key: 'ai', type: 'button', className: 'dshgit-iconbtn',
          title: t('action.generateMessage'), 'aria-label': t('action.generateMessage'), 'aria-busy': aiBusy[0], disabled: busyState[0] || aiBusy[0], onClick: generate },
          aiBusy[0] ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : h('span', { 'aria-hidden': true }, '✨')) : null,
      ]),
      h('textarea', { key: 'input', className: 'dshgit-textarea dshgit-rewrite-message', value: message,
        disabled: busyState[0], 'aria-label': t('rewrite.newMessage'), rows: 5,
        onChange: function (event) { messageState[1](event.currentTarget.value) } }),
    ]) : null,
    aiNotice[0] ? h(Toast, { key: 'ai-notice', seq: aiNotice[0].seq, text: aiNotice[0].text, tone: 'warning', onDone: function () { aiNotice[1](null) } }) : null,
    plan !== null ? h('div', { key: 'hint', className: 'dshgit-muted' }, t('rewrite.shaHint')) : null,
    plan !== null && plan.replayed.length > 0 ? h('details', { key: 'replay', className: 'dshgit-lfs-advanced' }, [
      h('summary', { key: 'summary' }, t('rewrite.replayedTitle')),
      plan.replayed.map(function (commit) {
        return h('div', { key: commit.sha, className: 'dshgit-rewrite-commit' }, [
          h('code', { key: 'sha', className: 'dshgit-rewrite-sha' }, commit.shortSha),
          h('span', { key: 'subject', className: 'dshgit-rewrite-subject' }, commit.subject),
        ])
      }),
    ]) : null,
    h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
      h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', disabled: busyState[0], onClick: close }, t('action.cancel')),
      h('button', { key: 'run', type: 'button', className: 'dshgit-btn dshgit-btn-primary', 'data-rewrite-confirm': mode,
        disabled: !canRun, onClick: execute },
        busyState[0] ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : t(mode === 'squash' ? 'rewrite.squashAction' : 'rewrite.rewordAction')),
    ]),
  ]))
}


function WorkbenchDialog(props) {
  var t = props.t, request = props.request, subject = request.subject || {}, action = request.action
  var remoteBranch = /^refs\/remotes\//.test(subject.ref || '')
  var tagStart = action === 'createBranch' && /^refs\/tags\//.test(subject.ref || '')
  var compactBranchForm = action === 'createBranch' || action === 'checkout'
  var fixedStart = (remoteBranch || tagStart) && action === 'createBranch'
  var remoteName = remoteBranch ? subject.remoteName || subject.ref.slice(13).split('/')[0] : ''
  var localName = remoteBranch ? subject.ref.slice(14 + remoteName.length) : (subject.name || '')
  var upstreamRef = subject.upstreamRef || (subject.upstream ? (subject.upstream.startsWith('refs/') ? subject.upstream : 'refs/remotes/' + subject.upstream) : '')
  var worktreeNeedsBranch = remoteBranch || subject.head || subject.occupied
  var valuesState = React.useState({ name: action === 'addWorktree' ? localName + '-worktree' : action === 'createTag' ? '' : action === 'renameBranch' ? localName : remoteBranch ? localName : (request.extras || {}).prefix || '',
    directory: '', newBranch: !!worktreeNeedsBranch,
    startPoint: subject.ref || subject.sha || 'HEAD', checkout: true, track: remoteBranch, existing: '',
    mode: 'soft', pullStrategy: 'ff', backup: ['resetTo', 'undoCommit', 'rebase', 'commit'].indexOf(action) >= 0,
    stash: false, acknowledge: false, force: false, noFf: false, noCommit: false, mainline: '1',
    message: '', remote: remoteName || (request.extras || {}).remote || '', targetBranch: localName, upstream: upstreamRef, prune: false })
  var values = valuesState[0], previewState = React.useState(null), preview = previewState[0]
  var actionLabel = t(tagStart ? 'wb.createBranchFromTag' : 'wb.' + action)
  var errorState = React.useState(''), loadingState = React.useState(true), busyState = React.useState(false)
  var remotesState = React.useState([]), retryState = React.useState(0), panel = React.useRef(null)
  var pending = React.useRef(false)
  var close = function () { if (!pending.current) props.onClose() }
  useDialogFocus(panel, close)
  var set = function (key, value) {
    // A failed write invalidates its guard. Editing an option should fetch
    // a fresh review so the corrected action can be retried in this dialog.
    if (!pending.current && !preview && errorState[0] && !loadingState[0]) {
      loadingState[1](true)
      retryState[1](function (current) { return current + 1 })
    }
    valuesState[1](function (old) {
    var next = Object.assign({}, old); next[key] = value
    if (key === 'startPoint' && /^refs\/remotes\//.test(value)) {
      next.track = true
      if (!old.name) next.name = value.slice(13).split('/').slice(1).join('/')
    }
    return next
  }) }
  var refs = props.refs || {}
  var locals = React.useMemo(function () { return sortedBranches(refs.branches) }, [refs.branches])
  var remotes = React.useMemo(function () { return sortedBranches(refs.remotes).filter(function (ref) { return !ref.symbolic }) }, [refs.remotes])
  var proposedName = values.name.trim(), nameError = ''
  var needsName = action === 'renameBranch' || action === 'createBranch' || action === 'createTag' || (action === 'addWorktree' && values.newBranch) || (action === 'checkout' && remoteBranch && !values.existing)
  var directoryValid = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(values.directory.trim()) && !/[\0\r\n]/.test(values.directory)
  if (needsName && proposedName) {
    var nameRefs = action === 'createTag' ? refs.tags || [] : locals
    if (/^[\-\/]|\/$|\/\/|\.\.|@\{|[\s\x00-\x1f\x7f~^:?*\[\\]/.test(proposedName) || proposedName === '@' || (action !== 'createTag' && proposedName === 'HEAD') || proposedName.endsWith('.') || proposedName.split('/').some(function (part) { return part.startsWith('.') || part.endsWith('.lock') })) nameError = t(action === 'createTag' ? 'wb.invalidTagName' : 'wb.invalidName')
    else if (nameRefs.some(function (ref) { return ref.name !== (action === 'renameBranch' ? subject.name : null) && (ref.name === proposedName || ref.name.startsWith(proposedName + '/') || proposedName.startsWith(ref.name + '/')) })) nameError = t(action === 'createTag' ? 'wb.tagNameConflict' : 'wb.nameConflict')
  }
  var target = action === 'createBranch' || (action === 'checkout' && remoteBranch) ? values.startPoint : subject.ref || subject.sha
  var previewKey = JSON.stringify([target, values.upstream, values.existing, values.mainline])
  var ready = preview && preview.reviewKey === previewKey
  var branchFiles = props.status?.files || preview?.files || []
  var branchDirty = props.status ? branchFiles.length > 0 : !!preview?.dirty
  var otherBranchPull = action === 'pull' && preview && preview.branch !== subject.ref && preview.branch !== subject.name
  React.useEffect(function () {
    var active = true
    if (action === 'createBranch') return
    props.run('remotes', { root: props.repo.root }, { silentError: true }).then(function (result) {
      if (!active) return
      var list = Array.isArray(result) ? result : result.remotes || []
      remotesState[1](list)
      var upstreamRemote = list.filter(function (remote) { return upstreamRef.startsWith('refs/remotes/' + remote.name + '/') }).sort(function (a, b) { return b.name.length - a.name.length })[0]
      if (!values.remote && list.length) {
        set('remote', upstreamRemote ? upstreamRemote.name : list[0].name)
        if (action === 'push' && upstreamRemote) set('targetBranch', upstreamRef.slice(14 + upstreamRemote.name.length))
      }
    }).catch(function () {})
    return function () { active = false }
  }, [props.repo.root])
  React.useEffect(function () {
    var active = true
    loadingState[1](true); errorState[1](''); previewState[1](null)
    var references = values.upstream ? [values.upstream] : []
    if (values.existing) references.push('refs/heads/' + values.existing)
    props.run('workbenchPreview', { root: props.repo.root, target: target, refs: references, action: action, path: subject.path, mainline: Number(values.mainline) }, { silentError: true }).then(function (result) {
      if (!active) return
      previewState[1](Object.assign({}, result, { reviewKey: previewKey })); loadingState[1](false)
      if ((action === 'commit' || action === 'undoCommit') && result.commit && !values.message) set('message', result.commit.message || result.commit.subject)
      if (action === 'revert' && result.commit && !values.message) set('message', 'Revert "' + result.commit.subject + '"\n\nThis reverts commit ' + result.commit.sha + '.')
    }).catch(function (failure) { if (active) { errorState[1](failure.message); loadingState[1](false) } })
    return function () { active = false }
  }, [props.repo.root, target, values.upstream, values.existing, values.mainline, retryState[0]])
  var field = function (key, label, options) {
    return h('label', { key: key, className: 'dshgit-workbench-field' }, [h('span', { key: 'label' }, label),
      options ? h(ComboBox, { key: 'input', value: values[key], disabled: busyState[0], options: options, searchable: options.length > 6, t: t, label: label,
        onChange: function (value) { set(key, value) } }) : h(key === 'message' ? 'textarea' : 'input', { key: 'input', value: values[key], disabled: busyState[0], autoFocus: action === 'createBranch' && key === 'name', 'aria-label': label, name: key, onChange: function (event) { set(key, event.target.value) } })])
  }
  var check = function (key, label) { return h('label', { key: key, className: 'dshgit-check' }, [
    h('input', { key: 'input', type: 'checkbox', checked: values[key], disabled: busyState[0], onChange: function (event) { set(key, event.target.checked) } }), label]) }
  var allRefs = [{ value: 'HEAD', label: t('label.startPointHead') }].concat(locals.concat(remotes).map(function (ref) { return { value: ref.ref, label: ref.name } }))
  if (target && !allRefs.some(function (ref) { return ref.value === target })) allRefs.unshift({ value: target, label: target })
  var fields = []
  if (action === 'createBranch' || (action === 'checkout' && remoteBranch)) {
    fields.push(field('name', t('wb.name')), fixedStart ? h('div', { key: 'startPoint', className: 'dshgit-workbench-field' }, [
      h('span', { key: 'label' }, t('wb.start')), h('span', { key: 'value', className: 'dshgit-name', title: subject.ref }, subject.name || subject.ref.replace(/^refs\/(remotes|tags)\//, '')),
    ]) : field('startPoint', t('wb.start'), allRefs))
    if (action === 'checkout' && remoteBranch && locals.length) fields.push(field('existing', t('wb.existingBranch'), [{ value: '', label: t('wb.createBranch') }].concat(locals.map(function (ref) { return { value: ref.name, label: ref.name } }))))
    if (locals.some(function (ref) { return ref.name === values.name.trim() }) && !values.existing) fields.push(h('div', { key: 'exists', role: 'status', className: 'dshgit-muted' }, t('wb.branchExists')))
    if (action === 'createBranch' && !tagStart) fields.push(check('checkout', t('wb.switchAfter')))
    if (/^refs\/remotes\//.test(values.startPoint)) fields.push(check('track', t('wb.track')))
  }
  if (action === 'renameBranch') fields.push(field('name', t('wb.name')))
  if (action === 'createTag') fields.push(field('name', t('wb.tagName')), field('message', t('wb.tagMessage')),
    h('div', { key: 'tagHint', className: 'dshgit-muted' }, t('wb.tagHint')))
  if (action === 'addWorktree') {
    fields.push(field('directory', t('wb.worktreeDirectory')), h('div', { key: 'worktreeHint', className: 'dshgit-muted' }, t('wb.worktreeHint')))
    if (worktreeNeedsBranch) fields.push(h('div', { key: 'worktreeOccupied', className: 'dshgit-muted' }, t(remoteBranch ? 'wb.track' : 'wb.worktreeOccupied')))
    else fields.push(check('newBranch', t('wb.worktreeNewBranch')))
    if (values.newBranch) fields.push(field('name', t('wb.name')))
    if (remoteBranch) fields.push(check('track', t('wb.track')))
  }
  if (nameError) fields.push(h('div', { key: 'nameError', role: 'alert', className: 'dshgit-error' }, nameError))
  if (action === 'push' || action === 'fetch') {
    if (action !== 'fetch' || !remoteBranch) fields.push(field('remote', t('wb.remote'), (action === 'fetch' ? [{ value: '', label: t('wb.all') }] : []).concat(remotesState[0].map(function (remote) { return { value: remote.name, label: remote.name } }))))
    if (action === 'push') fields.push(field('targetBranch', t('wb.target')))
    else fields.push(check('prune', t('wb.prune')))
  }
  if (action === 'setUpstream') fields.push(field('upstream', t('wb.upstream'), [{ value: '', label: t('wb.noUpstream') }].concat(remotes.map(function (ref) { return { value: ref.ref, label: ref.name } }))))
  if (action === 'pull') fields.push(h('div', { key: 'upstream', className: 'dshgit-muted' }, t('wb.upstream') + ': ' + (subject.upstream || upstreamRef)),
    otherBranchPull ? h('div', { key: 'pullHint', className: 'dshgit-muted' }, t('wb.pullOtherBranch')) : field('pullStrategy', t('wb.pullStrategy'), [{ value: 'ff', label: t('wb.pullFf') }, { value: 'merge', label: t('wb.pullMerge') }, { value: 'rebase', label: t('wb.pullRebase') }]))
  if (action === 'resetTo') fields.push(field('mode', 'Reset', ['soft', 'mixed', 'hard'].map(function (mode) { return { value: mode, label: t('wb.' + mode) } })))
  if (action === 'merge') fields.push(check('noFf', t('wb.noFf')))
  if (action === 'revert' || action === 'cherryPick') fields.push(check('noCommit', t('wb.noCommit')))
  if (action === 'commit') fields.push(field('message', t('wb.message')))
  if (action === 'revert' && !values.noCommit) fields.push(field('message', t('wb.message')))
  if (action === 'revert' && preview && preview.commit && preview.commit.parents.length > 1) fields.push(field('mainline', t('wb.parent'), preview.commit.parents.map(function (sha, index) { return { value: String(index + 1), label: String(index + 1) + ' · ' + sha.slice(0, 10) } })))
  if (action === 'deleteBranch' && !remoteBranch) fields.push(check('force', t('wb.force')))
  if (['resetTo', 'undoCommit', 'rebase', 'commit'].indexOf(action) >= 0) fields.push(check('backup', t('wb.backup')))
  if ((compactBranchForm ? branchDirty : preview?.dirty) && !otherBranchPull && ['checkout', 'createBranch', 'merge', 'pull', 'rebase', 'cherryPick', 'revert', 'resetTo'].indexOf(action) >= 0) fields.push(check('stash', t('wb.stash') + (compactBranchForm ? ' (' + branchFiles.length + ')' : '')))
  if (action === 'resetTo' && values.mode === 'hard') fields.push(check('acknowledge', t('wb.understand')))
  var submit = function (event) {
    if (event) event.preventDefault()
    if (!ready || pending.current) return
    if (nameError) { errorState[1](nameError); return }
    var parameters = {}, operation = action, upstream = null
    var fail = function (message) { errorState[1](message) }
    if (preview.operation && ['fetch', 'push', 'setUpstream'].indexOf(action) < 0) return fail(t('wb.busyOperation'))
    if (['merge', 'pull', 'rebase', 'revert', 'cherryPick'].indexOf(action) >= 0 && !otherBranchPull && preview.dirty && !values.stash) return fail(t('wb.cleanFirst'))
    if (action === 'resetTo' && values.mode === 'hard' && !values.acknowledge) return fail(t('wb.understand'))
    if (action === 'undoCommit' && (!preview.commit || !preview.commit.parents.length)) return fail(t('wb.rootUndo'))
    if (action === 'cherryPick' && preview.commit && preview.commit.parents.length > 1) return fail(t('wb.parent'))
    if (action === 'createBranch' || (action === 'checkout' && remoteBranch && !values.existing)) {
      if (!values.name.trim()) return fail(t('error.branchName'))
      if (locals.some(function (branch) { return branch.name === values.name.trim() })) return fail(t('wb.branchExists'))
      operation = 'createBranch'; parameters = { name: values.name.trim(), startPoint: values.startPoint, checkout: action === 'checkout' || values.checkout, track: false }
      if (values.track && /^refs\/remotes\//.test(values.startPoint)) upstream = values.startPoint
    } else if (action === 'checkout') parameters = { ref: values.existing || subject.ref, detached: /^refs\/tags\//.test(subject.ref || '') }
    else if (action === 'createTag') {
      if (!proposedName || !preview.target) return
      parameters = { name: proposedName, ref: preview.target, message: values.message.trim() }
    }
    else if (action === 'renameBranch') parameters = { from: subject.name, to: values.name.trim() }
    else if (action === 'deleteBranch') parameters = { name: remoteBranch ? localName : subject.name, remote: remoteBranch, remoteName: remoteName, force: values.force }
    else if (action === 'push') parameters = { remote: values.remote, sourceBranch: subject.name, targetBranch: values.targetBranch.trim(), setUpstream: true }
    else if (action === 'fetch') parameters = { remote: values.remote || undefined, all: !values.remote, prune: values.prune,
      branch: remoteBranch ? localName : values.remote && upstreamRef.startsWith('refs/remotes/' + values.remote + '/') ? upstreamRef.slice(14 + values.remote.length) : undefined }
    else if (action === 'pull') {
      if (!upstreamRef) return fail(t('wb.pullNeedsUpstream'))
      parameters = { name: subject.name, upstream: upstreamRef, ffOnly: otherBranchPull || values.pullStrategy === 'ff', rebase: !otherBranchPull && values.pullStrategy === 'rebase', merge: !otherBranchPull && values.pullStrategy === 'merge' }
    }
    else if (action === 'addWorktree') {
      if (!directoryValid) return fail(t('wb.worktreePathRequired'))
      if (values.newBranch && !proposedName) return fail(t('error.branchName'))
      parameters = { directory: values.directory.trim(), ref: subject.ref, name: values.newBranch ? proposedName : undefined, track: remoteBranch && values.track }
    }
    else if (action === 'setUpstream') parameters = { name: subject.name, upstream: values.upstream }
    else if (action === 'resetTo') parameters = { ref: preview.target, mode: values.mode }
    else if (action === 'undoCommit') parameters = { originalMessage: values.message, expectedHead: preview.target }
    else if (action === 'merge' || action === 'rebase') parameters = { ref: preview.target, noFf: values.noFf }
    else if (action === 'revert' || action === 'cherryPick') parameters = { sha: preview.target, noCommit: values.noCommit, mainline: Number(values.mainline), message: values.message }
    else if (action === 'commit') parameters = { amend: true, message: values.message, expectedHead: preview.target }
    else if (action === 'restoreRevision') parameters = { ref: preview.target, path: subject.path }
    pending.current = true; busyState[1](true); errorState[1]('')
    props.execute({ action: operation, parameters: parameters, upstream: upstream, guard: preview.guard, backup: values.backup, stashFirst: values.stash }).then(function (result) {
      if (!result) throw new Error(t('action.failed'))
      if (action === 'addWorktree' && props.onWorktreeOpen) props.onWorktreeOpen(values.directory.trim())
      pending.current = false; props.onClose()
    }).catch(function (failure) { pending.current = false; busyState[1](false); errorState[1](failure.message); previewState[1](null) })
  }
  return h('div', { className: 'dshgit-modal', onClick: close }, h('form', {
    className: 'dshgit-dialog dshgit-workbench-dialog' + (compactBranchForm ? ' dshgit-createbranch-dialog' : ''), role: 'dialog', 'aria-modal': true, 'aria-label': actionLabel, ref: panel, tabIndex: -1,
    onClick: function (event) { event.stopPropagation() }, onSubmit: submit,
  }, [h('div', { key: 'title', className: 'dshgit-dialogtitle' }, actionLabel),
    action === 'createBranch' ? null : h('div', { key: 'direction', className: 'dshgit-muted' }, action === 'checkout'
      ? (props.status?.branch?.head || 'HEAD') + ' → ' + (subject.name || subject.sha || subject.ref || '')
      : ['rebase', 'resetTo'].indexOf(action) >= 0 && preview
      ? (preview.branch || 'HEAD') + ' → ' + (subject.name || subject.sha || subject.ref || '')
      : (subject.name || subject.path || subject.sha || '') + (['merge', 'cherryPick', 'revert'].indexOf(action) >= 0 && preview ? ' → ' + (preview.branch || 'HEAD') : '')),
    loadingState[0] && !compactBranchForm ? h('div', { key: 'loading', role: 'status' }, h('span', { className: 'dshgit-spinner' })) : null,
    preview && !compactBranchForm ? h('div', { key: 'preview', className: 'dshgit-workbench-preview' }, [
      action === 'createTag' ? h('div', { key: 'tagTarget' }, t('wb.tagTarget') + ': ' + (subject.name || subject.sha || subject.ref || '') + ' · ' + (preview.target || '').slice(0, 10)) : null,
      action === 'createBranch' ? null : h('div', { key: 'head' }, (otherBranchPull ? subject.name : preview.branch || 'HEAD') + ' · ' + (otherBranchPull ? preview.target || '' : preview.head || '').slice(0, 10)),
      action !== 'createBranch' && preview.commit ? h('div', { key: 'commit' }, preview.commit.sha.slice(0, 10) + ' · ' + preview.commit.subject) : null,
      preview.dirty && !otherBranchPull ? h('div', { key: 'dirty' }, t('wb.dirty') + ': ' + preview.files.length) : null,
      action === 'checkout' && /^refs\/tags\//.test(subject.ref || '') ? h('div', { key: 'detached' }, t('wb.detachedNotice')) : null,
      ['resetTo', 'undoCommit', 'commit', 'rebase'].indexOf(action) >= 0 ? h('div', { key: 'published', className: 'dshgit-muted' }, preview.publishedRefs.length ? t('wb.published') : t('wb.unknown')) : null,
      action === 'resetTo' ? h('details', { key: 'lost' }, [h('summary', { key: 'summary' }, t('wb.lost') + ': ' + preview.lostCount), preview.lost.map(function (commit) { return h('div', { key: commit.sha }, commit.sha.slice(0, 8) + ' ' + commit.subject) })]) : null,
      action === 'deleteBranch' && remoteBranch ? h('div', { key: 'warning' }, t('wb.remoteDelete')) : null,
      ['merge', 'rebase', 'deleteBranch'].indexOf(action) >= 0 ? h('details', { key: 'incoming' }, [h('summary', { key: 'summary' }, t('merge.incoming') + ': ' + (preview.incomingCount || 0)), (preview.incoming || []).map(function (commit) { return h('div', { key: commit.sha }, commit.sha.slice(0, 8) + ' ' + commit.subject) })]) : null,
      action === 'undoCommit' && preview.commit ? h('div', { key: 'parent' }, t('wb.target') + ': ' + (preview.commit.parents[0] || t('wb.rootUndo'))) : null,
      action === 'commit' ? h('div', { key: 'amend' }, t('wb.amendNotice')) : null,
      action === 'rebase' ? h('details', { key: 'replay' }, [h('summary', { key: 'summary' }, t('wb.replay') + ': ' + preview.lostCount), preview.lost.map(function (commit) { return h('div', { key: commit.sha }, commit.sha.slice(0, 8) + ' ' + commit.subject) })]) : null,
      action === 'revert' && preview.commit?.parents.length > 1 ? h('div', { key: 'mergeNotice' }, t('wb.revertMergeNotice')) : null,
      action === 'resetTo' && values.mode === 'hard' ? h('details', { key: 'paths' }, [h('summary', { key: 'summary' }, t('wb.dirty') + ': ' + preview.files.length), preview.files.map(function (file) { return h('div', { key: file.path }, file.path) })]) : null,
      ['resetTo', 'undoCommit', 'revert', 'commit', 'rebase'].indexOf(action) >= 0 ? h('div', { key: 'local', className: 'dshgit-muted' }, t('wb.noAutoPush')) : null,
    ]) : null,
    tagStart ? h('div', { key: 'tagNotice', className: 'dshgit-muted' }, t('wb.tagBranchNotice')) : null,
  ].concat(fields).concat([
    preview?.coordinates && ['resetTo', 'revert', 'cherryPick', 'restoreRevision', 'commit', 'merge', 'rebase'].indexOf(action) >= 0 ? h(WorkbenchPatchPreview, { key: JSON.stringify(preview.coordinates), preview: preview, repo: props.repo, run: props.run, t: t, label: action === 'merge' ? t('wb.sourceChanges') : null }) : null,
    errorState[0] ? h('div', { key: 'error', role: 'alert', className: 'dshgit-error' }, errorState[0]) : null,
    h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
      action !== 'createBranch' || errorState[0] ? h('button', { key: 'refresh', type: 'button', className: 'dshgit-btn', disabled: busyState[0], onClick: function () { retryState[1](function (value) { return value + 1 }) } }, t('action.refresh')) : null,
      h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', disabled: busyState[0], onClick: close }, t('action.cancel')),
      h('button', { key: 'submit', type: 'submit', className: 'dshgit-btn ' + (action === 'deleteBranch' || (action === 'resetTo' && values.mode === 'hard') ? 'dshgit-btn-danger' : 'dshgit-btn-primary'), disabled: !ready || !!nameError || (needsName && !proposedName) || (action === 'addWorktree' && !directoryValid) || loadingState[0] || busyState[0] || (action === 'undoCommit' && !preview?.commit?.parents.length) }, busyState[0] ? h('span', { className: 'dshgit-spinner' }) : actionLabel),
    ]),
  ])))
}

export { RewriteDialog, WorkbenchDialog }

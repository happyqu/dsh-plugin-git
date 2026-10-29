import { React, ReactDOM, h } from '../../core/runtime.js'
import { registerNavigationGuard, navigate, approveNavigation } from '../../core/navigation.js'
import { readDraft, saveDraft, clearDraft, conflictBlocks } from './model.js'
import { useDialogFocus } from '../../ui/controls.js'
import { Toast } from '../../ui/notifications.js'
import { ConflictVersion, ConflictResult } from './compare.js'
import { operationReviewText } from './operation-review.js'
import { ConflictSplitHandle } from './layout.js'
import { canSkipOperation } from '../../../shared/operation.js'

function ConflictQuestion(props) {
  var panel = React.useRef(null)
  useDialogFocus(panel, props.onCancel, { cancelFirst: true })
  return ReactDOM.createPortal(h('div', { className: 'dshgit-modal', style: { zIndex: 1900 }, onClick: props.onCancel }, h('div', { ref: panel, tabIndex: -1, className: 'dshgit-dialog dshgit-conflict-question', role: 'alertdialog', 'aria-modal': true, 'aria-label': props.title, onClick: function (event) { event.stopPropagation() } }, [
    h('strong', { key: 'title' }, props.title), h('div', { key: 'text' }, props.text),
    h('div', { key: 'actions', className: 'dshgit-dialogactions' }, props.actions.concat([{ label: props.t('action.cancel'), run: props.onCancel }]).map(function (action, index) { return h('button', { key: index, type: 'button', className: 'dshgit-btn', onClick: action.run }, action.label) })),
  ])), document.body)
}

function ConflictEditor(props) {
  var t = props.t, root = props.repo.root, path = props.path
  var value = React.useState(null), draft = React.useState(''), choice = React.useState('text'), busy = React.useState(false), notice = React.useState(null), question = React.useState(null), status = React.useState(null), stale = React.useState(false), sideView = React.useState('ours')
  var alive = React.useRef(true), epoch = React.useRef(0), request = React.useRef(null), dirty = React.useRef(false), restored = React.useRef(null), readFailure = React.useState(false)
  var lastEdit = React.useRef(null), toolToken = React.useState(null)
  var report = function (failure, tone) { if (alive.current) notice[1]({ seq: Date.now(), text: typeof failure === 'string' ? failure : failure.message, tone: tone || 'error' }) }
  var notify = function () { Promise.resolve().then(function () { return props.onChanged?.() }).catch(function (failure) { report(failure) }) }
  var call = function (method, body, signal) { return props.run(method, Object.assign({ root: root }, body), { silent: true, silentError: true, signal: signal }) }
  var refreshStatus = async function () { var next = await call('status', { force: true }); if (alive.current) status[1](next); return next }
  var load = async function () {
    lastEdit.current = null
    var id = ++epoch.current; request.current?.abort(); var controller = new AbortController(); request.current = controller; busy[1](true); readFailure[1](false)
    var retained = readDraft(root, path)
    if (retained) { dirty.current = true; restored.current = retained; draft[1](retained.text); choice[1](retained.choice) }
    else { dirty.current = false; value[1](null) }
    try {
      var nextStatus = await call('status', { force: true }, controller.signal)
      if (!alive.current || id !== epoch.current) return
      status[1](nextStatus)
      if (Array.isArray(nextStatus.files) && !nextStatus.files.some(function (file) { return file.path === path && file.kind === 'unmerged' }) && !readDraft(root, path)) { value[1](null); return }
      var data = await call('conflictFile', { path: path }, controller.signal)
      if (!alive.current || id !== epoch.current) return
      var saved = readDraft(root, path); value[1](data); stale[1](!!saved && saved.hash !== data.hash); restored.current = saved
      draft[1](saved ? saved.text : data.text); choice[1](saved ? saved.choice : 'text'); dirty.current = !!saved
    } catch (failure) { if (!controller.signal.aborted && id === epoch.current) { readFailure[1](true); if (retained) stale[1](true); report(failure) } }
    finally { if (alive.current && id === epoch.current) busy[1](false) }
  }
  React.useEffect(function () { alive.current = true; load(); return function () { alive.current = false; request.current?.abort() } }, [root, path])
  React.useEffect(function () {
    return registerNavigationGuard(function (action) {
      if (busy[0]) { report(t('conflict.wait')); return false }
      if (!dirty.current) return true
      question[1](function (previous) { return previous || { title: t('conflict.unsaved'), text: t('conflict.leaveHint'), actions: [
        { label: t('conflict.keepLeave'), run: function () { question[1](null); approveNavigation(action) } },
        { label: t('conflict.discardLeave'), run: function () { clearDraft(root, path); dirty.current = false; question[1](null); approveNavigation(action) } },
      ] } }); return false
    })
  }, [root, path, busy[0]])
  React.useEffect(function () {
    var leave = function (event) { if (dirty.current || busy[0]) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', leave); return function () { window.removeEventListener('beforeunload', leave) }
  }, [busy[0]])
  var edit = function (text, side, checkpoint) {
    if (!value[0] || stale[0]) return
    if (text === draft[0] && side === choice[0]) return true
    var history = (readDraft(root, path)?.history || []).slice()
    if (checkpoint || lastEdit.current !== 'manual') history.push({ text: draft[0], choice: choice[0] })
    if (!saveDraft(root, path, value[0].hash, text, side, history)) return report(t('conflict.draftLimit'))
    lastEdit.current = checkpoint ? 'choice' : 'manual'
    dirty.current = true; draft[1](text); choice[1](side); return true
  }
  var undo = function () {
    var saved = readDraft(root, path), history = (saved?.history || []).slice(), previous = history.pop()
    if (!previous || busy[0] || stale[0]) return
    if (!saveDraft(root, path, value[0].hash, previous.text, previous.choice, history)) return report(t('conflict.draftLimit'))
    lastEdit.current = null; dirty.current = true; draft[1](previous.text); choice[1](previous.choice)
  }
  var discardReload = function () { clearDraft(root, path); dirty.current = false; restored.current = null; stale[1](false); load() }
  var reload = function () {
    if (!dirty.current) return discardReload()
    question[1]({ title: t('conflict.reload'), text: t('conflict.discardHint'), actions: [{ label: t('conflict.discard'), run: function () { question[1](null); discardReload() } }] })
  }
  var resolve = async function (openNext) {
    if (!value[0] || busy[0] || stale[0]) return
    busy[1](true)
    try {
      await call('write.resolveConflict', { path: path, hash: value[0].hash, choice: choice[0], text: draft[0], confirm: true })
      if (!alive.current) return
      clearDraft(root, path); dirty.current = false; value[1](null); report(t('conflict.resolved'), 'success')
      var updated = await refreshStatus(); if (alive.current) notify()
      var remaining = updated.files?.filter(function (file) { return file.kind === 'unmerged' }), after = remaining?.find(function (file) { return file.path === next?.path }) || remaining?.[0]
      if (openNext === true && alive.current && after) approveNavigation(function () { props.onOpenConflict?.(after) })
    } catch (failure) { if (!alive.current) return; report(failure); stale[1](true); await load() }
    finally { if (alive.current) busy[1](false) }
  }
  var select = function (side) {
    var version = value[0][side]
    var apply = function () { edit(version?.text || '', side, true) }
    if (!version) question[1]({ title: t('conflict.acceptDeletion'), text: t('conflict.deleteHint'), actions: [{ label: t('conflict.acceptDeletion'), run: function () { question[1](null); apply() } }] })
    else if (dirty.current && (draft[0] !== version.text || choice[0] !== side)) question[1]({ title: t('conflict.replaceResult'), text: t('conflict.replaceHint'), actions: [{ label: t('conflict.useWhole', { side: t('conflict.' + side) }), run: function () { question[1](null); apply() } }] })
    else apply()
  }
  var operation = status[0]?.operation, conflicts = (status[0]?.files || []).filter(function (file) { return file.kind === 'unmerged' }), blocks = React.useMemo(function () { return choice[0] === 'text' ? conflictBlocks(draft[0]) : [] }, [choice[0], draft[0]])
  var currentIndex = conflicts.findIndex(function (file) { return file.path === path })
  var next = conflicts.length > (currentIndex < 0 ? 0 : 1) ? conflicts[(currentIndex + 1) % conflicts.length] : null
  var proceed = async function (abort, reviewHash, skip) {
    busy[1](true)
    try {
      var latest = await refreshStatus()
      if (latest.operation?.kind !== operation.kind) throw new Error(t('conflict.operationChanged'))
      if (!abort && !skip && latest.files?.some(function (file) { return file.kind === 'unmerged' })) throw new Error(t('conflict.resolveRemaining'))
      await call(abort ? 'write.abortOperation' : 'write.continueOperation', Object.assign({ kind: operation.kind, confirm: abort || skip === true, reviewHash: reviewHash }, skip ? { skip: true } : {}))
      if (!alive.current) return
      if (abort || skip) { clearDraft(root, path); dirty.current = false }
      if (skip) {
        for (var file of latest.files || []) if (file.kind === 'unmerged') clearDraft(root, file.path)
        value[1](null); draft[1](''); stale[1](false); restored.current = null; lastEdit.current = null
      }
      var updated = await refreshStatus(); if (!alive.current) return; notify(); report(t('conflict.operationUpdated'), 'success')
      var remaining = updated.files?.find(function (file) { return file.kind === 'unmerged' }); if (remaining) approveNavigation(function () { props.onOpenConflict?.(remaining) })
    } catch (failure) {
      if (!alive.current) return
      report(failure)
      try {
        var updated = await refreshStatus(); if (!alive.current) return; props.onChanged?.()
        var remaining = updated.files?.find(function (file) { return file.kind === 'unmerged' })
        if (remaining && !abort) approveNavigation(function () { props.onOpenConflict?.(remaining) })
      } catch (refreshError) { report(refreshError) }
    }
    finally { if (alive.current) busy[1](false) }
  }
  var reviewContinue = async function (skip) {
    busy[1](true)
    try {
      var review = await call('operationReview', {})
      if (!alive.current) return
      if (review.operation?.kind !== operation.kind) throw new Error(t('conflict.operationChanged'))
      if (skip && !canSkipOperation(review.operation)) throw new Error(t('conflict.operationChanged'))
      if (review.conflicts && !skip) throw new Error(t('conflict.resolveRemaining'))
      question[1]({ title: skip ? t('pick.skip') : t('conflict.continue', { kind: t('op.' + operation.kind) }),
        text: skip ? t('pick.confirmSkip') : operationReviewText(t, review),
        actions: [{ label: skip ? t('pick.skip') : t('conflict.confirmContinue'), run: function () { question[1](null); proceed(false, review.hash, skip) } }] })
    } catch (failure) { report(failure) }
    finally { if (alive.current) busy[1](false) }
  }
  var launchExternal = async function () {
    busy[1](true)
    try {
      var result = await call('write.launchConflictTool', { path: path, hash: value[0].hash, text: draft[0] })
      if (alive.current) { toolToken[1](result.token); report(t('conflict.externalHint'), 'info') }
    } catch (failure) { report(failure) }
    finally { if (alive.current) busy[1](false) }
  }
  var importExternal = async function () {
    busy[1](true)
    try {
      var result = await call('conflictToolResult', { path: path, token: toolToken[0] })
      if (!alive.current) return
      if (result.running) return report(t('conflict.externalRunning'), 'info')
      if (result.hash !== value[0].hash) throw new Error(t('conflict.staleDraft'))
      if (edit(result.text, 'text', true)) { toolToken[1](null); report(t('conflict.externalImported'), 'success') }
    } catch (failure) { report(failure) }
    finally { if (alive.current) busy[1](false) }
  }
  var versions = function (side) {
    var label = t(operation?.kind === 'rebase' && side !== 'base' ? 'conflict.rebase' + (side === 'ours' ? 'Ours' : 'Theirs') : 'conflict.' + side)
    if (side === 'ours' && operation?.kind !== 'rebase' && status[0]?.branch?.head) label += ' · ' + status[0].branch.head
    if (value[0].labels?.[side]) label += ' · ' + value[0].labels[side]
    return h(ConflictVersion, { key: side, version: value[0][side], label: label, side: side, active: sideView[0] === side, ranges: value[0].ranges?.[side], otherRanges: value[0].ranges?.[side === 'ours' ? 'theirs' : 'ours'], t: t, disabled: busy[0] || stale[0], selected: choice[0] === side, onSelect: side === 'base' ? undefined : function () { select(side) } })
  }
  return h('div', { className: 'dshgit-conflict-editor', 'data-conflict-editor': true }, [
    h('header', { key: 'head', className: 'dshgit-conflict-head' }, [h('strong', { key: 'path', title: path }, path), value[0] ? h('span', { key: 'type', className: 'dshgit-muted' }, t(value[0].binary ? 'conflict.binaryType' : !value[0].ours || !value[0].theirs ? 'conflict.deleteType' : 'conflict.textType')) : null, h('span', { key: 'state', className: 'dshgit-muted' }, t('conflict.remaining', { count: conflicts.length }) + (dirty.current ? ' · ' + t('conflict.unsaved') : ''))]),
    h('div', { key: 'toolbar', className: 'dshgit-conflict-toolbar' }, [
      h('button', { key: 'reload', className: 'dshgit-btn', disabled: busy[0], onClick: reload }, t('action.refresh')),
      value[0] && !value[0].binary && value[0].ours && value[0].theirs ? h('button', { key: 'merge-tool', className: 'dshgit-btn', disabled: busy[0] || stale[0], onClick: launchExternal }, t('conflict.externalMerge')) : null,
      toolToken[0] ? h('button', { key: 'read-tool', className: 'dshgit-btn', disabled: busy[0] || stale[0], onClick: importExternal }, t('conflict.externalRead')) : null,
      !value[0] || value[0].binary || !value[0].ours || !value[0].theirs ? h('button', { key: 'external', className: 'dshgit-btn', disabled: busy[0], onClick: function () { call('openInEditor', { path: path }).catch(function (failure) { report(failure) }) } }, t('action.externalEditor')) : null,
    ]),
    h('div', { key: 'body', className: 'dshgit-conflict-body' }, [h('div', { key: 'hint', className: 'dshgit-muted dshgit-conflict-hint' }, t('conflict.hint')),
      stale[0] ? h('div', { key: 'stale', role: 'alert', className: 'dshgit-conflict-warning' }, [t('conflict.staleDraft'), restored.current ? h('pre', { key: 'draft' }, restored.current.text) : null,
        value[0] && !value[0].binary ? h('button', { key: 'reuse', className: 'dshgit-btn', disabled: busy[0], onClick: function () { if (saveDraft(root, path, value[0].hash, draft[0], 'text')) { stale[1](false); choice[1]('text'); dirty.current = true } } }, t('conflict.reviewDraft')) : null]) : null,
      value[0] ? h(React.Fragment, { key: 'value' }, [
        h('details', { key: 'base', className: 'dshgit-conflict-base' }, [h('summary', { key: 'label' }, t('conflict.base')), versions('base')]),
        h('div', { key: 'tabs', className: 'dshgit-conflict-tabs', role: 'group', 'aria-label': t('conflict.compare') }, ['theirs', 'ours'].map(function (side) { return h('button', { key: side, className: 'dshgit-btn', 'aria-pressed': sideView[0] === side, onClick: function () { sideView[1](side) } }, t('conflict.' + side)) })),
        h('div', { key: 'versions', className: 'dshgit-conflict-versions' }, ['theirs', 'ours'].map(versions)),
        h(ConflictSplitHandle, { key: 'split', t: t }),
        h(ConflictResult, { key: 'result', t: t, text: draft[0], blocks: blocks, choice: choice[0], binary: value[0].binary, deleting: choice[0] !== 'text' && !value[0][choice[0]], disabled: busy[0] || stale[0], onEdit: edit, onUndo: undo, canUndo: !!readDraft(root, path)?.history?.length }),
      ]) : h('div', { key: 'done', role: 'status', className: 'dshgit-empty' }, t(busy[0] ? 'state.loading' : readFailure[0] ? 'conflict.loadFailed' : operation ? 'conflict.resolved' : 'conflict.completed')),
    ]),
    h('footer', { key: 'footer', className: 'dshgit-conflict-toolbar' }, [
      h('button', { key: 'save', className: 'dshgit-btn dshgit-btn-primary', disabled: busy[0] || !value[0] || stale[0] || blocks.length > 0 || (value[0]?.binary && choice[0] === 'text'), onClick: function () { resolve(false) } }, t('conflict.mark')),
      next && value[0] && props.onOpenConflict ? h('button', { key: 'save-next', className: 'dshgit-btn', disabled: busy[0] || stale[0] || blocks.length > 0 || (value[0].binary && choice[0] === 'text'), onClick: function () { resolve(true) } }, t('conflict.saveNext')) : null,
      next && props.onOpenConflict ? h('button', { key: 'next', className: 'dshgit-btn', disabled: busy[0], onClick: function () { navigate(function () { props.onOpenConflict(next) }) } }, t('conflict.next')) : null,
      operation ? h('button', { key: 'continue', className: 'dshgit-btn dshgit-btn-primary', disabled: busy[0] || conflicts.length > 0 || dirty.current, onClick: function () { reviewContinue(false) } }, t('conflict.continue', { kind: t('op.' + operation.kind) })) : null,
      canSkipOperation(operation) ? h('button', {
        key: 'skip', className: 'dshgit-btn', disabled: busy[0], 'data-op-action': 'skip',
        title: t('pick.skipHint'), onClick: function () { reviewContinue(true) },
      }, t('pick.skip')) : null,
      operation ? h('button', { key: 'abort', className: 'dshgit-btn', disabled: busy[0], onClick: function () { question[1]({ title: t('action.abortOp'), text: t('conflict.abortHint'), actions: [{ label: t('action.abortOp'), run: function () { question[1](null); proceed(true) } }] }) } }, t('action.abortOp')) : null,
    ]),
    question[0] ? h(ConflictQuestion, Object.assign({}, question[0], { key: 'question', t: t, onCancel: function () { question[1](null) } })) : null,
    notice[0] ? h(Toast, { key: 'notice', seq: notice[0].seq, text: notice[0].text, tone: notice[0].tone, onDone: function () { notice[1](null) } }) : null,
  ])
}
export { ConflictEditor }

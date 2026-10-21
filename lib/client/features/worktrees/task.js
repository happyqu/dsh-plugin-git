import { React, h } from '../../core/runtime.js'
import { approveNavigation, registerNavigationGuard } from '../../core/navigation.js'
import { setWorktreeNote, worktreePathKey } from './preferences.js'
import { worktreeAssociations, worktreeSessions, worktreeWorkspace } from './workspace.js'
import { clearWorktreeDraft, readWorktreeDraft, writeWorktreeDraft } from './drafts.js'

export function WorktreeTask(props) {
  var t = props.t, saved = props.model.metadata[worktreePathKey(props.path)]?.note || ''
  var note = React.useState(function () { return readWorktreeDraft(props.model.common, props.path, saved) }), error = React.useState(null), leave = React.useState(null)
  var previous = React.useRef(saved)
  React.useEffect(function () {
    if (note[0] === previous.current) { note[1](saved); clearWorktreeDraft(props.model.common, props.path) }
    else if (note[0] === saved) clearWorktreeDraft(props.model.common, props.path)
    previous.current = saved
  }, [saved])
  var dirty = note[0] !== saved
  var dirtyRef = React.useRef(dirty)
  dirtyRef.current = dirty
  React.useEffect(function () { return registerNavigationGuard(function (action) {
    if (!dirtyRef.current) return true
    leave[1](function () { return action }); return false
  }) }, [])
  var save = function (continueNavigation) {
    try {
      setWorktreeNote(props.model.common, props.path, note[0]); dirtyRef.current = false; error[1](null)
      clearWorktreeDraft(props.model.common, props.path)
      if (continueNavigation && leave[0]) { var next = leave[0]; leave[1](null); approveNavigation(next) }
    } catch (failure) { error[1](failure.message) }
  }
  var associations = worktreeAssociations(props.path, props.model.context)
  return h('div', { className: 'dshgit-worktree-form' }, [
    h('form', { key: 'note', onSubmit: function (event) { event.preventDefault(); save(false) } }, [
      h('label', { key: 'label' }, [t('wt.taskNote'), h('textarea', { key: 'input', name: 'worktreeNote', className: 'dshgit-input', value: note[0], maxLength: 4000, rows: 3, style: { width: '100%', boxSizing: 'border-box' }, onChange: function (event) {
        var text = event.target.value
        writeWorktreeDraft(props.model.common, props.path, text, saved); note[1](text)
      } })]),
      h('p', { key: 'hint', className: 'dshgit-muted' }, t('wt.localNotes')),
      h('button', { key: 'save', type: 'submit', className: 'dshgit-btn', disabled: !dirty }, t('wt.saveNote')),
      dirty ? h('span', { key: 'dirty', className: 'dshgit-muted' }, ' · ' + t('wt.unsavedNote')) : null,
    ]),
    leave[0] ? h('div', { key: 'leave', role: 'alert' }, [
      h('p', { key: 'text' }, t('wt.noteLeave')),
      h('button', { key: 'save', type: 'button', className: 'dshgit-btn', onClick: function () { save(true) } }, t('wt.saveContinue')),
      h('button', { key: 'discard', type: 'button', className: 'dshgit-btn', onClick: function () { var next = leave[0]; clearWorktreeDraft(props.model.common, props.path); dirtyRef.current = false; note[1](saved); leave[1](null); approveNavigation(next) } }, t('wt.discardContinue')),
    ]) : null,
    error[0] ? h('div', { key: 'error', className: 'dshgit-error', role: 'alert' }, error[0]) : null,
    h('strong', { key: 'title' }, t('wt.associations')),
    !associations.length ? h('p', { key: 'empty', className: 'dshgit-muted' }, t(props.model.context.available ? 'wt.noWorkspace' : 'wt.workspaceContextUnavailable')) : null,
    !associations.length ? h('div', { key: 'sessions', className: 'dshgit-muted' }, worktreeSessions(props.path, props.model.context).map(function (session) { return session.title || session.name || session.id }).join(' · ')) : null,
    associations.map(function (workspace) { return h('div', { key: workspace.workspaceId, className: 'dshgit-worktree-form' }, [
      h('div', { key: 'name' }, workspace.name || workspace.path),
      h('div', { key: 'sessions', className: 'dshgit-muted' }, workspace.sessions.length ? workspace.sessions.map(function (session) { return session.title || session.name || session.id }).join(' · ') : t('wt.noSessions')),
      h('button', { key: 'open', type: 'button', className: 'dshgit-btn', disabled: props.busy || !worktreeWorkspace(),
        onClick: function () { props.onOpenWorkspace(workspace.workspaceId) } }, t('wt.openLinkedWorkspace')),
    ]) }),
  ])
}

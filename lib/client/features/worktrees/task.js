import { React, ReactDOM, h } from '../../core/runtime.js'
import { useDialogFocus } from '../../ui/controls.js'
import { approveNavigation, registerNavigationGuard } from '../../core/navigation.js'
import { setWorktreeNote, worktreePathKey } from './preferences.js'
import { clearWorktreeDraft, readWorktreeDraft, writeWorktreeDraft } from './drafts.js'

function WorktreeNoteDialog(props) {
  var panel = React.useRef(null)
  useDialogFocus(panel, props.onClose)
  return ReactDOM.createPortal(h('div', { className: 'dshgit-modal', onClick: props.onClose },
    h('div', { ref: panel, tabIndex: -1, role: 'dialog', 'aria-modal': true, 'aria-label': props.t('wt.taskNote'), className: 'dshgit-dialog dshgit-worktree-form', onClick: function (event) { event.stopPropagation() } }, props.children)), document.body)
}

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
      editing[1](false)
      if (continueNavigation && leave[0]) { var next = leave[0]; leave[1](null); approveNavigation(next) }
    } catch (failure) { error[1](failure.message) }
  }
  var editing = React.useState(dirty)
  var close = function () { editing[1](false); leave[1](null); error[1](null) }
  React.useEffect(function () { if (leave[0] || error[0]) editing[1](true) }, [leave[0], error[0]])
  return h('div', { className: 'dshgit-worktree-note' }, [
    note[0] ? h('span', { key: 'preview', className: 'dshgit-worktree-note-preview', title: note[0] }, note[0].replace(/\s+/g, ' ')) : null,
    h('button', { key: 'edit', type: 'button', className: 'dshgit-btn', title: t('wt.noteHint'), onClick: function () { editing[1](true) } }, t(note[0] ? 'wt.editNote' : 'wt.addNote')),
    dirty ? h('span', { key: 'draft', className: 'dshgit-muted' }, t('wt.unsavedNote')) : null,
    editing[0] ? h(WorktreeNoteDialog, { key: 'dialog', t: t, onClose: close }, [
      h('div', { key: 'title', className: 'dshgit-dialogtitle' }, t('wt.taskNote')),
      h('form', { key: 'note', className: 'dshgit-worktree-form', onSubmit: function (event) { event.preventDefault(); save(!!leave[0]) } }, [
        h('textarea', { key: 'input', name: 'worktreeNote', className: 'dshgit-input dshgit-textarea', value: note[0], 'aria-label': t('wt.taskNote'), maxLength: 4000, rows: 3, onChange: function (event) {
          var text = event.target.value
          writeWorktreeDraft(props.model.common, props.path, text, saved); note[1](text)
        } }),
        h('div', { key: 'save', className: 'dshgit-actions' }, [
          h('button', { key: 'submit', type: 'submit', className: 'dshgit-btn dshgit-btn-primary', disabled: !dirty }, t('wt.saveNote')),
          h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', onClick: close }, t('action.close')),
          dirty ? h('span', { key: 'dirty', className: 'dshgit-muted' }, t('wt.unsavedNote')) : null,
        ]),
        h('p', { key: 'hint', className: 'dshgit-muted' }, t('wt.noteHint')),
      ]),
      leave[0] ? h('div', { key: 'leave', role: 'alert', className: 'dshgit-worktree-form' }, [
        h('p', { key: 'text' }, t('wt.noteLeave')),
        h('div', { key: 'buttons', className: 'dshgit-actions' }, [
          h('button', { key: 'save', type: 'button', className: 'dshgit-btn dshgit-btn-primary', onClick: function () { save(true) } }, t('wt.saveContinue')),
          h('button', { key: 'discard', type: 'button', className: 'dshgit-btn', onClick: function () { var next = leave[0]; clearWorktreeDraft(props.model.common, props.path); dirtyRef.current = false; note[1](saved); leave[1](null); editing[1](false); approveNavigation(next) } }, t('wt.discardContinue')),
        ]),
      ]) : null,
      error[0] ? h('div', { key: 'error', className: 'dshgit-error', role: 'alert' }, error[0]) : null,
    ]) : null,
  ])
}

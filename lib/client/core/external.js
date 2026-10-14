/** Launch through the Host so embedded browsers cannot swallow the URI. */
function externalEditorItem(root, file, t, event, call, onError) {
  var line = Number(event?.target?.closest?.('.dshgit-diffrow')?.querySelector('.dshgit-diffnum:last-child')?.textContent) || 1
  return { id: 'external-editor', label: t('action.externalEditor'), disabled: !root || file.worktree === 'D',
    run: function () {
      return call('openInEditor', { root: root, path: file.path, line: line }, { silent: true, silentError: true }).catch(function (failure) {
        onError(failure.code === 'git/unknown-method' ? t('workflow.reloadHost') : failure.message)
      })
    },
  }
}
export { externalEditorItem }

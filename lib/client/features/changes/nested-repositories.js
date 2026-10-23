import { h } from '../../core/runtime.js'
import { openGitWindow } from '../../core/state.js'
import { navigate } from '../../core/navigation.js'

export function openNestedRepository(file, sessionId, onOpen) {
  navigate(function () {
    if (onOpen) onOpen()
    openGitWindow({ sessionId: sessionId || '', directory: file.nestedRepository.root })
  })
}

/** Keep embedded repositories visible with the same explicit choices as VCS roots. */
export function NestedRepositories(props) {
  var files = (props.status?.files || []).filter(function (file) { return file.nestedRepository })
  if (!files.length) return null
  var t = props.t
  return h('div', { className: 'dshgit-nested-repositories', 'aria-label': t('nested.title') }, [
    h('div', { key: 'title', className: 'dshgit-muted' }, t('nested.title')),
    h('div', { key: 'hint', className: 'dshgit-muted' }, t('nested.hint')),
    files.map(function (file) {
      return h('div', { key: file.path, className: 'dshgit-nested-repository', 'data-nested-repository': file.path }, [
        h('span', { key: 'path', className: 'dshgit-name', title: file.nestedRepository.root }, file.path),
        h('button', { key: 'open', type: 'button', className: 'dshgit-btn', disabled: !!props.busy,
          onClick: function () {
            if (props.onOpenNestedRepository) props.onOpenNestedRepository(file)
            else openNestedRepository(file, props.sessionId)
          } }, t('nested.open')),
        h('button', { key: 'ignore', type: 'button', className: 'dshgit-btn', disabled: !!props.busy || !props.onWrite,
          title: t('nested.ignoreHint'), onClick: function () {
            props.onWrite('ignoreLocalPath', { path: file.path }, { after: props.afterWrite })
          } }, t('action.ignoreLocal')),
        h('button', { key: 'ignore-shared', type: 'button', className: 'dshgit-btn', disabled: !!props.busy || !props.onWrite,
          onClick: function () { props.onWrite('ignorePath', { path: file.path }, { after: props.afterWrite }) }
        }, t('action.ignoreFile')),
      ])
    }),
  ])
}

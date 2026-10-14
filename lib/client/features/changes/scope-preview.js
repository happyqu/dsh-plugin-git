import { React, ReactDOM, h } from '../../core/runtime.js'
import { useDialogFocus } from '../../ui/controls.js'
import { DiffBody } from '../../preview/code.js'
import { IconChangeAction } from '../../ui/icons.js'

function ScopeDialog(props) {
  var panel = React.useRef(null), result = React.useState(null), error = React.useState(null), summary = React.useState(null)
  useDialogFocus(panel, props.onClose)
  React.useEffect(function () {
    var controller = new AbortController(), active = true
    var lists = props.changelists?.mode === 'lists'
    var read = lists ? props.changelists.flush().then(function (state) {
      var paths = props.changelists.pathsFor(state)
      if (!paths.length) throw new Error(props.t('commit.nothing'))
      if (!active) throw new DOMException('Aborted', 'AbortError')
      summary[1]({ excluded: props.status.files.filter(function (file) { return !paths.includes(file.path) }).map(function (file) { return file.path }),
        chunks: paths.reduce(function (count, path) { return count + (state.chunks?.[path]?.parts || []).filter(function (part) { return !part.selected }).length }, 0) })
      return props.run('changelistDiff', { root: props.repo.root, paths, changelistVersion: state.version }, { silent: true, silentError: true, signal: controller.signal })
    }) : props.run('commitScopePreview', { root: props.repo.root }, { silent: true, silentError: true, signal: controller.signal })
    read.then(function (value) { if (active) result[1](value) }).catch(function (failure) { if (active) error[1](failure.code === 'git/unknown-method' ? props.t('workflow.reloadHost') : failure.message) })
    return function () { active = false; controller.abort() }
  }, [])
  return ReactDOM.createPortal(h('div', { className: 'dshgit-modal', style: { zIndex: 1650 }, onClick: props.onClose },
    h('div', { ref: panel, tabIndex: -1, className: 'dshgit-dialog dshgit-scope-dialog', 'data-preview-root': props.repo.root, 'data-history-commit': 'commit-preview', role: 'dialog', 'aria-modal': true, 'aria-label': props.t('scope.title'), onClick: function (event) { event.stopPropagation() } }, [
      h('div', { key: 'head', className: 'dshgit-dialogtitle' }, [props.t('scope.title'), h('button', { className: 'dshgit-iconbtn', style: { marginLeft: 'auto' }, onClick: props.onClose, 'aria-label': props.t('action.close') }, '×')]),
      h('div', { key: 'hint', className: 'dshgit-muted' }, props.t('scope.hint')),
      summary[0] ? h('details', { key: 'excluded' }, [h('summary', null, props.t('scope.excluded') + ': ' + summary[0].excluded.length + ' / ' + props.t('scope.unselectedChunks') + ': ' + summary[0].chunks), h('div', { style: { maxHeight: '120px', overflow: 'auto', whiteSpace: 'pre-wrap' } }, summary[0].excluded.slice(0, 100).join('\n'))]) : null,
      h('div', { key: 'body', className: 'dshgit-scope-body' }, error[0] ? h('div', { role: 'alert' }, error[0]) : !result[0] ? props.t('state.loading') : result[0].tooLarge ? props.t('state.fileTooLarge') : (result[0].files || []).map(function (file) {
        return h('section', { key: file.path }, [h('strong', { key: 'name' }, file.path), h(DiffBody, { key: 'diff', path: file.path, hunks: file.hunks, t: props.t, emptyText: props.t(file.binary ? 'state.fileBinary' : 'state.emptyDiff') })]) })),
    ])), document.body)
}
function CommitScopePreview(props) {
  var open = React.useState(false)
  return h(React.Fragment, null, [h('button', { key: 'button', type: 'button', className: 'dshgit-iconbtn', disabled: props.disabled, title: props.t('scope.title'), 'aria-label': props.t('scope.title'), onClick: function () { open[1](true) } }, h(IconChangeAction, { kind: 'preview', size: 16 })),
    open[0] ? h(ScopeDialog, Object.assign({}, props, { key: 'dialog', onClose: function () { open[1](false) } })) : null])
}
export { CommitScopePreview }

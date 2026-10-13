import { Fragment, React, h } from '../core/runtime.js'

function conflictBlocks(text) {
  var expression = /^<{7,}[^\r\n]*\r?\n([\s\S]*?)^={7,}\r?\n([\s\S]*?)^>{7,}[^\r\n]*(?:\r?\n|$)/gm
  return Array.from(text.matchAll(expression)).map(function (match) { return { start: match.index, end: match.index + match[0].length, ours: match[1].split(/^\|{7,}[^\r\n]*\r?\n/m)[0], theirs: match[2] } })
}


function ConflictEditor(props) {
  var t = props.t, value = React.useState(null), draft = React.useState(''), error = React.useState(''), busy = React.useState(false)
  var alive = React.useRef(true)
  var load = function () { error[1](''); return props.run('conflictFile', { root: props.repo.root, path: props.path }, { silent: true, silentError: true }).then(function (data) { if (alive.current) { value[1](data); draft[1](data.text) } }).catch(function (failure) { if (alive.current) error[1](failure.message) }) }
  React.useEffect(function () { alive.current = true; load(); return function () { alive.current = false } }, [props.repo.root, props.path])
  var blocks = conflictBlocks(draft[0])
  var resolve = function (choice) {
    busy[1](true); error[1]('')
    props.run('write.resolveConflict', { root: props.repo.root, path: props.path, hash: value[0].hash, choice: choice, text: draft[0], confirm: true }, { silentError: true }).then(function () { props.onChanged?.(); value[1](null); error[1](t('conflict.resolved')) }).catch(function (failure) { error[1](failure.message) }).finally(function () { busy[1](false) })
  }
  var buttons = function (block, index) { return h('div', { key: index, className: 'dshgit-lfs-actions' }, [h('span', { key: 'number', className: 'dshgit-muted' }, t('conflict.block', { number: index + 1 })), ['ours', 'theirs', 'both'].map(function (choice) { return h('button', { key: choice, type: 'button', className: 'dshgit-btn', disabled: busy[0], onClick: function () { draft[1](draft[0].slice(0, block.start) + (choice === 'ours' ? block.ours : choice === 'theirs' ? block.theirs : block.ours + block.theirs) + draft[0].slice(block.end)) } }, t('conflict.' + choice)) })]) }
  return h('div', { className: 'dshgit-scroll dshgit-settings-form dshgit-lfs-panel', 'data-conflict-editor': true }, [
    h('div', { key: 'title', className: 'dshgit-card' }, [h('strong', { key: 'path', className: 'dshgit-lfs-report' }, props.path), h('div', { key: 'hint', className: 'dshgit-muted' }, t('conflict.hint')), h('button', { key: 'refresh', type: 'button', className: 'dshgit-btn', disabled: busy[0], onClick: load }, t('conflict.reload'))]),
    error[0] ? h('div', { key: 'error', role: 'status', className: 'dshgit-hint' }, error[0]) : null,
    value[0] ? h('div', { key: 'versions', className: 'dshgit-lfs-grid' }, ['base', 'ours', 'theirs'].map(function (side) { return h('div', { key: side, className: 'dshgit-card' }, [h('strong', { key: 'label' }, t('conflict.' + side)), h('pre', { key: 'content', className: 'dshgit-lfs-report' }, value[0][side] ? value[0][side].binary ? t('state.fileBinary') : value[0][side].text : t('conflict.deleted'))]) })) : null,
    value[0] ? h('div', { key: 'result', className: 'dshgit-card' }, [h('strong', { key: 'label' }, t('conflict.result')), value[0].binary ? h('div', { key: 'binary', className: 'dshgit-muted' }, t('conflict.binary')) : h(Fragment, { key: 'text' }, [h('div', { key: 'blocks', className: 'dshgit-lfs-panel' }, blocks.map(buttons)), h('textarea', { key: 'draft', className: 'dshgit-textarea', style: { minHeight: 220, fontFamily: 'monospace' }, 'aria-label': t('conflict.result'), value: draft[0], disabled: busy[0], onChange: function (event) { draft[1](event.currentTarget.value) } })]), h('div', { key: 'actions', className: 'dshgit-lfs-actions' }, value[0].binary ? ['ours', 'theirs'].map(function (side) { return h('button', { key: side, type: 'button', className: 'dshgit-btn', disabled: busy[0], onClick: function () { resolve(side) } }, t('conflict.' + side) + ' · ' + t('conflict.mark')) }) : h('button', { key: 'save', type: 'button', className: 'dshgit-btn dshgit-btn-primary', disabled: busy[0] || blocks.length > 0, onClick: function () { resolve('text') } }, t('conflict.mark')))]) : null,
  ])
}

export { ConflictEditor }

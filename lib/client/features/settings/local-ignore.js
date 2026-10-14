import { React, h } from '../../core/runtime.js'
import { Toast } from '../../ui/notifications.js'
import { IconRefresh } from '../../ui/icons.js'

// Rules rather than an `--ignored` directory scan: opening settings stays cheap
// even when ignored build output contains hundreds of thousands of files.
function LocalIgnoreSettings(props) {
  var data = React.useState(null), selected = React.useState([]), busy = React.useState(false), notice = React.useState(null), page = React.useState(0), refresh = React.useState(0), search = React.useState('')
  var request = React.useRef(null), root = props.repo?.root, t = props.t
  React.useEffect(function () {
    var controller = new AbortController(); request.current = controller; busy[1](true); data[1](null); selected[1]([])
    props.run('localIgnoreRules', { root: root }, { silent: true, silentError: true, signal: controller.signal }).then(function (value) {
      if (!controller.signal.aborted) data[1](value)
    }).catch(function (failure) {
      if (!controller.signal.aborted) notice[1]({ seq: Date.now(), text: /Unknown Git operation/.test(failure.message) ? t('workflow.reloadHost') : failure.message })
    }).finally(function () { if (!controller.signal.aborted) busy[1](false) })
    return function () { controller.abort(); request.current = null }
  }, [root, refresh[0]])
  React.useEffect(function () { page[1](0) }, [search[0]])
  var rules = data[0]?.rules || [], query = search[0].trim().toLowerCase()
  var matched = rules.filter(function (rule) { return rule.pattern.toLowerCase().includes(query) })
  var pages = Math.max(1, Math.ceil(matched.length / 100)), current = Math.min(page[0], pages - 1), shown = matched.slice(current * 100, (current + 1) * 100)
  var chosen = new Set(selected[0])
  var checkedOnPage = shown.filter(function (rule) { return chosen.has(rule.id) }).length
  var remove = async function (ids) {
    if (busy[0] || !ids.length || !request.current) return
    var controller = request.current; busy[1](true)
    try {
      await props.run('write.removeLocalIgnoreRules', { root: root, ids: ids, version: data[0].version }, { silent: true, silentError: true, signal: controller.signal })
      if (controller.signal.aborted) return
      props.onChanged?.(); refresh[1](function (value) { return value + 1 })
    } catch (failure) {
      if (!controller.signal.aborted) notice[1]({ seq: Date.now(), text: /Unknown Git operation/.test(failure.message) ? t('workflow.reloadHost') : failure.message })
    } finally { if (!controller.signal.aborted) busy[1](false) }
  }
  return h('div', { className: 'dshgit-scroll dshgit-settings-form dshgit-ignore-settings' }, [
    h('div', { key: 'heading', className: 'dshgit-ignore-heading' }, [
      h('strong', { key: 'title' }, t('settings.currentRepo')),
      h('div', { key: 'root', className: 'dshgit-muted dshgit-ignore-root', title: root }, root),
    ]),
    h('div', { key: 'rules', className: 'dshgit-card' }, [
    h('div', { key: 'title', className: 'dshgit-ignore-cardtitle' }, [
      h('strong', { key: 'label' }, t('ignore.title')),
      data[0] ? h('span', { key: 'count', className: 'dshgit-muted' }, t('ignore.count', { count: rules.length })) : null,
    ]),
    h('div', { key: 'hint', className: 'dshgit-muted' }, t('ignore.localHint')),
    h('div', { key: 'tools', className: 'dshgit-ignore-toolbar' }, [
    h('input', { key: 'search', type: 'search', className: 'dshgit-input', value: search[0], placeholder: t('ignore.search'), 'aria-label': t('ignore.search'), onChange: function (event) { search[1](event.currentTarget.value) } }),
    h('div', { key: 'actions', className: 'dshgit-ignore-actions' }, [
      h('button', { key: 'remove', className: 'dshgit-btn', disabled: busy[0] || !chosen.size, onClick: function () { remove(selected[0]) } }, t('ignore.removeSelected') + (chosen.size ? ' (' + chosen.size + ')' : '')),
      h('button', { key: 'refresh', type: 'button', className: 'dshgit-iconbtn', disabled: busy[0], title: t('action.refresh'), 'aria-label': t('action.refresh'), onClick: function () { refresh[1](refresh[0] + 1) } }, h(IconRefresh, { size: 16 })),
    ]),
    ]),
    h('table', { key: 'table', className: 'dshgit-ignore-table' }, [
      h('colgroup', { key: 'cols' }, [h('col', { key: 'select', className: 'dshgit-ignore-selectcol' }), h('col', { key: 'rule' }), h('col', { key: 'action', className: 'dshgit-ignore-actioncol' })]),
      h('thead', { key: 'head' }, h('tr', null, [
        h('th', { key: 'select', scope: 'col' }, h('input', { type: 'checkbox', 'aria-label': t('ignore.selectShown'), checked: shown.length > 0 && checkedOnPage === shown.length,
          ref: function (node) { if (node) node.indeterminate = checkedOnPage > 0 && checkedOnPage < shown.length }, disabled: busy[0] || !shown.length,
          onChange: function (event) { var ids = new Set(shown.map(function (rule) { return rule.id })); selected[1](event.target.checked ? Array.from(new Set(selected[0].concat(Array.from(ids)))) : selected[0].filter(function (id) { return !ids.has(id) })) } })),
        h('th', { key: 'rule', scope: 'col' }, t('ignore.rule')),
        h('th', { key: 'action', scope: 'col' }, t('ignore.operation')),
      ])),
      h('tbody', { key: 'body' }, data[0] && shown.length ? shown.map(function (rule) { return h('tr', { key: rule.id, className: 'dshgit-ignore-rule', 'data-selected': chosen.has(rule.id) }, [
        h('td', { key: 'select' }, h('input', { type: 'checkbox', 'aria-label': rule.pattern, checked: chosen.has(rule.id), disabled: busy[0], onChange: function (event) { selected[1](event.target.checked ? selected[0].concat(rule.id) : selected[0].filter(function (id) { return id !== rule.id })) } })),
        h('td', { key: 'pattern' }, h('code', { title: rule.pattern }, rule.pattern)),
        h('td', { key: 'action' }, h('button', { className: 'dshgit-ignore-link', disabled: busy[0], onClick: function () { remove([rule.id]) } }, t('ignore.remove'))),
      ]) }) : h('tr', null, h('td', { colSpan: 3, className: 'dshgit-ignore-empty' }, t(!data[0] ? busy[0] ? 'state.loading' : 'action.retryRead' : query ? 'list.noMatches' : 'ignore.empty')))),
    ]),
    pages > 1 ? h('div', { key: 'pages', className: 'dshgit-ignore-pagination' }, [h('button', { key: 'prev', className: 'dshgit-btn', disabled: current === 0, 'aria-label': t('ignore.previousPage'), onClick: function () { page[1](current - 1) } }, '‹'), h('span', { key: 'count' }, (current + 1) + ' / ' + pages), h('button', { key: 'next', className: 'dshgit-btn', disabled: current + 1 >= pages, 'aria-label': t('ignore.nextPage'), onClick: function () { page[1](current + 1) } }, '›')]) : null,
    ]),
    notice[0] ? h(Toast, { key: 'notice', seq: notice[0].seq, text: notice[0].text, tone: 'error', onDone: function () { notice[1](null) } }) : null,
  ])
}
export { LocalIgnoreSettings }

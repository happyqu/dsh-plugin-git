import { React, h } from '../../core/runtime.js'
import { IconRefresh } from '../../ui/icons.js'
import { Toast } from '../../ui/notifications.js'

/**
 * Remote management for the current repository.
 *
 * The panel could add a remote (from the publish flow) but never remove one,
 * so a mistyped URL left a permanent entry until the user dropped to a
 * terminal. Removing a remote deletes nothing local — the commits and refs
 * stay — so it needs a confirmation, not a warning: the only loss is the
 * fetch/push configuration and the remote-tracking refs it maintained.
 *
 * Renaming is deliberately absent: `git remote rename` also moves the
 * remote-tracking refs, and a half-renamed remote is worse than a stale one.
 *
 * @param props - `{ repo, run, t, onChanged }`.
 */
function RemoteSettings(props) {
  var t = props.t, root = props.repo?.root
  var data = React.useState(null), busy = React.useState(false), notice = React.useState(null)
  // A read that failed is NOT the same as a read still in flight: both leave
  // `data` null, and without this flag the card would sit on "loading" forever.
  var loadError = React.useState(null)
  var confirmState = React.useState(null), refresh = React.useState(0)
  React.useEffect(function () {
    var active = true
    data[1](null)
    loadError[1](null)
    props.run('remotes', { root: root }, { silent: true, silentError: true })
      .then(function (value) { if (active) data[1](value || []) })
      .catch(function (failure) {
        if (active) loadError[1](/Unknown Git operation/.test(failure.message) ? t('workflow.reloadHost') : failure.message)
      })
    return function () { active = false }
  }, [root, refresh[0]])

  var remotes = data[0] || []
  var remove = function (name) {
    if (busy[0]) return
    busy[1](true)
    props.run('write.removeRemote', { root: root, name: name, confirm: true }, { silent: true, silentError: true })
      .then(function () {
        confirmState[1](null)
        notice[1]({ seq: Date.now(), text: t('remote.removed', { name: name }), tone: 'success' })
        props.onChanged?.(); refresh[1](function (value) { return value + 1 })
      })
      .catch(function (failure) { notice[1]({ seq: Date.now(), text: failure.message, tone: 'error' }) })
      .finally(function () { busy[1](false) })
  }

  return h('div', { key: 'remotes', className: 'dshgit-card dshgit-remote-settings' }, [
    // Rendered above the title so a failure is visible without scrolling to
    // the bottom of a long remote table.
    notice[0] ? h(Toast, { key: 'notice', seq: notice[0].seq, text: notice[0].text, tone: notice[0].tone || 'success',
      onDone: function () { notice[1](null) } }) : null,
    h('div', { key: 'title', className: 'dshgit-ignore-cardtitle' }, [
      h('strong', { key: 'label' }, t('remote.title')),
      data[0] ? h('span', { key: 'count', className: 'dshgit-muted' }, t('remote.count', { count: remotes.length })) : null,
    ]),
    h('div', { key: 'hint', className: 'dshgit-muted' }, t('remote.hint')),
    loadError[0] !== null
      ? h('div', { key: 'unavailable', className: 'dshgit-empty', role: 'alert' }, [
        h('div', { key: 'm' }, t('remote.unavailable')),
        h('div', { key: 'd', className: 'dshgit-muted', style: { marginTop: '4px', fontSize: 'var(--dshgit-font-small)' } }, loadError[0]),
      ])
      : data[0] === null
        ? h('div', { key: 'loading', className: 'dshgit-muted' }, t('state.loading'))
        : remotes.length === 0
          ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('remote.empty'))
        : h('table', { key: 'table', className: 'dshgit-ignore-table dshgit-remote-table' }, [
          h('thead', { key: 'head' }, h('tr', null, [
            h('th', { key: 'name' }, t('remote.name')),
            h('th', { key: 'url' }, t('remote.url')),
            h('th', { key: 'action', className: 'dshgit-ignore-actioncol' }, ''),
          ])),
          h('tbody', { key: 'body' }, remotes.map(function (remote) {
            var armed = confirmState[0] === remote.name
            return h('tr', { key: remote.name, 'data-remote': remote.name }, [
              h('td', { key: 'name' }, remote.name),
              // Fetch and push URLs differ often enough (fork workflow) that
              // showing both saves a "why is it pushing there" investigation.
              h('td', { key: 'url', className: 'dshgit-remote-url', title: [remote.fetchUrl, remote.pushUrl].filter(Boolean).join('\n') }, [
                h('div', { key: 'fetch' }, remote.fetchUrl || t('remote.none')),
                remote.pushUrl && remote.pushUrl !== remote.fetchUrl
                  ? h('div', { key: 'push', className: 'dshgit-muted' }, t('remote.pushUrl') + ' ' + remote.pushUrl)
                  : null,
              ]),
              h('td', { key: 'action', className: 'dshgit-ignore-actioncol' }, armed
                ? h('span', { key: 'confirm', className: 'dshgit-remote-confirm' }, [
                  h('button', { key: 'yes', type: 'button', className: 'dshgit-btn dshgit-btn-danger', 'data-remote-confirm': remote.name, disabled: busy[0], onClick: function () { remove(remote.name) } }, t('remote.confirmRemove')),
                  h('button', { key: 'no', type: 'button', className: 'dshgit-btn', onClick: function () { confirmState[1](null) } }, t('action.cancel')),
                ])
                : h('button', {
                  key: 'remove', type: 'button', className: 'dshgit-btn', 'data-remote-remove': remote.name,
                  // A remote can also be readonly for this ref set; the write
                  // gate rejects it, and this title explains why proactively.
                  title: t('remote.remove'), 'aria-label': t('remote.remove') + ' ' + remote.name,
                  onClick: function () { confirmState[1](remote.name) },
                }, t('remote.remove'))),
            ])
          })),
        ]),
    h('div', { key: 'tools', className: 'dshgit-ignore-toolbar' }, [
      h('div', { key: 'actions', className: 'dshgit-ignore-actions' }, [
        h('button', { key: 'refresh', type: 'button', className: 'dshgit-iconbtn', disabled: busy[0], title: t('action.refresh'), 'aria-label': t('action.refresh'), onClick: function () { refresh[1](refresh[0] + 1) } }, h(IconRefresh, { size: 16 })),
      ]),
    ]),
  ])
}

export { RemoteSettings }

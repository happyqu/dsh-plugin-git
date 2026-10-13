import { installStyles } from './client/styles.js'
import { NS, h } from './client/core/runtime.js'
import { en, zh } from './client/locales.js'
import { GitWindow, HeaderGitCluster } from './client/shell/window.js'
import { SettingsTab } from './client/features/settings/view.js'
import { callRpc } from './client/core/rpc.js'

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

function apply(ctx) {
  ctx.effect(function () {
    return installStyles()
  }, 'git: styles')

  ctx.effect(function () {
    return ctx.locale.register(NS, { zh: zh, en: en })
  }, 'git: dictionaries')

  // Soft injection: a profile without `connection` simply does not render
  // this window, instead of failing client activation.
  ctx.inject(['slots', 'connection'], function (scope) {
    var connection = scope.connection
    var t = scope.locale ? scope.locale.bind(NS) : function (key) { return key }

    // The top-right corner of the session header. `utilities` is the
    // right-aligned cluster there, so the button sits with the session's own
    // controls instead of at the sidebar foot.
    //
    // Registered via a soft injection because `conversation.session.header`
    // is session-scoped: on the blank-session screen the seat does not
    // exist, and a hard dependency would fail client activation there.
    scope.slots.inject('conversation.session.header.utilities', function () {
      return scope.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'git',
          order: 40,
          label: function () { return t('panel.title') },
          locale: NS,
        },
        function HeaderGitAction(actionProps) {
          return h(HeaderGitCluster, {
            // The session this cluster belongs to. `conversation.session.header.*`
            // is a session-scoped slot, so the renderer injects `sessionId` from
            // the built-in session source; the window needs it because it lives
            // in a root-scoped slot with no session binding of its own.
            sessionId: actionProps.sessionId,
            connection: connection,
            t: actionProps.t || t,
          })
        },
      )
    })

    scope.slots.inject('shell.overlay', function () {
      return scope.slots.register(
        {
          name: 'shell.overlay',
          id: 'git-window',
          order: 40,
          locale: NS,
        },
        function OverlayWindow(overlayProps) {
          return h(GitWindow, {
            connection: connection,
            t: overlayProps.t || t,
          })
        },
      )
    })

    scope.slots.inject('settings.section', function () {
      return scope.slots.register(
        {
          name: 'settings.section',
          id: 'git-plugin',
          order: 60,
          label: function () { return t('panel.title') },
          locale: NS,
          inject: function () { return { connection: connection } },
        },
        function SettingsSection(sectionProps) {
          return h(SettingsTab, {
            run: function (method, payload) {
              return callRpc(connection, method, payload, undefined)
            },
            gitPath: null,
            repo: null,
            onChanged: function () {},
            onToast: function () {},
            t: sectionProps.t || t,
          })
        },
      )
    })
  })
}

export const name = 'git-client'
export const inject = ['slots', 'locale']

export { apply }

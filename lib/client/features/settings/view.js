import { React, h } from '../../core/runtime.js'
import { ComboBox } from '../../ui/controls.js'
import { nextControlId } from '../../core/ids.js'
import { publishPluginConfig } from '../../core/state.js'
import { LfsPanel } from './lfs.js'
import { LocalIgnoreSettings } from './local-ignore.js'
import { Toast } from '../../ui/notifications.js'
import { AiModelSettings } from './ai.js'
import { AiContextSettings } from './ai-context.js'

/**
 * The settings sidebar: one group per SCOPE, not per feature.
 *
 * The page this replaced mixed three different scopes in "general": paths that
 * belong to this Host (git executable, VS Code), switches for how the panel
 * behaves (background fetch, the add-workspace chooser), and repository-scoped
 * facts (commit identity, authentication) that silently changed meaning when the
 * active repository changed. Grouping by scope makes the answer to "what does
 * this change?" visible before the control is touched:
 *
 * - **General** — this device and this panel. Nothing here depends on a repo.
 * - **Sync** — when and how often the plugin talks to a remote.
 * - **Current repository** — everything Git stores per repository.
 * - **Git LFS**, **Diagnostics** — tools, not preferences.
 */
function SettingsNav(props) {
  var t = props.t
  var sections = [
    { id: 'general', label: t('settings.general') },
    { id: 'sync', label: t('settings.sync') },
    { id: 'repository', label: t('settings.currentRepo') },
    { id: 'ai', label: t('settings.ai') },
    { id: 'lfs', label: t('lfs.title') },
    { id: 'diagnostics', label: t('settings.diagnostics') },
  ]
  return h('div', { className: 'dshgit-section dshgit-settings-nav' }, sections.map(function (section) {
    return h('button', {
      key: section.id,
      type: 'button',
      className: 'dshgit-row dshgit-rowbtn',
      'data-selected': props.section === section.id,
      onClick: function () { props.onSelect(section.id) },
    }, h('span', { key: 'n', className: 'dshgit-name' }, section.label))
  }))
}


/* ------------------------------------------------------------------ *
 * Settings tab
 * ------------------------------------------------------------------ */

function AuthenticationHelp(props) {
  var t = props.t, state = React.useState(null), error = React.useState(''), busy = React.useState(false)
  return h('div', { className: 'dshgit-card dshgit-lfs-panel' }, [h('strong', { key: 'title' }, t('auth.help')), h('div', { key: 'hint', className: 'dshgit-muted' }, t('auth.hint')),
    h('button', { key: 'check', type: 'button', className: 'dshgit-btn', disabled: busy[0], onClick: function () { busy[1](true); error[1](''); Promise.all(['remotes', 'hostingAccounts'].map(function (method) { return props.run(method, { root: props.repo.root }, { silent: true, silentError: true }) })).then(state[1]).catch(function (failure) { error[1](failure.message) }).finally(function () { busy[1](false) }) } }, t('auth.check')),
    state[0] ? h('div', { key: 'result', className: 'dshgit-lfs-report' }, [h('div', { key: 'remotes' }, state[0][0].map(function (remote) { return remote.name + ' · ' + (remote.fetchUrl || remote.pushUrl || '') }).join('\n') || t('lfs.noRemote')), h('div', { key: 'accounts' }, (Array.isArray(state[0][1]) ? state[0][1] : state[0][1].accounts || []).map(function (account) { return account.host + ' · ' + account.login }).join('\n') || t('auth.noAccount'))]) : null,
    error[0] ? h('div', { key: 'error', role: 'alert' }, error[0]) : null,
    h('div', { key: 'login', className: 'dshgit-lfs-panel' }, [h('span', { key: 'label' }, t('auth.github')), h('code', { key: 'command' }, 'gh auth login'), h('a', { key: 'help', href: 'https://cli.github.com/manual/gh_auth_login', target: '_blank', rel: 'noopener noreferrer' }, t('auth.documentation'))]),
    h('div', { key: 'ssh', className: 'dshgit-muted' }, t('auth.ssh')), h('div', { key: 'retry', className: 'dshgit-muted' }, t('auth.retry')),
  ])
}


function IdentitySettings(props) {
  var t = props.t, scope = React.useState('local'), name = React.useState(''), email = React.useState(''), busy = React.useState(false), message = React.useState('')
  React.useEffect(function () {
    var alive = true; message[1](''); busy[1](true)
    props.run('repoIdentity', { root: props.repo.root, scope: scope[0] }, { silent: true, silentError: true }).then(function (value) { if (alive) { name[1](typeof value?.name === 'string' ? value.name : ''); email[1](typeof value?.email === 'string' ? value.email : '') } }).catch(function (failure) { if (alive) message[1](failure.message) }).finally(function () { if (alive) busy[1](false) })
    return function () { alive = false }
  }, [props.repo.root, scope[0]])
  return h('div', { className: 'dshgit-card dshgit-lfs-panel' }, [h('strong', { key: 'title' }, t('identity.title')), h('label', { key: 'scope', className: 'dshgit-field' }, [h('span', { key: 'label', className: 'dshgit-fieldlabel' }, t('identity.scope')), h(ComboBox, { key: 'input', t: t, label: t('identity.scope'), value: scope[0], disabled: busy[0], searchable: false,
    options: ['local', 'global'].map(function (value) { return { value: value, label: t('identity.' + value) } }),
    onChange: function (value) { scope[1](value) } })]), h('div', { key: 'hint', className: 'dshgit-muted' }, t('identity.hint')),
    ['name', 'email'].map(function (key) { var state = key === 'name' ? name : email; return h('label', { key: key, className: 'dshgit-field' }, [h('span', { key: 'label', className: 'dshgit-fieldlabel' }, t('identity.' + key)), h('input', { key: 'input', className: 'dshgit-input', value: state[0], disabled: busy[0], onChange: function (event) { state[1](event.currentTarget.value) } })]) }),
    h('button', { key: 'save', type: 'button', className: 'dshgit-btn', disabled: busy[0] || !name[0].trim() || !email[0].trim(), onClick: function () { busy[1](true); message[1](''); props.run('write.setIdentity', { root: props.repo.root, scope: scope[0], name: name[0], email: email[0] }, { silentError: true }).then(function () { props.onSaved?.(); props.onChanged?.() }).catch(function (failure) { message[1](failure.message) }).finally(function () { busy[1](false) }) } }, t('identity.save')),
    message[0] ? h('div', { key: 'message', role: 'status', className: 'dshgit-hint' }, message[0]) : null,
  ])
}


function SettingsTab(props) {
  var t = props.t
  var fieldsId = React.useRef(null)
  if (fieldsId.current === null) fieldsId.current = nextControlId('dshgit-settings-')
  var configState = React.useState(null)
  var config = configState[0]
  var setConfig = configState[1]
  var diagState = React.useState(null)
  var diagnostics = diagState[0]
  var setDiagnostics = diagState[1]
  var savedToast = React.useState(null)
  var saveQueue = React.useRef(Promise.resolve())
  var editRevision = React.useRef(0)
  var saveError = React.useState('')

  React.useEffect(
    function () {
      props.run('config', {}, { silentError: true }).then(function (value) { setConfig(value); publishPluginConfig(value) }).catch(function () {})
      props.run('diagnostics', {}, { silentError: true }).then(setDiagnostics).catch(function () {})
    },
    [],
  )

  // LFS is a self-contained tool page: it owns its own scroll container and
  // loads its own data, so it is rendered before the settings form exists.
  if (props.section === 'lfs') return h(LfsPanel, Object.assign({ key: props.repo?.root || 'none' }, props))
  if (config === null) return h('div', { className: 'dshgit-empty' }, t('state.loading'))

  /** Patch and persist one setting. */
  var update = function (key, value) {
    var patch = typeof key === 'object' ? key : { [key]: value }
    if (key === 'aiProvider' || key === 'aiModel') patch.aiReasoningEffort = ''
    var revision = ++editRevision.current
    savedToast[1](null)
    saveError[1]('')
    setConfig(function (previous) { return Object.assign({}, previous, patch) })
    // A field blur can save just before a checkbox click. Preserve the
    // user's later edits while persisting patches in their original order.
    saveQueue.current = saveQueue.current.catch(function () {}).then(function () {
      return props.run('setConfig', { patch: patch }, { silentError: true })
    })
    return saveQueue.current
      .then(function (next) {
        if (revision === editRevision.current) setConfig(next)
        publishPluginConfig(next)
        if ((typeof value === 'boolean' || key === 'editorPath') && next?.[key] !== value) {
          throw new Error(t(key === 'autoFetch' ? 'settings.autoFetchUnavailable' : 'settings.notApplied'))
        }
        if (revision !== editRevision.current) return
        savedToast[1]({ seq: revision, text: t('settings.saved') })
        if (props.onChanged !== undefined) props.onChanged()
      })
      .catch(function (failure) {
        if (revision === editRevision.current) { savedToast[1](null); saveError[1](failure.message) }
        props.onToast?.(failure.message, 'error')
      })
  }

  /** One text field bound to a config key. */
  var field = function (key, label, placeholder, type, disabled) {
    return h('div', { key: key, className: 'dshgit-field' }, [
      h('label', { key: 'l', className: 'dshgit-fieldlabel', htmlFor: fieldsId.current + '-' + key }, label),
      h('input', {
        key: 'i',
        className: 'dshgit-input', id: fieldsId.current + '-' + key,
        type: type === undefined ? 'text' : type,
        disabled: disabled === true,
        value: config[key],
        placeholder: placeholder,
        onChange: function (event) {
          var value = event.currentTarget.value
          editRevision.current++
          setConfig(function (previous) { return Object.assign({}, previous, { [key]: value }) })
        },
        onBlur: function (event) { update(key, type === 'number' ? Number(event.currentTarget.value) : event.currentTarget.value) },
        onKeyDown: function (event) {
          if (event.key === 'Enter') update(key, type === 'number' ? Number(event.currentTarget.value) : event.currentTarget.value)
        },
      }),
    ])
  }

  /** One checkbox bound to a config key. */
  var toggle = function (key, label, disabled, checked) {
    return h('label', { key: key, className: 'dshgit-checkrow' }, [
      h('input', {
        key: 'i',
        type: 'checkbox',
        disabled: disabled === true,
        checked: checked === undefined ? config[key] === true : checked === true,
        onChange: function (event) { update(key, event.currentTarget.checked) },
      }),
      h('span', { key: 'l' }, label),
    ])
  }

  // Only the selected group renders: that is what keeps each page a short list
  // of settings that share one scope rather than a long scroll of everything.
  var section = props.section === undefined ? 'general' : props.section

  /** A titled card, so a page reads as named blocks instead of loose fields. */
  var card = function (key, title, hint, children) {
    return h('div', { key: key, className: 'dshgit-card' }, [
      h('div', { key: 'h', className: 'dshgit-cardhead' }, [
        h('strong', { key: 't' }, title),
        hint ? h('span', { key: 's', className: 'dshgit-muted' }, hint) : null,
      ]),
    ].concat(children))
  }

  /* ---------------------------------------------------------------- *
   * General — this Host and this panel; nothing here depends on a repo
   * ---------------------------------------------------------------- */

  var editorPathSupported = typeof config.editorPath === 'string'
  var gitCard = card('git', t('settings.groupGit'), null, [
    h('div', { key: 'state', className: 'dshgit-muted' }, props.gitPath
      ? t('settings.gitFound', { path: props.gitPath })
      : t('settings.gitMissing')),
    diagnostics !== null
      ? h('div', { key: 'v', className: 'dshgit-muted', style: { fontSize: 'var(--dshgit-font-small)' } },
          t('settings.version', { version: (diagnostics.sessions[0] && diagnostics.sessions[0].version) || '—' }))
      : null,
    field('gitPath', t('label.gitPath'), t('placeholder.gitPath')),
    field('editorPath', t('label.editorPath'), t('placeholder.editorPath'), 'text', !editorPathSupported),
    !editorPathSupported ? h('div', { key: 'editor-unavailable', className: 'dshgit-muted', role: 'alert' }, t('workflow.reloadHost')) : null,
    field('defaultRepo', t('label.defaultRepo'), t('placeholder.path')),
    h('div', { key: 'default-repo-hint', className: 'dshgit-muted' }, t('settings.defaultRepoHint')),
  ])

  // An older plugin Host drops an unknown key, so a value that never comes back
  // means the switch is not loaded there yet. The workspace-add shadow treats a
  // missing key as its default (on), so the checkbox has to say the same thing
  // rather than show an unchecked box for behaviour that is actually happening.
  var workspaceDialogSupported = typeof config.workspaceAddDialog === 'boolean'
  var interfaceCard = card('interface', t('settings.groupInterface'), t('settings.groupInterfaceHint'), [
    toggle('workspaceAddDialog', t('settings.workspaceAddDialog'), !workspaceDialogSupported, config.workspaceAddDialog !== false),
    h('div', { key: 'workspace-add-hint', className: 'dshgit-muted', role: workspaceDialogSupported ? undefined : 'alert' },
      t(workspaceDialogSupported ? 'settings.workspaceAddDialogHint' : 'settings.notApplied')),
  ])

  // Rename detection is how the diff decides a file was moved rather than deleted
  // and added, so it is a display setting, not a repository one.
  var diffCard = card('diff', t('settings.groupDiff'), null, [
    field('similarityThreshold', t('label.similarity') + '（1–100）', '50', 'number'),
    h('div', { key: 'diff-hint', className: 'dshgit-muted' }, t('settings.groupDiffHint')),
    // The list badge and the patch come from two different git calls: the list
    // uses `git status --find-renames` (Git's own default) while the patch uses
    // this setting, and only the patch honours it. Saying so here is cheaper than
    // a user concluding the panel contradicts itself.
    h('div', { key: 'diff-scope', className: 'dshgit-muted' }, t('settings.groupDiffScope')),
  ])

  /* ---------------------------------------------------------------- *
   * Sync — when this plugin talks to a remote, on any repository
   * ---------------------------------------------------------------- */

  var autoFetchSupported = typeof config.autoFetch === 'boolean' && Object.prototype.hasOwnProperty.call(config, 'autoFetchInterval')
  var fetchCard = card('fetch', t('settings.groupFetch'), null, [
    toggle('autoFetch', t('settings.autoFetch'), !autoFetchSupported),
    field('autoFetchInterval', t('settings.autoFetchInterval'), '5', 'number', !autoFetchSupported),
    h('div', { key: 'auto-fetch-hint', className: 'dshgit-muted', role: autoFetchSupported ? undefined : 'alert' },
      t(autoFetchSupported ? 'settings.autoFetchHint' : 'settings.autoFetchUnavailable')),
  ])

  /* ---------------------------------------------------------------- *
   * AI — model choice, then what it is allowed to read
   * ---------------------------------------------------------------- */

  var aiCard = h('div', { key: 'ai', className: 'dshgit-card', 'data-settings-card': 'ai-model' }, [
    h(AiModelSettings, { key: 'model', t: t, config: config, run: props.run, onChange: update,
      enabledControl: toggle('aiEnabled', t('label.aiEnabled')),
      manualFields: [field('aiProvider', t('label.aiProvider'), ''), field('aiModel', t('label.aiModel'), '')] }),
  ])

  /* ---------------------------------------------------------------- *
   * Diagnostics — read-only facts about caches
   * ---------------------------------------------------------------- */

  var diagnosticsCard = diagnostics !== null
    ? card('diag', t('settings.cache'), null, [
        h('dl', { key: 'kv', className: 'dshgit-kv' }, [
          h('dt', { key: 'n' }, 'node'),
          h('dd', { key: 'nv' }, diagnostics.node),
          h('dt', { key: 'p' }, 'platform'),
          h('dd', { key: 'pv' }, diagnostics.platform),
          h('dt', { key: 'r' }, t('settings.repo')),
          h('dd', { key: 'rv' }, diagnostics.sessions.length === 0
            ? t('settings.noRepo')
            : diagnostics.sessions.map(function (session) {
                var parts = Object.keys(session.cache || {}).map(function (kind) {
                  return kind + ':' + session.cache[kind].size
                })
                return session.root + '  (' + parts.join(', ') + ')'
              }).join(' | ')),
        ]),
      ])
    : h('div', { key: 'diag', className: 'dshgit-card' },
        h('div', { key: 'l', className: 'dshgit-muted' }, t('state.loading')))

  var groups = {
    general: [gitCard, interfaceCard, diffCard],
    sync: [fetchCard],
    ai: [aiCard, h(AiContextSettings, { key: 'ai-context', t: t, config: config, onChange: update })],
    diagnostics: [diagnosticsCard],
  }

  // The repository group owns its own scroll container: it composes the identity,
  // authentication and ignore-rule blocks, and each of those used to bring a
  // heading, which read as three competing page titles.
  if (section === 'repository') {
    if (!props.repo) return h('div', { className: 'dshgit-empty' }, t('settings.noRepo'))
    return h('div', { className: 'dshgit-scroll dshgit-settings-form dshgit-ignore-settings' }, [
      h('div', { key: 'heading', className: 'dshgit-ignore-heading' }, [
        h('strong', { key: 'title' }, t('settings.currentRepo')),
        h('div', { key: 'root', className: 'dshgit-muted dshgit-ignore-root', title: props.repo.root }, props.repo.root),
      ]),
      saveError[0] ? h('div', { key: 'save-error', role: 'alert', style: { color: 'var(--dshgit-error-text)' } }, saveError[0]) : null,
      h(IdentitySettings, { key: 'identity:' + props.repo.root, repo: props.repo, run: props.run, t: t, onChanged: props.onChanged,
        onSaved: function () { savedToast[1]({ seq: Date.now(), text: t('settings.saved') }) } }),
      h(AuthenticationHelp, { key: 'auth:' + props.repo.root, repo: props.repo, run: props.run, t: t }),
      h(LocalIgnoreSettings, { key: 'ignore:' + props.repo.root, repo: props.repo, run: props.run, t: t, onChanged: props.onChanged }),
      savedToast[0] ? h(Toast, { key: 'saved-toast', seq: savedToast[0].seq, text: savedToast[0].text, tone: 'success',
        onDone: function () { savedToast[1](null) } }) : null,
    ])
  }

  return h('div', { className: 'dshgit-scroll dshgit-settings-form' }, [
    saveError[0] ? h('div', { key: 'save-error', role: 'alert', style: { color: 'var(--dshgit-error-text)' } }, saveError[0]) : null,
    groups[section] === undefined ? groups.general : groups[section],
    savedToast[0] ? h(Toast, { key: 'saved-toast', seq: savedToast[0].seq, text: savedToast[0].text, tone: 'success',
      onDone: function () { savedToast[1](null) } }) : null,
  ])
}

export { SettingsNav, SettingsTab }

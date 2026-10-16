import { React, h } from '../../core/runtime.js'
import { ComboBox } from '../../ui/controls.js'
import { nextControlId } from '../../core/ids.js'
import { publishPluginConfig } from '../../core/state.js'
import { LfsPanel } from './lfs.js'
import { LocalIgnoreSettings } from './local-ignore.js'
import { Toast } from '../../ui/notifications.js'
import { AiModelSettings } from './ai.js'

/**
 * The settings module's sidebar: which group of settings is showing.
 *
 * Separate groups, because the settings page had grown into one long scroll of
 * unrelated concerns (paths, blame tuning, AI, diagnostics).
 */
function SettingsNav(props) {
  var t = props.t
  var sections = [
    { id: 'general', label: t('settings.general') },
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

  if (props.section === 'lfs') return h(LfsPanel, Object.assign({ key: props.repo?.root || 'none' }, props))
  if (props.section === 'repository') return props.repo
    ? h(LocalIgnoreSettings, Object.assign({}, props, { key: props.repo.root }))
    : h('div', { className: 'dshgit-empty' }, t('settings.noRepo'))
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
  var toggle = function (key, label, disabled) {
    return h('label', { key: key, className: 'dshgit-checkrow' }, [
      h('input', {
        key: 'i',
        type: 'checkbox',
        disabled: disabled === true,
        checked: config[key] === true,
        onChange: function (event) { update(key, event.currentTarget.checked) },
      }),
      h('span', { key: 'l' }, label),
    ])
  }

  // The three groups the sidebar navigates between. Rendering only the
  // selected one is what turns a single long scroll of unrelated settings
  // (paths, blame tuning, AI, diagnostics) into three scannable pages.
  var section = props.section === undefined ? 'general' : props.section

  var editorPathSupported = typeof config.editorPath === 'string'
  var generalCard = h('div', { key: 'git', className: 'dshgit-card' }, [
    h('div', { key: 'h', style: { fontWeight: 600 } }, props.gitPath ? t('settings.gitFound', { path: props.gitPath }) : t('settings.gitMissing')),
    diagnostics !== null
      ? h('div', { key: 'v', className: 'dshgit-muted', style: { fontSize: 'var(--dshgit-font-small)' } },
          t('settings.version', { version: (diagnostics.sessions[0] && diagnostics.sessions[0].version) || '—' }))
      : null,
    field('gitPath', t('label.gitPath'), t('placeholder.gitPath')),
    field('editorPath', t('label.editorPath'), t('placeholder.editorPath'), 'text', !editorPathSupported),
    !editorPathSupported ? h('div', { key: 'editor-unavailable', className: 'dshgit-muted', role: 'alert' }, t('workflow.reloadHost')) : null,
    field('defaultRepo', t('label.defaultRepo'), t('placeholder.path')),
  ])

  var autoFetchSupported = typeof config.autoFetch === 'boolean' && Object.prototype.hasOwnProperty.call(config, 'autoFetchInterval')
  var behaviourCard = h('div', { key: 'behaviour', className: 'dshgit-card' }, [
    toggle('autoFetch', t('settings.autoFetch'), !autoFetchSupported),
    field('autoFetchInterval', t('settings.autoFetchInterval'), '5', 'number', !autoFetchSupported),
    h('div', { key: 'auto-fetch-hint', className: 'dshgit-muted', role: autoFetchSupported ? undefined : 'alert' }, t(autoFetchSupported ? 'settings.autoFetchHint' : 'settings.autoFetchUnavailable')),
    field('similarityThreshold', t('label.similarity') + '（1–100）', '50', 'number'),
    field('blameChunkLines', t('label.blameChunk'), '2000', 'number'),
    field('historyLimit', t('label.historyLimit'), '300', 'number'),
  ])

  var aiCard = h('div', { key: 'ai', className: 'dshgit-card' }, [
    h(AiModelSettings, { key: 'model', t: t, config: config, run: props.run, onChange: update,
      enabledControl: toggle('aiEnabled', t('label.aiEnabled')),
      manualFields: [field('aiProvider', t('label.aiProvider'), ''), field('aiModel', t('label.aiModel'), '')] }),
  ])

  var diagnosticsCard = diagnostics !== null
    ? h('div', { key: 'diag', className: 'dshgit-card' }, [
        h('div', { key: 'h', style: { fontWeight: 600 } }, t('settings.cache')),
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
    general: [generalCard, props.repo ? h(IdentitySettings, { key: props.repo.root, repo: props.repo, run: props.run, t: t, onChanged: props.onChanged,
      onSaved: function () { savedToast[1]({ seq: Date.now(), text: t('settings.saved') }) } }) : null, props.repo ? h(AuthenticationHelp, { key: 'auth:' + props.repo.root, repo: props.repo, run: props.run, t: t }) : null, behaviourCard],
    ai: [aiCard],
    diagnostics: [diagnosticsCard],
  }

  return h('div', { className: 'dshgit-scroll dshgit-settings-form' }, [
    saveError[0] ? h('div', { key: 'save-error', role: 'alert', style: { color: 'var(--dshgit-error-text)' } }, saveError[0]) : null,
    groups[section] === undefined ? groups.general : groups[section],
    savedToast[0] ? h(Toast, { key: 'saved-toast', seq: savedToast[0].seq, text: savedToast[0].text, tone: 'success',
      onDone: function () { savedToast[1](null) } }) : null,
  ])
}

export { SettingsNav, SettingsTab }

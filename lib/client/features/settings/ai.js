import { React, h } from '../../core/runtime.js'
import { ComboBox } from '../../ui/controls.js'
import { IconRefresh } from '../../ui/icons.js'

/** One saved model pair, shared by all Git AI actions. */
function AiModelSettings(props) {
  var catalog = React.useState(null), error = React.useState(''), retry = React.useState(0), saving = React.useState(false)
  var pending = React.useRef(false), alive = React.useRef(true), t = props.t
  var info = React.useState(null), infoError = React.useState('')
  React.useEffect(function () { alive.current = true; return function () { alive.current = false } }, [])
  React.useEffect(function () {
    var active = true
    catalog[1](null); error[1]('')
    props.run('ai.models', {}, { silent: true, silentError: true }).then(function (value) {
      if (active) catalog[1](value)
    }).catch(function (failure) {
      if (active) { catalog[1]({ supported: false, models: [] }); error[1](failure.code === 'git/unknown-method' ? t('workflow.reloadHost') : failure.message) }
    })
    return function () { active = false }
  }, [props.run, retry[0]])
  var provider = props.config.aiProvider || '', model = props.config.aiModel || ''
  React.useEffect(function () {
    var active = true, controller = new AbortController()
    info[1](null); infoError[1]('')
    props.run('ai.modelInfo', { provider: provider, model: model }, { silent: true, silentError: true, signal: controller.signal }).then(function (value) {
      if (active) info[1](value)
    }).catch(function (failure) {
      if (active) { info[1]({ supported: false, reasoning: null }); infoError[1](failure.code === 'git/unknown-method' ? t('workflow.reloadHost') : failure.message) }
    })
    return function () { active = false; controller.abort() }
  }, [props.run, provider, model, retry[0]])
  var value = provider || model ? JSON.stringify([provider, model]) : ''
  var options = [{ value: '', label: t('settings.aiFollowSession') }].concat((catalog[0]?.models || []).map(function (entry) {
    return { value: JSON.stringify([entry.provider, entry.id]), label: entry.name + ' · ' + entry.providerName }
  }))
  if (value && !options.some(function (option) { return option.value === value })) options.push({ value: value, label: model + ' · ' + provider })
  var save = async function (patch) {
    if (pending.current) return
    pending.current = true; saving[1](true)
    try { await props.onChange(patch) }
    finally { pending.current = false; if (alive.current) saving[1](false) }
  }
  var choose = function (next) {
    var pair = next ? JSON.parse(next) : ['', '']
    return save({ aiProvider: pair[0], aiModel: pair[1], aiReasoningEffort: '' })
  }
  var effort = props.config.aiReasoningEffort || '', efforts = info[0]?.reasoning?.efforts || []
  var reasoningOptions = [{ value: '', label: t(value ? 'settings.aiReasoningDefault' : 'settings.aiReasoningFollow') }]
    .concat(efforts.map(function (entry) { return { value: entry.id, label: entry.name } }))
  if (effort && !efforts.some(function (entry) { return entry.id === effort })) reasoningOptions.push({ value: effort, label: effort })
  return h('div', { className: 'dshgit-ai-settings' }, [
    h('div', { key: 'header', className: 'dshgit-ai-header' }, [
      props.enabledControl,
      h('button', { key: 'refresh', type: 'button', className: 'dshgit-btn', disabled: !catalog[0] || saving[0], onClick: function () { retry[1](retry[0] + 1) } }, [
        h(IconRefresh, { key: 'icon' }), h('span', { key: 'label' }, t(catalog[0] ? 'action.refresh' : 'state.loading')),
      ]),
    ]),
    h('div', { key: 'fields', className: 'dshgit-ai-fields' }, [
      h('div', { key: 'picker', className: 'dshgit-field' }, [
        h('span', { key: 'label', className: 'dshgit-fieldlabel' }, t('settings.aiModelChoice')),
        h(ComboBox, { key: 'input', t: t, value: value, options: options, label: t('settings.aiModelChoice'),
          disabled: saving[0] || props.config.aiEnabled === false, onChange: choose }),
        h('div', { key: 'hint', className: 'dshgit-ai-help' }, t('settings.aiModelHint')),
      ]),
      h('div', { key: 'reasoning', className: 'dshgit-field' }, [
        h('span', { key: 'label', className: 'dshgit-fieldlabel' }, t('settings.aiReasoning')),
        h(ComboBox, { key: 'input', t: t, value: effort, options: reasoningOptions, label: t('settings.aiReasoning'), searchable: false,
          disabled: saving[0] || props.config.aiEnabled === false || typeof props.config.aiReasoningEffort !== 'string' || !info[0] || (!efforts.length && !effort),
          onChange: function (next) { return save({ aiReasoningEffort: next }) } }),
        h('div', { key: 'hint', className: 'dshgit-ai-help' }, typeof props.config.aiReasoningEffort !== 'string' ? t('workflow.reloadHost')
          : infoError[0] || t(!info[0] ? 'state.loading' : efforts.length ? 'settings.aiReasoningHint' : 'settings.aiReasoningUnavailable')),
      ]),
    ]),
    error[0] ? h('div', { key: 'error', role: 'alert' }, error[0]) : null,
    catalog[0] && (!catalog[0].supported || catalog[0].partial || !catalog[0].models?.length) ? h('div', { key: 'fallback', className: 'dshgit-muted' }, t('settings.aiManualHint')) : null,
    h('details', { key: 'manual', className: 'dshgit-ai-manual' }, [
      h('summary', { key: 'label' }, t('settings.aiManual')),
      h('div', { key: 'fields', className: 'dshgit-ai-fields' }, props.manualFields),
    ]),
    h('p', { key: 'privacy', className: 'dshgit-ai-help dshgit-ai-privacy' }, t('settings.aiPrivacy')),
  ])
}

export { AiModelSettings }

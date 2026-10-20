import { React, h } from '../../core/runtime.js'
import { DEFAULT_AI_EXCLUDE_PATTERNS } from '../../../shared/aiContextPolicy.js'

/** Commit-message input policy has its own card, separate from model choice. */
function AiContextSettings(props) {
  var t = props.t, exclude = React.useState(props.config.aiExcludePatterns || DEFAULT_AI_EXCLUDE_PATTERNS)
  React.useEffect(function () { exclude[1](props.config.aiExcludePatterns || DEFAULT_AI_EXCLUDE_PATTERNS) }, [props.config.aiExcludePatterns])
  return h('div', { className: 'dshgit-card', 'data-settings-card': 'ai-context' }, [
    h('strong', { key: 'title' }, t('settings.aiContext')),
    h('label', { key: 'exclude', className: 'dshgit-field', style: { marginTop: '16px', marginBottom: 0 } }, [
      h('span', { key: 'label', className: 'dshgit-fieldlabel' }, t('settings.aiExclude')),
      h('textarea', { key: 'input', className: 'dshgit-textarea', rows: 5, value: exclude[0], maxLength: 8000,
        'aria-label': t('settings.aiExclude'), placeholder: 'dist/**\nbuild/**\n**/*.map\n!dist/important.js',
        disabled: props.config.aiEnabled === false || typeof props.config.aiExcludePatterns !== 'string',
        onChange: function (event) { exclude[1](event.target.value) },
        onBlur: function () { if (exclude[0] !== (props.config.aiExcludePatterns || '')) props.onChange({ aiExcludePatterns: exclude[0] }) },
      }),
      h('span', { key: 'hint', className: 'dshgit-ai-help' }, t(typeof props.config.aiExcludePatterns !== 'string' ? 'workflow.reloadHost' : 'settings.aiExcludeHint')),
    ]),
  ])
}

export { AiContextSettings }

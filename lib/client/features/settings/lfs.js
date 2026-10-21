import { watchOperation } from '../../core/operations.js'
import { Fragment, React, h } from '../../core/runtime.js'
import { ChipNotice, OperationProgress } from '../../ui/notifications.js'
import { ComboBox } from '../../ui/controls.js'

var lfsSummarySnapshots = new Map()

function cachedLfsSummary(root) {
  var saved = lfsSummarySnapshots.get(root)
  if (saved && Date.now() - saved.at < 30_000) return saved.value
  lfsSummarySnapshots.delete(root)
  return null
}

function LfsPanel(props) {
  var t = props.t, root = props.repo?.root
  var data = React.useState(function () { return cachedLfsSummary(root) }), error = React.useState(''), pattern = React.useState(''), remotes = React.useState([]), refs = React.useState([])
  var statusLoading = React.useState(true), detailsReady = React.useState(false), loadEpoch = React.useRef(0)
  var remote = React.useState(''), mode = React.useState('import'), filter = React.useState('pattern'), include = React.useState(''), exclude = React.useState(''), above = React.useState('50 MB'), selected = React.useState([])
  var uploadRef = React.useState(''), transferAdvanced = React.useState(false), migrationAdvanced = React.useState(false)
  var preview = React.useState(null), acknowledged = React.useState(false), job = React.useState(null), working = React.useState(false), restore = React.useState(null), alive = React.useRef(true)
  var filesOpen = React.useState(false), fileQuery = React.useState(''), filePage = React.useState(1), fileData = React.useState(null), filesBusy = React.useState(false), fileRefresh = React.useState(0), fileRevision = React.useRef(-1), retryRequest = React.useRef(null)
  var busy = working[0] || job[0]?.state === 'running'
  React.useEffect(function () { if (!busy) return; props.onBusy?.(true); return function () { props.onBusy?.(false) } }, [busy])
  var call = function (method, body, options) { return props.run(method, Object.assign({ root: root }, body || {}), Object.assign({ silent: true, silentError: true }, options)) }
  var load = function (force) {
    var epoch = ++loadEpoch.current
    var current = function () { return alive.current && epoch === loadEpoch.current }
    var report = function (failure) { if (current()) error[1](failure.message) }
    statusLoading[1](true)
    var summary = call('lfsStatus', { summaryOnly: true, force: force === true }).then(function (value) {
      if (current()) {
        data[1](function (previous) { return Object.assign({}, previous, value, { rules: previous?.rules || '', backups: previous?.backups || [] }) })
        lfsSummarySnapshots.delete(root); lfsSummarySnapshots.set(root, { at: Date.now(), value: value })
        if (lfsSummarySnapshots.size > 8) lfsSummarySnapshots.delete(lfsSummarySnapshots.keys().next().value)
      }
      return value
    }).finally(function () { if (current()) statusLoading[1](false) })
    summary.then(function (value) {
      if (!current() || !value.installed) return
      return call('lfsDetails', { force: force === true }).then(function (details) { if (current()) { data[1](function (value) { return Object.assign({}, value, details) }); detailsReady[1](true) } })
    }).catch(report)
    call('remotes').then(function (values) { if (current()) { remotes[1](values); remote[1](function (value) { return values.some(function (item) { return item.name === value }) ? value : values[0]?.name || '' }) } }).catch(report)
    call('lfsBranches').then(function (branches) {
      if (!current()) return
      refs[1](branches)
      uploadRef[1](function (value) { return branches.some(function (branch) { return branch.ref === value }) ? value : '' })
      selected[1](function (value) { var retained = value.filter(function (ref) { return branches.some(function (branch) { return branch.ref === ref }) }); return retained.length ? retained : branches.filter(function (branch) { return branch.head }).map(function (branch) { return branch.ref }) })
    }).catch(report)
    return summary
  }
  React.useEffect(function () { alive.current = true; if (root) { load().catch(function (failure) { if (alive.current) error[1](failure.message) }); call('operationStatus').then(function (value) { if (alive.current) job[1](value) }).catch(function () {}) } return function () { alive.current = false } }, [root])
  React.useEffect(function () {
    if (!root || !filesOpen[0]) return
    var stopped = false
    var controller = new AbortController()
    filesBusy[1](true)
    var timer = setTimeout(function () { call('lfsFiles', { query: fileQuery[0], page: filePage[0], force: fileRevision.current !== fileRefresh[0] }, { signal: controller.signal }).then(function (value) {
      if (!stopped) { fileRevision.current = fileRefresh[0]; fileData[1](value) }
    }).catch(function (failure) { if (!stopped) error[1](failure.message) }).finally(function () { if (!stopped) filesBusy[1](false) }) }, 250)
    return function () { stopped = true; clearTimeout(timer); controller.abort() }
  }, [root, filesOpen[0], fileQuery[0], filePage[0], fileRefresh[0]])
  React.useEffect(function () {
    if (!job[0] || job[0].state !== 'running') return
    var controller = new AbortController()
    // A lost status response does not mean the Host job stopped. Keep its
    // identity and the busy state until we observe a terminal result.
    watchOperation(call, job[0], { signal: controller.signal, maxFailures: Infinity, returnJob: true, onUpdate: function (value) { if (value.state === 'running') job[1](value) } }).then(function (value) {
      if (!value || controller.signal.aborted) return
      job[1](value)
      if (!value.result?.ok) error[1](value.result?.error?.message || t('lfs.' + value.state))
      else if (value.method === 'lfsMigrationPreview') preview[1](value.result.value)
      else props.onToast?.(value.result?.value?.message || t('lfs.complete'))
      load().catch(function (failure) { error[1](failure.message) }); fileRefresh[1](function (value) { return value + 1 }); props.onChanged?.()
    }).catch(function (failure) { if (!controller.signal.aborted) error[1](failure.message) })
    return function () { controller.abort() }
  }, [job[0]?.id, job[0]?.state])
  var perform = function (method, body) {
    error[1](''); working[1](true)
    return call(method, body).then(function (value) { if (alive.current) { props.onToast?.(value.message || t('lfs.complete')); return load().then(function () { fileRefresh[1](function (value) { return value + 1 }); props.onChanged?.() }) } }).catch(function (failure) { if (alive.current) error[1](failure.message) }).finally(function () { if (alive.current) working[1](false) })
  }
  var start = function (method, parameters) { retryRequest.current = ['write.lfsTransfer', 'lfsMigrationPreview'].includes(method) ? { method: method, parameters: parameters } : null; error[1](''); working[1](true); call('operationStart', { method: method, parameters: parameters }).then(function (value) { if (alive.current) job[1](value) }).catch(function (failure) { if (alive.current) error[1](failure.message) }).finally(function () { if (alive.current) working[1](false) }) }
  var change = function (state, value) { state[1](value); preview[1](null); acknowledged[1](false); retryRequest.current = null }
  var config = function () { return { mode: mode[0], refs: selected[0], include: filter[0] === 'pattern' || mode[0] === 'export' ? include[0] : '', exclude: filter[0] === 'pattern' || mode[0] === 'export' ? exclude[0] : '', above: filter[0] === 'size' && mode[0] === 'import' ? above[0] : '', remote: mode[0] === 'export' ? remote[0] : '' } }
  var input = function (key, state, placeholder) { return h('label', { key: key, className: 'dshgit-field' }, [h('span', { key: 'label', className: 'dshgit-fieldlabel' }, t('lfs.' + key)), h('input', { key: 'input', className: 'dshgit-input', value: state[0], placeholder: placeholder, disabled: busy, onChange: function (event) { change(state, event.currentTarget.value) } })]) }
  var button = function (key, onClick, disabled, primary) { return h('button', { key: key, type: 'button', className: 'dshgit-btn' + (primary ? ' dshgit-btn-primary' : ''), disabled: busy || disabled, onClick: onClick }, t(key.startsWith('action.') ? key : 'lfs.' + key)) }
  var actions = function (key, children) { return h('div', { key: key, className: 'dshgit-lfs-actions' }, children) }
  var hint = function (key) { return h('div', { key: key, className: 'dshgit-muted' }, t('lfs.' + key)) }
  /**
   * One panel section: a title, a "when would I use this?" line, then the
   * controls.
   *
   * The scenario line is the point of the layout. Status, rules, transfers
   * and migration all present as "LFS buttons", so without a sentence saying
   * what each is FOR, the panel reads as an undifferentiated wall — and the
   * expensive mistakes (rewriting history when you only meant to download)
   * come from picking the wrong section.
   */
  var section = function (key, children) {
    return h('section', { key: key, className: 'dshgit-lfs-section', 'data-lfs-section': key }, [
      h('div', { key: 'head', className: 'dshgit-lfs-sectionhead' }, [
        h('strong', { key: 'title' }, t('lfs.section' + key[0].toUpperCase() + key.slice(1))),
        h('div', { key: 'scenario', className: 'dshgit-lfs-scenario' }, t('lfs.scenario' + key[0].toUpperCase() + key.slice(1))),
      ]),
    ].concat(children))
  }
  /** A labelled group inside a section, so controls never float unlabelled. */
  var step = function (key, label, children) {
    return h('div', { key: key, className: 'dshgit-lfs-step' }, [h('div', { key: 'label', className: 'dshgit-lfs-steplabel' }, label)].concat(children))
  }
  var choices = function (key, state, values) { return actions(key, values.map(function (item) { return h('label', { key: item.value, className: 'dshgit-checkrow' }, [h('input', { key: 'input', type: 'radio', checked: state[0] === item.value, disabled: busy, onChange: function () { change(state, item.value); if (item.value === 'export') filter[1]('pattern') } }), t('lfs.' + item.label)]) })) }
  if (!root) return h('div', { className: 'dshgit-empty' }, t('lfs.noRepo'))
  var currentBranch = refs[0].find(function (branch) { return branch.head })
  var installed = data[0]?.installed === true
  var initialized = data[0]?.initialized === true

  // ---- Status: is LFS usable here at all? --------------------------------
  var statusRows = [
    h('div', { key: 'row', className: 'dshgit-lfs-statusrow' }, [
      h('span', { key: 'k', className: 'dshgit-lfs-statuskey' }, t('lfs.statusInstalled')),
      data[0]
        ? h('span', { key: 'v', className: 'dshgit-lfs-statusval' + (installed ? '' : ' dshgit-lfs-bad') },
            installed ? data[0].version : data[0].error ? t('lfs.missingReason', { message: data[0].error }) : t('lfs.missing'))
        : h('span', { key: 'v', className: 'dshgit-muted' }, t(statusLoading[0] ? 'state.loading' : 'lfs.unavailable')),
    ]),
  ]
  if (installed) {
    statusRows.push(h('div', { key: 'filters', className: 'dshgit-lfs-statusrow' }, [
      h('span', { key: 'k', className: 'dshgit-lfs-statuskey' }, t('lfs.statusFilters')),
      h('span', { key: 'v', className: 'dshgit-lfs-statusval', role: 'status', 'data-lfs-configured': initialized },
        t(initialized ? 'lfs.statusFiltersOn' : 'lfs.statusFiltersOff')),
    ]))
    // The consequence, spelled out. "未配置" alone does not tell a user that
    // their next commit will silently miss LFS.
    statusRows.push(h('div', { key: 'advice', className: 'dshgit-lfs-advice' + (initialized ? '' : ' dshgit-lfs-warn') },
      t(initialized ? 'lfs.enabledNow' : 'lfs.enableFirst')))
  }
  var statusActions = [
    button('action.refresh', function () { error[1](''); fileRefresh[1](function (value) { return value + 1 }); load(true).catch(function (failure) { error[1](failure.message) }) }, statusLoading[0]),
  ]
  if (installed && !initialized) statusActions.push(button('initialize', function () { perform('write.lfsInitialize') }, false, true))
  if (data[0]?.installed === false && !data[0].error) statusActions.push(h('a', { key: 'guide', href: 'https://git-lfs.com/', target: '_blank', rel: 'noopener noreferrer' }, t('lfs.installGuide')))
  if (statusLoading[0] && data[0]) statusActions.push(h('span', { key: 'refreshing', className: 'dshgit-muted' }, t('lfs.refreshing')))
  statusRows.push(actions('actions', statusActions))

  var content = [section('status', statusRows)]
  if (error[0]) content.push(h(ChipNotice, { key: 'error', t: t, outcome: { id: 'lfs-error', tone: 'error', summary: error[0] }, onDismiss: function () { error[1]('') } }))
  if (job[0]?.state === 'running' && !error[0]) content.push(h(OperationProgress, { key: 'progress', job: job[0], t: t, onCancel: ['write.lfsMigrate', 'write.lfsRestore'].includes(job[0].method) ? null : function () { call('operationCancel', { id: job[0].id }).catch(function (failure) { error[1](failure.message) }) } }))
  if (['failed', 'cancelled'].includes(job[0]?.state) && retryRequest.current) content.push(actions('retry', [h('span', { key: 'state' }, t('lfs.' + job[0].state)), button('retry', function () { var request = retryRequest.current; start(request.method, request.parameters) })]))
  // Everything past the status block needs a working LFS install; offering
  // buttons that can only fail is worse than saying why they are hidden.
  if (installed) content.push(
    section('rules', [
      h('div', { key: 'current', className: 'dshgit-lfs-listlabel' }, t('lfs.rulesList')),
      h('pre', { key: 'rules', className: 'dshgit-lfs-rules' }, detailsReady[0] ? data[0].rules || t('lfs.rulesEmpty') : t('state.loading')),
      h('div', { key: 'edit', className: 'dshgit-lfs-inline' }, [
        h('label', { key: 'field', className: 'dshgit-field dshgit-lfs-grow' }, [
          h('span', { key: 'label', className: 'dshgit-fieldlabel' }, t('lfs.pattern')),
          h('input', { key: 'input', className: 'dshgit-input', value: pattern[0], placeholder: t('lfs.rulePlaceholder'), disabled: busy,
            onChange: function (event) { change(pattern, event.currentTarget.value) } }),
        ]),
        button('trackAction', function () { perform('write.lfsTrack', { pattern: pattern[0] }) }, !pattern[0].trim(), true),
        button('untrackAction', function () { perform('write.lfsTrack', { pattern: pattern[0], untrack: true }) }, !pattern[0].trim()),
      ]),
      hint('trackScenarioHint'),
      hint('ruleHint'),
    ]),
    section('transfers', [
      h('div', { key: 'current', className: 'dshgit-lfs-statusrow' }, [
        h('span', { key: 'k', className: 'dshgit-lfs-statuskey' }, t('lfs.currentBranch')),
        h('span', { key: 'v', className: 'dshgit-lfs-statusval' }, currentBranch?.name || t('lfs.noCurrentBranch')),
      ]),
      h('label', { key: 'remote', className: 'dshgit-field' }, [
        h('span', { key: 'label', className: 'dshgit-fieldlabel' }, t('lfs.remote')),
        h(ComboBox, { key: 'select', t: t, label: t('lfs.remote'), placeholder: t('lfs.noRemote'),
          disabled: busy || !remotes[0].length, value: remote[0], searchable: false,
          options: remotes[0].map(function (item) { return { value: item.name, label: item.name } }),
          onChange: function (value) { change(remote, value) } }),
      ]),
      actions('actions', [
        h('button', { key: 'pull', type: 'button', className: 'dshgit-btn dshgit-btn-primary', disabled: busy || !remote[0] || !currentBranch, title: 'git lfs pull ' + remote[0],
          onClick: function () { start('write.lfsTransfer', { action: 'pull', remote: remote[0] }) } }, t('lfs.downloadCurrent')),
        h('button', { key: 'push', type: 'button', className: 'dshgit-btn', disabled: busy || !remote[0] || !currentBranch, title: 'git lfs push --all ' + remote[0] + ' ' + currentBranch?.name,
          onClick: function () { start('write.lfsTransfer', { action: 'push', remote: remote[0], ref: currentBranch.ref }) } }, t('lfs.uploadCurrent')),
      ]),
      hint('transferHint'),
      h('button', { key: 'advanced', type: 'button', className: 'dshgit-btn dshgit-lfs-disclosure', disabled: busy, 'aria-expanded': transferAdvanced[0],
        onClick: function () { transferAdvanced[1](!transferAdvanced[0]) } }, t(transferAdvanced[0] ? 'lfs.hideAdvanced' : 'lfs.transferAdvanced')),
      transferAdvanced[0] ? h('div', { key: 'advancedfields', className: 'dshgit-lfs-advanced' }, [
        h('label', { key: 'branch', className: 'dshgit-field' }, [
          h('span', { key: 'label', className: 'dshgit-fieldlabel' }, t('lfs.uploadBranch')),
          h(ComboBox, { key: 'select', t: t, label: t('lfs.uploadBranch'), placeholder: t('lfs.selectUploadBranch'),
            disabled: busy || !refs[0].length, value: uploadRef[0],
            options: refs[0].map(function (branch) { return { value: branch.ref, label: branch.name } }),
            onChange: function (value) { uploadRef[1](value); retryRequest.current = null } }),
        ]),
        actions('actions', [button('pushSelected', function () { start('write.lfsTransfer', { action: 'push', remote: remote[0], ref: uploadRef[0] }) }, !remote[0] || !uploadRef[0]), button('fsck', function () { start('write.lfsTransfer', { action: 'fsck' }) })]),
        hint('advancedTransferHint'),
      ]) : null,
    ]),
    section('files', [
      hint('filesHint'),
      button(filesOpen[0] ? 'hideFiles' : 'showFiles', function () { filesOpen[1](!filesOpen[0]) }),
      filesOpen[0] ? h('div', { key: 'details', className: 'dshgit-lfs-files', 'data-lfs-files': true }, [
        h('input', { key: 'search', type: 'search', className: 'dshgit-input', value: fileQuery[0], placeholder: t('lfs.searchFiles'), 'aria-label': t('lfs.searchFiles'), onChange: function (event) { fileQuery[1](event.currentTarget.value); filePage[1](1) } }),
        filesBusy[0] ? h('span', { key: 'loading', role: 'status' }, t('state.loading')) : null,
        fileData[0] && !filesBusy[0] ? h(Fragment, { key: 'loaded' }, [
          h('span', { key: 'count', className: 'dshgit-muted' }, fileData[0].matched == null ? t('lfs.shownFiles', { count: fileData[0].files.length }) : t('lfs.fileCount', fileData[0])),
          h('div', { key: 'files', className: 'dshgit-lfs-filelist' }, fileData[0].files.length
            ? fileData[0].files.map(function (file) { return h('div', { key: file.name, className: 'dshgit-lfs-row' }, [
                h('span', { key: 'name', className: 'dshgit-name', title: file.name }, file.name),
                h('span', { key: 'state', className: 'dshgit-lfs-tag' + (file.checkout ? ' dshgit-lfs-tag-ok' : '') }, t(file.checkout ? 'lfs.downloaded' : 'lfs.pointer')),
              ]) })
            : h('div', { className: 'dshgit-muted' }, t('lfs.noFiles'))),
          actions('pages', [button('previous', function () { filePage[1](fileData[0].page - 1) }, fileData[0].page <= 1), h('span', { key: 'page', className: 'dshgit-muted' }, fileData[0].matched == null ? t('lfs.partialPage', { page: fileData[0].page }) : t('lfs.page', { page: fileData[0].page, pages: Math.max(1, Math.ceil(fileData[0].matched / fileData[0].pageSize)) })), button('next', function () { filePage[1](fileData[0].page + 1) }, fileData[0].hasNext === undefined ? fileData[0].page * fileData[0].pageSize >= fileData[0].matched : !fileData[0].hasNext)]),
        ]) : null,
      ]) : null,
    ]),
    // Migration is last and deliberately the most "walled off": it is the
    // only section here that rewrites published history.
    section('migrate', [
      h('div', { key: 'danger', className: 'dshgit-lfs-danger' }, t('lfs.migrationHint')),
      step('purpose', t('lfs.stepPurpose'), [
        choices('mode', mode, [{ value: 'import', label: 'import' }, { value: 'export', label: 'export' }]),
        hint(mode[0] === 'import' ? 'importHint' : 'exportHint'),
      ]),
      step('scope', t('lfs.stepFiles'), [
        h('div', { key: 'branches', className: 'dshgit-lfs-statusrow' }, [
          h('span', { key: 'k', className: 'dshgit-lfs-statuskey' }, t('lfs.scopeLabel')),
          h('span', { key: 'v', className: 'dshgit-lfs-statusval', 'data-lfs-migration-scope': true },
            refs[0].filter(function (branch) { return selected[0].includes(branch.ref) }).map(function (branch) { return branch.name }).join(', ') || t('lfs.selectBranches')),
        ]),
        mode[0] === 'import' ? choices('filter', filter, [{ value: 'pattern', label: 'byPattern' }, { value: 'size', label: 'bySize' }]) : null,
        h('div', { key: 'fields', className: 'dshgit-lfs-inline' }, filter[0] === 'size' && mode[0] === 'import'
          ? [input('above', above, '50 MB')]
          : [input('pattern', include, '*.psd,*.zip')]),
        hint(filter[0] === 'size' && mode[0] === 'import' ? 'sizeExample' : 'patternExample'),
        h('button', { key: 'advanced', type: 'button', className: 'dshgit-btn dshgit-lfs-disclosure', disabled: busy, 'aria-expanded': migrationAdvanced[0],
          onClick: function () { migrationAdvanced[1](!migrationAdvanced[0]) } }, t(migrationAdvanced[0] ? 'lfs.hideMigrationAdvanced' : 'lfs.migrationAdvanced')),
        migrationAdvanced[0] ? h('div', { key: 'advancedfields', className: 'dshgit-lfs-advanced' }, [
          h('span', { key: 'branchlabel', className: 'dshgit-fieldlabel' }, t('lfs.branches')),
          h('div', { key: 'branches', className: 'dshgit-lfs-branchpick' }, refs[0].map(function (branch) {
            return h('label', { key: branch.ref, className: 'dshgit-checkrow' }, [
              h('input', { key: 'input', type: 'checkbox', disabled: busy, checked: selected[0].includes(branch.ref),
                onChange: function (event) { change(selected, event.currentTarget.checked ? selected[0].concat(branch.ref) : selected[0].filter(function (ref) { return ref !== branch.ref })) } }),
              branch.name,
            ])
          })),
          filter[0] === 'pattern' || mode[0] === 'export' ? input('exclude', exclude, 'vendor/**') : null,
        ]) : null,
      ]),
      step('preview', t('lfs.stepPreview'), [
        button('scan', function () { preview[1](null); acknowledged[1](false); start('lfsMigrationPreview', config()) }, !selected[0].length || !(filter[0] === 'size' && mode[0] === 'import' ? above[0].trim() : include[0].trim())),
        preview[0] ? h('div', { key: 'preview', className: 'dshgit-lfs-preview' }, [
          h('div', { key: 'count', className: 'dshgit-muted' }, t('lfs.scopeSummary', { count: preview[0].commitCount, published: preview[0].publishedCount })),
          h('pre', { key: 'report', className: 'dshgit-lfs-report' }, preview[0].report || t('lfs.empty')),
          h('code', { key: 'command', className: 'dshgit-lfs-code' }, preview[0].command.join(' ')),
          h('div', { key: 'refs', className: 'dshgit-muted' }, preview[0].refs.map(function (ref) { return ref.ref.replace('refs/heads/', '') + ' · ' + ref.sha.slice(0, 8) }).join(', ')),
          h('div', { key: 'backup', className: 'dshgit-lfs-danger' }, t('lfs.backupHint')),
          h('label', { key: 'confirm', className: 'dshgit-checkrow' }, [
            h('input', { key: 'input', type: 'checkbox', checked: acknowledged[0], disabled: busy, onChange: function (event) { acknowledged[1](event.currentTarget.checked) } }),
            t('lfs.confirm'),
          ]),
          button('execute', function () { start('write.lfsMigrate', Object.assign({}, config(), { config: preview[0].config, snapshot: preview[0].snapshot, confirm: true })); preview[1](null); acknowledged[1](false) }, !acknowledged[0], true),
        ]) : null,
      ]),
    ]),
    section('backups', [
      !detailsReady[0] ? h('div', { className: 'dshgit-muted' }, t('state.loading'))
        : data[0].backups.length ? h('div', { key: 'list', className: 'dshgit-lfs-backups' }, data[0].backups.map(function (backup) {
            return h('div', { key: backup.id, className: 'dshgit-lfs-backup' }, [
              h('div', { key: 'row', className: 'dshgit-lfs-row' }, [
                h('span', { key: 'name', className: 'dshgit-name', title: backup.refs.join(', ') },
                  new Date(backup.createdAt).toLocaleString() + ' · ' + t('lfs.' + backup.mode) + ' · ' + t('lfs.' + backup.state)),
                button('restore', function () { restore[1](backup.id) }, backup.state === 'restored' || backup.state === 'running'),
              ]),
              restore[0] === backup.id ? h('div', { key: 'confirm', className: 'dshgit-lfs-advanced' }, [
                hint('restoreConfirm'),
                actions('actions', [button('action.cancel', function () { restore[1](null) }), button('restore', function () { start('write.lfsRestore', { id: backup.id, confirm: true }); restore[1](null) }, false, true)]),
              ]) : null,
            ])
          })) : h('div', { className: 'dshgit-muted' }, t('lfs.empty')),
    ]),
  )
  return h('div', { className: 'dshgit-scroll dshgit-settings-form dshgit-lfs-panel', 'data-lfs-panel': true }, content)
}

export { LfsPanel }

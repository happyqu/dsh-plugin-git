import { Spinner } from './spinner.js'
import { React, ReactDOM, h } from '../core/runtime.js'
import { baseName } from '../core/files.js'
import { ComboBox, dialogOption, useDialogFocus } from './controls.js'

/** A small form dialog: clone, new branch, new tag, add/remove remote. */
/** Add a remote and optionally continue the original first push. */
function RemoteConfigDialog(props) {
  var t = props.t, dialogRef = React.useRef(null), pending = React.useRef(false)
  var mounted = React.useRef(true), repositoryRetry = React.useState(0)
  React.useEffect(function () { return function () { mounted.current = false } }, [])
  var source = React.useState('url'), name = React.useState('origin'), url = React.useState('')
  var sourceTouched = React.useRef(false)
  var githubMode = React.useState('new'), repositoryName = React.useState(baseName(props.repo.root.replace(/\\/g, '/')).replace(/[^a-z\d_.-]/gi, '-'))
  var visibility = React.useState('private'), created = React.useRef(null), createdState = React.useState(false)
  var accounts = React.useState(null), account = React.useState(''), repositories = React.useState([])
  var page = React.useState(1), more = React.useState(false), repoLoading = React.useState(false), repoError = React.useState(null)
  var busy = React.useState(false), error = React.useState(null), saved = React.useState(false)
  var close = function () { if (!pending.current) props.onClose() }
  var chooseSource = function (kind) { sourceTouched.current = true; source[1](kind); if (kind === 'url') created.current = null }
  useDialogFocus(dialogRef, close)
  React.useEffect(function () {
    var active = true
    props.run('hostingAccounts', { root: props.repo.root }, { silentError: true })
      .then(function (value) { if (active) { accounts[1](value.accounts || []); account[1](value.accounts?.[0]?.id || ''); if (props.initialPush && value.accounts?.length && !sourceTouched.current) source[1]('github') } })
      .catch(function () { if (active) accounts[1]([]) })
    return function () { active = false }
  }, [props.repo.root])
  React.useEffect(function () {
    if (source[0] !== 'github' || githubMode[0] !== 'existing' || !account[0]) return
    var active = true
    repoLoading[1](true); repoError[1](null)
    props.run('hostingRepositories', { root: props.repo.root, account: account[0], page: page[0] }, { silentError: true })
      .then(function (value) {
        if (!active) return
        repositories[1](function (rows) { return page[0] === 1 ? value.repositories || [] : rows.concat(value.repositories || []).filter(function (row, index, all) { return all.findIndex(function (other) { return other.url === row.url }) === index }) })
        more[1](value.hasMore === true)
      }).catch(function (failure) { if (active) repoError[1](failure.message) })
      .finally(function () { if (active) repoLoading[1](false) })
    return function () { active = false }
  }, [props.repo.root, source[0], githubMode[0], account[0], page[0], repositoryRetry[0]])
  var creating = source[0] === 'github' && githubMode[0] === 'new' && !createdState[0]
  var valid = !!name[0].trim() && (creating ? !!account[0] && /^[a-z\d_.-]{1,100}$/i.test(repositoryName[0].trim()) && !/^\.+$/.test(repositoryName[0].trim()) : !!url[0].trim())
  var save = async function (push) {
    if (pending.current || !valid) return
    var remoteName = name[0].trim(), address = url[0].trim()
    if (!saved[0] && (props.remotes || []).some(function (remote) { return remote.name === remoteName })) { error[1](t('remote.exists')); return }
    if (remoteName.startsWith('-') || /[\s\0]/.test(remoteName) || address.startsWith('-') || /[\0\r\n]/.test(address)) { error[1](t('remote.invalid')); return }
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(address)) {
      try { if (new URL(address).password) { error[1](t('remote.invalid')); return } }
      catch (_) { error[1](t('remote.invalid')); return }
    }
    pending.current = true; busy[1](true); error[1](null)
    try {
      if (creating && !created.current) {
        var result = await props.onWrite('createHostingRepository', { root: props.repo.root, account: account[0],
          name: repositoryName[0].trim(), private: visibility[0] !== 'public', remoteName: remoteName, branch: push ? props.branch : undefined })
        if (!result || !mounted.current) return
        created.current = result.repository; createdState[1](true); url[1](result.repository.url)
      }
      if (created.current) address = created.current.url
      if (!saved[0]) {
        var added = await props.onWrite('addRemote', { root: props.repo.root, name: remoteName, url: address, addOnly: true })
        if (!added || !mounted.current) return
        saved[1](true); props.onSaved()
      }
      if (push) {
        var pushed = await props.onWrite('push', { root: props.repo.root, remote: remoteName, sourceBranch: props.branch,
          targetBranch: props.branch, setUpstream: true, hostingAccount: source[0] === 'github' ? account[0] : undefined })
        if (!pushed || !mounted.current) return
        props.onSaved()
      }
      props.onClose()
    } catch (failure) { if (mounted.current) error[1](failure.message) }
    finally { pending.current = false; if (mounted.current) busy[1](false) }
  }
  var field = function (key, label, state) { return h('label', { key: key, className: 'dshgit-field' }, [
    h('span', { key: 'label', className: 'dshgit-fieldlabel' }, label),
    h('input', { key: 'input', className: 'dshgit-input', 'data-remote-field': key, value: state[0], disabled: busy[0] || saved[0],
      autoFocus: key === 'url', placeholder: key === 'url' ? 'https://host/owner/repository.git' : 'origin',
      onChange: function (event) { sourceTouched.current = true; state[1](event.currentTarget.value); error[1](null) } }),
  ]) }
  return h('div', { className: 'dshgit-modal', onClick: close }, h('form', {
    className: 'dshgit-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': t('remote.configure'), ref: dialogRef, tabIndex: -1,
    style: { width: 'min(560px, 100%)' }, 'data-remote-dialog': props.repo.root,
    onClick: function (event) { event.stopPropagation() }, onSubmit: function (event) { event.preventDefault(); save(props.initialPush && !!props.branch) },
  }, [
    h('h3', { key: 'title' }, t('remote.configure')),
    h('div', { key: 'sources', className: 'dshgit-tools' }, ['url', 'github'].map(function (kind) { return h('button', {
      key: kind, type: 'button', className: 'dshgit-btn', 'aria-pressed': source[0] === kind, 'data-remote-source': kind,
      disabled: busy[0] || saved[0] || createdState[0], onClick: function () { chooseSource(kind) },
    }, t(kind === 'url' ? 'remote.address' : 'remote.github')) })),
    source[0] === 'github' ? accounts[0] === null ? h('div', { key: 'accounts-loading', role: 'status' }, t('state.loading'))
      : !accounts[0].length ? h('div', { key: 'no-accounts', className: 'dshgit-muted' }, t('remote.noAccounts'))
        : h('fieldset', { key: 'github', className: 'dshgit-field', disabled: busy[0] || saved[0] || createdState[0], style: { border: 0, padding: 0, margin: 0 } }, [
            accounts[0].length > 1 ? h(ComboBox, { key: 'account', value: account[0], t: t, options: accounts[0].map(function (entry) {
              return { value: entry.id, label: entry.login + ' · ' + entry.host + ' · ' + (entry.source === 'gh' ? 'GitHub CLI' : 'Git Credential Manager') }
            }), onChange: function (value) { account[1](value); page[1](1); repositories[1]([]); url[1]('') } })
              : h('div', { key: 'account', className: 'dshgit-muted' }, accounts[0][0].login + ' · ' + accounts[0][0].host),
            h('div', { key: 'mode', className: 'dshgit-tools' }, ['new', 'existing'].map(function (mode) { return h('button', {
              key: mode, type: 'button', className: 'dshgit-btn', 'data-github-mode': mode, 'aria-pressed': githubMode[0] === mode,
              onClick: function () { githubMode[1](mode); url[1]('') },
            }, t(mode === 'new' ? 'remote.newRepository' : 'remote.existingRepository')) })),
            githubMode[0] === 'new' ? h('div', { key: 'name', className: 'dshgit-field' }, [
              h('span', { key: 'label', className: 'dshgit-fieldlabel' }, t('remote.repositoryName')),
              h('input', { key: 'input', className: 'dshgit-input', 'data-remote-field': 'repositoryName', value: repositoryName[0],
                'aria-label': t('remote.repositoryName'),
                onChange: function (event) { repositoryName[1](event.currentTarget.value) } }),
              h('div', { key: 'visibility', role: 'radiogroup', className: 'dshgit-visibility-options', 'aria-label': t('remote.repository') }, ['private', 'public'].map(function (kind) {
                var login = (accounts[0] || []).find(function (entry) { return entry.id === account[0] })?.login || ''
                return h('button', { key: kind, type: 'button', className: 'dshgit-visibility-option', role: 'radio', tabIndex: visibility[0] === kind ? 0 : -1,
                  'aria-checked': visibility[0] === kind, 'data-selected': visibility[0] === kind, 'data-remote-visibility': kind,
                  onClick: function () { visibility[1](kind) },
                  onKeyDown: function (event) {
                    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(event.key) < 0) return
                    event.preventDefault()
                    var next = kind === 'private' ? 'public' : 'private'
                    visibility[1](next)
                    event.currentTarget.parentNode?.querySelector?.('[data-remote-visibility="' + next + '"]')?.focus?.()
                  },
                }, [
                  h('span', { key: 'radio', className: 'dshgit-visibility-radio', 'aria-hidden': true }),
                  h('span', { key: 'label', className: 'dshgit-visibility-label' }, [
                    h('span', { key: 'title', className: 'dshgit-visibility-title' }, t('remote.' + kind + 'Label')),
                    h('span', { key: 'path', className: 'dshgit-muted', title: login + '/' + repositoryName[0] }, login + '/' + repositoryName[0]),
                  ]),
                ])
              })),
            ]) : h('div', { key: 'existing' }, [
              h('span', { key: 'repo-label', className: 'dshgit-fieldlabel' }, t('remote.repository')),
              h(ComboBox, { key: 'repository', value: url[0], t: t, options: repositories[0].map(function (entry) { return { value: entry.url, label: entry.name } }), onChange: url[1] }),
            repoLoading[0] ? h('div', { key: 'loading', role: 'status' }, t('state.loading')) : null,
            repoError[0] ? h('div', { key: 'error', role: 'alert' }, repoError[0]) : null,
            !repoLoading[0] && !repoError[0] && !repositories[0].length ? h('div', { key: 'empty', className: 'dshgit-muted' }, t('remote.noRepos')) : null,
            more[0] || repoError[0] ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn', disabled: repoLoading[0],
              onClick: function () { if (repoError[0]) repositoryRetry[1](repositoryRetry[0] + 1); else page[1](page[0] + 1) },
            }, t(repoError[0] ? 'stash.retry' : 'action.loadMore')) : null,
            ]),
          ]) : null,
    !creating ? field('url', t('remote.address'), url) : null,
    source[0] === 'url' ? h('div', { key: 'hint', className: 'dshgit-muted' }, t('remote.hint')) : null,
    creating ? h('details', { key: 'advanced' }, [h('summary', { key: 'label' }, t('remote.name') + ': ' + name[0]), field('name', t('remote.name'), name)]) : field('name', t('remote.name'), name),
    !creating && props.branch ? h('div', { key: 'branch', className: 'dshgit-muted' }, t('remote.pushBranch') + ': ' + props.branch) : null,
    source[0] === 'url' ? h('div', { key: 'auth', className: 'dshgit-muted' }, t('remote.authHint')) : null,
    error[0] ? h('div', { key: 'error', role: 'alert' }, error[0]) : null,
    h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
      h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', disabled: busy[0], onClick: close }, t(saved[0] ? 'action.close' : 'action.cancel')),
      !saved[0] && !creating ? h('button', { key: 'save', type: 'button', className: 'dshgit-btn' + (!props.initialPush ? ' dshgit-btn-primary' : ''),
        'data-remote-action': 'save', disabled: busy[0] || !valid, onClick: function () { save(false) },
      }, busy[0] ? t('state.loading') : t('remote.save')) : null,
      props.branch ? h('button', { key: 'push', type: 'button', className: 'dshgit-btn' + (props.initialPush || saved[0] ? ' dshgit-btn-primary' : ''),
        'data-remote-action': 'push', disabled: busy[0] || !valid, onClick: function () { save(true) },
      }, busy[0] ? h(Spinner, { className: 'dshgit-spinner' }) : t(saved[0] ? 'action.push' : creating ? 'remote.publish' : 'remote.savePush')) : null,
    ]),
  ]))
}


function PromptDialog(props) {
  var t = props.t
  var saving = React.useState(false), saveError = React.useState(null), savingRef = React.useRef(false)
  var spec = props.spec
  var dialogRef = React.useRef(null)
  useDialogFocus(dialogRef, props.onClose, { opener: props.opener })
  var valuesState = React.useState(function () {
    var initial = {}
    for (var i = 0; i < (spec.fields || []).length; i++) {
      var field = spec.fields[i]
      initial[field.key] = field.initial !== undefined ? field.initial : field.value !== undefined ? field.value : field.options !== undefined && field.options.length > 0
        ? dialogOption(field.options[0]).value
        : (field.initial === undefined ? '' : field.initial)
    }
    return initial
  })
  var values = valuesState[0]
  var setValues = valuesState[1]
  var submitValues = function () {
    if (savingRef.current) return
    if (!spec.awaitSubmit) { props.onClose(); spec.submit(values); return }
    savingRef.current = true; saving[1](true); saveError[1](null)
    Promise.resolve().then(function () { return spec.submit(values) }).then(props.onClose)
      .catch(function (error) { saveError[1](error.message) })
      .finally(function () { savingRef.current = false; saving[1](false) })
  }

  /**
   * Apply one field change, plus whatever it derives.
   *
   * A field may declare `derive(value, values)`, returning a patch of other
   * fields. That is what lets "start point = origin/feature/login" fill in
   * the branch name without the user retyping it — the single most error
   * prone step in creating a tracking branch by hand.
   *
   * @param key - the changed field.
   * @param value - its new value.
   */
  var setField = function (key, value) {
    setValues(function (current) {
      var next = Object.assign({}, current)
      next[key] = value
      var field = null
      for (var i = 0; i < (spec.fields || []).length; i++) {
        if (spec.fields[i].key === key) field = spec.fields[i]
      }
      if (field !== null && typeof field.derive === 'function') {
        var patch = field.derive(value, next)
        if (patch !== null && patch !== undefined) Object.assign(next, patch)
      }
      return next
    })
  }

  var fields = (spec.fields || []).map(function (field) {
    if (field.type === 'checkbox') return h('label', { key: field.key, className: 'dshgit-commit-check' }, [
      h('input', { key: 'input', type: 'checkbox', checked: values[field.key] === true,
        onChange: function (event) { setField(field.key, event.currentTarget.checked) },
      }), h('span', { key: 'label' }, field.label),
    ])

    if (field.options !== undefined) {
      if (field.type === 'select') return h('div', { key: field.key, className: 'dshgit-field' }, [
        h('span', { key: 'l', className: 'dshgit-fieldlabel' }, field.label),
        h(ComboBox, { key: 'i', value: values[field.key], label: field.label, t: t, searchable: false,
          disabled: saving[0] || !field.options.length,
          options: field.options,
          onChange: function (value) { setField(field.key, value) },
        }),
      ])
      return h('div', { key: field.key, className: 'dshgit-field' }, [
        h('span', { key: 'l', className: 'dshgit-fieldlabel' }, field.label),
        // A filterable combobox, not a native <select>: the start-point list
        // is every local branch, every remote branch and every tag, which is
        // exactly the list a user needs to type into.
        h(ComboBox, {
          key: 'i',
          t: t,
          value: values[field.key],
          options: field.options,
          placeholder: field.placeholder,
          onChange: function (value) { setField(field.key, value) },
        }),
      ])
    }
    return h('div', { key: field.key, className: 'dshgit-field' }, [
      h('span', { key: 'l', className: 'dshgit-fieldlabel' }, field.label),
      h('input', {
        key: 'i',
        className: 'dshgit-input',
        value: values[field.key],
        placeholder: field.placeholder,
        autoFocus: (spec.fields || [])[0]?.key === field.key,
        onChange: function (event) { setField(field.key, event.currentTarget.value) },
        onKeyDown: function (event) {
          if (event.key === 'Enter') {
            event.preventDefault(); submitValues()
          }
        },
      }),
    ])
  })

  var actions = (spec.actions || []).map(function (action) {
    return h(
      'button',
      {
        key: action.label,
        type: 'button',
        className: 'dshgit-btn' + (action.danger === true ? ' dshgit-btn-danger' : ''),
        onClick: function () {
          props.onClose()
          action.run()
        },
      },
      action.label,
    )
  })

  if (spec.actions === undefined) {
    actions.push(
      h('button', {
        key: 'ok',
        type: 'button',
        className: 'dshgit-btn dshgit-btn-primary',
        disabled: saving[0], onClick: submitValues,
      }, t('action.ok')),
    )
  }
  actions.push(
    h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', disabled: saving[0], onClick: props.onClose }, t('action.cancel')),
  )

  return h('div', { className: 'dshgit-modal', style: props.zIndex === undefined ? undefined : { zIndex: props.zIndex }, onClick: function () { if (!savingRef.current) props.onClose() } }, [
    h('div', {
      key: 'dialog',
      ref: dialogRef,
      tabIndex: -1,
      role: 'dialog',
      'aria-modal': true,
      'aria-label': spec.title,
      className: 'dshgit-dialog' + (spec.compact ? ' dshgit-dialog-compact' : ''),
      onClick: function (event) { event.stopPropagation() },
    }, [
      h('div', { key: 'title', className: 'dshgit-dialogtitle' }, spec.title),
    ].concat(fields).concat([
      saveError[0] ? h('div', { key: 'error', role: 'alert', className: 'dshgit-cl-error' }, saveError[0]) : null,
      h('div', { key: 'actions', className: 'dshgit-dialogactions' }, actions),
    ])),
  ])
}


/**
 * A confirmation bar for a destructive write.
 *
 * The chip cluster has no room for an inline bar, so this floats under the
 * header — the same place the popovers open, for the same reason.
 *
 * @param props - `{ t, request, onCancel }`.
 */
function ConfirmBar(props) {
  var option = React.useState(props.request.option?.checked === true)
  var panelRef = React.useRef(null)
  useDialogFocus(panelRef, props.onCancel, { opener: props.opener, cancelFirst: true })
  return ReactDOM.createPortal(
    h('div', { className: 'dshgit-scrim' + (props.centered ? ' dshgit-confirm-scrim' : ''), style: { zIndex: 1600 }, onClick: props.onCancel }, [
      h('div', {
        key: 'bar',
        ref: panelRef,
        tabIndex: -1,
        className: 'dshgit-confirmbar' + (props.centered ? ' dshgit-confirmbar-centered' : ''),
        style: { zIndex: 1601 },
        role: 'alertdialog',
        'aria-modal': true,
        'aria-label': props.request.title || props.request.message,
        onClick: function (event) { event.stopPropagation() },
      }, [
        props.request.title ? h('strong', { key: 'title' }, props.request.title) : null,
        h('div', { key: 'm', className: 'dshgit-hint' }, props.request.message),
        props.request.option ? h('label', { key: 'option', className: 'dshgit-commit-check' }, [
          h('input', { key: 'check', type: 'checkbox', checked: option[0], onChange: function (event) { option[1](event.currentTarget.checked) } }), props.request.option.label,
        ]) : null,
        h('div', { key: 'a', className: 'dshgit-headline' }, [
          h('button', { key: 'ok', type: 'button', className: 'dshgit-btn ' + (props.request.danger === false ? 'dshgit-btn-primary' : 'dshgit-btn-danger'),
            onClick: function () { props.request.onConfirm(props.request.option ? option[0] : undefined) },
          }, props.request.label || props.t('action.apply')),
          h('button', { key: 'no', type: 'button', className: 'dshgit-btn',
            onClick: props.onCancel,
          }, props.t('action.cancel')),
        ]),
      ]),
    ]),
    document.body,
  )
}


/**
 * A small modal that asks the user to pick one of N named actions.
 *
 * Used where the two options are genuinely different outcomes rather than
 * variations of one — merging and rebasing produce different history, so the
 * plugin asks instead of picking a default on the user's behalf.
 *
 * @param props - `{ t, title, choices, onClose }`, where each choice is
 *   `{ label, hint, run }`.
 */
function ChoiceDialog(props) {
  var panelRef = React.useRef(null)
  useDialogFocus(panelRef, props.onClose, { opener: props.opener })
  return h('div', { className: 'dshgit-modal', onClick: props.onClose }, [
    h('div', {
      key: 'dialog',
      className: 'dshgit-dialog',
      role: 'dialog',
      'data-choice-dialog': props.title,
      ref: panelRef, tabIndex: -1, 'aria-modal': true, 'aria-label': props.title,
      onClick: function (event) { event.stopPropagation() },
    }, [
      h('div', { key: 'title', className: 'dshgit-dialogtitle' }, props.title),
    ].concat(props.choices.map(function (choice, index) {
      return h('button', {
        key: 'c' + index,
        type: 'button',
        className: 'dshgit-choice',
        onClick: function () { props.onClose(); choice.run() },
      }, [
        h('span', { key: 'l', className: 'dshgit-choicelabel' }, choice.label),
        choice.hint === undefined ? null : h('span', { key: 'h', className: 'dshgit-choicehint' }, choice.hint),
      ])
    })).concat([
      h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
        h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', onClick: props.onClose },
          props.t('action.cancel')),
      ]),
    ])),
  ])
}


/**
 * The in-progress multi-step operation, with its way out.
 *
 * A conflicted merge/rebase/cherry-pick leaves the repository in a state where
 * most other actions fail, and `git status` looks like an ordinary dirty tree.
 * Without this panel the user is stuck with no visible exit — the worst place
 * to strand someone — so it names the operation, points at the conflicted
 * files, and offers continue/abort.
 *
 * It is a fixed panel, not a popover: a popover closes on the first outside
 * click, and the way out must not disappear while the user edits files.
 *
 * @param props - `{ t, operation, busy, onContinue, onAbort, onClose }`.
 */
function OperationPanel(props) {
  var t = props.t
  var operation = props.operation
  var kind = operation.kind
  var labelKey = kind === 'cherry-pick' ? 'op.cherry-pick' : 'op.' + kind
  // A rebase knows its position; the others are one-shot. Showing "1/3" only
  // when it is real avoids implying a step count that does not exist.
  var title = kind === 'rebase' && operation.step !== null && operation.total !== null
    ? t('op.rebasing', { step: operation.step, total: operation.total })
    : kind === 'merge' ? t('op.merging')
      : kind === 'cherry-pick' ? t('op.cherryPicking')
        : kind === 'revert' ? t('op.reverting')
          : t('op.aming')

  return ReactDOM.createPortal(
    h('div', {
      key: 'panel',
      className: 'dshgit-oppanel',
      role: 'alertdialog',
      'data-operation': kind,
    }, [
      h('div', { key: 'head', className: 'dshgit-ophead' }, [
        h('span', { key: 'w', className: 'dshgit-opbadge' }, '⚠'),
        h('span', { key: 't', className: 'dshgit-optitle' }, title),
        h('button', {
          key: 'x', type: 'button', className: 'dshgit-iconbtn',
          title: t('action.close'), 'aria-label': t('action.close'),
          onClick: props.onClose,
        }, '✕'),
      ]),
      h('div', { key: 'hint', className: 'dshgit-hint' }, t('next.hint.resolve', { kind: t(labelKey) })),
      operation.noCommit ? h('div', { key: 'noCommit', className: 'dshgit-hint' }, t('wb.noCommit')) : null,
      h('div', { key: 'actions', className: 'dshgit-opactions' }, [
        h('button', {
          key: 'cont', type: 'button', className: 'dshgit-btn dshgit-btn-primary',
          disabled: props.busy, 'data-op-action': 'continue',
          onClick: props.onContinue,
        }, t('action.continueOp')),
        h('button', {
          key: 'abort', type: 'button', className: 'dshgit-btn dshgit-btn-danger',
          disabled: props.busy, 'data-op-action': 'abort',
          onClick: props.onAbort,
        }, t('action.abortOp')),
      ]),
    ]),
    document.body,
  )
}

export { ChoiceDialog, ConfirmBar, OperationPanel, PromptDialog, RemoteConfigDialog }

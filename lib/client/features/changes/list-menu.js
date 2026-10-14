/** Explicitly consolidate the chosen files, including stale chunk metadata. */
export function moveWholeFilesMenu(props, paths, from) {
  var model = props.changelists, data = model.data, t = props.t
  var targets = (data?.lists || []).filter(function (list) { return list.id !== from })
  return { id: 'move-whole-files', label: t('cl.removeFromList'),
    disabled: props.busy || model.loading || model.pending || !props.prompt || !paths.length || !targets.length,
    run: function () {
      if (!targets.length || !props.prompt) return
      props.prompt({ title: t('cl.moveWhole'), fields: [{ key: 'id', type: 'select', label: t('cl.moveWholeTarget'),
        value: targets.some(function (list) { return list.id === data.active }) ? data.active : targets[0].id,
        options: targets.map(function (list) { return { value: list.id, label: list.id === 'default' && list.name === '默认' ? t('cl.default') : list.name } }) }],
        onSubmit: function (values) {
          // Omitting `from` deliberately moves the whole file and clears its
          // chunk split. A partial move would leave unassigned/invalid chunks.
          return model.mutate({ action: 'move', id: values.id, paths: paths })
        },
      })
    },
  }
}

/** List management shared by the workbench sidebar and the header popover. */
export function changelistListMenu(props, list, files) {
  var model = props.changelists, data = model.data, t = props.t
  var blocked = props.busy || model.loading || model.pending
  var paths = files.filter(function (file) { return file.kind !== 'unmerged' }).map(function (file) { return file.path })
  var targets = data.lists.filter(function (entry) { return entry.id !== list.id })
  var label = function (entry) { return entry.id === 'default' && entry.name === '默认' ? t('cl.default') : entry.name }
  var act = function (operation) { model.mutate(operation).catch(function () {}) }
  return [
    { id: 'new-list', label: t('cl.create'), disabled: blocked || !props.onCreateList, run: function () { props.onCreateList() } },
    { id: 'active', label: t('cl.active'), disabled: blocked || data.active === list.id, run: function () { act({ action: 'active', id: list.id }) } },
    list.commitBlocked === true ? null : { id: 'scope', label: t('cl.scope'), disabled: blocked || list.commitBlocked === true || !paths.length, run: function () { act({ action: 'scope', id: list.id, paths: paths }) } },
    { id: 'commit-block', label: t(list.commitBlocked === true ? 'cl.allowCommit' : 'cl.blockCommit'), disabled: blocked,
      run: function () { act({ action: 'commitBlock', id: list.id, blocked: list.commitBlocked !== true }) } },
    { id: 'stash-list', label: t('cl.stash'), command: 'stash', disabled: blocked || !files.length || !!props.status?.operation || files.some(function (file) { return file.kind === 'unmerged' }), run: function () {
      props.requestConfirm(t('cl.stashConfirm', { name: label(list) }), function () {
        props.onWrite('stashChangelist', { id: list.id, changelistVersion: data.version }, { after: props.afterWrite })
      })
    } },
    { id: 'rename', label: t('cl.rename'), disabled: blocked || !props.prompt, run: function () {
      props.prompt({ title: t('cl.rename'), fields: [{ key: 'name', label: t('cl.name'), value: list.name }],
        onSubmit: function (values) { return model.mutate({ action: 'rename', id: list.id, name: values.name }) } })
    } },
    { id: 'move-list-files', label: t('cl.move'), disabled: blocked || !files.length || !targets.length || !props.prompt, run: function () {
      props.prompt({ title: t('cl.move'), fields: [{ key: 'id', type: 'select', label: t('cl.target'),
        value: targets.some(function (entry) { return entry.id === data.active }) ? data.active : targets[0].id,
        options: targets.map(function (entry) { return { value: entry.id, label: label(entry) } }) }],
        onSubmit: function (values) { return model.mutate({ action: 'move', id: values.id, paths: files.map(function (file) { return file.path }), from: list.id }) } })
    } },
    { id: 'delete', label: t('cl.delete'), disabled: blocked || !targets.length || !props.prompt, run: function () {
      props.prompt({ title: t('cl.delete'), fields: [{ key: 'target', type: 'select', label: t('cl.deleteHint'), value: targets[0].id,
        options: targets.map(function (entry) { return { value: entry.id, label: label(entry) } }) }],
        onSubmit: function (values) { return model.mutate({ action: 'delete', id: list.id, target: values.target }) } })
    } },
  ].filter(Boolean)
}

/**
 * Workspace headers have no public action seat yet (Session rows do).
 * Keep this DOM adapter limited to the Host's keyed workspace treeitems and
 * reuse their native action strip. The workspace registry supplies identity;
 * display names and hover-card paths are never used to guess a directory.
 */
export function installSidebarWorkspaceGit(list, label, open, doc = document) {
  var selector = '[role="treeitem"][data-row-key^="workspace:"]'
  var entries = new Map()
  var sync = function () {
    var workspaces = new Map((list.getSnapshot()?.items || []).map(function (item) { return [item.workspaceId, item] }))
    var rows = new Set(doc.querySelectorAll(selector))
    entries.forEach(function (entry, row) {
      var workspace = workspaces.get(row.getAttribute('data-row-key')?.slice(10))
      if (!rows.has(row) || !workspace?.path || entry.button.parentElement !== row.lastElementChild) {
        entry.button.remove(); entries.delete(row)
      }
    })
    rows.forEach(function (row) {
      var workspace = workspaces.get(row.getAttribute('data-row-key').slice(10))
      if (!workspace?.path) return
      var strip = row.lastElementChild
      var nativeButton = strip?.querySelector('button')
      if (!nativeButton) return
      var entry = entries.get(row)
      if (!entry) {
        var button = doc.createElement('button')
        button.type = 'button'
        button.className = nativeButton.className + ' dshgit-sidebar-workspace-git'
        button.draggable = false
        var icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
        for (var [key, value] of Object.entries({ width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' })) icon.setAttribute(key, value)
        for (var shape of [
          ['circle', { cx: '4.5', cy: '3.5', r: '1.8' }],
          ['circle', { cx: '4.5', cy: '12.5', r: '1.8' }],
          ['circle', { cx: '11.5', cy: '7', r: '1.8' }],
          ['path', { d: 'M4.5 5.3v5.4 M4.5 9.8c0-3 7-1.6 7-4.6' }],
        ]) {
          var node = doc.createElementNS('http://www.w3.org/2000/svg', shape[0])
          for (var [attribute, text] of Object.entries(shape[1])) node.setAttribute(attribute, text)
          node.setAttribute('stroke', 'currentColor'); icon.appendChild(node)
        }
        button.appendChild(icon)
        entry = { button: button, workspace: workspace }
        button.addEventListener('click', function (event) {
          event.preventDefault(); event.stopPropagation()
          open(entry.workspace.path)
        })
        // Do not start the enclosing workspace row's drag or keyboard walk.
        for (var eventName of ['pointerdown', 'dblclick', 'keydown', 'dragstart']) button.addEventListener(eventName, function (event) { event.stopPropagation() })
        strip.insertBefore(button, strip.firstChild)
        entries.set(row, entry)
      }
      entry.workspace = workspace
      var title = label() + ' · ' + (workspace.title || workspace.path)
      if (entry.button.title !== title) {
        entry.button.title = title
        entry.button.setAttribute('aria-label', title)
      }
    })
  }
  sync()
  var observer = typeof MutationObserver === 'function' ? new MutationObserver(function (records) {
    // Streaming messages also mutate the document; only scan for changes that
    // can add, remove or replace workspace headers or their action buttons.
    if (records.some(function (record) {
      return entries.has(record.target) || record.target.closest?.(selector) || [...record.addedNodes || [], ...record.removedNodes || []].some(function (node) {
        return node.matches?.(selector) || node.querySelector?.(selector)
      })
    })) sync()
  }) : null
  observer?.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-row-key'] })
  var unsubscribe = list.subscribe(sync)
  return function () {
    observer?.disconnect(); unsubscribe()
    entries.forEach(function (entry) { entry.button.remove() })
    entries.clear()
  }
}

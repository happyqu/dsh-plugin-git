import { Spinner } from '../ui/spinner.js'
import { IconBranch, IconChanges, IconFolder, IconGraph, IconHistory, IconOutput, IconSettings, IconStash } from '../ui/icons.js'
import { h } from '../core/runtime.js'
import { formatRelative } from '../core/format.js'

/* ------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------ */



/**
 * The workbench's modules, in activity-bar order.
 *
 * This replaced a flat list of tab names. Each module now owns three facts
 * the old tab row could not express: the icon that identifies it in the
 * activity bar, the label its sidebar header shows, and — via
 * {@link moduleHasSidebar} — whether it even has a sidebar, which is what
 * keeps a module with nothing to list from rendering an empty column.
 */
var MODULES = [
  { id: 'changes', icon: IconChanges, labelKey: 'tab.changes', sidebarKey: 'sidebar.changes' },
  { id: 'graph', icon: IconGraph, labelKey: 'tab.graph', sidebarKey: 'sidebar.graph' },
  { id: 'history', icon: IconHistory, labelKey: 'tab.history', sidebarKey: 'sidebar.history' },
  { id: 'stashes', icon: IconStash, labelKey: 'tab.stashes', sidebarKey: 'sidebar.stashes' },
  { id: 'worktrees', icon: IconFolder, labelKey: 'tab.worktrees', sidebarKey: 'tab.worktrees' },
  { id: 'output', icon: IconOutput, labelKey: 'tab.output', sidebarKey: 'sidebar.output' },
  { id: 'settings', icon: IconSettings, labelKey: 'tab.settings', sidebarKey: 'sidebar.settings' },
]


/** Look up one module's definition by id. */
function moduleById(id) {
  if (id === 'compare') return { id: 'compare', labelKey: 'tab.compare', sidebarKey: 'label.files' }
  for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i]
  return MODULES[0]
}


/**
 * The activity bar: the workbench's only module switcher.
 *
 * Modelled on VS Code's, so the muscle memory transfers. An icon column is
 * used instead of a text tab row for one reason that matters here: the old
 * row shared a line with Fetch/Pull/Push and six dropdown menus, so at any
 * narrow width it wrapped and the whole top bar lost its structure. A fixed
 * 48px column cannot be squeezed by the controls next to it.
 *
 * The active item is marked by a left accent bar AND `aria-pressed`, so the
 * visual state and the state assistive technology reads are the same value
 * and cannot disagree.
 *
 * @param props - `{ t, active, changes, onSelect }`.
 */
function ActivityBar(props) {
  var t = props.t
  return h('nav', {
    className: 'dshgit-activitybar',
    role: 'tablist',
    'aria-label': t('panel.title'),
  }, MODULES.map(function (module) {
    var Icon = module.icon
    var active = props.active === module.id
    // Only "changes" carries a count: it is the one module whose contents the
    // user is expected to act on. A badge on History or Settings would be noise.
    var badge = module.id === 'changes' && props.changes > 0 ? props.changes : null
    return h('button', {
      key: module.id,
      type: 'button',
      className: 'dshgit-activity-item',
      role: 'tab',
      'aria-selected': active,
      'aria-pressed': active,
      'data-module': module.id,
      title: t(module.labelKey),
      'aria-label': t(module.labelKey),
      onClick: function () { props.onSelect(module.id) },
    }, [
      h(Icon, { key: 'i', size: 18 }),
      badge === null ? null : h('span', {
        key: 'b', className: 'dshgit-activity-badge', 'aria-hidden': 'true',
      }, String(badge)),
    ])
  }))
}


/**
 * The status bar: repository facts that are always true and never actionable.
 *
 * Branch, divergence, commit count, last fetch and the configured user used
 * to sit in the title bar, where they competed with the sync buttons for one
 * row and wrapped first. Moved to the bottom they cost nothing, stay
 * permanently readable, and leave the title bar to identity and actions —
 * the same split VS Code makes.
 *
 * `aria-live="polite"` because these values change after a fetch or a commit,
 * and a screen-reader user gets no other signal that they did.
 *
 * @param props - `{ t, status, repoMeta, tracking, busy, gitVersion }`.
 */
function StatusBar(props) {
  var t = props.t
  var branch = props.status !== null && props.status.branch !== null ? props.status.branch : null
  var parts = []
  if (branch !== null) {
    parts.push(h('span', { key: 'b', className: 'dshgit-statusitem' }, [
      h(IconBranch, { key: 'i', size: 12 }),
      h('span', { key: 'n', className: 'dshgit-statusbranch' }, branch.head || '?'),
    ]))
    if (branch.ahead > 0 || branch.behind > 0) {
      parts.push(h('span', { key: 'ab', className: 'dshgit-statusitem' },
        '↑' + (branch.ahead || 0) + ' ↓' + (branch.behind || 0)))
    }
  }
  if (props.repoMeta !== null && props.repoMeta !== undefined) {
    if (props.repoMeta.commitCount !== null) {
      parts.push(h('span', { key: 'c' }, t('meta.commits', { count: props.repoMeta.commitCount })))
    }
    parts.push(h('span', { key: 'f' }, props.repoMeta.lastFetchedAt === null
      ? t('meta.neverFetched')
      : t('meta.lastFetched', { time: formatRelative(Math.floor(props.repoMeta.lastFetchedAt / 1000), t) })))
    if (props.repoMeta.userName !== null) {
      parts.push(h('span', { key: 'u' }, props.repoMeta.userName))
    }
  }
  parts.push(h('span', { key: 'spacer', className: 'dshgit-spacer' }))
  if (props.busy === true) parts.push(h(Spinner, { key: 'busy', className: 'dshgit-spinner' }))
  if (props.gitVersion !== null && props.gitVersion !== undefined) {
    parts.push(h('span', { key: 'v' }, props.gitVersion))
  }
  return h('div', {
    className: 'dshgit-statusbar', role: 'status', 'aria-live': 'polite',
  }, parts)
}

export { ActivityBar, StatusBar, moduleById }

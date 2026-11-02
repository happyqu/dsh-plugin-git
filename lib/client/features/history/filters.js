import { React, ReactDOM, h } from '../../core/runtime.js'
import { IconFilter } from '../../ui/icons.js'
import { ComboBox } from '../../ui/controls.js'
import { popoverPosition } from '../../ui/popover-position.js'

/**
 * The history filter popover: author, time range and merge policy.
 *
 * These are `git log` options the Host has supported all along, but the panel
 * sent only `grep` and `path`, so "who touched this and when" was answerable
 * only from a terminal.
 *
 * Why a POPOVER and not an inline disclosure
 * ------------------------------------------
 * It was inline first, and that was wrong in two ways visible in the rendered
 * result. The sidebar is a fixed-width column with `overflow:hidden`, so a
 * multi-field panel opened as a block ABOVE the commit list and pushed the
 * search box and the first commits below the fold — opening a filter hid the
 * thing being filtered. As a portalled popover it overlays the list instead of
 * displacing it, and can be wider than the trigger's column.
 *
 * Why PRESETS and not date inputs
 * -------------------------------
 * The first version asked for git's date grammar in two free-text fields
 * ("2 weeks ago", "2026-10-01"). That is a developer skill, not a UI: it
 * demanded the user already know the syntax, gave no feedback about which
 * formats worked, and made the common question ("what changed lately?") the
 * hardest thing on the panel. A short list of ranges answers the same
 * question in one click, and the translation to `--since` happens here so the
 * Host keeps receiving the flags it always did.
 *
 * @param props - `{ filters, onChange, t }`.
 */
function HistoryFilters(props) {
  var t = props.t
  var filters = props.filters || { author: '', range: '', merges: 'all' }
  var active = Boolean((filters.author || '').trim()) || (filters.range || '') !== '' || (filters.merges || 'all') !== 'all'
  var update = function (patch) { props.onChange(Object.assign({}, filters, patch)) }

  var openState = React.useState(false)
  var open = openState[0]
  var setOpen = openState[1]
  var rootRef = React.useRef(null)
  var panelRef = React.useRef(null)
  var triggerRef = React.useRef(null)
  var rectState = React.useState(null)
  var anchor = rectState[0]
  var setAnchor = rectState[1]

  // Dismiss on Escape anywhere, and on a press outside both the trigger and
  // the portalled panel (the panel is not a DOM child of the trigger, so
  // `contains` has to check it separately).
  React.useEffect(function () {
    if (!open) return undefined
    var dismiss = function (event) {
      if (rootRef.current?.contains(event.target)) return
      if (panelRef.current?.contains(event.target)) return
      // A press inside the ComboBox's own list is part of the panel's work.
      if (event.target?.closest?.('.dshgit-combolist')) return
      setOpen(false)
    }
    var escape = function (event) { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus?.() } }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return function () {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  var toggle = function () {
    if (!open && rootRef.current) {
      var rect = rootRef.current.getBoundingClientRect()
      setAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
    }
    setOpen(!open)
  }

  var field = function (key, label, control) {
    return h('label', { key: key, className: 'dshgit-filterfield' }, [
      h('span', { key: 'l', className: 'dshgit-filterlabel' }, label),
      control,
    ])
  }

  var viewport = {
    width: typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 900,
  }
  // Wider than the sidebar on purpose: the popover overlays the list, so it is
  // not bound by the column that hosts the trigger.
  var placement = anchor === null ? null : popoverPosition(anchor, { width: 268, align: 'start', maxHeight: 380 }, viewport)

  var panel = open && placement !== null ? ReactDOM.createPortal(
    h('div', { key: 'panel', ref: panelRef, className: 'dshgit-filterpopover', role: 'dialog',
      'aria-label': t('history.filters'), 'data-history-filters-panel': 'true',
      style: Object.assign({}, placement, { boxSizing: 'border-box' }) }, [
      h('div', { key: 'head', className: 'dshgit-filterpopoverhead' }, [
        h('strong', { key: 'title' }, t('history.filters')),
        active
          ? h('button', {
              key: 'clear', type: 'button', className: 'dshgit-filterclear',
              title: t('history.clearFilters'), 'aria-label': t('history.clearFilters'),
              onClick: function () { props.onChange({ author: '', range: '', merges: 'all' }) },
            }, t('history.clearShort'))
          : null,
      ]),
      h('div', { key: 'body', className: 'dshgit-filterpopoverbody' }, [
        field('author', t('history.author'), h('input', {
          key: 'i', type: 'search', className: 'dshgit-input', value: filters.author || '',
          placeholder: t('history.authorPlaceholder'),
          onChange: function (event) { update({ author: event.currentTarget.value }) },
        })),
        field('range', t('history.range'), h(ComboBox, {
          key: 'i', t: t, value: filters.range || '', label: t('history.range'),
          options: [
            { value: '', label: t('history.rangeAll') },
            { value: '7d', label: t('history.range7d') },
            { value: '30d', label: t('history.range30d') },
            { value: '90d', label: t('history.range90d') },
            { value: 'year', label: t('history.rangeYear') },
          ],
          onChange: function (value) { update({ range: value }) },
        })),
        // The themed ComboBox, not a native <select>: the native popup is
        // painted by the browser and ignores the panel's theme entirely.
        field('merges', t('history.merges'), h(ComboBox, {
          key: 'i', t: t, value: filters.merges || 'all', label: t('history.merges'),
          options: [
            { value: 'all', label: t('history.mergesAll') },
            { value: 'only', label: t('history.mergesOnly') },
            { value: 'none', label: t('history.mergesNone') },
          ],
          onChange: function (value) { update({ merges: value }) },
        })),
      ]),
    ]),
    document.body,
  ) : null

  return h('span', { key: 'filters', className: 'dshgit-history-filters', ref: rootRef }, [
    h('button', {
      key: 'toggle', type: 'button', ref: triggerRef,
      // An ICON trigger, not the word "筛选". Two reasons, both from looking at
      // the rendered row: a two-character label sitting beside "恢复点" read as
      // a second, equally-important destination when it is really a refinement
      // of the search field next to it; and the word says nothing the funnel
      // does not say faster. The accessible name still spells it out.
      className: 'dshgit-history-filtericon' + (active ? ' dshgit-history-filtericon-on' : ''),
      'aria-expanded': open, 'aria-haspopup': 'dialog',
      'data-history-filters-toggle': true,
      title: active ? t('history.filtersActive') : t('history.filtersHint'),
      'aria-label': active ? t('history.filtersActive') : t('history.filters'),
      onClick: toggle,
    }, [
      h(IconFilter, { key: 'icon', size: 14 }),
      // The dot is the only evidence, once closed, that the list is a subset
      // rather than the whole history — the funnel alone cannot show "armed".
      active ? h('span', { key: 'active', className: 'dshgit-filterbadge', 'aria-hidden': true }) : null,
    ]),
    panel,
  ])
}

export { HistoryFilters }

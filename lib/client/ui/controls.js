import { Fragment, React, ReactDOM, h } from '../core/runtime.js'
import { IconChevron, svg } from './icons.js'
import { useCloseOnWindowHide } from '../core/state.js'
import { nextControlId } from '../core/ids.js'
import { comboLayout, comboWindow } from './combo-window.js'

var useLayoutEffect = React.useLayoutEffect || React.useEffect

/* ------------------------------------------------------------------ *
 * Small presentational pieces
 * ------------------------------------------------------------------ */

/** A collapsible section with a header row. */
function Section(props) {
  var openState = React.useState(props.initialOpen !== false)
  var open = openState[0]
  var setOpen = openState[1]
  return h('div', { className: 'dshgit-section' + (props.className ? ' ' + props.className : '') }, [
    h('div', { key: 'bar', className: 'dshgit-sectionbar' }, [
    h(
      'button',
      {
        key: 'head',
        type: 'button',
        className: 'dshgit-sectionhead',
        onClick: function () { setOpen(!open) },
        'aria-expanded': open,
      },
      [
        h('span', { key: 'c', className: 'dshgit-caret' }, h(IconChevron, { open: open })),
        h('span', { key: 't' }, props.title),
      ],
    ),
    props.actions || null,
    props.count === undefined
      ? null
      : h('span', { key: 'n', className: 'dshgit-sectioncount' }, props.count),
    ]),
    open ? h('div', { key: 'body' }, props.children) : null,
  ])
}


/**
 * A small dropdown menu.
 *
 * Normally positioned under its trigger. The commit split button portals
 * its menu so the workbench sidebar and compact popover cannot clip it.
 * Outside click and Escape close it.
 */
function Menu(props) {
  var t = props.t
  var openState = React.useState(false)
  var open = openState[0]
  var setOpen = openState[1]
  var rootRef = React.useRef(null)
  var menuRef = React.useRef(null)
  var rectState = React.useState(null)
  var menuRect = rectState[0]
  var setMenuRect = rectState[1]
  useCloseOnWindowHide(rootRef, setOpen)

  React.useEffect(
    function () {
      if (!open) return undefined
      var close = function (event) {
        if (rootRef.current !== null && rootRef.current.contains(event.target)) return
        if (menuRef.current !== null && menuRef.current.contains(event.target)) return
        setOpen(false)
      }
      var onKey = function (event) {
        if (event.key === 'Escape') setOpen(false)
      }
      document.addEventListener('mousedown', close)
      document.addEventListener('keydown', onKey)
      return function () {
        document.removeEventListener('mousedown', close)
        document.removeEventListener('keydown', onKey)
      }
    },
    [open],
  )

  var items = props.items || []
  var portalled = props.portal === true && menuRect !== null
  var menuNode = open ? h('div', {
    key: 'menu', ref: menuRef,
    className: 'dshgit-menu' + (props.menuClass ? ' ' + props.menuClass : ''), role: 'menu',
    style: portalled
      ? { position: 'fixed', top: menuRect.bottom + 4 + 'px',
          right: Math.max(8, window.innerWidth - menuRect.right) + 'px' }
      : { position: 'absolute', top: 'calc(100% + 4px)',
          left: props.align === 'right' ? undefined : 0,
          right: props.align === 'right' ? 0 : undefined },
  }, items.map(function (item, index) {
    if (item === null || item === undefined) return null
    if (item.separator === true) return h('div', { key: 'sep' + index, className: 'dshgit-menusep' })
    return h('button', {
      key: item.id ?? index, type: 'button', role: 'menuitem',
      className: 'dshgit-menuitem' + (item.danger === true ? ' dshgit-menudanger' : ''),
      disabled: item.disabled === true, title: item.hint,
      onClick: function () { setOpen(false); item.run() },
    }, item.label)
  })) : null
  return h('span', { ref: rootRef,
    className: props.rootClass,
    style: { position: 'relative', display: 'inline-block' },
  }, [
    h(
      'button',
      {
        key: 'trigger',
        type: 'button',
        // The trigger is a button so the whole label is a real click target,
        // but its class is the caller's: the compact branch switcher reuses
        // the badge's own look instead of growing a second, differently
        // styled control beside it.
        className: props.triggerClass === undefined ? 'dshgit-btn' : props.triggerClass,
        disabled: props.disabled === true,
        onClick: function (event) {
          if (typeof props.onOpen === 'function') props.onOpen()
          if (!open && props.portal === true && rootRef.current?.getBoundingClientRect) {
            var rect = rootRef.current.getBoundingClientRect()
            setMenuRect({ bottom: rect.bottom, right: rect.right })
          }
          setOpen(!open)
          event.stopPropagation()
        },
        title: props.title,
        'aria-label': props.title,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
      },
      props.label,
    ),
    portalled && open ? ReactDOM.createPortal(menuNode, document.body) : menuNode,
  ])
}


/** Native right-click menu, portaled so pane scrolling cannot clip it. */
function FileContextMenu(props) {
  var menu = props.menu
  var rootRef = React.useRef(null)
  React.useEffect(function () {
    if (menu === null) return undefined
    var outside = function (event) {
      if (rootRef.current?.contains?.(event.target)) return
      props.onClose()
    }
    var key = function (event) { if (event.key === 'Escape') props.onClose() }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', key)
    return function () {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [menu])
  if (menu === null || !menu.items.some(function (item) { return !item.separator })) return null
  var width = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1440
  var height = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 900
  var menuWidth = Math.min(menu.compact ? 180 : 360, width - 8)
  var x = Math.max(4, Math.min(menu.x, width - menuWidth - 4))
  var menuHeight = menu.items.reduce(function (total, item) { return total + (item.separator ? 9 : 34) }, 12)
  var y = Math.max(4, Math.min(menu.y, height - Math.min(menuHeight, height * .8) - 4))
  return ReactDOM.createPortal(h('div', {
    ref: rootRef, className: 'dshgit-contextmenu', role: 'menu',
    style: { left: x + 'px', top: y + 'px', width: menuWidth + 'px', maxHeight: Math.min(height * .8, height - y - 4) + 'px' },
    onContextMenu: function (event) { event.preventDefault() },
  }, menu.items.map(function (item, index) {
    if (item.separator) return h('div', { key: 'sep' + index, className: 'dshgit-menusep' })
    return h('button', {
      key: item.id, type: 'button', role: 'menuitem',
      className: 'dshgit-menuitem' + (item.danger ? ' dshgit-menudanger' : ''),
      disabled: item.disabled === true, title: [item.hint, item.command].filter(Boolean).join('\n') || undefined,
      onClick: function () { props.onClose(); item.run() },
    }, [h('span', { key: 'label' }, item.label), item.command ? h('code', { key: 'command', className: 'dshgit-menucommand' }, item.command) : null])
  })), document.body)
}


/**
 * Normalize one dialog option.
 *
 * Options are plain strings in most dialogs. A `{ value, label, group }`
 * object is also accepted so a list can be split into `<optgroup>` sections —
 * the branch picker needs "local" and "remote" separated, and a flat list of
 * twenty refs with no grouping is exactly where a user picks the wrong one.
 *
 * @param option - a string or an option object.
 * @returns `{ value, label, group }`.
 */
function dialogOption(option) {
  if (typeof option === 'string') return { value: option, label: option, group: '' }
  return {
    value: option.value,
    label: option.label === undefined ? String(option.value) : option.label,
    group: option.group === undefined ? '' : option.group,
  }
}


/**
 * Group normalized options, preserving first-seen order.
 *
 * Shared by the native `<select>` renderer and the filterable combobox, so a
 * list cannot group one way in a dialog and another way in a picker.
 *
 * @param options - the raw option list.
 * @returns `[{ name, items }]`; `name` is `''` for ungrouped options.
 */
function groupOptions(options) {
  var normalized = options.map(dialogOption)
  var groups = [], byName = new Map()
  for (var i = 0; i < normalized.length; i++) {
    var group = normalized[i].group
    var bucket = byName.get(group)
    if (!bucket) {
      bucket = { name: group, items: [] }
      byName.set(group, bucket)
      groups.push(bucket)
    }
    bucket.items.push(normalized[i])
  }
  return groups
}


/**
 * A filterable select.
 *
 * A native `<select>` cannot be searched. Its popup list is drawn by the OS,
 * so there is nowhere to type, and `<datalist>` matches only from the start
 * of the value and cannot be styled or grouped. Picking one ref out of a long
 * branch list is exactly where a filter earns its keep, so this is a real
 * combobox.
 *
 * Interaction model, matching the editors people already use:
 *   - focus alone leaves it closed; clicking or arrow keys opens the list;
 *   - the selected label stays visible until a search is typed;
 *   - typing filters on the label, the value and the group name;
 *   - arrows move the highlight, Enter picks it, Escape closes without
 *     changing the value;
 *   - clicking away restores the selection label.
 *
 * @param props - `{ value, options, placeholder, onChange, t, autoFocus,
 *   className, style, listWidth, allowCustom, name, required }`.
 * With allowCustom, typing updates the value immediately and adds the typed
 * value as the first choice; blurring or submitting keeps that value.
 */


function ComboBox(props) {
  var t = props.t
  var searchable = props.searchable !== false
  var idRef = React.useRef(null)
  if (idRef.current === null) idRef.current = nextControlId('dshgit-select-')
  var listId = idRef.current
  var options = React.useMemo(function () {
    return (props.options || []).map(function (option) {
      var item = dialogOption(option)
      item.search = (item.label + '\0' + item.value + '\0' + item.group).toLowerCase()
      return item
    })
  }, [props.options])
  var current = React.useMemo(function () {
    var selected = null
    options.forEach(function (item) { if (item.value === props.value) selected = item })
    return selected
  }, [options, props.value])

  var openState = React.useState(false)
  var open = openState[0]
  var setOpen = openState[1]
  var queryState = React.useState('')
  var query = queryState[0]
  var setQuery = queryState[1]
  var activeState = React.useState(0)
  var active = activeState[0]
  var setActive = activeState[1]
  var inputRef = React.useRef(null)
  useCloseOnWindowHide(inputRef, React.useCallback(function (value) {
    setOpen(value); if (!value) { setQuery(''); setActive(0) }
  }, []))
  var listRef = React.useRef(null)
  var viewport = React.useState({ top: 0, active: -1, query: null, optionHeight: 0, groupHeight: 0 })
  var placement = React.useState(0)
  React.useEffect(function () {
    if (!open) return
    var update = function (event) {
      if (event?.target && listRef.current?.contains?.(event.target)) return
      placement[1](function (value) { return value + 1 })
    }
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    var observer = typeof MutationObserver === 'function' ? new MutationObserver(update) : null
    observer?.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] })
    return function () { window.removeEventListener('resize', update); document.removeEventListener('scroll', update, true); observer?.disconnect() }
  }, [open])
  React.useEffect(function () { if (props.disabled) { setOpen(false); setQuery('') } }, [props.disabled])

  // Filter on everything the row shows, plus its group: a user looking for
  // "the remote one called login" can type either part.
  var matches = React.useMemo(function () {
    var needle = query.trim().toLowerCase()
    var filtered = options.filter(function (item) { return !needle || item.search.indexOf(needle) !== -1 })
    if (props.allowCustom && query.trim() !== '') {
      var customValue = query.trim()
      filtered = filtered.filter(function (item) { return item.value !== customValue })
      filtered.unshift({ value: customValue, label: customValue, group: '' })
    }
    var groups = groupOptions(filtered), flat = []
    groups.forEach(function (group) { group.items.forEach(function (item) { flat.push(item) }) })
    return { groups: groups, flat: flat }
  }, [options, query, props.allowCustom])
  var groups = matches.groups, flat = matches.flat
  // Clamp the highlight: the list shrinks under it as the user types, so the
  // stored index can point past the end.
  var activeIndex = flat.length === 0 ? -1 : Math.max(0, Math.min(active, flat.length - 1))

  var expand = function () {
    if (props.disabled) return
    setQuery('')
    var selected = flat.findIndex(function (item) { return item.value === props.value })
    setActive(Math.max(0, selected))
    viewport[1]({ top: 0, active: -1, query: null, optionHeight: 0, groupHeight: 0 })
    setOpen(true)
  }

  /** Commit a choice and collapse. */
  var pick = function (value) {
    setOpen(false)
    setQuery('')
    setActive(0)
    props.onChange(value)
  }

  /** Collapse without choosing, restoring the selection label. */
  var dismiss = function () {
    setOpen(false)
    setQuery('')
    setActive(0)
  }

  var rect = inputRef.current !== null && inputRef.current !== undefined &&
    typeof inputRef.current.getBoundingClientRect === 'function'
    ? inputRef.current.getBoundingClientRect()
    : null

  // Match the theme's type scale; fixed row boxes keep scroll offsets exact.
  var fontSize = open && inputRef.current && typeof getComputedStyle === 'function'
    ? Number.parseFloat(getComputedStyle(inputRef.current).fontSize) || 14 : 14
  var optionHeight = Math.ceil(fontSize * 1.5 + 10), groupHeight = Math.ceil(Math.max(12, fontSize - 2) * 1.5 + 7)
  var geometry = React.useMemo(function () { return comboLayout(groups, optionHeight, groupHeight) }, [groups, optionHeight, groupHeight])
  var virtual = flat.length > 100
  var windowWidth = window.innerWidth || 1024, windowHeight = window.innerHeight || 800
  var below = rect ? windowHeight - rect.bottom - 12 : 256, above = rect ? rect.top - 12 : 0
  var upwards = below < Math.min(240, geometry.height + 8) && above > below
  var maxHeight = Math.max(40, Math.min(256, upwards ? above : below)), visibleHeight = maxHeight - 10
  var scrollTop = Math.max(0, Math.min(viewport[0].top, geometry.height - visibleHeight))
  var activeRow = geometry.optionRows[activeIndex]
  var reveal = viewport[0].active !== activeIndex || viewport[0].query !== query || viewport[0].optionHeight !== optionHeight || viewport[0].groupHeight !== groupHeight
  if (virtual && reveal && activeRow !== undefined) {
    var selectedRow = geometry.rows[activeRow]
    if (selectedRow.top < scrollTop) scrollTop = selectedRow.top
    else if (selectedRow.top + selectedRow.height > scrollTop + visibleHeight) scrollTop = selectedRow.top + selectedRow.height - visibleHeight
  }
  useLayoutEffect(function () {
    if (!open) return
    if (virtual && listRef.current && listRef.current.scrollTop !== scrollTop) listRef.current.scrollTop = scrollTop
    var top = virtual ? scrollTop : 0
    viewport[1](function (previous) {
      return previous.top === top && previous.active === activeIndex && previous.query === query && previous.optionHeight === optionHeight && previous.groupHeight === groupHeight
        ? previous : { top: top, active: activeIndex, query: query, optionHeight: optionHeight, groupHeight: groupHeight }
    })
  }, [open, virtual, scrollTop, activeIndex, query, optionHeight, groupHeight])

  var list = null
  if (open && rect !== null) {
    var rows = []
    /** One selectable row; `myIndex` is its position in the flattened list. */
    var makeRow = function (item, myIndex, style) {
      var isCurrent = item.value === props.value
      return h('button', {
        key: 'o:' + item.value,
        type: 'button',
        role: 'option', id: listId + '-' + myIndex, tabIndex: -1,
        'aria-selected': isCurrent,
        'aria-posinset': myIndex + 1, 'aria-setsize': flat.length,
        'aria-label': item.group ? item.label + ' (' + item.group + ')' : item.label,
        style: style,
        'data-value': item.value,
        'data-active': myIndex === activeIndex ? 'true' : 'false',
        className: 'dshgit-combooption' + (isCurrent ? ' dshgit-combooptioncurrent' : ''),
        ref: !virtual && myIndex === activeIndex
          // Keep the highlighted row in view during arrow navigation. A
          // function ref: the test harness ignores those, and browsers only
          // need it to exist.
          ? function (node) {
              if (node !== null && typeof node.scrollIntoView === 'function') {
                node.scrollIntoView({ block: 'nearest' })
              }
            }
          : undefined,
        // Keep focus in the input so the list does not close before the click
        // lands, and so typing can continue seamlessly.
        onMouseDown: function (event) { event.preventDefault() },
        onMouseEnter: function () { setActive(myIndex) },
        onClick: function () { pick(item.value) },
      }, [
        h('span', { key: 'c', className: 'dshgit-combocheck' }, isCurrent ? '✓' : ''),
        h('span', { key: 'l', className: 'dshgit-combolabel', title: item.label }, item.label),
      ])
    }
    var visibleRows = geometry.rows
    if (virtual) {
      var range = comboWindow(geometry.rows, scrollTop, visibleHeight)
      visibleRows = geometry.rows.slice(range.start, range.end)
      // aria-activedescendant must still name a mounted option after mouse scrolling.
      if (activeRow < range.start || activeRow >= range.end) visibleRows = visibleRows.concat(geometry.rows[activeRow]).filter(Boolean).sort(function (a, b) { return a.top - b.top })
    }
    visibleRows.forEach(function (row) {
      var style = virtual ? { position: 'absolute', top: row.top + 'px', left: 0, width: '100%', height: row.height + 'px', boxSizing: 'border-box' } : undefined
      rows.push(row.item ? makeRow(row.item, row.index, style)
        : h('div', { key: 'g:' + row.group, className: 'dshgit-combogroup', title: row.group, style: style }, row.group))
    })
    if (virtual) rows = [h('div', { key: 'virtual', className: 'dshgit-combovirtual', role: 'presentation', style: { height: geometry.height + 'px' } }, rows)]
    if (flat.length === 0) {
      rows.push(h('div', { key: 'none', className: 'dshgit-comboempty' }, t('combo.noMatch')))
    }
    var listWidth = Math.min(props.listWidth === undefined ? rect.width : props.listWidth, windowWidth - 16)
    list = ReactDOM.createPortal(h('div', {
      key: 'list',
      className: 'dshgit-combolist',
      role: 'listbox', id: listId, ref: listRef,
      'data-combo-list': props.value,
      'data-virtual': virtual,
      onMouseDown: function (event) { event.preventDefault() },
      onScroll: virtual ? function (event) {
        var top = Math.max(0, event.currentTarget.scrollTop)
        viewport[1]({ top: top, active: activeIndex, query: query, optionHeight: optionHeight, groupHeight: groupHeight })
      } : undefined,
      style: { left: Math.max(8, Math.min(rect.left, windowWidth - listWidth - 8)) + 'px', top: upwards ? undefined : rect.bottom + 4 + 'px', bottom: upwards ? windowHeight - rect.top + 4 + 'px' : undefined, width: listWidth + 'px', maxHeight: maxHeight + 'px' },
    }, rows), document.body)
  }

  return h(Fragment, null, [
    h('span', { key: 'control', className: 'dshgit-combo', style: props.style, 'data-open': open }, [h('input', {
      key: 'input',
      ref: inputRef,
      className: 'dshgit-input dshgit-comboinput' + (props.className === undefined ? '' : ' ' + props.className),

      type: 'text',
      name: props.name,
      required: props.required,
      role: 'combobox',
      autoComplete: 'off',
      spellCheck: false,
      autoFocus: props.autoFocus === true,
      disabled: props.disabled === true,
      'aria-label': props.label || props.placeholder,
      'aria-invalid': props.invalid || undefined,
      'aria-describedby': props.describedBy,
      'aria-expanded': open,
      'aria-autocomplete': searchable ? 'list' : 'none',
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open && activeIndex >= 0 ? listId + '-' + activeIndex : undefined,
      readOnly: !searchable,
      'data-combo': props.value,
      value: props.allowCustom && !open ? props.value : query,
      placeholder: current !== null ? '' : props.placeholder,
      onClick: function () { if (!open) expand() },
      onChange: function (event) {
        setOpen(true)
        setQuery(event.currentTarget.value)
        setActive(0)
        viewport[1]({ top: 0, active: -1, query: null, optionHeight: 0, groupHeight: 0 })
        if (props.allowCustom) props.onChange(event.currentTarget.value)
      },
      onBlur: dismiss,
      onKeyDown: function (event) {
        if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return
        if (!searchable && event.key === ' ') { event.preventDefault(); if (open) dismiss(); else expand(); return }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          if (!open) { expand(); return }
          if (flat.length === 0) return
          var step = event.key === 'ArrowDown' ? 1 : -1
          var next = activeIndex + step
          if (next < 0) next = flat.length - 1
          if (next >= flat.length) next = 0
          setActive(next)
          return
        }
        if (event.key === 'Enter') {
          if (!open) { event.preventDefault(); expand(); return }
          event.preventDefault()
          if (open && activeIndex >= 0 && flat[activeIndex] !== undefined) {
            event.preventDefault()
            pick(flat[activeIndex].value)
          }
          return
        }
        if (event.key === 'Escape') {
          if (!open) return
          event.preventDefault()
          // Stopping here matters: the surrounding dialog also closes on
          // Escape, and dismissing a list must not throw away the whole form.
          event.stopPropagation()
          dismiss()
          return
        }
        if (event.key === 'Tab' && open) dismiss()
      },
    }),
    !query && current !== null && (!props.allowCustom || open) ? h('span', { key: 'value', className: 'dshgit-combovalue', title: current.label }, current.label) : null,
    h('button', { key: 'arrow', type: 'button', className: 'dshgit-comboarrow', tabIndex: -1,
      disabled: props.disabled, 'aria-label': props.label || props.placeholder, 'aria-hidden': true,
      onMouseDown: function (event) { event.preventDefault() },
      onClick: function () { inputRef.current?.focus(); if (open) dismiss(); else expand() },
    }, svg({ size: 14 }, h('path', { d: 'M3 5l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
    ]),
    list,
  ])
}


/** Keyboard focus stays inside a modal until it closes. */
function useDialogFocus(panelRef, onClose, options) {
  var closeRef = React.useRef(onClose)
  closeRef.current = onClose
  React.useEffect(function () {
    var opts = options || {}
    var opener = opts.opener || document.activeElement
    var panel = panelRef.current
    if (panel && !panel.contains?.(document.activeElement)) {
      var first = opts.cancelFirst ? panel.querySelector?.('button:last-child')
        : panel.querySelector?.('input:not(:disabled),textarea:not(:disabled)') || panel.querySelector?.('button:not(:disabled)')
      if (first) first.focus?.()
      else panel.focus?.()
    }
    var key = function (event) {
      if (event.defaultPrevented || (event.target && panel && !panel.contains?.(event.target))) return
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      var controls = Array.from(panel?.querySelectorAll?.('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') || [])
      if (controls.length === 0) { event.preventDefault(); panel?.focus?.(); return }
      var first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus?.() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus?.() }
    }
    document.addEventListener('keydown', key, opts.capture === true)
    return function () {
      document.removeEventListener('keydown', key, opts.capture === true)
      // A newly opened dialog may already own focus. Do not steal it while
      // cleaning up the dialog that launched it.
      var current = document.activeElement
      if (opener?.isConnected !== false && (!current || current === document.body || current.isConnected === false || panel?.contains?.(current))) opener?.focus?.()
    }
  }, [])
}

export { ComboBox, FileContextMenu, Menu, dialogOption, useDialogFocus }

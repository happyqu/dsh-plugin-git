/** Find the Hero row belonging to this composer using the Host's slot anchors. */
export function findHeroWorkspaceRow(anchor) {
  for (var parent = anchor?.parentElement; parent; parent = parent.parentElement) {
    var preset = parent.querySelector?.('[data-slot="conversation.hero.agentPreset"]')
    if (preset) return preset.parentElement
    // Never reach another conversation through the outer application shell.
    if (parent.hasAttribute?.('data-phase') || parent.hasAttribute?.('data-content-phase')) break
  }
  return null
}

/** The Host's trailing options have auto margin: insert before that spacer. */
export function insertHeroActions(row, container) {
  var preset = row.querySelector('[data-slot="conversation.hero.agentPreset"]')
  row.insertBefore(container, preset?.nextSibling || null)
}

/** Match the mode label itself; the Hero row can use a larger heading font. */
export function syncHeroBranchFont(row, container, readStyle = getComputedStyle) {
  var preset = row.querySelector('[data-slot="conversation.hero.agentPreset"]')
  if (!preset) return
  var control = preset.querySelector('button, [role="button"]') || preset
  var label = [control].concat(Array.from(control.querySelectorAll('*'))).find(function (element) {
    return !element.closest('svg') && Array.from(element.childNodes).some(function (node) {
      return node.nodeType === 3 && node.textContent.trim()
    })
  }) || control
  var style = readStyle(label)
  Object.entries({ 'font-size': style.fontSize, 'font-family': style.fontFamily,
    'font-weight': style.fontWeight, 'line-height': style.lineHeight, 'letter-spacing': style.letterSpacing }).forEach(function (entry) {
    var name = '--dshgit-hero-' + entry[0], value = entry[1]
    if (value && container.style.getPropertyValue(name) !== value) container.style.setProperty(name, value)
  })
}

/** Include group headings in the scroll geometry, but not in option indexes. */
export function comboLayout(groups, optionHeight, groupHeight) {
  var rows = [], optionRows = [], offset = 0, index = 0
  groups.forEach(function (group) {
    if (group.name !== '') {
      rows.push({ group: group.name, top: offset, height: groupHeight })
      offset += groupHeight
    }
    group.items.forEach(function (item) {
      optionRows.push(rows.length)
      rows.push({ item: item, index: index++, top: offset, height: optionHeight })
      offset += optionHeight
    })
  })
  return { rows: rows, optionRows: optionRows, height: offset }
}

/** Binary search keeps scrolling independent of the total number of options. */
export function comboWindow(rows, top, height) {
  var low = 0, high = rows.length
  while (low < high) {
    var middle = (low + high) >>> 1
    if (rows[middle].top + rows[middle].height <= top) low = middle + 1
    else high = middle
  }
  var start = Math.max(0, low - 3)
  high = rows.length
  while (low < high) {
    var middle = (low + high) >>> 1
    if (rows[middle].top < top + height) low = middle + 1
    else high = middle
  }
  return { start: start, end: Math.min(rows.length, low + 3) }
}

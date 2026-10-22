

/** Format an epoch-seconds timestamp as a compact local string. */
function formatTime(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds)) return ''
  try {
    return new Date(seconds * 1000).toLocaleString()
  } catch (error) {
    return ''
  }
}



/**
 * Format an epoch-seconds timestamp as a short relative string.
 *
 * The words are plain locale keys, not hardcoded text: a caller that renders
 * in a user-chosen language passes its `t`, and callers without one keep the
 * zh defaults so a bare call never shows a raw key.
 *
 * @param seconds - epoch seconds.
 * @param translate - optional `t(key, values)` from the locale context.
 */
function formatRelative(seconds, translate) {
  if (typeof seconds !== 'number' || !isFinite(seconds)) return ''
  var say = typeof translate === 'function' ? translate : function (key, values) { return zhRelative[key].replace('{count}', values && values.count) }
  var diff = Date.now() / 1000 - seconds
  if (diff < 60) return say('time.justNow')
  if (diff < 3600) return say('time.minutesAgo', { count: Math.floor(diff / 60) })
  if (diff < 86400) return say('time.hoursAgo', { count: Math.floor(diff / 3600) })
  if (diff < 86400 * 30) return say('time.daysAgo', { count: Math.floor(diff / 86400) })
  if (diff < 86400 * 365) return say('time.monthsAgo', { count: Math.floor(diff / (86400 * 30)) })
  return say('time.yearsAgo', { count: Math.floor(diff / (86400 * 365)) })
}

var zhRelative = {
  'time.justNow': '刚刚',
  'time.minutesAgo': '{count} 分钟前',
  'time.hoursAgo': '{count} 小时前',
  'time.daysAgo': '{count} 天前',
  'time.monthsAgo': '{count} 个月前',
  'time.yearsAgo': '{count} 年前',
}



/**
 * Human-readable byte size, for the image preview's metadata row.
 *
 * @param bytes - a non-negative byte count.
 * @returns e.g. `187.5 kB` / `1.4 MB`.
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return bytes + ' B'
  var units = ['kB', 'MB', 'GB']
  var value = bytes / 1024
  var unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10) + ' ' + units[unit]
}

export { formatBytes, formatRelative, formatTime }

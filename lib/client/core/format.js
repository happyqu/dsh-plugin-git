

/** Format an epoch-seconds timestamp as a compact local string. */
function formatTime(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds)) return ''
  try {
    return new Date(seconds * 1000).toLocaleString()
  } catch (error) {
    return ''
  }
}



/** Format an epoch-seconds timestamp as a short relative string. */
function formatRelative(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds)) return ''
  var diff = Date.now() / 1000 - seconds
  if (diff < 60) return '刚刚'
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前'
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前'
  if (diff < 86400 * 365) return Math.floor(diff / (86400 * 30)) + ' 个月前'
  return Math.floor(diff / (86400 * 365)) + ' 年前'
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

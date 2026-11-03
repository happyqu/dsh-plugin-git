

/** The single-letter status code git shows for a changed file. */
function statusLetter(file) {
  if (file.kind === 'untracked') return 'U'
  if (file.kind === 'unmerged') return '!'
  if (file.kind === 'renamed') return 'R'
  if (file.index !== '.' && file.index !== ' ' && file.index !== '?') return file.index
  if (file.worktree !== '.' && file.worktree !== ' ') return file.worktree
  return 'M'
}


/**
 * Whether the file has changes STAGED for the next commit.
 *
 * Read from `index`, not from the `staged` boolean, because for a file git
 * reports as `MM` those are different facts: it has staged changes AND further
 * unstaged edits. Collapsing that to one boolean can only put the file in one
 * list, and whichever list it lands in, the other half of its changes is
 * invisible — so the user commits without having seen part of the diff.
 *
 * @param file - one status entry.
 * @returns whether it belongs in the staged section.
 */
function isStaged(file) {
  if (file.kind === 'untracked' || file.kind === 'ignored') return false
  // A conflict is not "staged": it cannot be committed until it is resolved,
  // so listing it as staged invites a commit git will refuse.
  if (file.kind === 'unmerged') return false
  return file.index !== '.' && file.index !== ' ' && file.index !== '?'
}


/**
 * Whether the file has changes NOT staged, including partially staged ones.
 *
 * A partially staged file belongs in BOTH sections: that is what shows the
 * user there is more to add before committing.
 *
 * @param file - one status entry.
 * @returns whether it belongs in the unstaged section.
 */
function isUnstaged(file) {
  if (file.kind === 'unmerged') return true
  if (file.kind === 'untracked') return true
  return file.worktree !== '.' && file.worktree !== ' '
}


/**
 * Whether the file's changes are split across the index and the worktree.
 * @param file - one status entry.
 * @returns whether it is partially staged.
 */
function isPartial(file) {
  return isStaged(file) && isUnstaged(file)
}


/** Basename of a slash-separated path. */
function baseName(path) {
  var parts = String(path || '').split('/')
  return parts[parts.length - 1] || path
}


/**
 * The directory part of a path, for grouping repositories.
 *
 * Handles both separators because repository roots arrive as native Windows
 * paths (`D:/demo/repo` after normalisation, but a raw `D:\demo\repo` is
 * possible) while a POSIX path uses `/` only.
 *
 * @param path - the path.
 * @returns the parent directory, or `''` when there is none.
 */
function dirName(path) {
  var text = String(path || '')
  var cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return cut <= 0 ? '' : text.slice(0, cut)
}


/**
 * Whether a path names a raster image the panel can render inline.
 *
 * Kept in step with the Host's `IMAGE_MIME` table. It exists so the panel can
 * skip the `imageDiff` round-trip entirely for the overwhelming majority of
 * files that are not images; SVG is excluded there and here, for the same
 * reason (it is text, and inlining it would run repository markup).
 *
 * @param path - a repository-relative path.
 * @returns true when the extension is a previewable raster format.
 */
function isImagePath(path) {
  return /\.(?:png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(String(path ?? ''))
}


/** A safe download name for a repository path (last segment only). */
function imageFileName(path) {
  var name = String(path ?? '').split(/[\\/]/).filter(Boolean).pop() || 'image'
  return name.replace(/[\\/:*?"<>|\0]/g, '_')
}

/**
 * Whether a changed file is binary, preferring the loaded patch.
 *
 * Status reports `binary` from `diff --numstat`, but that decoration is skipped
 * past STATUS_DECORATION_LIMIT changes (the host sends `null` instead of
 * `false`, meaning "not established"), so a large change set would otherwise
 * offer hunk staging on a binary file and let the Host refuse the write. The
 * patch on screen is authoritative when there is one: it is the same diff the
 * hunk operations are about to be computed from.
 *
 * @param file - one status entry, possibly with `binary: null`.
 * @param patch - the loaded diff for that file, if any.
 * @returns whether the file cannot be handled as text.
 */
function isBinaryChange(file, patch) {
  if (patch?.binary === true || patch?.tooLarge === true || patch?.truncated === true) return true
  return file?.binary === true
}


/** Sum the added and removed lines over a set of hunks. */
function countHunkLines(hunks) {
  var added = 0, deleted = 0
  for (var index = 0; index < (hunks || []).length; index++) {
    var lines = hunks[index].lines || []
    for (var line = 0; line < lines.length; line++) {
      if (lines[line].charAt(0) === '+') added++
      else if (lines[line].charAt(0) === '-') deleted++
    }
  }
  return { added: added, deleted: deleted }
}


export { baseName, countHunkLines, dirName, imageFileName, isBinaryChange, isImagePath, isPartial, isStaged, isUnstaged, statusLetter }

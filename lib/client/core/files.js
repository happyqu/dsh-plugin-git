

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

export { baseName, dirName, imageFileName, isImagePath, isPartial, isStaged, isUnstaged, statusLetter }

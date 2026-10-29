import { createHash } from 'node:crypto'

/** Fingerprint the coordinates and body actually sent to the diff renderer. */
export function withHunkFingerprint(hunk) {
  if (hunk.wordDiff) return hunk
  const contentHash = createHash('sha256').update(JSON.stringify([
    hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines, hunk.lines,
  ])).digest('hex')
  return { ...hunk, contentHash }
}

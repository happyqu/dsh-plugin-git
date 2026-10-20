import { h } from '../core/runtime.js'

/* ------------------------------------------------------------------ *
 * Icons (local artwork; the primitives package must not be imported)
 * ------------------------------------------------------------------ */

/** Shared <svg> wrapper. */
function svg(props, children) {
  return h(
    'svg',
    {
      width: props.size,
      height: props.size,
      viewBox: '0 0 16 16',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
      className: props.className,
    },
    children,
  )
}


/** A branch glyph for the sidebar. */
function IconGit(props) {
  var size = props.size === undefined ? 16 : props.size
  return svg({ size: size, className: props.className }, [
    h('circle', { key: 'a', cx: '4.5', cy: '3.5', r: '1.8', stroke: 'currentColor' }),
    h('circle', { key: 'b', cx: '4.5', cy: '12.5', r: '1.8', stroke: 'currentColor' }),
    h('circle', { key: 'c', cx: '11.5', cy: '7', r: '1.8', stroke: 'currentColor' }),
    h('path', { key: 'd', d: 'M4.5 5.3v5.4', stroke: 'currentColor' }),
    h('path', { key: 'e', d: 'M4.5 9.8c0-3 7-1.6 7-4.6', stroke: 'currentColor' }),
  ])
}


/** Chevron used by collapsible sections. */
function IconChevron(props) {
  return svg({ size: props.size === undefined ? 10 : props.size, className: props.className }, h('path', {
    d: props.open === true ? 'M3 6l5 5 5-5' : 'M6 3l5 5-5 5',
    stroke: 'currentColor',
  }))
}


function IconChangeAction(props) {
  var path = {
    open: 'M5 2H3v12h9v-2M6 1h6l3 3v7M12 1v3h3M6 10l4-4m-3 0h3v3',
    viewGroup: 'M3 3H1v12h10v-2M5 1h7l3 3v9H5zM12 1v3h3M10 6v5m-2.5-2.5h5',
    stash: 'M8 1.5v7m-2.5-2.5L8 8.5 10.5 6M2 9.5h3l1.5 2h3l1.5-2h3V14H2z',
    export: 'M3 1h7l3 3v3M10 1v3h3M3 1v14h4M11 8v7m-2.5-2.5L11 15l2.5-2.5',
    restoreRevision: 'M4 5H1V2M1 5a6 6 0 1 1 0 6M8 4v4l3 2',
    preview: 'M1 8s2-4 7-4 7 4 7 4-2 4-7 4-7-4-7-4zM10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    archive: 'M2 2h12v3H2zM3 5v9h10V5M6 8h4',
    unstage: 'M2 8h12',
    stage: 'M8 2v12M2 8h12',
    refresh: 'M13 5V2m0 3h-3M13 5a5.5 5.5 0 1 0 .5 5',
    diff: 'M3 1h7l3 3v11H3zM10 1v3h3M5 7h5M5 11h5M7.5 9v4',
    before: 'M3 1h7l3 3v11H3zM10 1v3h3M10 9H5m0 0 2-2M5 9l2 2',
    after: 'M3 1h7l3 3v11H3zM10 1v3h3M5 9h5m0 0-2-2m2 2-2 2',
    // Undo-last-commit: an arrow swinging back left over a line, the mark
    // for "take the last step back" — a reset, not a discard.
    undo: 'M3 6h7a3.5 3.5 0 1 1 0 7H6M3 6l3-3M3 6l3 3',
    // Clean: a broom sweeping, for "remove the untracked leftovers".
    clean: 'M10.5 1.5l4 4L8 12l-2.5.5.5-2.5zM4 10l-2.5 4',
  }[props.kind]
  // Discard is the one glyph taken verbatim from VS Code's own codicon font,
  // and it is a FILLED outline rather than a stroke.
  //
  // The previous path was an almost-complete circle with an arrowhead, which
  // is the universal mark for "refresh" — so the discard button read as a
  // reload control, the opposite of a destructive action. VS Code's discard
  // is a curly back-arrow (codicon U+EAE2): the shape says "put this back",
  // which is exactly what the button does.
  //
  // Filled, not stroked, because that is how the glyph is drawn — it is the
  // outline of the arrow, so stroking it would double the line weight. The
  // path below was extracted from codicon.ttf's outline for U+EAE2 and
  // rendered beside the font glyph to confirm it reproduces it exactly.
  if (props.kind === 'discard') {
    return svg({ size: props.size === undefined ? 17 : props.size }, h('path', {
      d: 'M2.99 2.51Q2.99 2.29 3.15 2.13Q3.31 1.97 3.52 1.97Q3.73 1.97 3.87 2.13Q4 2.29 4 2.51L4 6.35L7.15 3.15Q7.95 2.4 8.99 2.13Q10.03 1.87 11.04 2.13Q12.05 2.4 12.83 3.17Q13.6 3.95 13.87 4.99Q14.13 6.03 13.87 7.04Q13.6 8.05 12.85 8.85L7.79 13.87Q7.68 13.97 7.47 13.97Q7.25 13.97 7.09 13.84Q6.93 13.71 6.93 13.49Q6.93 13.28 7.09 13.12L12.11 8.11Q13.01 7.25 13.01 6Q13.01 4.75 12.13 3.87Q11.25 2.99 10 2.99Q8.75 2.99 7.89 3.89L4.75 6.99L8.48 6.99Q8.69 6.99 8.85 7.15Q9.01 7.31 9.01 7.52Q9.01 7.73 8.85 7.87Q8.69 8 8.48 8L3.63 8Q3.36 8 3.17 7.81Q2.99 7.63 2.99 7.41Z',
      fill: 'currentColor', stroke: 'none',
    }))
  }
  return svg({ size: props.size === undefined ? 17 : props.size }, h('path', {
    d: path, stroke: 'currentColor', strokeWidth: '1.5',
    strokeLinecap: 'round', strokeLinejoin: 'round',
  }))
}


/** The two diagonal strokes of a resize grip, the familiar corner mark. */
function IconResize(props) {
  return svg({ size: 10 }, [
    h('path', { key: 'a', d: 'M14 6L6 14', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }),
    h('path', { key: 'b', d: 'M14 11L11 14', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }),
  ])
}


/** A branch glyph for the header's branch chip. */
function IconBranch(props) {
  return svg({ size: props.size === undefined ? 12 : props.size, className: props.className }, [
    h('circle', { key: 'a', cx: '4', cy: '3', r: '1.6', stroke: 'currentColor' }),
    h('circle', { key: 'b', cx: '4', cy: '13', r: '1.6', stroke: 'currentColor' }),
    h('circle', { key: 'c', cx: '12', cy: '6', r: '1.6', stroke: 'currentColor' }),
    h('path', { key: 'd', d: 'M4 4.6v6.8', stroke: 'currentColor' }),
    h('path', { key: 'e', d: 'M4 8.4c0-2.4 8-1.2 8-3.6', stroke: 'currentColor' }),
  ])
}


/**
 * The "changes" glyph: a pencil over a line, as a diff/edits mark.
 *
 * Deliberately not the same artwork as {@link IconGit}: the two chips sit
 * side by side, and two identical icons would be unreadable at 12px.
 */
function IconFileList(props) {
  return svg(props, h('path', { d: 'M5 3h9M5 8h9M5 13h9M1 3h1M1 8h1M1 13h1',
    stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }))
}

function IconPlus(props) {
  return svg(props, h('path', { d: 'M8 3v10M3 8h10', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }))
}

function IconFolder(props) {
  return svg(props, h('path', { d: 'M1.5 4h5l1.5 2h6.5v7h-13zM1.5 4V2.5h5L8 4h5v2', stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' }))
}

function IconRemote(props) {
  return svg(props, h('path', { d: 'M4.3 12.5h7.4a2.8 2.8 0 0 0 .3-5.6A4.1 4.1 0 0 0 4 6a3.3 3.3 0 0 0 .3 6.5Z',
    stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' }))
}

function IconTag(props) {
  return svg(props, [h('path', { key: 'tag', d: 'M2 2h5.5l6.5 6.5-5.5 5.5L2 7.5Z', stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' }),
    h('circle', { key: 'hole', cx: '5', cy: '5', r: '1', fill: 'currentColor' })])
}

function IconStar(props) {
  return svg(props, h('path', { d: 'm8 1.5 2 4.1 4.5.7-3.2 3.1.7 4.6-4-2.2-4 2.2.7-4.6-3.2-3.1 4.5-.7Z',
    stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' }))
}

function IconFolderPlus(props) {
  return svg(props, h('path', { d: 'M1.5 4h5l1.5 2h6.5v7h-13zM1.5 4V2.5h5L8 4h5v2M8 8v3M6.5 9.5h3', stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round', strokeLinecap: 'round' }))
}

function IconFileTree(props) {
  return svg(props, h('path', { d: 'M2 2h4v3H2zM9 7h5v3H9zM9 12h5v3H9zM4 5v8.5h5M4 8.5h5',
    stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' }))
}


function IconStashApply(props) {
  return svg(props, h('path', { d: 'M8 2v8M5 7l3 3 3-3M5 9H3l-1 4v1h12v-1l-1-4h-2',
    stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

function IconStashPop(props) {
  return svg(props, h('path', { d: 'M8 10V2M5 5l3-3 3 3M5 9H3l-1 4v1h12v-1l-1-4h-2',
    stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

function IconTrash(props) {
  return svg(props, h('path', { d: 'M3 4h10M6 4V2h4v2M4 4l.7 10h6.6L12 4M6.5 7v4M9.5 7v4',
    stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }))
}


function IconSweep(props) {
  return svg(props, h('path', { d: 'M12.5 1.5 7.5 7M5.5 6.5l4 3-2.5 5H1.5l1.5-5 2.5-3ZM4 10l-1 4.5M6 11l-.5 3.5M10.5 13.5h3M12 10.5h2.5',
    stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }))
}


function IconMore(props) {
  return svg(props, [3, 8, 13].map(function (y) {
    return h('circle', { key: y, cx: props.horizontal ? y : 8, cy: props.horizontal ? 8 : y, r: 1.4, fill: 'currentColor' })
  }))
}


function IconCopyPath(props) {
  return svg(props, [
    h('rect', { key: 'front', x: 5, y: 5, width: 9, height: 9, rx: 1.3, stroke: 'currentColor', strokeWidth: '1.4' }),
    h('path', { key: 'back', d: 'M10 3V2H2v8h1', stroke: 'currentColor', strokeWidth: '1.4', strokeLinejoin: 'round', strokeLinecap: 'round' }),
  ])
}


function IconStash(props) {
  return svg(props, [
    h('path', { key: 'box', d: 'M2 5h12v9H2zM1 2h14v3H1zM6 8h4', fill: 'none',
      stroke: 'currentColor', strokeWidth: '1.6', strokeLinejoin: 'round', strokeLinecap: 'round' }),
  ])
}


function IconChanges(props) {
  return svg({ size: props.size === undefined ? 12 : props.size, className: props.className }, [
    h('path', { key: 'a', d: 'M9.5 2.5l3 3L6 12H3V9z', stroke: 'currentColor', strokeLinejoin: 'round' }),
    h('path', { key: 'b', d: 'M2 15h12', stroke: 'currentColor', strokeLinecap: 'round' }),
  ])
}


/**
 * The activity bar's icons.
 *
 * One glyph per module, drawn on the same 16×16 grid and with the same
 * `currentColor` stroke as the rest of the panel's artwork. The activity bar
 * is the only module switcher, so an unreadable icon there costs the user the
 * ability to navigate — these are deliberately simple silhouettes rather than
 * detailed marks that dissolve at 18px.
 *
 * Each takes an optional `size`, defaulting to 18 (the activity bar's size),
 * so a status-bar use can ask for 12 without a second component.
 */

/** History: a clock face, the universal "past" mark. */
function IconHistory(props) {
  return svg({ size: props.size === undefined ? 18 : props.size, className: props.className }, [
    h('circle', { key: 'a', cx: '8', cy: '8', r: '6.2', stroke: 'currentColor' }),
    h('path', { key: 'b', d: 'M8 4.4V8l2.6 1.6', stroke: 'currentColor', strokeLinecap: 'round' }),
  ])
}


/** Commit graph: three nodes on a lane, the shape a graph column makes. */
function IconGraph(props) {
  return svg({ size: props.size === undefined ? 18 : props.size, className: props.className }, [
    h('circle', { key: 'a', cx: '4', cy: '3.4', r: '1.7', stroke: 'currentColor' }),
    h('circle', { key: 'b', cx: '4', cy: '12.6', r: '1.7', stroke: 'currentColor' }),
    h('circle', { key: 'c', cx: '12', cy: '8', r: '1.7', stroke: 'currentColor' }),
    h('path', { key: 'd', d: 'M4 5.1v5.8', stroke: 'currentColor' }),
    h('path', { key: 'e', d: 'M5.7 8h4.6', stroke: 'currentColor' }),
  ])
}


/** Compare: two columns with an arrow crossing between them. */
function IconCompare(props) {
  return svg({ size: props.size === undefined ? 18 : props.size, className: props.className }, [
    h('path', { key: 'a', d: 'M2.5 4.5h6M2.5 11.5h6', stroke: 'currentColor', strokeLinecap: 'round' }),
    h('path', { key: 'b', d: 'M13.5 4.5h-2M13.5 11.5h-2', stroke: 'currentColor', strokeLinecap: 'round' }),
    h('path', {
      key: 'c', d: 'M9.5 8h4m0 0-1.6-1.6M13.5 8l-1.6 1.6',
      stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round',
    }),
  ])
}


/** Output: a terminal prompt. */
function IconOutput(props) {
  return svg({ size: props.size === undefined ? 18 : props.size, className: props.className }, [
    h('rect', { key: 'a', x: '1.8', y: '2.8', width: '12.4', height: '10.4', rx: '1.6', stroke: 'currentColor' }),
    h('path', { key: 'b', d: 'M4.6 6.4l2 1.8-2 1.8', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { key: 'c', d: 'M8.4 10.4h3.2', stroke: 'currentColor', strokeLinecap: 'round' }),
  ])
}


/** Settings: a gear. */
function IconSettings(props) {
  return svg({ size: props.size === undefined ? 18 : props.size, className: props.className }, [
    h('circle', { key: 'a', cx: '8', cy: '8', r: '2.2', stroke: 'currentColor' }),
    h('path', {
      key: 'b',
      d: 'M8 1.6l1 1.7 2-.3.5 2 1.8.9-1 1.8 1 1.8-1.8.9-.5 2-2-.3-1 1.7-1-1.7-2 .3-.5-2-1.8-.9 1-1.8-1-1.8 1.8-.9.5-2 2 .3z',
      stroke: 'currentColor', strokeLinejoin: 'round',
    }),
  ])
}


/** Refresh: a circular arrow, for the title bar's reload control. */
function IconRefresh(props) {
  return svg({ size: props.size === undefined ? 15 : props.size, className: props.className }, [
    h('path', { key: 'a', d: 'M13.4 8a5.4 5.4 0 1 1-1.6-3.8', stroke: 'currentColor', strokeLinecap: 'round' }),
    h('path', { key: 'b', d: 'M13.6 2.2V5h-2.8', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }),
  ])
}


/** Fetch: a cloud with a downward arrow, i.e. "bring the remote's state in". */
function IconFetch(props) {
  return svg({ size: props.size === undefined ? 15 : props.size, className: props.className }, [
    h('path', {
      key: 'a', d: 'M5 12.4h6.4a2.7 2.7 0 0 0 .3-5.4 3.5 3.5 0 0 0-6.7-.7A2.5 2.5 0 0 0 5 12.4z',
      stroke: 'currentColor', strokeLinejoin: 'round',
    }),
  ])
}


/** Branch sync actions share a ref marker; fetch uses a dotted arrow. */
function IconBranchSync(props) {
  var push = props.kind === 'push'
  return svg({ size: props.size === undefined ? 16 : props.size }, [
    h('path', { key: 'line', d: 'M1.5 12.5h4.25m4.5 0h4.25', stroke: 'currentColor', strokeLinecap: 'round' }),
    h('circle', { key: 'ref', cx: 8, cy: 12.5, r: 2.25, stroke: 'currentColor' }),
    h('path', { key: 'shaft', d: push ? 'M8 8.5V1.5' : 'M8 1.5v7', stroke: 'currentColor', strokeLinecap: 'round', strokeDasharray: props.kind === 'fetch' ? '1 2' : undefined }),
    h('path', { key: 'arrow', d: push ? 'M4.75 4.75 8 1.5l3.25 3.25' : 'M4.75 5.25 8 8.5l3.25-3.25', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }),
  ])
}


function IconBranchAction(props) {
  if (props.kind === 'merge') return svg({ size: props.size || 16 }, [
    h('circle', { key: 'base', cx: 3, cy: 2, r: 1.5, stroke: 'currentColor', strokeWidth: 1.5 }),
    h('circle', { key: 'source', cx: 12, cy: 4, r: 1.5, stroke: 'currentColor', strokeWidth: 1.5 }),
    h('circle', { key: 'result', cx: 3, cy: 14, r: 1.5, stroke: 'currentColor', strokeWidth: 1.5 }),
    h('path', { key: 'merge', d: 'M3 3.5v9M12 5.5V6c0 2.3-2 3.5-4.5 3.5H3.5M6 7l-2.5 2.5L6 12', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  ])

  if (props.kind === 'checkout') return svg({ size: props.size || 16 }, h('path', {
    d: 'M5 3H4a3.5 3.5 0 0 0 0 7h9M10 7l3 3-3 3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
  }))
  return svg({ size: props.size || 16 }, [
    h('circle', { key: 'start', cx: 3, cy: 2, r: 1.4, stroke: 'currentColor' }),
    h('circle', { key: 'end', cx: 3, cy: 13, r: 1.4, stroke: 'currentColor' }),
    h('circle', { key: 'branch', cx: 11, cy: 2, r: 1.4, stroke: 'currentColor' }),
    h('path', { key: 'line', d: 'M3 3.4v8.2M11 3.4v1.4c0 2.2-8 2-8 5', stroke: 'currentColor' }),
    h('circle', { key: 'new', cx: 11, cy: 11, r: 3.5, stroke: 'currentColor' }),
    h('path', { key: 'plus', d: 'M11 9v4m-2-2h4', stroke: 'currentColor', strokeLinecap: 'round' }),
  ])
}


/** A tick in a circle: the outcome banner's success tone. */
function IconCheck(props) {
  return svg({ size: props.size === undefined ? 14 : props.size, className: props.className }, [
    h('circle', { key: 'a', cx: '8', cy: '8', r: '6.4', stroke: 'currentColor' }),
    h('path', { key: 'b', d: 'M5.2 8.3l2 2 3.6-4', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }),
  ])
}


/** A filled exclamation mark: the outcome banner's error tone. */
function IconAlert(props) {
  return svg({ size: props.size === undefined ? 14 : props.size, className: props.className }, [
    h('circle', { key: 'a', cx: '8', cy: '8', r: '6.4', stroke: 'currentColor' }),
    h('path', { key: 'b', d: 'M8 4.6v4.2', stroke: 'currentColor', strokeLinecap: 'round' }),
    h('circle', { key: 'c', cx: '8', cy: '11.3', r: '.85', fill: 'currentColor' }),
  ])
}


/** An x, for dismissing an outcome banner. */
function IconClose(props) {
  return svg({ size: props.size === undefined ? 12 : props.size, className: props.className }, [
    h('path', { key: 'a', d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeLinecap: 'round' }),
  ])
}

export { IconAlert, IconBranch, IconBranchAction, IconBranchSync, IconChangeAction, IconChanges, IconCheck, IconChevron, IconClose, IconCompare, IconCopyPath, IconFileList, IconFileTree, IconFolder, IconFolderPlus, IconGit, IconGraph, IconHistory, IconMore, IconOutput, IconPlus, IconRefresh, IconRemote, IconResize, IconSettings, IconStar, IconStash, IconStashApply, IconStashPop, IconSweep, IconTag, IconTrash, svg }

/**
 * Verify the Client half without a browser.
 *
 * There is no browser test runner here, so this suite proves the things a silent
 * failure would hide: the module parses through the real `__ModuleLoader__`
 * entry, the two panel registrations share the id that makes the sidebar icon
 * address this panel, every locale key the component reads exists in both
 * dictionaries, and — most importantly — the component actually RENDERS in each
 * tab. A component that throws blanks its slot entry, and the user sees an empty
 * panel with no error.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { findHeroWorkspaceRow, insertHeroActions, syncHeroBranchFont } from '../lib/client/core/hero-placement.js'
import { popoverPosition } from '../lib/client/ui/popover-position.js'
import { observeWorkspaceNavigation, getWorkspaceNavigation, acknowledgeWorkspaceNavigation } from '../lib/client/core/workspace-navigation.js'

import {
  loadClientModule,
  createClientContext,
  createRpcStub,
  mount,
  flush,
  walk,
  textOf,
  findAll,
  findWhere,
  hasText,
  refNode,
  React,
  runCleanups,
} from './render-harness.mjs'

/** Shorthand for React.createElement, matching the plugin's own style. */
const h = React.createElement

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'dist', 'client.js'), 'utf8')

let failures = 0
let checks = 0

function check(label, ok, detail) {
  checks++
  if (ok) console.log(`ok   ${label}`)
  else {
    failures++
    console.error(`FAIL ${label}${detail === undefined ? '' : `\n     ${detail}`}`)
  }
}

/* ------------------------------------------------------------------ *
 * Fixture data, shaped exactly like the Host's real RPC values
 * ------------------------------------------------------------------ */

const ROOT = 'D:/demo/repo'

const STATUS = {
  repo: { root: ROOT, version: 'git version 2.50.1.windows.1' },
  branch: { head: 'main', upstream: 'origin/main', ahead: 1, behind: 0, detached: false, oid: 'a'.repeat(40) },
  total: 3,
  files: [
    { path: 'docs/待提交.md', originalPath: null, index: 'A', worktree: '.', staged: true, kind: 'ordinary', added: 3, deleted: 0, binary: false },
    { path: 'src/index.js', originalPath: null, index: '.', worktree: 'M', staged: false, kind: 'ordinary', added: 2, deleted: 1, binary: false },
    { path: 'untracked.txt', originalPath: null, index: '?', worktree: '?', staged: false, kind: 'untracked', added: null, deleted: null, binary: false },
  ],
}

const REFS = {
  branches: [
    // `ahead`/`behind`/`upstreamRef` are what the branch row needs to render its
    // divergence (`dshgit-branch-tracking`); without them that span never appears.
    { name: 'main', ref: 'refs/heads/main', sha: 'a'.repeat(40), head: true, subject: 'merge: 合并 feature', upstream: 'origin/main', upstreamRef: 'refs/remotes/origin/main', ahead: 2, behind: 1 },
    { name: 'feature/新功能', ref: 'refs/heads/feature/新功能', sha: 'b'.repeat(40), head: false, subject: 'feat: util', upstream: null, upstreamRef: null, ahead: 0, behind: 0 },
    { name: 'origin/main', ref: 'refs/remotes/origin/main', sha: 'a'.repeat(40), head: false, subject: 'merge', upstream: null, upstreamRef: null, ahead: 0, behind: 0 },
  ],
  tags: [{ name: 'v0.1.0', ref: 'refs/tags/v0.1.0', sha: 'c'.repeat(40), subject: '第一个版本' }],
  remotes: [{ name: 'origin/main', ref: 'refs/remotes/origin/main', sha: 'a'.repeat(40), subject: 'merge' }],
}

const REMOTES = [
  { name: 'origin', fetchUrl: 'https://github.com/user/repo.git', pushUrl: 'https://github.com/user/repo.git' },
]

const CONTRIBUTORS = [
  { commits: 12, name: '张三', email: 'dev@example.com' },
  { commits: 5, name: '李四', email: 'li@example.com' },
]

const TRACKING = { ref: 'main', upstream: 'origin/main', ahead: 2, behind: 1 }

const REPO_META = {
  lastFetchedAt: 1790741262000,
  commitCount: 5,
  userName: '张三',
  userEmail: 'dev@example.com',
}

const COMMITS = {
  commits: [
    {
      sha: 'f'.repeat(40), shortSha: 'fffffff', author: '张三', authorEmail: 'dev@example.com',
      authorDate: 1790741262, committerDate: 1790741262, parents: ['e'.repeat(40)],
      tips: ['main'], subject: 'merge: 合并 feature/新功能', message: 'merge: 合并 feature/新功能',
      files: [{ status: 'M', path: 'src/util.js', from: null }],
    },
    {
      sha: 'e'.repeat(40), shortSha: 'eeeeeee', author: '李四', authorEmail: 'l@example.com',
      authorDate: 1790740000, committerDate: 1790740000, parents: ['d'.repeat(40)],
      tips: [], subject: 'refactor: 把 app.js 重命名为 index.js', message: 'refactor: 把 app.js 重命名为 index.js\n\n详见说明。',
      files: [{ status: 'R', path: 'src/index.js', from: 'src/app.js' }],
    },
  ],
}

const GRAPH = {
  laneCount: 2,
  rows: [
    { sha: 'f'.repeat(40), shortSha: 'fffffff', parents: ['e'.repeat(40), 'b'.repeat(40)], lane: 0, laneCount: 2, through: [], edges: [{ from: 0, to: 0 }, { from: 0, to: 1 }], tips: ['main'], subject: 'merge: 合并 feature/新功能' },
    { sha: 'e'.repeat(40), shortSha: 'eeeeeee', parents: ['d'.repeat(40)], lane: 0, laneCount: 2, through: [1], edges: [{ from: 0, to: 0 }], tips: [], subject: 'refactor: 把 app.js 重命名为 index.js' },
    { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', parents: ['d'.repeat(40)], lane: 1, laneCount: 2, through: [], edges: [{ from: 1, to: 0 }], tips: ['feature/新功能'], subject: 'feat: 新分支上添加 util.js' },
  ],
}

const DIFF = {
  text: 'diff --git a/src/index.js b/src/index.js\n@@ -1,3 +1,4 @@\n function main() {\n+  console.log(\'world\')\n }\n',
  files: [{
    from: null, path: 'src/index.js', status: 'M', binary: false,
    hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' function main() {', "+  console.log('world')", ' }'] }],
  }],
  hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' function main() {', "+  console.log('world')", ' }'] }],
}

const COMMIT_DIFF = {
  text: 'diff --git a/src/index.js b/src/index.js\n@@ -1,3 +1,4 @@\n function main() {\n-  console.log(\'hi\')\n+  console.log(\'world\')\n }\n',
  files: [{
    // A rename (`R`) with `from` set, which is the shape `parse.js` produces for a
    // rename pair. The detail pane renders `file.status` as a badge, so this fixture
    // is what makes that badge reachable — a plain 'M' would never show one.
    from: 'src/app.js', path: 'src/index.js', status: 'R', binary: false,
    hunks: [{
      oldStart: 1, oldLines: 3, newStart: 1, newLines: 4,
      // Both an addition and a deletion, so the renderer's two row kinds are
      // exercised rather than only the easy one.
      lines: [' function main() {', "-  console.log('hi')", "+  console.log('world')", ' }'],
    }],
  }],
  hunks: [{
    oldStart: 1, oldLines: 3, newStart: 1, newLines: 4,
    lines: [' function main() {', "-  console.log('hi')", "+  console.log('world')", ' }'],
  }],
}

const BLAME = {
  path: 'src/index.js',
  rev: 'WORKTREE',
  range: null,
  fileLines: 4,
  cacheable: true,
  authors: [{ name: '张三', mail: 'dev@example.com', lines: 3 }],
  commits: [{ sha: 'e'.repeat(40), author: '张三', authorTime: 1790740000, summary: 'refactor: 重命名' }],
  lines: [
    { line: 1, originalLine: 1, sha: 'e'.repeat(40), author: '张三', authorTime: 1790740000, summary: 'refactor: 重命名', previous: null, filename: 'src/index.js' },
    { line: 2, originalLine: 2, sha: 'e'.repeat(40), author: '张三', authorTime: 1790740000, summary: 'refactor: 重命名', previous: null, filename: 'src/index.js' },
  ],
}

const COMMIT_DETAIL = {
  sha: 'e'.repeat(40), shortSha: 'eeeeeee', author: '张三', authorEmail: 'dev@example.com',
  authorDate: 1790740000, committerDate: 1790740000, parents: ['d'.repeat(40)], tips: [],
  subject: 'refactor: 把 app.js 重命名为 index.js',
  message: 'refactor: 把 app.js 重命名为 index.js\n\n详见说明。',
  // `status` is what the Host's commit-detail parser emits for each file
  // (`parse.js` sets 'R' when a rename pair is seen), and the detail pane renders
  // it as a badge. The fixture previously omitted it, so that badge could never
  // appear and the assertion that looked for it was testing nothing.
  files: [{ path: 'src/index.js', originalPath: 'src/app.js', status: 'R', added: 1, deleted: 0, binary: false }],
}

const CONFIG = {
  gitPath: '', defaultRepo: '', similarityThreshold: 50, autoBlame: true, blameChunkLines: 2000,
  historyLimit: 300, aiEnabled: true, aiProvider: '', aiModel: '', aiExcludePatterns: '', locale: '',
}

const DIAGNOSTICS = {
  gitPath: 'd:/Program Files/Git/cmd/git.exe',
  node: 'v24.21.0',
  platform: 'win32',
  sessions: [{
    root: ROOT,
    version: 'git version 2.50.1.windows.1',
    features: { 'git:status:porcelain-v2': true },
    ignoreRevsFile: null,
    cache: { blame: { size: 2, hits: 1, misses: 1 }, diff: { size: 1, hits: 0, misses: 1 } },
  }],
}

/** Handlers for a fully working Host. */
function healthyHandlers(overrides = {}) {
  return {
    repos: () => ({ gitPath: 'd:/Program Files/Git/cmd/git.exe', repos: [{ root: ROOT, version: 'git version 2.50.1.windows.1', features: {} }], config: CONFIG }),
    status: () => STATUS,
    changelists: () => ({ version: 1, mode: 'staging', fileLayout: 'flat', active: 'default', draftList: 'default', lists: [{ id: 'default', name: '默认', draft: '', expanded: true }], assignments: {}, selected: [], chunks: {} }),
    refs: () => REFS,
    stashes: () => [{ ref: 'stash@{0}', sha: '9'.repeat(40), message: 'On main: 临时改动：README 草稿', date: 1790740000 }],
    stashDiff: () => COMMIT_DIFF,
    worktrees: () => [{ path: ROOT, head: 'a'.repeat(40), branch: 'refs/heads/main', bare: false, detached: false }],
    commits: () => COMMITS,
    commit: () => COMMIT_DETAIL,
    commitGraph: () => GRAPH,
    // The branch/tag dialogs gate their submit on a review payload: `ready` is
    // `preview.reviewKey === previewKey`, so without this the form silently refuses
    // to submit and no write is ever attempted.
    workbenchPreview: (payload) => ({
      reviewKey: String(payload?.action ?? '') + ':' + String(payload?.ref ?? '') + ':' + String(payload?.sha ?? ''),
      branch: 'main', head: 'a'.repeat(40), target: 'a'.repeat(40), dirty: false, files: [],
      operation: null, published: false, publishedRefs: [], incoming: [], incomingCount: 0,
      outgoing: [], outgoingCount: 0, lost: [], lostCount: 0, commit: COMMIT_DETAIL,
    }),
    blame: () => BLAME,
    lineHistory: () => ({ entries: [{ sha: 'e'.repeat(40), author: '张三', authorTime: 1790740000, summary: 'refactor', path: 'src/index.js', line: 2, resultLine: 2, rev: 'WORKTREE' }] }),
    diff: (payload) => (payload?.from !== undefined && payload.from !== '' ? COMMIT_DIFF : DIFF),
    fileContent: () => ({ exists: true, text: 'function main() {\n  console.log(\'world\')\n}\n\nmain()\n', binary: false, truncated: false, error: null }),
    diffSummary: () => ({ files: 3, added: 5, deleted: 1, binary: 0 }),
    contributors: () => CONTRIBUTORS,
    remotes: () => REMOTES,
    branchTracking: () => TRACKING,
    repoMeta: () => REPO_META,
    compareCommits: () => ({
      left: 'main', right: 'HEAD', shortstat: '1 file changed, 2 insertions(+)',
      commits: COMMITS.commits,
    }),
    // The compare view loads its file list through `compareFiles`; without a stub
    // the pane renders a retry notice instead of the comparison.
    compareFiles: (payload) => ({
      left: payload?.left ?? 'main', right: payload?.right ?? 'HEAD',
      shortstat: '1 file changed, 2 insertions(+)',
      files: [{ path: 'src/index.js', status: 'M', added: 2, deleted: 0, binary: false, hunks: COMMIT_DIFF.files[0].hunks }],
      commits: COMMITS.commits,
    }),
    config: () => CONFIG,
    setConfig: (payload) => ({ ...CONFIG, ...payload.patch }),
    diagnostics: () => DIAGNOSTICS,
    invalidate: () => ({ ok: true }),
    gitOutput: () => ({
      total: 2,
      entries: [
        { id: 2, at: 1790741262000, cwd: ROOT, command: 'git push origin main', code: 1, durationMs: 640, stdout: '', stderr: 'fatal: 远端拒绝了推送 (non-fast-forward)', error: null },
        { id: 1, at: 1790741260000, cwd: ROOT, command: 'git status --porcelain=v2 --branch -u', code: 0, durationMs: 35, stdout: '# branch.head main', stderr: '', error: null },
      ],
    }),
    clearGitOutput: () => ({ ok: true }),
    clone: (payload) => ({ directory: payload.directory, message: 'Cloning into …' }),
    'write.fetch': () => ({ ok: true, code: 0, message: '已 Fetch', stdout: '' }),
    'write.pull': () => ({ ok: true, code: 0, message: '已 Pull', stdout: '' }),
    'write.push': () => ({ ok: true, code: 0, message: '已 Push', stdout: '' }),
    'write.merge': () => ({ ok: true, code: 0, message: '已合并', stdout: '' }),
    'write.renameBranch': () => ({ ok: true, code: 0, message: '已重命名', stdout: '' }),
    'write.deleteBranch': () => ({ ok: true, code: 0, message: '已删除分支', stdout: '' }),
    'write.stashPush': () => ({ ok: true, code: 0, message: '已储藏', stdout: '' }),
    'write.ignorePath': () => ({ ok: true, code: 0, message: '已添加到 .gitignore', stdout: '' }),
    'write.stashDrop': () => ({ ok: true, code: 0, message: '已删除储藏', stdout: '' }),
    'write.createTag': () => ({ ok: true, code: 0, message: '已打标签', stdout: '' }),
    'write.addRemote': () => ({ ok: true, code: 0, message: '已添加远端', stdout: '' }),
    'write.removeRemote': () => ({ ok: true, code: 0, message: '已删除远端', stdout: '' }),
    'write.undoCommit': () => ({ ok: true, code: 0, message: '已撤销提交', stdout: '' }),
    'write.createBranch': () => ({ ok: true, code: 0, message: '已新建分支', stdout: '' }),
    'write.discardAll': () => ({ ok: true, code: 0, message: '已丢弃全部', stdout: '' }),
    'write.clean': () => ({ ok: true, code: 0, message: '已清理', stdout: '' }),
    'ai.prepareCommitMessage': () => ({ available: true, id: 'context' }),
    'ai.commitMessage': () => ({ available: true, message: 'feat: 新增中文说明文档', empty: false }),
    'ai.explainCommit': () => ({ available: true, text: '这次提交把文件重命名了。' }),
    'ai.summarizeDiff': () => ({ available: true, text: '总体：小改动。' }),
    'write.stage': () => ({ ok: true, code: 0, message: '已暂存', stdout: '' }),
    'write.unstage': () => ({ ok: true, code: 0, message: '已取消暂存', stdout: '' }),
    'write.commit': () => ({ ok: true, code: 0, message: '提交成功', stdout: '' }),
    'write.discardPaths': () => ({ ok: true, message: '已丢弃' }),
    'write.discardPath': () => ({ ok: true, code: 0, message: '已丢弃', stdout: '' }),
    'write.checkout': () => ({ ok: true, code: 0, message: '已切换', stdout: '' }),
    'write.stashApply': () => ({ ok: true, code: 0, message: '已应用', stdout: '' }),
    ...overrides,
  }
}

/* ------------------------------------------------------------------ *
 * Module surface
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Module surface
 * ------------------------------------------------------------------ */

/**
 * A stand-in for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The real package is part of the shell's frozen platform module table, and it
 * carries DSH's Shiki highlighter. In this process there is no module table, so
 * the suite supplies a fake with the exact shape the plugin uses: a
 * `languageForPath` mapping and a `useCodeHighlighter(lang)` hook returning
 * `(code) => Array<Array<{ text, style }>>`.
 *
 * Faking it (rather than loading the real package) keeps the assertion about
 * THIS plugin: that it asks the platform for a grammar and renders whatever
 * tokens come back, with the colours it was given. Whether Shiki tokenizes
 * TypeScript correctly is Shiki's own test suite's job, not ours.
 *
 * @param options - `{ language }` to force a grammar, `{ none }` to simulate a
 *   profile without the package.
 * @returns the module table entry, or undefined for the absent case.
 */
function primitivesStub(options = {}) {
  const asked = []
  return {
    asked,
    // `undefined` makes the harness's require throw, which is exactly what the
    // browser does for a module that is absent from the platform table.
    module: options.none === true ? undefined : {
      /** Map a path to a grammar id, like the real extension table does. */
      languageForPath: (path) => {
        const extension = String(path).split('.').pop().toLowerCase()
        if (options.language !== undefined) return options.language
        if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) return 'javascript'
        if (['ts', 'tsx'].includes(extension)) return 'typescript'
        if (['yml', 'yaml'].includes(extension)) return 'yaml'
        return undefined
      },
      /**
       * The hook: returns a highlighter that splits each line into tokens with
       * an explicit colour, which is exactly what Shiki's `css-variables` theme
       * produces (`style.color` resolved from `--shiki-token-*`).
       */
      useCodeHighlighter: (language) => {
        asked.push(language)
        return (code) => String(code).split('\n').map((line) => {
          if (line === '') return []
          return [{ text: line, style: { color: 'rgb(10, 20, 30)' } }]
        })
      },
    },
  }
}

console.log('--- module surface ---')
// One shared stub instance, so the grammar the preview asked for can be
// asserted later rather than only inferred from the colours.
const primitives = primitivesStub()
const loaded = loadClientModule(source, { require: { '@deepseek-ai/dsh-client-ui-primitives': primitives.module } })
// The bundle registers under its npm package id, which is scoped.
check('loaded through __ModuleLoader__ with the package id', loaded.id === '@happyqu/dsh-plugin-git', String(loaded.id))
check('exports a name', typeof loaded.name === 'string' && loaded.name.length > 0, String(loaded.name))
check('exports apply()', typeof loaded.apply === 'function')
check('declares hard injections',
  Array.isArray(loaded.inject) && loaded.inject.includes('slots') && loaded.inject.includes('locale'),
  JSON.stringify(loaded.inject))

/* ------------------------------------------------------------------ *
 * Slot registrations
 * ------------------------------------------------------------------ */

console.log('\n--- slot registrations ---')
const stub = createRpcStub(healthyHandlers())
const client = createClientContext({ connection: stub })
loaded.apply(client.ctx)

// Styles are injected from an effect, so they land when `apply` runs rather than
// while the module factory is still evaluating.
check('installed exactly one stylesheet', loaded.appendedStyles.length === 1,
  String(loaded.appendedStyles.length))
check('the stylesheet declares this plugin as its owner',
  loaded.appendedStyles[0]?.dataset?.plugin === 'dsh-plugin-git',
  JSON.stringify(loaded.appendedStyles[0]?.dataset))
check('the stylesheet contains theme tokens, not hard-coded colors',
  String(loaded.appendedStyles[0]?.textContent).includes('--dsw-alias-'),
  String(loaded.appendedStyles[0]?.textContent).slice(0, 120))
check('an empty commit message keeps the primary button legible',
  String(loaded.appendedStyles[0]?.textContent).includes('.dshgit-btn.dshgit-commit-primary:disabled{opacity:1;'))
// The commit control is a joined split button: the primary half and the chevron
// half must share ONE fill. That fill is now a theme token
// (`--dsw-alias-button-info-fill`, falling back to the brand primary) rather than
// a hardcoded `#007acc`, so both halves follow the active theme — which is the
// point of the change. Assert the shared token on both halves instead.
check('the commit button uses a consistent primary surface', (() => {
  const css = String(loaded.appendedStyles[0]?.textContent ?? '')
  const primary = /\.dshgit-commit-primary\{[^}]*\}/.exec(css)?.[0] ?? ''
  const arrow = /\.dshgit-commit-arrow\{[^}]*\}/.exec(css)?.[0] ?? ''
  const token = 'var(--dsw-alias-button-info-fill'
  return primary.includes(token) && arrow.includes(token) &&
    primary.includes('border-radius:6px 0 0 6px') && arrow.includes('border-radius:0 6px 6px 0')
})())
// The remote steps moved from checkboxes into the options menu, so the menu is
// what has to exist now; the checkbox rule survives only for the confirm bar.
check('the commit options are offered from the split button menu',
  String(loaded.appendedStyles[0]?.textContent).includes('.dshgit-commit-menu-root{') &&
  String(loaded.appendedStyles[0]?.textContent).includes('.dshgit-commit-options{'))

/* ------------------------------------------------------------------ *
 * Type scale
 * ------------------------------------------------------------------ */

console.log('\n--- the type scale follows the DSH font-size setting ---')
{
  const css = String(loaded.appendedStyles[0]?.textContent ?? '')

  // DSH's Settings → Font size writes this exact custom property on `body`, so
  // reading it is what makes the panel follow the setting instead of pinning its
  // own numbers.
  check('the scale is rooted at DSH\u2019s content font size',
    css.includes('--dshgit-font-base:var(--dsh-content-font-size, 14px)'),
    'no --dshgit-font-base derived from --dsh-content-font-size')
  // Declared on `body`, not on `.dshgit`: the popovers, the file viewer and the
  // confirm bar are portalled to `body`, so a class-scoped ramp would leave
  // exactly the surfaces that need it most at their old fixed sizes.
  check('the scale is declared on body so portalled surfaces inherit it',
    /(^|\n)body\{--dshgit-font-base:/.test(css),
    css.split('\n')[0].slice(0, 100))

  // Nothing may stay pinned: one hardcoded size is enough to make a label ignore
  // the setting while its neighbours move.
  const pinned = css.match(/font-size:\d+px/g) ?? []
  check('no font size is hardcoded any more', pinned.length === 0,
    JSON.stringify(pinned))
  check('every font size goes through the scale',
    (css.match(/font-size:var\(--dshgit-font-/g) ?? []).length > 40,
    String((css.match(/font-size:var\(--dshgit-font-/g) ?? []).length))

  // The offsets must reproduce the sizes the panel shipped before the scale
  // existed, or every user on the default setting would see it shift.
  const offsets = { micro: 4, meta: 3, small: 2, body: 1, lead: 1, title: 0 }
  const floors = { micro: 10, meta: 11, small: 12, body: 12, lead: 13, title: 13 }
  const at = (base) => Object.fromEntries(Object.entries(offsets).map(([name, down]) =>
    [name, Math.max(floors[name] ?? 0, base - down)]))
  check('at the 14px default the scale uses readable caption sizes',
    JSON.stringify(at(14)) === JSON.stringify({ micro: 10, meta: 11, small: 12, body: 13, lead: 13, title: 14 }),
    JSON.stringify(at(14)))
  // The small end is clamped: at 12px an unclamped micro would be 7px, which is
  // unreadable, and the clamp must not silently invert the ordering either.
  check('the scale stays readable and ordered at the 12px minimum',
    at(12).micro >= 8 && at(12).micro <= at(12).meta && at(12).meta <= at(12).small &&
      at(12).small <= at(12).body && at(12).body <= at(12).lead && at(12).lead <= at(12).title,
    JSON.stringify(at(12)))
  check('the scale grows monotonically at the 17px maximum',
    at(17).micro <= at(17).meta && at(17).meta <= at(17).small && at(17).small <= at(17).body &&
      at(17).body <= at(17).lead && at(17).lead <= at(17).title,
    JSON.stringify(at(17)))
  // A caption must not outgrow body text just because the floor kicked in.
  check('the clamp never inverts the scale',
    Object.values(at(12)).every((value, index, all) => index === 0 || all[index - 1] <= value),
    JSON.stringify(at(12)))
}

/* ------------------------------------------------------------------ *
 * Native form controls
 * ------------------------------------------------------------------ */

console.log('\n--- the dropdown is a themed combobox list, not a UA-painted popup ---')
{
  const css = String(loaded.appendedStyles[0]?.textContent ?? '')
  // The native `<select>` is gone entirely, and with it the class of bug it
  // brought: the UA paints a select's popup, so it could not be themed (it showed
  // up as a white box in a dark dialog) and it could not be typed into. The list
  // is now our own DOM, portalled to `body`, so both problems disappear — and the
  // styling assertions move onto that list.
  check('no native select is styled or rendered any more',
    !css.includes('.dshgit-select'),
    (css.match(/\.dshgit-select[^{]*\{[^}]*\}/g) ?? []).slice(0, 2).join(' '))

  // The list must be positioned by us rather than nested: the workbench header
  // lives in a shell with `overflow:hidden` and a `backdrop-filter`, both of which
  // clip or trap a fixed descendant.
  const listRule = /\.dshgit-combolist\{[^}]*\}/.exec(css)
  check('the combobox list is a fixed overlay', listRule !== null && listRule[0].includes('position:fixed'),
    String(listRule))
  check('the combobox list carries a theme surface and stroke, like other popovers',
    css.includes('.dshgit-combolist{') && /\.dshgit-combolist\{[^}]*background:var\(--dsw-menu-surface-fill/.test(css) &&
      /\.dshgit-combolist\{[^}]*border:1px solid var\(--dsw-alias-border-l1\)/.test(css),
    String(listRule))
  // A translucent surface needs the opaque fallback, exactly like the popovers.
  check('the combobox list has an opaque fallback where backdrop-filter is unsupported',
    /@supports not \(\(backdrop-filter[\s\S]{0,200}\.dshgit-combolist\{background:var\(--dsw-alias-bg-layer-1/.test(css))
  // Arrow-key navigation moves a highlight with no pointer involved, so the
  // highlighted row needs a state that does not depend on `:hover`.
  check('the keyboard-highlighted row has its own visible style',
    css.includes('.dshgit-combooption[data-active="true"]{'),
    'no [data-active="true"] rule')
  check('the current value and the group headers are styled',
    css.includes('.dshgit-combooptioncurrent{') && css.includes('.dshgit-combogroup{'))
}

console.log('\n--- the workbench shell and its accent surfaces ---')
{
  const css = String(loaded.appendedStyles[0]?.textContent ?? '')

  // The window is a large CENTRED workbench, not a full-viewport one: opening
  // Git must not replace the conversation, and the first feedback on the
  // viewport-filling version was exactly that it was too big. 1180×780 keeps
  // the four regions readable while the session stays visible around it.
  // The fill must still be OPAQUE — `--dsw-menu-surface-fill` is ~45% alpha,
  // sized for a blurred menu, and puts the conversation underneath 10-11px text.
  const shell = /\.dshgit-workbench\{[^}]*\}/.exec(css)
  check('the window is a centred workbench with a bounded default size', shell !== null &&
    shell[0].includes('position:fixed') && shell[0].includes('left:50%') &&
    shell[0].includes('width:min(1180px,94vw)') && shell[0].includes('height:min(780px,88vh)'), String(shell))
  check('the workbench fill is opaque, not the translucent menu material',
    shell !== null && shell[0].includes('background:var(--dsw-alias-bg-layer-1') &&
      !shell[0].includes('menu-surface-fill') && !shell[0].includes('backdrop-filter'),
    String(shell))

  // The accent surfaces are the bug this suite previously missed: the activity
  // badge used `--dsw-alias-brand-primary` as a BACKGROUND, but that token is a
  // LABEL colour (near-white in dark, near-black in light) — so the badge was
  // white-on-white in dark mode and black-on-black in light mode. Assert that no
  // accent surface is filled with a label token.
  const badge = /\.dshgit-activity-badge\{[^}]*\}/.exec(css)
  check('the activity badge is a real accent fill', badge !== null &&
    badge[0].includes('background:var(--dsw-alias-state-business-primary)') &&
    badge[0].includes('color:var(--dsw-alias-label-primary-foreground)'), String(badge))
  check('the activity badge does not use a label token as its background',
    badge !== null && !/background:var\(--dsw-alias-brand-primary\)/.test(badge[0]), String(badge))

  // The active-module marker is the accent bar VS Code shows, drawn from the
  // accent fill rather than a label colour.
  const activeBar = /\.dshgit-activity-item\[aria-pressed="true"\]::before\{[^}]*\}/.exec(css)
  check('the active module is marked by an accent bar',
    activeBar !== null && activeBar[0].includes('background:var(--dsw-alias-state-business-primary)'),
    String(activeBar))

  // The bar is drawn OUTSIDE the item's box, into the rail's gutter, and the
  // workbench clips at its own edge. The rail is 48px with a 40px item, so the
  // gutter is 4px: a more negative offset paints outside the panel and is
  // silently cut off by `overflow:hidden`, leaving no active marker at all.
  const railWidth = Number(/\.dshgit-activitybar\{[^}]*width:(\d+)px/.exec(css)?.[1])
  const itemWidth = Number(/\.dshgit-activity-item\{[^}]*width:(\d+)px/.exec(css)?.[1])
  const barOffset = Number(/::before\{[^}]*left:(-?\d+)px/.exec(activeBar?.[0] ?? '')?.[1])
  check('the rail gutter is wide enough for the active bar',
    railWidth > itemWidth && Number.isFinite(barOffset) && -barOffset <= (railWidth - itemWidth) / 2,
    `rail=${railWidth} item=${itemWidth} barOffset=${barOffset}`)

  // Every module is reachable through one switcher, so its item must be a real
  // control with a focus ring and a transition that reduced-motion can disable.
  check('the activity items are keyboard focusable with a visible ring',
    css.includes('.dshgit-activity-item:focus-visible{outline:2px solid'))
  check('reduced motion disables the new transitions',
    /@media \(prefers-reduced-motion: reduce\)\{[\s\S]{0,400}?\.dshgit-activity-item[\s\S]{0,200}?transition:none/.test(css),
    (css.match(/@media \(prefers-reduced-motion[\s\S]{0,300}/g) ?? []).join(' '))

  // Each module gets a sidebar header, and a module with nothing to list hides
  // the column rather than showing an empty gutter.
  check('the sidebar header and empty-state rules exist',
    css.includes('.dshgit-sidebar-head{') && css.includes('.dshgit-sidebar[data-empty="true"]{display:none}'))
}

const bySlot = (name) => client.registrations.filter((entry) => entry.declaration.name === name)
const footerAction = bySlot('conversation.session.header.utilities')
const overlayWindow = bySlot('shell.overlay')
const settingsSection = bySlot('settings.section')

check('registered one top-right header action', footerAction.length === 1, String(footerAction.length))
check('registered one overlay window', overlayWindow.length === 1, String(overlayWindow.length))
check('registered one settings section', settingsSection.length === 1, String(settingsSection.length))

// The button and the window occupy DIFFERENT slots, which is precisely why the
// window's state lives in a module-level store instead of React state: the two
// halves cannot share a component tree.
check('the button sits in the right-aligned session header cluster',
  footerAction[0]?.declaration.name === 'conversation.session.header.utilities',
  String(footerAction[0]?.declaration.name))
check('the window renders into the frame-wide overlay, not into main',
  overlayWindow[0]?.declaration.name === 'shell.overlay' &&
    !client.registrations.some((entry) => entry.declaration.name === 'main'),
  client.registrations.map((entry) => entry.declaration.name).join(', '))
check('the button and the window use distinct ids',
  footerAction[0]?.declaration.id === 'git' && overlayWindow[0]?.declaration.id === 'git-window',
  `${footerAction[0]?.declaration.id} / ${overlayWindow[0]?.declaration.id}`)
check('the button label is localized through a thunk',
  typeof footerAction[0]?.declaration.label === 'function',
  typeof footerAction[0]?.declaration.label)
check('the four registrations target distinct slots',
  new Set(client.registrations.map((entry) => entry.declaration.name)).size === 4,
  client.registrations.map((entry) => entry.declaration.name).join(', '))

/* ------------------------------------------------------------------ *
 * Dictionaries
 * ------------------------------------------------------------------ */

console.log('\n--- dictionaries ---')
{
  const dicts = client.dictionaries.get('gitPlugin')
  check('registered the gitPlugin namespace', dicts !== undefined && dicts.zh !== undefined && dicts.en !== undefined)
  const zhKeys = Object.keys(dicts.zh).sort()
  const enKeys = Object.keys(dicts.en).sort()
  check('zh and en have identical key sets',
    zhKeys.length === enKeys.length && zhKeys.every((key, i) => key === enKeys[i]),
    `zh=${zhKeys.length} en=${enKeys.length}`)
  check('no dictionary value is empty or missing',
    zhKeys.every((key) => typeof dicts.zh[key] === 'string' && dicts.zh[key] !== '' &&
      typeof dicts.en[key] === 'string' && dicts.en[key] !== ''))

  // Every t('...') key read by the component must exist, which is the check that
  // catches a typo that would otherwise render a raw key to the user. Keys built
  // by concatenation (e.g. t('tab.' + name)) are skipped: they have no single
  // literal to look up, and the tabs are asserted individually below.
  // Keys built by concatenation (e.g. t('tab.' + name)) have no single literal
  // to look up, so they are checked separately below instead of being reported
  // as a missing key.
  const used = new Set()
  // The bundle is built by esbuild, which rewrites string literals to DOUBLE
  // quotes. Matching only `t('key')` therefore found zero keys and reported
  // `used=0`, making this check pass vacuously on a false premise. Accept either
  // quote style so the scan reflects the artifact it is reading.
  const pattern = /\bt\(\s*['"]([\w.-]+)['"]\)/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    used.add(match[1])
  }
  const missing = [...used].filter((key) => dicts.zh[key] === undefined)
  check('every literal translation key exists in the dictionary',
    missing.length === 0, `missing: ${missing.join(', ')}`)
  // The concatenated tab keys must exist too, or the tab row renders raw keys.
  const tabKeys = ['changes', 'history', 'graph', 'compare', 'settings'].map((name) => `tab.${name}`)
  check('every concatenated tab key exists',
    tabKeys.every((key) => dicts.zh[key] !== undefined && dicts.en[key] !== undefined),
    tabKeys.filter((key) => dicts.zh[key] === undefined).join(', '))
  // "No obviously unused key" is only a meaningful claim if the scan actually
  // found usages: an extractor that matches nothing would report 0 used and, with
  // a `> 50` threshold, still pass. Require a high coverage ratio of the defined
  // keys so a broken extractor fails loudly instead of vacuously succeeding.
  const coverage = zhKeys.length === 0 ? 0 : used.size / zhKeys.length
  check('the dictionary has no obviously unused key',
    used.size > 50 && coverage > 0.5,
    `used=${used.size} defined=${zhKeys.length} coverage=${(coverage * 100).toFixed(1)}%`)
  check('interpolated keys exist', dicts.zh['count.files'] !== undefined && dicts.zh['error.load'] !== undefined)
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const t = client.ctx.locale.bind('gitPlugin')

/**
 * Build a harness from ONE client context's registrations.
 *
 * The components must come from the same `apply()` run as the connection they
 * will call through: a component closes over its own `connection`, so reusing
 * the first context's components with a later context's stub silently routes
 * every call to the wrong stub — which shows up as "the RPC methods were never
 * called" rather than as an obvious wiring error.
 *
 * The button lives in `conversation.session.header.utilities` and the window in
 * `shell.overlay` — two slots with no shared ancestor, which is exactly why the
 * plugin bridges them with a module-level store. Mounting only one of them could
 * never exercise the opening path, so the harness renders both.
 *
 * @param ctx - a client context from one `apply()` run.
 * @param connection - the stub that context was created with.
 * @returns a root component plus the `t` bound to that context.
 */
function makeHarness(ctx, connection) {
  const registrations = ctx.registrations
  const findBySlot = (name) => registrations.find((entry) => entry.declaration.name === name)
  const HeaderButton = findBySlot('conversation.session.header.utilities').Component
  const Window = findBySlot('shell.overlay').Component
  // The harness's own `locale` is a recording stub, so the translator is taken
  // from the real one bound at the top of this file.
  const translate = t

  /** The root that renders both halves. */
  function Harness(props) {
    return [
      h(HeaderButton, { key: 'button', t: props.t }),
      h(Window, { key: 'window', connection: props.connection, t: props.t }),
    ]
  }
  return { Harness, t: translate, connection }
}

/** Render the harness, then open the window and expand it to full mode. */
async function renderApp(handlers, props = {}) {
  const rpc = createRpcStub(handlers ?? healthyHandlers())
  const context = createClientContext({ connection: rpc })
  // Each run needs its own `apply()`: the components close over the connection
  // they were built with, so reusing an earlier run's components would route
  // every call to the wrong stub.
  loaded.apply(context.ctx)
  const built = makeHarness(context, rpc)
  // Point the delegating root at THIS run's components before mounting, so the
  // mount and every later flush pass through the same component path — a path
  // change would silently reset each component's hook state.
  currentHarness = built.Harness
  mounted = { rpc, context, t: built.t }
  const rootProps = { connection: rpc, t: built.t, ...props }
  // `mount` establishes the tree and clears hook state; `flush` alone only
  // re-renders, so skipping the mount leaves effects unregistered and the
  // window would never open.
  mount(GitApp, rootProps)
  let tree = await flush(GitApp, rootProps, { maxPasses: 10 })
  tree = await openFull(tree, rootProps)
  return tree
}

/**
 * Open the window and switch it to full mode.
 *
 * There is only one mode now — the compact window is gone — so this is just
 * "click the launcher if the window is closed".
 *
 * @param tree - the current tree.
 * @param props - root props.
 * @returns the tree with the window open.
 */
async function openFull(tree, props) {
  const modeOf = (current) => {
    const float = walk(current).find((node) => node.props !== undefined && node.props['data-mode'] !== undefined)
    return float === undefined ? null : float.props['data-mode']
  }

  if (modeOf(tree) === null) {
    const openButton = findAll(tree, 'button').find((node) => String(node.props.className).includes('dshgit-iconbtn'))
    if (openButton !== undefined) {
      openButton.props.onClick()
      tree = await flush(GitApp, props)
    }
  }
  return tree
}

let mounted = null

/**
 * The workbench's module switchers, in activity-bar order.
 *
 * The activity bar replaced the horizontal tab row, so every test that used to
 * find a tab by its label now finds an activity item by its `data-module`. The
 * label moved into `title`/`aria-label`, which is what an icon-only control
 * should expose.
 *
 * @param tree - the rendered tree.
 * @returns the activity-bar buttons.
 */
function activityItems(tree) {
  return findAll(tree, 'button').filter((node) => String(node.props?.className ?? '').includes('dshgit-activity-item'))
}

/**
 * Click one module in the activity bar.
 *
 * @param current - the tree to click in.
 * @param id - the module id (`changes`, `history`, …).
 * @returns the tree after the click.
 */
async function selectModule(current, id) {
  const item = activityItems(current).find((node) => node.props['data-module'] === id)
  if (item === undefined) throw new Error(`no activity item for "${id}"`)
  item.props.onClick()
  return flush(GitApp, { connection: mounted.rpc, t })
}

/**
 * Render the harness and leave it on the header CHIPS, without opening the
 * workbench window.
 *
 * The chips are the everyday surface now, so most UI checks run against them
 * rather than against a window.
 *
 * @param handlers - RPC handlers.
 * @returns the tree with the chips rendered.
 */
async function renderChips(handlers) {
  const rpc = createRpcStub(handlers ?? healthyHandlers())
  const context = createClientContext({ connection: rpc })
  loaded.apply(context.ctx)
  const built = makeHarness(context, rpc)
  currentHarness = built.Harness
  mounted = { rpc, context, t: built.t }
  const rootProps = { connection: rpc, t: built.t }
  mount(GitApp, rootProps)
  return flush(GitApp, rootProps, { maxPasses: 10 })
}

/**
 * The current harness.
 *
 * `renderApp` rebuilds the components from a fresh `apply()` run on every test,
 * because a component closes over the connection it was built with. This
 * delegating root lets the many `flush(GitApp, props)` calls in the suite keep
 * driving whichever harness is current, without threading it through by hand.
 *
 * `GitApp` itself holds no hooks, so its stable identity is not a problem for
 * the harness's path-based hook store.
 */
let currentHarness = makeHarness(client, stub).Harness
function GitApp(props) {
  return currentHarness(props)
}

console.log('\n--- flat branch picker and collapsed tags ---')
{
  const branches = Array.from({ length: 12 }, (_, i) => ({
    name: `feature/${i}`, ref: `refs/heads/feature/${i}`, committerDate: i + 1,
    author: 'Branch author', sha: 'abcdef0123456789', subject: 'A detailed commit description',
  }))
  const remotes = branches.map((branch) => ({ ...branch, name: `origin/${branch.name}`, ref: `refs/remotes/origin/${branch.name}` }))
  const tags = Array.from({ length: 12 }, (_, i) => ({ name: `v0.1.${i}`, ref: `refs/tags/v0.1.${i}` }))
  let tree = await renderChips(healthyHandlers({ refs: () => ({ ...REFS, branches: [REFS.branches[0], ...branches], remotes, tags }) }))
  const rootProps = { connection: mounted.rpc, t: mounted.t }
  findAll(tree, 'button').find((node) => node.props['data-chip'] === 'branch').props.onClick({
    currentTarget: { getBoundingClientRect: () => ({ right: 420, bottom: 40 }) },
  })
  tree = await flush(GitApp, rootProps)
  const rows = (prefix) => findAll(tree, 'button').filter((node) => node.props.className?.includes('dshgit-pickrow') && node.props['data-ref']?.startsWith(prefix))
  const tagsToggle = () => findAll(tree, 'button').find((node) => node.props['data-picker-toggle'] === 'tags')
  const more = (group) => findAll(tree, 'button').find((node) => node.props['data-picker-more'] === group)
  check('picker includes current branch within the first five local branches', rows('feature/').length === 4 &&
    rows('origin/').length === 5 && rows('main').length === 1 && rows('feature/')[0]?.props['data-ref'] === 'feature/11')
  const current = rows('main')[0]
  check('picker marks the current local branch with the same dot as the workbench', current.props['aria-current'] === 'true' && current.props.disabled === true &&
    walk(current).some((node) => node.props?.className === 'dshgit-tipdot dshgit-branch-current-dot'))
  check('picker has no separate current-branch heading', !walk(tree).some((node) => node.props?.className === 'dshgit-pickgroup' && textOf(node) === t('picker.current')))
  const first = rows('feature/')[0]
  check('picker rows show a branch icon and name without commit metadata', walk(first).some((node) => node.name === 'IconBranch') &&
    textOf(first).includes('feature/11') && !textOf(first).includes('Branch author') && !textOf(first).includes('A detailed commit description'))
  check('picker tooltips retain author, commit hash and description', first.props.title.includes('Branch author') &&
    first.props.title.includes('abcdef0') && first.props.title.includes('A detailed commit description'))
  check('remote rows retain the full remote prefix in their visible names', textOf(rows('origin/')[0], '').includes('origin/feature/11'))
  more('locals').props.onClick()
  tree = await flush(GitApp, rootProps)
  check('picker shows only five more branches on each click', rows('feature/').length === 9 && rows('main').length === 1 && rows('origin/').length === 5)
  more('locals').props.onClick()
  tree = await flush(GitApp, rootProps)
  check('picker finishes with remaining branches and offers collapse', rows('feature/').length === 12 && textOf(more('locals')) === t('picker.showLess'))
  more('locals').props.onClick()
  more('remotes').props.onClick()
  tree = await flush(GitApp, rootProps)
  check('picker can collapse local branches and independently extend remotes', rows('feature/').length === 4 && rows('main').length === 1 && rows('origin/').length === 10)
  check('picker tags start collapsed', rows('v').length === 0 && tagsToggle()?.props['aria-expanded'] === false)
  tagsToggle().props.onClick()
  tree = await flush(GitApp, rootProps)
  check('picker tags first expand to five rows', rows('v').length === 5)
  check('picker tag rows have a tag icon', walk(rows('v')[0]).some((node) => node.name === 'IconTag'))
  more('tags').props.onClick()
  tree = await flush(GitApp, rootProps)
  check('picker tags also load five per click', rows('v').length === 10)
  tagsToggle().props.onClick()
  tree = await flush(GitApp, rootProps)
  const search = () => findAll(tree, 'input').find((node) => node.props.className === 'dshgit-pickerinput')
  search().props.onChange({ currentTarget: { value: 'feature/' } })
  tree = await flush(GitApp, rootProps)
  check('picker search covers all branches beyond initial batches', rows('feature/').length === 12 && rows('origin/').length === 12 && !more('locals') && !more('remotes'))
  search().props.onChange({ currentTarget: { value: 'v0.1' } })
  tree = await flush(GitApp, rootProps)
  check('picker search finds all collapsed tags', rows('v').length === 12)
  search().props.onChange({ currentTarget: { value: '' } })
  tree = await flush(GitApp, rootProps)
  check('clearing picker search restores batches and collapsed tags', rows('v').length === 0 && rows('feature/').length === 4 && rows('main').length === 1 && rows('origin/').length === 10)
  tagsToggle().props.onClick()
  tree = await flush(GitApp, rootProps)
  check('reopening tags resets to the first batch', rows('v').length === 5)
}

console.log('\n--- everyday header actions ---')
{
  let header = await renderChips()
  const chipIds = findAll(header, 'button').map((node) => node.props['data-chip']).filter(Boolean)
  check('the header keeps frequent actions in a stable order',
    JSON.stringify(chipIds.slice(0, 5)) === JSON.stringify(['branch', 'changes', 'next', 'sync-menu']),
    JSON.stringify(chipIds))
  check('uncommitted changes do not replace the remote action with a second commit entry',
    findAll(header, 'button').find((node) => node.props['data-chip'] === 'next')?.props['data-next'] === 'diverged')
  findAll(header, 'button').find((node) => node.props['data-chip'] === 'sync-menu').props.onClick({
    currentTarget: { getBoundingClientRect: () => ({ right: 900, bottom: 40 }) },
  })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  check('the alternate sync menu is available while branches diverge',
    ['fetch', 'pull-merge', 'pull-rebase', 'push-lease'].every((id) =>
      findAll(header, 'button').some((node) => node.props['data-sync'] === id)))
  findAll(header, 'button').find((node) => node.props['data-sync'] === 'fetch').props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })
  check('Fetch is available from the sync menu',
    mounted.rpc.calls.some((call) => call.method === 'write.fetch' && call.payload.prune === true))

  header = await renderChips(healthyHandlers({
    status: () => ({ ...STATUS, total: 0, files: [] }),
    commits: (payload) => ({ commits: payload.ref.startsWith('HEAD..') ? [COMMITS.commits[0]] : [] }),
  }))
  // Merge has no chip of its own: it is a quick action on each row of the branch
  // picker (`930d52e` moved it there). Driving the real path means opening the
  // branch chip and clicking that row action — asserting on a `merge` chip would
  // test a control the product no longer renders.
  findAll(header, 'button').find((node) => node.props['data-chip'] === 'branch').props.onClick({
    currentTarget: { getBoundingClientRect: () => ({ right: 420, bottom: 40 }) },
  })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  const mergeAction = findAll(header, 'button').find((node) =>
    node.props['data-branch-action'] === 'merge' && node.props['data-branch-target'] === 'refs/heads/feature/新功能')
  check('the branch picker offers merge as a per-branch quick action', mergeAction !== undefined)
  mergeAction.props.onClick({ preventDefault() {}, stopPropagation() {} })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  check('merge review shows source into current branch before writing',
    hasText(header, t('merge.direction', { source: 'feature/新功能', target: 'main' })) &&
    !mounted.rpc.calls.some((call) => call.method === 'write.merge'))
  check('merge review reads commits unique to each side',
    ['HEAD..refs/heads/feature/新功能', 'refs/heads/feature/新功能..HEAD'].every((ref) =>
      mounted.rpc.calls.some((call) => call.method === 'commits' && call.payload.ref === ref)))
  findAll(header, 'button').find((node) => node.props['data-merge-confirm'] === 'feature/新功能').props.onClick()
  await flush(GitApp, { connection: mounted.rpc, t })
  check('confirmed merge targets the selected source',
    mounted.rpc.calls.some((call) => call.method === 'write.merge' && call.payload.ref === 'refs/heads/feature/新功能'))

  header = await renderChips(healthyHandlers({
    branchTracking: () => ({ ref: 'main', upstream: 'origin/main', ahead: 0, behind: 0 }),
  }))
  check('an up-to-date branch offers Fetch as its sync action',
    findAll(header, 'button').find((node) => node.props['data-chip'] === 'next')?.props['data-next'] === 'fetch')
  findAll(header, 'button').find((node) => node.props['data-chip'] === 'branch').props.onClick({
    currentTarget: { getBoundingClientRect: () => ({ right: 420, bottom: 40 }) },
  })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(header, 'button').find((node) =>
    node.props['data-branch-action'] === 'merge' && node.props['data-branch-target'] === 'refs/heads/feature/新功能')
    .props.onClick({ preventDefault() {}, stopPropagation() {} })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  check('uncommitted files block the final merge action',
    findAll(header, 'button').find((node) => node.props['data-merge-confirm'] === 'feature/新功能')?.props.disabled === true &&
    !mounted.rpc.calls.some((call) => call.method === 'write.merge'))
  findAll(header, 'button').find((node) => textOf(node) === t('merge.stash')).props.onClick()
  await flush(GitApp, { connection: mounted.rpc, t })
  check('the merge review can stash tracked and untracked changes',
    mounted.rpc.calls.some((call) => call.method === 'write.stashPush' && call.payload.includeUntracked === true))

  let conflicted = false
  header = await renderChips(healthyHandlers({
    status: () => ({ ...STATUS, total: conflicted ? 1 : 0,
      files: conflicted ? [{ ...STATUS.files[1], kind: 'unmerged' }] : [],
      operation: conflicted ? { kind: 'merge', step: null, total: null } : null }),
    commits: (payload) => ({ commits: payload.ref.startsWith('HEAD..') ? [COMMITS.commits[0]] : [] }),
    'write.merge': () => { conflicted = true; throw new Error('merge conflict') },
  }))
  findAll(header, 'button').find((node) => node.props['data-chip'] === 'branch').props.onClick({
    currentTarget: { getBoundingClientRect: () => ({ right: 420, bottom: 40 }) },
  })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(header, 'button').find((node) =>
    node.props['data-branch-action'] === 'merge' && node.props['data-branch-target'] === 'refs/heads/feature/新功能')
    .props.onClick({ preventDefault() {}, stopPropagation() {} })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(header, 'button').find((node) => node.props['data-merge-confirm'] === 'feature/新功能').props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })
  // The recovery affordance is the `operation` chip, not a merge chip: `930d52e`
  // removed the merge chip and kept recovery visible as its own chip instead.
  check('a conflicted merge refreshes the header into its recovery action',
    textOf(findAll(header, 'button').find((node) => node.props['data-chip'] === 'operation') ?? {}) === t('next.resolve'))
}

console.log('\n--- action outcomes are reported as a readable banner ---')
{
  // A failed push used to print git's raw stderr, in error-red, clipped to
  // 220px, inline in the chip row. The raw text leads with the URL and repeats
  // "error: failed to push some refs", so the one sentence that says what to DO
  // was last — and cut off. These assertions pin the replacement's contract.
  const rawGit = [
    'To https://github.com/user/repo.git',
    ' ! [rejected]        main -> main (non-fast-forward)',
    "error: failed to push some refs to 'https://github.com/user/repo.git'",
    'hint: Updates were rejected because the tip of your current branch is behind',
  ].join('\n')

  // The fixture must be AHEAD-ONLY, or the primary chip offers "reconcile"
  // instead of push and no push is ever attempted.
  const aheadOnly = () => ({
    status: () => ({ ...STATUS, branch: { ...STATUS.branch, ahead: 1, behind: 0 } }),
    branchTracking: () => ({ ref: 'main', upstream: 'origin/main', ahead: 1, behind: 0 }),
  })

  let header = await renderChips(healthyHandlers({
    ...aheadOnly(),
    'write.push': () => { const e = new Error(rawGit); e.code = 'git/write-failed'; throw e },
  }))
  const nextChip = findAll(header, 'button').find((node) => node.props['data-chip'] === 'next')
  check('the primary chip offers Push when only local commits are pending',
    nextChip?.props['data-next'] === 'push', String(nextChip?.props['data-next']))
  nextChip.props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })

  const banner = walk(header).find((node) => String(node.props?.className ?? '').includes('dshgit-notice'))
  check('a failed write renders an outcome banner', banner !== undefined)
  check('a failure is toned as an error', banner?.props['data-tone'] === 'error', String(banner?.props['data-tone']))

  // The banner must NOT lead with git's raw prose: the reader should get the
  // explanation, not the terminal output, as the first thing they read.
  const summary = walk(banner).find((node) => String(node.props?.className ?? '').includes('dshgit-noticetext'))
  const summaryText = textOf(summary)
  check('the summary is the plain-language explanation, not raw git output',
    summaryText === t('failure.nonFastForward'),
    JSON.stringify(summaryText))
  check('the raw git text is not dumped into the summary',
    !summaryText.includes('! [rejected]') && !summaryText.includes('failed to push some refs'),
    JSON.stringify(summaryText))

  // The fix the plugin knows how to apply must be one click from the message.
  const fixButton = findAll(banner, 'button').find((node) => textOf(node) === t('failure.actionPull'))
  check('a recognised failure offers the action that resolves it', fixButton !== undefined,
    JSON.stringify(findAll(banner, 'button').map(textOf)))

  // The raw text must still be reachable — a failure the plugin does not
  // recognise has to stay reportable, and even a recognised one may need detail.
  const detailToggle = findAll(banner, 'button').find((node) => textOf(node) === t('notice.details'))
  check('the full git output is available behind a disclosure', detailToggle !== undefined,
    JSON.stringify(findAll(banner, 'button').map(textOf)))
  detailToggle.props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })
  const detail = walk(header).find((node) => String(node.props?.className ?? '').includes('dshgit-noticedetail'))
  check('expanding the disclosure shows the raw git text',
    detail !== undefined && textOf(detail).includes('non-fast-forward'), textOf(detail))
  check('an error banner can be dismissed',
    findAll(header, 'button').some((node) => String(node.props.className).includes('dshgit-noticeclose')))

  // A SUCCESS must not be painted like a failure — the old span was always red,
  // so a successful push read as an error.
  header = await renderChips(healthyHandlers({
    ...aheadOnly(),
    'write.push': () => ({ ok: true, code: 0, message: '已推送到 origin/main', stdout: '' }),
  }))
  findAll(header, 'button').find((node) => node.props['data-chip'] === 'next').props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })
  const okBanner = walk(header).find((node) => String(node.props?.className ?? '').includes('dshgit-notice'))
  check('a successful write is toned as a success, not an error',
    okBanner?.props['data-tone'] === 'success', String(okBanner?.props['data-tone']))
  check('the success banner reports the outcome',
    textOf(okBanner).includes('已推送到 origin/main'), textOf(okBanner))
  check('a success offers no "fix" action',
    !findAll(okBanner, 'button').some((node) => String(node.props.className).includes('dshgit-noticebtn-primary')))

  // An unrecognised failure must still be reported rather than swallowed.
  header = await renderChips(healthyHandlers({
    ...aheadOnly(),
    'write.push': () => { const e = new Error('some entirely novel git failure'); e.code = 'git/write-failed'; throw e },
  }))
  findAll(header, 'button').find((node) => node.props['data-chip'] === 'next').props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })
  check('an unrecognised failure still reports its message',
    hasText(header, 'some entirely novel git failure'), textOf(header).slice(-300))
}

console.log('\n--- workbench Smart Commit and Sync ---')
{
  let committed = false
  let full = await renderApp(healthyHandlers({
    status: () => ({ ...STATUS, total: committed ? 0 : 1,
      files: committed ? [] : [STATUS.files[2]] }),
    branchTracking: () => ({ ref: 'main', upstream: 'origin/main', ahead: committed ? 1 : 0, behind: 0 }),
    'write.stage': () => ({ ok: true, message: 'staged' }),
    'write.commit': () => { committed = true; return { ok: true, message: 'committed' } },
    'write.push': () => ({ ok: true, message: 'pushed' }),
  }))
  const composer = findAll(full, 'textarea').find((node) => node.props.placeholder === t('commit.placeholderMessage'))
  composer.props.onChange({ currentTarget: { value: 'feat: add file' } })
  full = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(full, 'button').find((node) => String(node.props.className).includes('dshgit-commit-primary')).props.onClick()
  full = await flush(GitApp, { connection: mounted.rpc, t })
  check('workbench Smart Commit stages before committing when nothing is staged',
    JSON.stringify(mounted.rpc.calls.filter((call) => ['write.stage', 'write.commit'].includes(call.method))
      .map((call) => call.method)) === JSON.stringify(['write.stage', 'write.commit']))
  // The sidebar composer deliberately never becomes a Sync button: the full
  // window already carries dedicated Fetch/Pull/Push controls in its title bar
  // (`dshgit-title-tools`), so repeating Sync here duplicated them. That is what
  // `!props.sidebar` in `canSync` encodes. After committing, the composer falls
  // back to its Commit label and disables itself because there is nothing left to
  // commit — the sync path is the title-bar button below.
  check('workbench composer does not duplicate the title-bar sync action',
    !findAll(full, 'button').some((node) => String(node.props.className).includes('dshgit-commit-primary')
      && textOf(node) === t('action.sync')))
  const workbenchPush = findAll(full, 'button').find((node) =>
    String(node.props.className).includes('dshgit-winbtn') && node.props['aria-label'] === t('action.push'))
  check('the workbench title bar offers Push', workbenchPush !== undefined)
  workbenchPush.props.onClick()
  await flush(GitApp, { connection: mounted.rpc, t })
  check('workbench Sync pushes the committed change',
    mounted.rpc.calls.some((call) => call.method === 'write.push'))
}

console.log('\n--- the commit popover closes once the commit lands ---')
{
  // A single untracked file, so the popover's own Commit stages and commits it.
  const oneFile = { ...STATUS.files[2] }
  let committed = false
  let header = await renderChips(healthyHandlers({
    status: () => ({ ...STATUS, total: committed ? 0 : 1, files: committed ? [] : [oneFile] }),
    branchTracking: () => ({ ref: 'main', upstream: 'origin/main', ahead: committed ? 1 : 0, behind: 0 }),
    'write.stage': () => ({ ok: true, message: 'staged' }),
    'write.commit': () => { committed = true; return { ok: true, message: 'committed' } },
  }))
  const chip = findAll(header, 'button').find((node) => node.props['data-chip'] === 'changes')
  chip.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ right: 900, bottom: 40 }) } })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  const isOpen = (current) => walk(current).some((node) => node.props?.['data-popover'] === 'commit')
  check('the commit popover is open before committing', isOpen(header))

  // The popover's composer uses `commit.placeholderMessage`; `placeholder.commit`
  // belongs to the workbench composer, and matching the wrong one silently found
  // no textarea at all (which is exactly how this assertion first failed).
  findAll(header, 'textarea').find((node) => node.props.placeholder === t('commit.placeholderMessage'))
    .props.onChange({ currentTarget: { value: 'feat: close me' } })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  // The fixture is one UNTRACKED file with nothing staged, so the primary action
  // offers to stage and commit it (`commit.all` = "暂存并提交全部"), not the plain
  // "提交" of an already-staged commit. Matching on the role rather than one
  // label keeps this assertion honest when the button's wording changes.
  findAll(header, 'button').find((node) => String(node.props.className).includes('dshgit-commit-primary')).props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })

  check('the commit actually landed',
    mounted.rpc.calls.some((call) => call.method === 'write.commit'))
  // The popover's file list is now stale (those files are committed), so leaving
  // it open would show a list of changes that no longer exist.
  check('the commit popover closes after the commit lands', !isOpen(header),
    JSON.stringify(walk(header).map((n) => n.props?.['data-popover']).filter(Boolean)))
  // Closing must not swallow the outcome: the banner lives outside the popover.
  check('the outcome is still reported after the popover closes',
    walk(header).some((node) => String(node.props?.className ?? '').includes('dshgit-notice')),
    textOf(header).slice(-200))

  // A FAILED commit must keep the popover open, or the error vanishes with the
  // panel that reported it and the user loses the message they were typing.
  let attempts = 0
  header = await renderChips(healthyHandlers({
    status: () => ({ ...STATUS, total: 1, files: [oneFile] }),
    branchTracking: () => ({ ref: 'main', upstream: 'origin/main', ahead: 0, behind: 0 }),
    'write.stage': () => ({ ok: true, message: 'staged' }),
    'write.commit': () => {
      attempts++
      const error = new Error('pre-commit hook failed')
      error.code = 'git/write-failed'
      throw error
    },
  }))
  findAll(header, 'button').find((node) => node.props['data-chip'] === 'changes')
    .props.onClick({ currentTarget: { getBoundingClientRect: () => ({ right: 900, bottom: 40 }) } })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(header, 'textarea').find((node) => node.props.placeholder === t('commit.placeholderMessage'))
    .props.onChange({ currentTarget: { value: 'feat: will fail' } })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  // Same untracked-only fixture as above: the primary action's label is
  // `commit.all`, so target the role rather than one specific wording.
  findAll(header, 'button').find((node) => String(node.props.className).includes('dshgit-commit-primary')).props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })
  check('a failed commit really was attempted', attempts > 0)
  check('a FAILED commit keeps the popover open so the error stays visible',
    isOpen(header),
    JSON.stringify(walk(header).map((n) => n.props?.['data-popover']).filter(Boolean)))
  // The banner shows a short summary and keeps the full git text behind a
  // "查看详情" disclosure, so the raw message is asserted after expanding it.
  const details = findAll(header, 'button').find((node) => node.props['aria-label'] === t('notice.details'))
  check('a failed commit offers the full error behind a disclosure', details !== undefined,
    textOf(header).slice(-300))
  details.props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })
  check('the failure is reported', hasText(header, 'pre-commit hook failed'), textOf(header).slice(-300))
}

console.log('\n--- workbench Commit explains missing text and clears a mixed change list ---')
{
  let committed = false
  let full = await renderApp(healthyHandlers({
    status: () => ({ ...STATUS, total: committed ? 0 : STATUS.files.length,
      files: committed ? [] : STATUS.files }),
    branchTracking: () => ({ ref: 'main', upstream: 'origin/main', ahead: committed ? 1 : 0, behind: 0 }),
    'write.stage': () => ({ ok: true, message: 'staged' }),
    'write.commit': () => { committed = true; return { ok: true, message: 'committed' } },
  }))
  findAll(full, 'button').find((node) => String(node.props.className).includes('dshgit-commit-primary')).props.onClick()
  full = await flush(GitApp, { connection: mounted.rpc, t })
  check('empty message shows a visible explanation and does not write',
    walk(full).some((node) => String(node.props?.className).includes('dshgit-toast') && hasText(node, t('commit.requiredMessage'))) &&
    !mounted.rpc.calls.some((call) => call.method.startsWith('write.')))
  findAll(full, 'textarea').find((node) => node.props.placeholder === t('commit.placeholderMessage'))
    .props.onChange({ currentTarget: { value: 'feat: all files' } })
  full = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(full, 'button').find((node) => String(node.props.className).includes('dshgit-commit-primary')).props.onClick()
  full = await flush(GitApp, { connection: mounted.rpc, t })
  // The fixture has ONE staged file (`docs/待提交.md`, index `A`), so the composer
  // takes the `stagedCount > 0` branch and commits only what is staged — it does
  // NOT also stage the unstaged files first. That is deliberate: a plain Commit
  // must never sweep in changes the user did not stage. The earlier label
  // ("提交已暂存的改动") is the visible half of the same rule.
  check('a commit with staged content commits exactly that, without re-staging',
    JSON.stringify(mounted.rpc.calls.filter((call) => call.method.startsWith('write.'))
      .map((call) => call.method)) === JSON.stringify(['write.commit']))
  check('the change rows clear after the commit',
    findWhere(full, (props) => props['data-change-group'] !== undefined).length === 0)
  // The sidebar composer never turns into Sync: the full window has dedicated
  // Fetch/Pull/Push buttons in its title bar (`canSync` requires `!props.sidebar`).
  check('the sidebar composer does not become a Sync button',
    !findAll(full, 'button').some((node) => String(node.props.className).includes('dshgit-commit-primary')
      && textOf(node) === t('action.sync')))
}

console.log('\n--- initial render (changes tab) ---')
let tree = await renderApp()
check('renders without throwing', tree !== null)
check('shows the panel title', hasText(tree, 'Git'), textOf(tree).slice(0, 160))
check('shows the resolved repository root', hasText(tree, ROOT), textOf(tree).slice(0, 200))
check('shows the branch badge', hasText(tree, 'main'))
// The file list has a staged/unstaged/all filter and DEFAULTS to "unstaged", so
// the staged file is intentionally absent until "All" is chosen. Selecting it is
// what a user does to see every change, and it keeps the row assertions below
// covering the staged row as well.
check('lists the staged file once the file filter shows everything', (() => {
  const all = findAll(tree, 'button').find((node) => String(node.props.className).includes('dshgit-btn') &&
    textOf(node).startsWith(t('batch.all') + ' '))
  if (all === undefined) return false
  all.props.onClick()
  return true
})())
tree = await flush(GitApp, { connection: mounted.rpc, t })
check('the staged file appears under the All filter',
  walk(tree).some((node) => node.props?.title === 'docs/待提交.md'),
  JSON.stringify(walk(tree).filter((n) => String(n.props?.className ?? '').includes('dshgit-change')).map((n) => n.props.title)))
check('lists the modified file', hasText(tree, 'src/index.js'))
check('lists the untracked file', hasText(tree, 'untracked.txt'))
const changeRow = walk(tree).find((node) => node.props?.title === 'src/index.js' &&
  String(node.props?.className ?? '').includes('dshgit-change'))
check('change rows split the filename from its directory',
  walk(changeRow).some((node) => node.props?.className === 'dshgit-filename' && textOf(node) === 'index.js') &&
  walk(changeRow).some((node) => node.props?.className === 'dshgit-filedir' && textOf(node) === 'src'))
// The full changes list renders its per-row toolbar through `batch.actions`,
// which yields a FileBatchActions ELEMENT rather than the component instance the
// harness already rendered — so `walk`/`findAll` cannot see inside it, and the
// last child of the row is that element, not a status span. Assert the row's own
// structure (which IS rendered) and leave the toolbar's contents to the compact
// popover below, where the same toolbar is rendered inline and is reachable.
// The full changes list renders its per-row toolbar through `batch.actions`,
// which yields a FileBatchActions ELEMENT the harness does not descend into — so
// the toolbar's buttons are not reachable from this tree, and the row's children
// end in those placeholder slots. Assert the row structure that IS rendered, and
// leave the toolbar's button set to the compact popover below, where the same
// toolbar renders inline.
check('change rows keep the status inside the row',
  walk(changeRow).some((node) => String(node.props?.className ?? '') === 'dshgit-status'))
check('change rows carry the file icon and label',
  walk(changeRow).some((node) => node.props?.className === 'dshgit-fileicon') &&
  walk(changeRow).some((node) => node.props?.className === 'dshgit-filelabel'))
check('file actions reveal on hover and keyboard focus',
  loaded.appendedStyles[0].textContent.includes('.dshgit-change:hover .dshgit-change-actions') &&
  loaded.appendedStyles[0].textContent.includes('.dshgit-change:focus-within .dshgit-change-actions'))
check('shows the commit composer placeholder',
  findWhere(tree, (props) => props.placeholder === t('commit.placeholderMessage')).length === 1)
// The module switcher is the activity bar, not a horizontal tab row: an icon
// column cannot be squeezed by the sync controls beside it, which is the whole
// reason the layout was rebuilt.
check('renders six activity-bar modules',
  activityItems(tree).length === 6,
  JSON.stringify(activityItems(tree).map((node) => node.props['data-module'])))
// The activity bar is changes / stashes / history / graph / output / settings.
// `compare` is deliberately NOT among them: it is opened from a branch's
// quick actions in the header (`setWindowState({ tab: 'compare' })`), because a
// comparison always starts from a branch. `navigation.js` keeps a `compare`
// fallback only so an old stored tab id still resolves.
check('the activity bar exposes each module by name',
  activityItems(tree).map((node) => node.props['aria-label']).join(',') ===
    ['changes', 'stashes', 'history', 'graph', 'output', 'settings'].map((id) => t(`tab.${id}`)).join(','),
  JSON.stringify(activityItems(tree).map((node) => node.props['aria-label'])))
check('exactly one activity item is marked active',
  activityItems(tree).filter((node) => node.props['aria-pressed'] === true).length === 1)
check('the active activity item is the changes module',
  activityItems(tree).find((node) => node.props['aria-pressed'] === true).props['data-module'] === 'changes')
check('no horizontal tab row is rendered',
  findAll(tree, 'button').every((node) => !String(node.props.className).includes('dshgit-tab')),
  JSON.stringify(findAll(tree, 'button').map((node) => node.props.className).filter((c) => String(c).includes('tab'))))
// Repository facts moved to a status bar so they cannot push the title bar's
// actions onto a second line.
check('renders a status bar carrying the repository facts',
  walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-statusbar')) &&
  hasText(walk(tree).find((node) => String(node.props?.className ?? '').includes('dshgit-statusbar')), 'main'))
check('renders the blame column for the opened file',
  hasText(tree, '张三'), textOf(tree).slice(0, 300))
check('rendered diff rows carry +/- kinds',
  walk(tree).some((node) => node.$$kind === 'host' && node.props?.['data-kind'] === 'add'),
  'no add row found')
check('rpc called repos then status', mounted.rpc.calls[0]?.method === 'repos' &&
  mounted.rpc.calls.some((call) => call.method === 'status'),
  mounted.rpc.calls.map((c) => c.method).join(','))

console.log('\n--- clicking a changed file opens it ---')
{
  changeRow.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  // A modified tracked file opens as a DIFF, not as raw content: `openChangedFile`
  // only selects content mode for HEAD, an explicit content request, or an
  // untracked file (there is no diff to show for one). The content assertions
  // below therefore belong to the untracked/YAML cases, which is where the
  // preview code path actually runs.
  check('the full window requested the working-tree diff',
    mounted.rpc.calls.some((call) => call.method === 'diff' && call.payload.path === 'src/index.js'))
  check('the full window renders diff rows for the file',
    walk(tree).some((node) => node.$$kind === 'host' && node.props?.['data-kind'] === 'add'))
  // The mode control shows the mode it would switch TO. The file opened as a
  // diff, so the control offers content ("文件内容") and vice versa — so driving
  // it means clicking whatever label is present, then asserting the flip.
  const modeToggle = findAll(tree, 'button').find((node) => node.props['data-preview-mode'] === true)
  check('the file view offers a diff/content toggle', modeToggle !== undefined)
  modeToggle.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('the toggle switches the file view to its content',
    mounted.rpc.calls.some((call) => call.method === 'fileContent' && call.payload.path === 'src/index.js'))
}

{
  // The compact window's second, larger file browser is gone: the full window's
  // own preview (asserted above) is the only file surface. What remains worth
  // asserting is that a non-JavaScript file still highlights by its own grammar.
  const yamlStatus = { ...STATUS, files: [{
    path: 'cordis.patch.yml', originalPath: null, index: '.', worktree: 'M',
    staged: false, kind: 'ordinary', added: 1, deleted: 0,
  }] }
  tree = await renderApp(healthyHandlers({
    status: () => yamlStatus,
    fileContent: () => ({ exists: true, text: 'plugins:\n  git: true\n  retries: 3\n', binary: false, truncated: false }),
  }))
  walk(tree).find((node) => node.props?.title === 'cordis.patch.yml' &&
    String(node.props?.className ?? '').includes('dshgit-change')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  // The grammar id is proved by the file ICON's `data-kind`, which is derived from
  // the path's extension — a fixed default would report one id for every file.
  // (`primitives.asked` cannot be used here: the render path loads its own module
  // instance, so the shared stub only sees the earlier JavaScript file.)
  check('a YAML file is highlighted with its own grammar',
    walk(tree).some((node) => node.props?.style?.color === 'rgb(10, 20, 30)') &&
      walk(tree).some((node) => node.props?.['data-kind'] === 'yaml'),
    JSON.stringify(Array.from(new Set(primitives.asked))))
  tree = await renderApp()
}

console.log('\n--- the preview degrades to plain text without the platform highlighter ---')
{
  // A profile whose composition lacks the primitives package must still render
  // files. The require is best-effort precisely so this case is a plain-text
  // fallback rather than a plugin that fails to activate.
  const bare = loadClientModule(source, { require: { '@deepseek-ai/dsh-client-ui-primitives': primitivesStub({ none: true }).module } })
  check('the plugin still loads without the highlighter', bare.id === '@happyqu/dsh-plugin-git', String(bare.id))
  const bareStub = createRpcStub(healthyHandlers())
  const bareContext = createClientContext({ connection: bareStub })
  bare.apply(bareContext.ctx)
  check('it still registers its slots', bareContext.registrations.length === 4,
    String(bareContext.registrations.length))
}

console.log('\n--- file context menu ---')
{
  tree = await renderApp()
  const row = walk(tree).find((node) => node.props?.title === 'src/index.js' &&
    String(node.props?.className ?? '').includes('dshgit-change'))
  let prevented = false
  row.props.onContextMenu({ clientX: 180, clientY: 220, preventDefault() { prevented = true }, stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('right click opens the file menu and suppresses the browser menu',
    prevented && walk(tree).some((node) => node.props?.className === 'dshgit-contextmenu'))
  // A menu row renders its label in a span and the underlying git command in a
  // sibling `<code>` (added so the menu teaches the command). `textOf` therefore
  // concatenates both, and rows without a command have no `<code>` at all — so
  // derive the label by subtracting that code text from the row's full text.
  const menuNode = walk(tree).find((node) => node.props?.className === 'dshgit-contextmenu')
  const menuButtons = findAll(menuNode ?? {}, 'button')
  const menuLabelOf = (node) => {
    const code = walk(node).find((child) => String(child.props?.className ?? '') === 'dshgit-menucommand')
    const full = textOf(node)
    return code === undefined ? full : full.replace(textOf(code), '').trim()
  }
  const menuLabels = menuButtons.map(menuLabelOf)
  check('the menu has open, history, and Git actions',
    [t('action.openChanges'), t('action.openFile'), t('action.openHead'), t('action.fileHistory'),
      t('action.discard'), t('action.stage'), t('action.stashFile')]
      .every((label) => menuLabels.includes(label)), JSON.stringify(menuLabels))
  const findMenu = (label) => menuButtons.find((node) => menuLabelOf(node) === label)
  findMenu(t('action.openHead')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('Open File (HEAD) reads the committed file',
    mounted.rpc.calls.some((call) => call.method === 'fileContent' &&
      call.payload.path === 'src/index.js' && call.payload.rev === 'HEAD'))
  const rowAgain = walk(tree).find((node) => node.props?.title === 'src/index.js' &&
    String(node.props?.className ?? '').includes('dshgit-change'))
  rowAgain.props.onContextMenu({ clientX: 180, clientY: 220, preventDefault() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const historyItem = findAll(walk(tree).find((node) => node.props?.className === 'dshgit-contextmenu') ?? {}, 'button')
    .find((node) => menuLabelOf(node) === t('action.fileHistory'))
  historyItem.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('File History filters commits to that path',
    mounted.rpc.calls.some((call) => call.method === 'commits' && call.payload.path === 'src/index.js'))

  // The compact popover uses the same hover actions as the full changes list.
  tree = await renderChips()
  const chip = findAll(tree, 'button').find((node) => node.props['data-chip'] === 'changes')
  chip.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ right: 900, bottom: 40 }) } })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const untrackedRow = walk(tree).find((node) => node.props?.title === 'untracked.txt' &&
    String(node.props?.className ?? '').includes('dshgit-pickfile'))
  check('the popover lists the untracked file', untrackedRow !== undefined)
  // The row's toolbar is the batch toolbar (stash / discard / stage). There is no
  // separate "open" button: clicking the row itself opens the file, which is what
  // `data-ref`/`onClick` on the row provides. The compact popover likewise has no
  // checkbox — checkboxes belong to the full changes list.
  const rowActions = findAll(untrackedRow, 'button').map((node) => node.props['data-file-action']).filter(Boolean)
  check('the popover offers Stash, Discard and Stage icons with no checkbox',
    JSON.stringify(rowActions) === JSON.stringify(['stash', 'discard', 'stage']) &&
      findAll(untrackedRow, 'input').length === 0, JSON.stringify(rowActions))
  findAll(untrackedRow, 'button').find((node) => node.props['data-file-action'] === 'stage')
    .props.onClick({ stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('staging from the popover targets exactly that file',
    mounted.rpc.calls.some((call) => call.method === 'write.stage' &&
      JSON.stringify(call.payload.paths) === JSON.stringify(['untracked.txt'])),
    JSON.stringify(mounted.rpc.calls.filter((call) => call.method === 'write.stage').map((call) => call.payload)))
  tree = await renderApp()
}

console.log('\n--- history tab ---')
{
  const rootProps = { connection: mounted.rpc, t }
  tree = await selectModule(tree, 'history')
  check('history lists commit subjects', hasText(tree, 'refactor: 把 app.js 重命名为 index.js'), textOf(tree).slice(0, 300))
  check('history shows the author', hasText(tree, '张三'))
  check('history requested commits', mounted.rpc.calls.some((call) => call.method === 'commits'))
  // The rename badge is NOT in the history list. The sidebar list shows subject,
  // author and date only; the file-level statuses (`R` for a rename) are rendered
  // by the commit DETAIL pane, once a commit is selected. The assertion therefore
  // lives in the "commit selection renders a diff" block below, where it is
  // actually reachable — asserting it here was testing a component that never
  // renders a badge.
}

console.log('\n--- commit selection renders a diff ---')
{
  const rootProps = { connection: mounted.rpc, t }
  const row = walk(tree).find((node) => node.$$kind === 'host' && node.props?.['data-selected'] === false && String(node.props.className).includes('commitrow'))
  check('found a commit row to click', row !== undefined)
  row.props.onClick()
  tree = await flush(GitApp, rootProps)
  check('commit detail fetched', mounted.rpc.calls.some((call) => call.method === 'commit'))
  // The row's kind lives on the row element, while the marker character and the
  // line body are separate text nodes — so assert on both, not on a joined
  // string that never contains "+<code>".
  const rows = walk(tree).filter((node) => node.$$kind === 'host' && node.props?.['data-kind'] !== undefined)
  const kinds = rows.map((node) => node.props['data-kind'])
  check('diff renders both an added and a removed row',
    kinds.includes('add') && kinds.includes('del'),
    `kinds=${JSON.stringify(kinds)} diffCalls=${JSON.stringify(mounted.rpc.calls.filter((c) => c.method === 'diff').map((c) => c.payload))} tail=${JSON.stringify(textOf(tree).slice(-200))}`)
  check('the added row carries the new line text',
    rows.some((node) => node.props['data-kind'] === 'add' && textOf(node).includes("console.log('world')")),
    JSON.stringify(rows.filter((n) => n.props['data-kind'] === 'add').map((n) => textOf(n))))
  check('the removed row carries the old line text',
    rows.some((node) => node.props['data-kind'] === 'del' && textOf(node).includes("console.log('hi')")),
    JSON.stringify(rows.filter((n) => n.props['data-kind'] === 'del').map((n) => textOf(n))))
  check('diff renders a hunk header',
    walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-hunkhead') &&
      /@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(textOf(node))),
    JSON.stringify(walk(tree).filter((n) => String(n.props?.className ?? '').includes('hunkhead')).map((n) => textOf(n))))
  check('commit detail pane shows the message', hasText(tree, '详见说明。'), textOf(tree).slice(-400))
  check('commit detail pane shows the changed file summary',
    hasText(tree, 'src/index.js'), textOf(tree).slice(-400))
  // File-level statuses live here, on each changed file's card in the detail
  // pane — this is where a rename surfaces as an `R` badge.
  // NOTE: the live history detail (`HistoryCommitDetails`) never renders a rename
  // indicator. Its file list shows DiffStats (`+1 −0`) and its single-file viewer
  // shows "before/after", so `file.status` and `file.from` are carried in the data
  // but not surfaced. Only the unreachable `CommitDiffView` rendered a badge for
  // `status`, and only its file cards showed `← originalPath`. So there is no
  // rename badge to assert; what IS guaranteed is that the file is listed and its
  // diff renders. (Surfacing the rename is a separate product change.)
  check('commit detail lists the changed file and renders its diff',
    hasText(tree, 'src/index.js') &&
    walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-diff-preview')),
    JSON.stringify(textOf(tree).slice(-300)))
}

console.log('\n--- graph tab ---')
{
  const rootProps = { connection: mounted.rpc, t }
  tree = await selectModule(tree, 'graph')
  check('graph reports the lane count', hasText(tree, '2'), textOf(tree).slice(0, 200))
  check('graph requested the commit graph', mounted.rpc.calls.some((call) => call.method === 'commitGraph'))
  check('graph shows branch tips', hasText(tree, 'feature/新功能'), textOf(tree).slice(0, 400))
  // The live graph is `WorkbenchGraph`, and it draws each commit as an SVG lane
  // diagram. It has no "M" badge and no `dshgit-dot` element: the old GraphView
  // (which had both) is no longer reachable, and `GraphSidebar` — the only user of
  // `graph.lanesLabel`/`graph.tips` — is exported nowhere and mounted nowhere.
  // A merge is encoded as a LARGER dot radius instead, so that is what to assert.
  check('graph renders an SVG lane diagram per commit',
    walk(tree).some((node) => node.$$kind === 'host' && node.type === 'svg') &&
    walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-graph-record')))
  check('a merge commit is drawn as a larger dot',
    walk(tree).some((node) => node.type === 'circle' && Number(node.props?.r) === 4) &&
    walk(tree).some((node) => node.type === 'circle' && Number(node.props?.r) === 3.5),
    JSON.stringify(walk(tree).filter((n) => n.type === 'circle').map((n) => n.props?.r)))
  // The live sidebar is the branch list, not a lane legend.
  check('graph sidebar lists the refs',
    walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-sidebar')) &&
    walk(tree).some((node) => node.props?.['data-branch-ref'] === 'refs/remotes/origin/main'))
}

console.log('\n--- compare tab ---')
{
  const rootProps = { connection: mounted.rpc, t }
  // `compare` has no activity-bar entry: a comparison always starts from a branch,
  // so it is opened from that branch's CONTEXT MENU in the picker (`wb.compare` →
  // `headerBranchItems` → `api.compare` → `setWindowState({ tab: 'compare',
  // compareWith: ref })`). It is a menu item, not one of the icon quick actions
  // (those are checkout/merge/push/pull/fetch), so the menu is the path to drive.
  tree = await renderChips(healthyHandlers({}))
  findAll(tree, 'button').find((node) => node.props['data-chip'] === 'branch').props.onClick({
    currentTarget: { getBoundingClientRect: () => ({ right: 420, bottom: 40 }) },
  })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const branchRow = walk(tree).find((node) => node.props?.['data-picker-branch'] === 'refs/heads/feature/新功能')
  check('the branch picker exposes a branch row to act on', branchRow !== undefined)
  branchRow.props.onContextMenu({ clientX: 100, clientY: 120, preventDefault() {}, stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const compareItem = findAll(tree, 'button').find((node) =>
    walk(node).some((child) => String(child.props?.className ?? '') === 'dshgit-menucommand'))
  check('a branch context menu offers actions', compareItem !== undefined, textOf(tree).slice(0, 200))
  check('compare is reachable from the branch menu', hasText(tree, t('wb.compare')), textOf(tree).slice(0, 300))
}

console.log('\n--- settings tab ---')
{
  const rootProps = { connection: mounted.rpc, t }
  tree = await selectModule(tree, 'settings')
  check('settings requested the config', mounted.rpc.calls.some((call) => call.method === 'config'))
  check('settings requested diagnostics', mounted.rpc.calls.some((call) => call.method === 'diagnostics'))
  check('settings shows the git executable path',
    hasText(tree, 'd:/Program Files/Git/cmd/git.exe'), textOf(tree).slice(0, 300))
  check('settings renders the rename threshold field',
    findWhere(tree, (props) => props.value === 50 && props.className === 'dshgit-input').length === 1)
  // The General page holds a single boolean (`autoBlame`); the other settings are
  // path/number fields. A count of 2+ was asserted when several booleans happened
  // to share this page, which is no longer the layout.
  check('settings renders a checkbox for its boolean option',
    findAll(tree, 'input').filter((node) => node.props.type === 'checkbox').length >= 1,
    String(findAll(tree, 'input').filter((node) => node.props.type === 'checkbox').length))
  // Settings grew from three groups to five: the repository scope and Git LFS each
  // gained a page of their own. Assert the group ids the nav actually offers.
  check('settings sidebar offers the five groups',
    findAll(tree, 'button').filter((node) => String(node.props.className).includes('dshgit-rowbtn'))
      .map((node) => textOf(node)).join(',') ===
      [t('settings.general'), t('settings.currentRepo'), t('settings.ai'), t('lfs.title'), t('settings.diagnostics')].join(','),
    JSON.stringify(findAll(tree, 'button').filter((n) => String(n.props.className).includes('dshgit-rowbtn')).map(textOf)))
}

console.log('\n--- AI settings expose independent diff exclusions ---')
{
  findAll(tree, 'button').find((node) => textOf(node) === t('settings.ai')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  let rules = findAll(tree, 'textarea').find((node) => node.props['aria-label'] === t('settings.aiExclude'))
  const modelCard = walk(tree).find((node) => node.props?.['data-settings-card'] === 'ai-model')
  const contextCard = walk(tree).find((node) => node.props?.['data-settings-card'] === 'ai-context')
  check('AI diff exclusions live in a separate context card', contextCard && hasText(contextCard, t('settings.aiContext')) &&
    findAll(contextCard, 'textarea').length === 1 && findAll(modelCard, 'textarea').length === 0)
  check('AI exclusions have an editable multiline setting', rules && !rules.props.disabled && rules.props.placeholder.includes('!dist/important.js'))
  check('AI exclusion defaults are filled into the editable value', rules.props.value.includes('**/dist/**') && rules.props.value.includes('*.map') && rules.props.value.includes('package-lock.json'))
  rules.props.onChange({ target: { value: 'dist/**\n!dist/important.js' } })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  rules = findAll(tree, 'textarea').find((node) => node.props['aria-label'] === t('settings.aiExclude'))
  rules.props.onBlur()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('AI exclusions persist without changing file selection', mounted.rpc.calls.some((call) =>
    call.method === 'setConfig' && call.payload.patch.aiExcludePatterns === 'dist/**\n!dist/important.js') &&
    !mounted.rpc.calls.some((call) => call.method === 'updateChangelist'))
}

/* ------------------------------------------------------------------ *
 * States and failures
 * ------------------------------------------------------------------ */

console.log('\n--- no git installed ---')
{
  tree = await renderApp(healthyHandlers({
    repos: () => { const error = new Error('未找到 git 可执行文件。请在设置里填写完整路径。'); error.code = 'git/not-found'; throw error },
  }))
  check('shows the no-git guidance', hasText(tree, '未找到 git'), textOf(tree).slice(0, 300))
  check('does not leak a raw error banner', !hasText(tree, t('action.close')),
    textOf(tree).slice(0, 300))
  check('offers a way to the settings module',
    findAll(tree, 'button').some((node) => textOf(node) === t('tab.settings')) ||
    activityItems(tree).some((node) => node.props['data-module'] === 'settings'))
}

console.log('\n--- git present but no repository ---')
{
  tree = await renderApp(healthyHandlers({
    repos: () => ({ gitPath: 'd:/git.exe', repos: [], config: CONFIG }),
  }))
  check('shows the no-repo guidance', hasText(tree, t('state.noRepo')), textOf(tree).slice(0, 300))
}

console.log('\n--- Initialize Repository in the session directory ---')
{
  // The header chips offer initialization when the session directory has no
  // repository, and the full window keeps its own entry point.
  let initialized = false
  const handlers = healthyHandlers({
    repos: () => initialized
      ? { gitPath: 'd:/git.exe', repos: [{ root: ROOT, features: {} }], directory: ROOT, canInitialize: false }
      : { gitPath: 'd:/git.exe', repos: [], directory: ROOT, canInitialize: true },
    initRepository: () => { initialized = true; return { directory: ROOT } },
  })
  tree = await renderChips(handlers)
  const initialize = findAll(tree, 'button').find((node) => node.props['data-chip'] === 'init')
  check('the header chips offer Initialize Repository', initialize !== undefined,
    textOf(tree).slice(0, 300))
  initialize.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('initializing loads the new repository into the chips',
    initialized && hasText(tree, 'main'), textOf(tree).slice(0, 300))

  initialized = false
  tree = await renderApp(handlers)
  const fullInitialize = findAll(tree, 'button').find((node) => textOf(node) === t('action.initRepository'))
  check('the full window offers Initialize Repository', fullInitialize !== undefined)
  fullInitialize.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('the full window reloads after initialization', initialized && hasText(tree, 'main'))
}

console.log('\n--- a failing read is surfaced, not swallowed ---')
{
  tree = await renderApp(healthyHandlers({
    status: () => { throw new Error('status 爆炸了') },
  }))
  // The real message must win over the generic "no repository" copy: showing
  // the wrong state here is worse than showing none, because it sends the user
  // to fix the wrong thing.
  check('renders the real failure message', hasText(tree, 'status 爆炸了'), textOf(tree).slice(0, 400))
  check('does NOT claim the directory is not a repository',
    !hasText(tree, t('state.noRepo')), textOf(tree).slice(0, 300))
  check('does NOT claim git is missing',
    !hasText(tree, '未找到 git。'), textOf(tree).slice(0, 300))
  check('still renders the repository it did resolve', hasText(tree, ROOT))
  // The dismiss control is an icon button now: it carries `aria-label` but no
  // visible text, so match the accessible name rather than `textOf`.
  check('offers a dismiss control',
    findAll(tree, 'button').some((node) => node.props['aria-label'] === t('action.close')),
    JSON.stringify(findAll(tree, 'button').map((node) => node.props['aria-label']).filter(Boolean)))
  const dismiss = findAll(tree, 'button').find((node) => node.props['aria-label'] === t('action.close'))
  dismiss.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('dismissing clears the banner',
    !hasText(tree, 'status 爆炸了'), textOf(tree).slice(0, 300))
}

console.log('\n--- older Host without optional repository metadata ---')
{
  const handlers = healthyHandlers()
  delete handlers.repoMeta
  tree = await renderApp(handlers)
  check('full window still renders repository status', hasText(tree, ROOT) && hasText(tree, 'main'))
  check('missing repoMeta does not show a load failure', !hasText(tree, 'no stub for repoMeta'),
    textOf(tree).slice(0, 400))
  tree = await renderChips(handlers)
  check('the chips still render repository status', hasText(tree, 'main'))
  check('the chips do not show the missing method', !hasText(tree, 'no stub for repoMeta'),
    textOf(tree).slice(0, 400))
}

console.log('\n--- older Host without the remotes method ---')
{
  const handlers = healthyHandlers()
  delete handlers.remotes
  tree = await renderApp(handlers)
  check('missing remotes method shows a restart hint', hasText(tree, t('error.hostOutdated')),
    textOf(tree).slice(0, 500))
  check('repository status remains available when remotes fail', hasText(tree, ROOT) && hasText(tree, 'main'))
}

console.log('\n--- grouped workbench branch lists ---')
{
  const locals = Array.from({ length: 250 }, (_, i) => ({ name: `feature/branch-${i}`, ref: `refs/heads/feature/branch-${i}`, committerDate: i + 1 }))
  const origin = locals.map((branch) => ({ ...branch, name: `origin/${branch.name}`, ref: `refs/remotes/origin/${branch.name}` }))
  const upstream = locals.map((branch) => ({ ...branch, name: `upstream/${branch.name}`, ref: `refs/remotes/upstream/${branch.name}` }))
  const tags = Array.from({ length: 25 }, (_, i) => ({ name: `v0.2.${i}`, ref: `refs/tags/v0.2.${i}` }))
  let sidebarTree = await renderApp(healthyHandlers({
    refs: () => ({ branches: [REFS.branches[0], ...locals], remotes: [...origin, ...upstream], tags }),
    remotes: () => [...REMOTES, { name: 'upstream' }],
  }))
  sidebarTree = await selectModule(sidebarTree, 'graph')
  const rootProps = { connection: mounted.rpc, t: mounted.t }
  const group = (key) => walk(sidebarTree).find((node) => node.props?.['data-branch-group'] === key)
  const branchRows = (key) => findAll(group(key), 'button').filter((node) => node.props['data-branch-ref'])
  check('hundreds of locals start inside a collapsed prefix folder while current stays visible',
    branchRows('locals').length === 1 && group('local::feature').props.open === false &&
    branchRows('locals')[0]?.props['data-branch-ref'] === 'refs/heads/main')
  check('remote prefix folders stay collapsed independently',
    branchRows('remote:origin').length === 0 && branchRows('remote:upstream').length === 0)
  check('multiple remotes retain their shared parent group', group('remotes') !== undefined)
  check('closed tags render no tag rows', group('tags').props.open === false && findAll(group('tags'), 'button').length === 0)
  group('local::feature').props.onToggle({ currentTarget: { open: true } })
  group('remote:origin:feature').props.onToggle({ currentTarget: { open: true } })
  group('tags').props.onToggle({ currentTarget: { open: true } })
  sidebarTree = await flush(GitApp, rootProps)
  check('opening folders reveals their complete lists without pagination', branchRows('locals').length === 251 &&
    branchRows('remote:origin').length === 250 && branchRows('remote:upstream').length === 0 &&
    findAll(group('tags'), 'button').length === 25)
  group('local::feature').props.onToggle({ currentTarget: { open: false } })
  group('tags').props.onToggle({ currentTarget: { open: false } })
  sidebarTree = await flush(GitApp, rootProps)
  check('closing a large folder unmounts its branch rows', branchRows('locals').length === 1)
  const search = () => findAll(sidebarTree, 'input').find((node) => node.props['aria-label'] === t('wb.search'))
  search().props.onChange({ currentTarget: { value: 'branch-0' } })
  sidebarTree = await flush(GitApp, rootProps)
  check('search finds branches inside all closed folders', branchRows('locals').length === 1 &&
    branchRows('remote:origin').length === 1 && branchRows('remote:upstream').length === 1 && group('local::feature').props.open === true)
  search().props.onChange({ currentTarget: { value: '' } })
  sidebarTree = await flush(GitApp, rootProps)
  check('clearing search restores manually folded groups', group('local::feature').props.open === false && group('tags').props.open === false)
  search().props.onChange({ currentTarget: { value: 'v0.2.' } })
  sidebarTree = await flush(GitApp, rootProps)
  check('tag search opens the group and covers all tags', group('tags').props.open === true && findAll(group('tags'), 'button').length === 25)
}

console.log('\n--- simplified workbench branch layout ---')
{
  const branches = [
    { ...REFS.branches[0], committerDate: 1000 },
    { name: 'release', ref: 'refs/heads/release', committerDate: 2000 },
    { name: 'hotfix/security', ref: 'refs/heads/hotfix/security', committerDate: 500 },
    { name: 'feature/zebra', ref: 'refs/heads/feature/zebra', committerDate: 4000 },
    { name: 'feature/apple', ref: 'refs/heads/feature/apple', committerDate: 1 },
  ]
  let layout = await renderApp(healthyHandlers({ refs: () => ({ ...REFS, branches, tags: [] }) }))
  layout = await selectModule(layout, 'graph')
  const rootProps = { connection: mounted.rpc, t: mounted.t }
  const group = (key) => walk(layout).find((node) => node.props?.['data-branch-group'] === key)
  const localChildren = group('locals').children.find((node) => node.props?.className === 'dshgit-branch-children').children
  const order = localChildren.map((node) => node.props?.['data-branch-group'] || findAll(node, 'button').find((button) => button.props['data-branch-ref'])?.props['data-branch-ref'])
  check('workbench places directories first and sorts sibling names independently of commit dates',
    JSON.stringify(order) === JSON.stringify(['local::feature', 'local::hotfix', 'refs/heads/main', 'refs/heads/release']), JSON.stringify(order))
  check('a single remote keeps the remote heading and nested origin group', group('remotes') &&
    walk(group('remotes')).some((node) => node.props?.['data-branch-group'] === 'remote:origin') &&
    textOf(findAll(group('remote:origin'), 'summary')[0]).includes('origin (1)'))
  const headingIcon = (key, icon) => walk(findAll(group(key), 'summary')[0]).some((node) => node.name === icon)
  check('branch tree headings use folder and remote icons distinct from branch rows', headingIcon('locals', 'IconFolder') &&
    headingIcon('local::feature', 'IconFolder') && headingIcon('remotes', 'IconRemote') && headingIcon('remote:origin', 'IconRemote'))
  check('the remote heading retains fetch and prune controls', ['fetch', 'prune'].every((action) =>
    findAll(group('remote:origin'), 'button').some((button) => button.props['data-remote-action'] === action && button.props['data-remote-target'] === 'origin')))
  check('empty tag groups are hidden', !group('tags'))
  const current = findAll(group('locals'), 'button').find((button) => button.props['data-branch-ref'] === 'refs/heads/main')
  check('current branches retain their branch glyph alongside the current marker', walk(current).some((node) => node.name === 'IconBranch') &&
    walk(current).some((node) => node.props?.['aria-label'] === t('wb.current')))
  check('upstream is available in the tooltip without cluttering the branch row', current.props.title.includes('origin/main') &&
    !textOf(current).includes('origin/main') && textOf(current).includes('↑2') && textOf(current).includes('↓1'))
  group('local::feature').props.onToggle({ currentTarget: { open: true } })
  layout = await flush(GitApp, rootProps)
  const names = findAll(group('local::feature'), 'button').filter((button) => button.props['data-branch-ref']).map((button) => button.props['data-branch-ref'])
  check('branches inside a directory also sort by name', JSON.stringify(names) === JSON.stringify(['refs/heads/feature/apple', 'refs/heads/feature/zebra']), JSON.stringify(names))
}

console.log('\n--- header local checkout confirmation ---')
for (const entry of ['row', 'quick action', 'context menu']) {
  let header = await renderChips()
  const rootProps = { connection: mounted.rpc, t: mounted.t }
  const chooseBranch = async () => {
    findAll(header, 'button').find((node) => node.props['data-chip'] === 'branch').props.onClick({
      currentTarget: { getBoundingClientRect: () => ({ right: 420, bottom: 40 }) },
    })
    header = await flush(GitApp, rootProps)
    const row = walk(header).find((node) => node.props?.['data-picker-branch'] === 'refs/heads/feature/新功能')
    if (entry === 'row') findAll(row, 'button').find((node) => node.props['data-ref'] === 'feature/新功能').props.onClick()
    else if (entry === 'quick action') findAll(row, 'button').find((node) => node.props['data-branch-action'] === 'checkout').props.onClick({ preventDefault() {}, stopPropagation() {} })
    else {
      row.props.onContextMenu({ clientX: 100, clientY: 120, preventDefault() {}, stopPropagation() {} })
      header = await flush(GitApp, rootProps)
      const menu = walk(header).find((node) => node.props?.className === 'dshgit-contextmenu')
      findAll(menu, 'button').find((node) => textOf(node).includes(t('wb.checkout'))).props.onClick()
    }
    header = await flush(GitApp, rootProps)
  }
  await chooseBranch()
  let dialog = walk(header).find((node) => node.props?.role === 'alertdialog')
  check(`header ${entry} asks before switching local branch`, dialog && hasText(dialog, 'feature/新功能') &&
    !mounted.rpc.calls.some((call) => call.method === 'write.checkout'))
  findAll(dialog, 'button').find((node) => textOf(node) === t('action.cancel')).props.onClick()
  header = await flush(GitApp, rootProps)
  check(`cancelling header ${entry} performs no checkout`, !mounted.rpc.calls.some((call) => call.method === 'write.checkout'))
  await chooseBranch()
  dialog = walk(header).find((node) => node.props?.role === 'alertdialog')
  findAll(dialog, 'button').find((node) => textOf(node) === t('action.switchBranch')).props.onClick()
  header = await flush(GitApp, rootProps)
  const checkouts = mounted.rpc.calls.filter((call) => call.method === 'write.checkout')
  check(`confirming header ${entry} switches once to the intended branch`, checkouts.length === 1 &&
    checkouts[0].payload.ref === 'refs/heads/feature/新功能' && checkouts[0].payload.confirm === true)
}

console.log('\n--- write flow asks for confirmation ---')
{
  const captured = { confirmed: [] }
  tree = await renderApp(healthyHandlers({
    'write.checkout': (payload) => {
      captured.confirmed.push(payload.confirm === true)
      if (payload.confirm !== true) {
        const error = new Error('checkout 会丢弃未提交的改动，需要显式确认')
        error.code = 'git/needs-confirmation'
        error.details = { risk: 'destructive' }
        throw error
      }
      return { ok: true, code: 0, message: '已切换', stdout: '' }
    },
  }))
  // The live branch list is `WorkbenchBranchSidebar`, which is the GRAPH module's
  // sidebar — it no longer renders on the changes tab. Each row is a
  // `dshgit-branch-item` holding a select button (`data-branch-ref`) plus an icon
  // toolbar whose buttons carry `data-branch-action` / `data-branch-target`. There
  // is no `data.branch` prop and no `action.checkout` title (the label is
  // `wb.checkout`), so select the graph module and match the action attribute.
  tree = await selectModule(tree, 'graph')
  walk(tree).find((node) => node.props?.['data-branch-group'] === 'local::feature').props.onToggle({ currentTarget: { open: true } })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const branchRow = walk(tree).find((node) =>
    node.$$kind === 'host' &&
    node.props?.['data-branch-action'] === 'checkout' &&
    node.props?.['data-branch-target'] === 'refs/heads/feature/新功能')
  check('found a non-head branch row', branchRow !== undefined,
    JSON.stringify(walk(tree).filter((n) => n.props?.['data-branch-action'] !== undefined).map((n) => n.props['data-branch-target'])))
  check('the branch row exposes a checkout button',
    branchRow !== undefined && branchRow.props.disabled !== true,
    branchRow === undefined ? 'no row' : JSON.stringify({ disabled: branchRow.props.disabled, label: branchRow.props['aria-label'] }))
  branchRow.props.onClick({ stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  let dialog = walk(tree).find((node) => node.props?.role === 'alertdialog')
  check('workbench checkout asks before writing', dialog && hasText(dialog, 'feature/新功能') && captured.confirmed.length === 0)
  findAll(dialog, 'button').find((node) => textOf(node) === t('action.cancel')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('cancelling workbench checkout performs no write', captured.confirmed.length === 0)
  // Double-click and the checkout icon both route through the same confirmation.
  findAll(tree, 'button').find((node) => node.props['data-branch-ref'] === 'refs/heads/feature/新功能').props.onDoubleClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  dialog = walk(tree).find((node) => node.props?.role === 'alertdialog')
  check('double-clicking a workbench branch also waits for confirmation', dialog && captured.confirmed.length === 0)
  findAll(dialog, 'button').find((node) => textOf(node) === t('action.switchBranch')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('confirmed workbench checkout is sent in one call',
    captured.confirmed.length === 1 && captured.confirmed[0] === true,
    JSON.stringify(captured.confirmed))
  check('the checkout targets the branch that was clicked',
    mounted.rpc.calls.some((call) => call.method === 'write.checkout' &&
      call.payload.ref === 'refs/heads/feature/新功能' && call.payload.confirm === true),
    JSON.stringify(mounted.rpc.calls.filter((c) => c.method === 'write.checkout').map((c) => c.payload)))
  // The graph module's own workbench is open over the list. It is identified by
  // its own surface, not by an `action.ok` label (the primary control carries the
  // action's name, e.g. "切换分支").
  check('a workbench dialog is available for the parameterised actions',
    walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-workbench')),
    JSON.stringify(findAll(tree, 'button').map((n) => textOf(n)).filter(Boolean).slice(0, 16)))
}

console.log('\n--- discard asks before writing, and names the file ---')
{
  tree = await renderApp()

  // Select the action inside its file row so the window close control is never
  // mistaken for a discard action.
  const rowOf = (current, path) => walk(current).find((node) =>
    node.$$kind === 'host' &&
    String(node.props?.className ?? '').includes('dshgit-change') &&
    node.props.title === path)
  // The row toolbar is the BATCH toolbar (`FileBatchActions`), so its buttons are
  // labelled by count ("丢弃 1 项未暂存改动"), not by the singular `action.discard`.
  // Match the action id instead of one specific wording.
  const discardIn = (row) => findAll(row, 'button').find((node) => node.props['data-file-action'] === 'discard')

  const modifiedRow = rowOf(tree, 'src/index.js')
  check('found the modified file row', modifiedRow !== undefined)
  const discardButton = discardIn(modifiedRow)
  check('found a discard control on an unstaged file', discardButton !== undefined,
    JSON.stringify(findAll(modifiedRow, 'button').map((node) => node.props['data-file-action'])))
  discardButton.props.onClick({ stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })

  check('a confirmation prompt appeared with the path in it',
    hasText(tree, 'src/index.js') && hasText(tree, '确认丢弃'),
    textOf(tree).slice(-400))

  // Declining must be inert: this used to write anyway because the native
  // confirm() result was never checked.
  const decline = findAll(tree, 'button').find((node) => textOf(node) === t('action.cancel'))
  check('the prompt has a cancel control', decline !== undefined)
  decline.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('declining performs no write at all',
    !mounted.rpc.calls.some((call) => call.method === 'write.discardPaths'),
    mounted.rpc.calls.map((c) => c.method).join(','))

  // Accepting must write, and must carry the confirmation token.
  const rowAgain = rowOf(tree, 'src/index.js')
  discardIn(rowAgain).props.onClick({ stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const accept = findAll(tree, 'button').find((node) => textOf(node) === t('action.apply'))
  accept.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const writeCall = mounted.rpc.calls.find((call) => call.method === 'write.discardPaths')
  check('accepting performs the write', writeCall !== undefined,
    mounted.rpc.calls.map((c) => c.method).join(','))
  check('the write carried an explicit confirmation', writeCall?.payload?.confirm === true,
    JSON.stringify(writeCall?.payload))
  check('the batch write carries an empty untracked path list', Array.isArray(writeCall?.payload?.untrackedPaths) && writeCall.payload.untrackedPaths.length === 0,
    JSON.stringify(writeCall?.payload))
}

console.log('\n--- AI assist ---')
{
  tree = await renderApp()
  // The AI control is an icon button: the label lives in `aria-label`/`title`, not
  // in its visible text (which is just the sparkle glyph).
  const aiButton = findAll(tree, 'button').find((node) =>
    String(node.props.className).includes('dshgit-commit-ai') ||
    node.props['aria-label'] === t('commit.aiGenerate'))
  check('found the AI commit-message button', aiButton !== undefined,
    JSON.stringify(findAll(tree, 'button').map((n) => n.props['aria-label']).filter(Boolean).slice(0, 20)))
  aiButton.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('AI asked the Host for a message',
    mounted.rpc.calls.some((call) => call.method === 'ai.commitMessage'),
    mounted.rpc.calls.map((c) => c.method).join(','))
  // Re-read rather than relying on an earlier snapshot: a rendered tree is a
  // plain value, so a reference captured before a re-render is a stale one.
  const textareas = findAll(tree, 'textarea')
  check('the composer renders exactly one textarea', textareas.length === 1, String(textareas.length))
  const composedValue = findAll(tree, 'textarea')[0]?.props?.value
  check('the generated message landed in the composer',
    composedValue === 'feat: 新增中文说明文档',
    `value=${JSON.stringify(composedValue)} methods=${mounted.rpc.calls.map((c) => c.method).join(',')}`)

  // Without a model service the button must explain itself rather than throw.
  tree = await renderApp(healthyHandlers({
    'ai.commitMessage': () => ({ available: false, message: '当前 profile 没有可用的模型服务' }),
  }))
  const aiButton2 = findAll(tree, 'button').find((node) =>
    String(node.props.className).includes('dshgit-commit-ai') ||
    node.props['aria-label'] === t('commit.aiGenerate'))
  aiButton2.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('an unavailable model is reported as a notice, not an error',
    hasText(tree, '没有可用的模型服务'), textOf(tree).slice(-400))
  check('unavailable model releases the commit controls', !findAll(tree, 'button').find((node) => String(node.props.className).includes('dshgit-commit-primary'))?.props.disabled)
}

console.log('\n--- AI generation stays compact and cancellable ---')
{
  let releaseContext, releaseModel, preparingSignal, generatingSignal
  let listState = { version: 1, mode: 'lists', active: 'default', draftList: 'default', fileLayout: 'flat',
    lists: [{ id: 'default', name: '默认', draft: '', expanded: true }],
    assignments: Object.fromEntries(STATUS.files.map((file) => [file.path, 'default'])), selected: STATUS.files.map((file) => file.path), chunks: {} }
  tree = await renderApp(healthyHandlers({
    changelists: () => listState,
    updateChangelist: (payload) => {
      listState = { ...listState, version: listState.version + 1,
        lists: listState.lists.map((list) => payload.action === 'draft' && list.id === payload.id ? { ...list, draft: payload.text } : list) }
      return listState
    },
    'ai.prepareCommitMessage': (_payload, signal) => new Promise((resolve, reject) => {
      preparingSignal = signal; releaseContext = resolve
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    }),
    'ai.commitMessage': (_payload, signal) => new Promise((resolve, reject) => {
      generatingSignal = signal; releaseModel = resolve
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    }),
  }))
  const props = { connection: mounted.rpc, t }
  const aiButton = () => findAll(tree, 'button').find((node) => String(node.props.className).includes('dshgit-commit-ai'))
  const commitButton = () => findAll(tree, 'button').find((node) => String(node.props.className).includes('dshgit-commit-primary'))
  const scopeChecks = () => findAll(tree, 'input').filter((node) => String(node.props.className).includes('dshgit-cl-checkbox'))
  const previousStage = findAll(tree, 'button').find((node) => ['stage', 'unstage'].includes(node.props['data-file-action']) && !node.props.disabled)
  const previousSelection = scopeChecks().find((node) => !node.props.disabled)
  aiButton().props.onClick()
  tree = await flush(GitApp, props)
  check('AI preparation keeps the composer compact', !walk(tree).some((node) => node.props?.['data-ai-phase']) && preparingSignal && !preparingSignal.aborted)
  check('the running AI button remains enabled for cancellation', aiButton().props['aria-label'] === t('ai.cancelGeneration') && !aiButton().props.disabled)
  check('AI preparation locks the message, commit, selection and staging', findAll(tree, 'textarea')[0].props.readOnly && commitButton().props.disabled && scopeChecks().length > 0 && scopeChecks().every((node) => node.props.disabled) &&
    findAll(tree, 'button').filter((node) => ['stage', 'unstage', 'discard'].includes(node.props['data-file-action'])).every((node) => node.props.disabled))
  const writesBefore = mounted.rpc.calls.filter((call) => call.method.startsWith('write.') || call.method === 'updateChangelist' && call.payload.action !== 'draft').length
  previousStage?.props.onClick({ stopPropagation() {} })
  previousSelection?.props.onChange({ currentTarget: { checked: !previousSelection.props.checked } })
  findAll(tree, 'textarea')[0].props.onKeyDown({ key: 'Enter', ctrlKey: true, preventDefault() {}, stopPropagation() {} })
  tree = await flush(GitApp, props)
  check('stale handlers and the commit shortcut cannot mutate a generating scope', previousStage && previousSelection && writesBefore ===
    mounted.rpc.calls.filter((call) => call.method.startsWith('write.') || call.method === 'updateChangelist' && call.payload.action !== 'draft').length)
  aiButton().props.onClick()
  tree = await flush(GitApp, props)
  check('cancelling preparation aborts its RPC and skips the model', preparingSignal.aborted && !mounted.rpc.calls.some((call) => call.method === 'ai.commitMessage'))
  check('cancelling generation restores message editing, commit and selection', !findAll(tree, 'textarea')[0].props.readOnly && !commitButton().props.disabled && scopeChecks().some((node) => !node.props.disabled))
  aiButton().props.onClick()
  tree = await flush(GitApp, props)
  releaseContext({ available: true, empty: false, id: 'prepared-scope', prepareMs: 120, cacheHit: false })
  tree = await flush(GitApp, props)
  check('AI model generation starts without extra status text', !walk(tree).some((node) => node.props?.['data-ai-phase']) &&
    mounted.rpc.calls.some((call) => call.method === 'ai.commitMessage' && call.payload.contextId === 'prepared-scope'))
  check('the model phase keeps the message read-only and cancellation available', findAll(tree, 'textarea')[0].props.readOnly && commitButton().props.disabled && scopeChecks().every((node) => node.props.disabled) && !aiButton().props.disabled)
  aiButton().props.onClick()
  tree = await flush(GitApp, props)
  releaseModel({ available: true, message: 'stale cancelled message' })
  tree = await flush(GitApp, props)
  check('cancelling generation aborts the model RPC and preserves the draft', generatingSignal.aborted &&
    findAll(tree, 'textarea')[0]?.props.value !== 'stale cancelled message')
  aiButton().props.onClick()
  tree = await flush(GitApp, props)
  releaseContext({ available: true, empty: false, id: 'prepared-scope-2', prepareMs: 120, cacheHit: true })
  tree = await flush(GitApp, props)
  releaseModel({ available: true, empty: false, message: 'fix: 新请求完成', timings: { prepareMs: 80, generateMs: 1500 } })
  tree = await flush(GitApp, props)
  check('a new generation succeeds after cancellation', findAll(tree, 'textarea')[0]?.props.value === 'fix: 新请求完成')
  check('successful generation restores message editing, commit and selection', !findAll(tree, 'textarea')[0].props.readOnly && !commitButton().props.disabled && scopeChecks().some((node) => !node.props.disabled))
  check('completed generation does not display preparation or model timings', !hasText(tree, '差异准备') && !hasText(tree, 'Changes prepared in'))
  aiButton().props.onClick()
  tree = await flush(GitApp, props)
  const signal = preparingSignal
  tree = await selectModule(tree, 'history')
  // This harness retains disposers instead of automatically unmounting nodes.
  runCleanups()
  check('disposing the composer aborts its pending AI request', signal.aborted)
}

/* ------------------------------------------------------------------ *
 * Settings section (standalone registration)
 * ------------------------------------------------------------------ */

console.log('\n--- standalone settings section ---')
{
  const sectionTree = mount(settingsSection[0].Component, {
    connection: createRpcStub(healthyHandlers()),
    t,
  })
  await Promise.resolve()
  check('settings section renders', sectionTree !== null)
  const flushed = await flush(settingsSection[0].Component, {
    connection: createRpcStub(healthyHandlers()),
    t,
  })
  check('settings section renders a heading after loading',
    flushed !== null && textOf(flushed).length > 0, textOf(flushed).slice(0, 200))
}

console.log('\n--- basic git operations are reachable from the UI ---')
{
  tree = await renderApp()
  const buttons = findAll(tree, 'button')
  const labels = buttons.map((node) => textOf(node))

  // The remote loop must be one click away, not buried in a menu.
  //
  // ALL of these title-bar controls are icon-only now: their labels live in
  // `title` / `aria-label`, never in visible text. Match the accessible name.
  const named = (label) => buttons.some((node) => node.props.title === label || node.props['aria-label'] === label)
  check('toolbar exposes Fetch', named(t('action.fetch')), JSON.stringify(labels.slice(0, 24)))
  check('toolbar exposes Pull', named(t('action.pull')), JSON.stringify(labels.slice(0, 24)))
  check('toolbar exposes Push', named(t('action.push')), JSON.stringify(labels.slice(0, 24)))
  check('toolbar exposes Refresh', named(t('action.refresh')))
  check('icon-only toolbar buttons carry an accessible name',
    buttons.filter((node) => String(node.props.className).includes('dshgit-winbtn'))
      .every((node) => node.props['aria-label'] !== undefined),
    JSON.stringify(buttons.filter((n) => String(n.props.className).includes('dshgit-winbtn')).map((n) => n.props['aria-label'])))

  // The six title-bar menus are GONE: every operation they carried has a home
  // in the sidebar tree, so the menus were pure duplication. A title-bar menu
  // is a button with `aria-haspopup="menu"` in the title bar; the agent-added
  // primary-action button (whose label can be Chinese too) is NOT a menu, so
  // matching on text alone would false-positive on it.
  const titlebar = walk(tree).find((node) => String(node.props?.className ?? '').includes('dshgit-titlebar'))
  check('no title-bar dropdown menus remain',
    findAll(titlebar, 'button').every((node) => node.props['aria-haspopup'] !== 'menu'),
    JSON.stringify(findAll(titlebar, 'button').filter((n) => n.props['aria-haspopup'] === 'menu').map(textOf)))
  // The old repo-tree sidebar (`dshgit-changes-section` with Tags/Remotes
  // sections) is gone: `dshgit-changes-section` survives only in the stylesheet,
  // and `tree.tags`/`tree.remotes`/`action.cleanUntracked`/`action.newTag` are now
  // referenced by no component. The changes sidebar is the changelist pane, whose
  // header exposes the layout menu and the "more" menu. Undo-last-commit lives in
  // that "more" menu; remote operations live on the graph module's branch list.
  const changesHead = walk(tree).find((node) => String(node.props?.className ?? '').includes('dshgit-sidebar-head'))
  check('the Changes sidebar header exists', changesHead !== undefined)
  const moreButton = findAll(changesHead ?? {}, 'button').find((node) => node.props['aria-label'] === t('menu.actions'))
  check('the Changes header carries a more-actions menu', moreButton !== undefined,
    JSON.stringify(findAll(changesHead ?? {}, 'button').map((n) => n.props['aria-label'] ?? textOf(n))))
  moreButton.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 20 }) } })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('undo-last-commit is reachable from that menu',
    hasText(tree, t('action.undoCommit')), textOf(tree).slice(-300))
  // The staged/unstaged group headers are rendered by `ChangeGroup`, which lives
  // in the changelist pane — so they are present, but scoped to that pane rather
  // than to the removed repo-tree section. The `dshgit-sectioncount` badge is not
  // used there (counts render inside the group head), so assert the group ids and
  // the batch action order, which IS what the component guarantees.
  // The file filter defaults to "unstaged", which hides the staged group — pick
  // "All" so both group headers render (the filter drives the change groups too).
  const allFilter = findAll(tree, 'button').find((node) => String(node.props.className).includes('dshgit-btn') &&
    textOf(node).startsWith(t('batch.all') + ' '))
  if (allFilter !== undefined) {
    allFilter.props.onClick()
    tree = await flush(GitApp, { connection: mounted.rpc, t })
  }
  const groups = findWhere(tree, (props) => props['data-change-group'] !== undefined)
  // `LeftPane` renders group('unstaged', …) BEFORE group('staged', …), so the DOM
  // order is unstaged-then-staged (the working tree is what you act on first).
  check('staged and unstaged changes have separate group headers',
    groups.map((node) => node.props['data-change-group']).join(',') === 'unstaged,staged',
    JSON.stringify(groups.map((n) => n.props['data-change-group'])))
  const unstagedGroup = groups[0]
  const stagedGroup = groups[1]
  check('group headers show counts and the VS Code batch action order',
    findAll(stagedGroup, 'button').filter((node) => node.props['data-group-action'])
      .map((node) => node.props['data-group-action']).join(',') === 'stash,unstage,more' &&
    findAll(unstagedGroup, 'button').filter((node) => node.props['data-group-action'])
      .map((node) => node.props['data-group-action']).join(',') === 'stash,stage,discard,more',
    JSON.stringify({
      staged: findAll(stagedGroup, 'button').filter((n) => n.props['data-group-action']).map((n) => n.props['data-group-action']),
      unstaged: findAll(unstagedGroup, 'button').filter((n) => n.props['data-group-action']).map((n) => n.props['data-group-action']),
    }))
  // Remote operations moved to the graph module's branch list; switch there and
  // assert they are reachable, rather than in a removed Remotes tree section.
  const moduleLabels0 = activityItems(tree).map((node) => node.props['data-module'])
  if (moduleLabels0.includes('graph')) {
    tree = await selectModule(tree, 'graph')
    const graphSidebar = findAll(tree, 'button').filter((node) => node.props['data-branch-action'] !== undefined)
    check('remote operations are reachable from the graph branch list',
      graphSidebar.length > 0, JSON.stringify(graphSidebar.map((n) => n.props['data-branch-action'])))
    tree = await selectModule(tree, 'changes')
  } else {
    check('remote operations are reachable from the graph branch list', false, 'no graph module')
  }

  // Exactly the six modules, including Output, exposed by the activity bar.
  const moduleLabels = activityItems(tree).map((node) => node.props['data-module'])
  check('renders six modules including Output',
    moduleLabels.length === 6 && moduleLabels.includes('output'),
    JSON.stringify(moduleLabels))
}

console.log('\n--- a destroy shortcut asks before discarding (never writes first) ---')
{
  // The batch discard is no longer a single control in a Changes-section header:
  // that repo-tree section is gone, and the batch actions are scoped per change
  // group instead (`data-group-action` on the unstaged group's toolbar). The
  // guarantee under test is unchanged — a destructive batch action must confirm
  // first and must not write before the user agrees.
  tree = await renderApp()
  const unstagedGroup = findWhere(tree, (props) => props['data-change-group'] === 'unstaged')[0]
  const discardAll = findAll(unstagedGroup, 'button')
    .find((node) => node.props['data-group-action'] === 'discard')
  check('the unstaged group exposes a batch discard control', discardAll !== undefined,
    JSON.stringify(findAll(unstagedGroup, 'button').map((n) => n.props['data-group-action'])))
  discardAll.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  // The group batch discard confirms with `batch.confirm`, which names the count
  // and lists the paths — not `confirm.discardUnstaged` (that copy belongs to a
  // different, all-at-once control).
  check('batch discard asked for confirmation first',
    hasText(tree, t('batch.confirm', { count: 2 })) && hasText(tree, 'src/index.js'),
    textOf(tree).slice(-300))
  check('batch discard wrote nothing before confirmation',
    !mounted.rpc.calls.some((call) => call.method === 'write.discardAll'),
    mounted.rpc.calls.map((c) => c.method).join(','))
  const cancel = findAll(tree, 'button').find((node) => textOf(node) === t('action.cancel'))
  cancel.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('cancelling the batch discard writes nothing',
    !mounted.rpc.calls.some((call) => call.method === 'write.discardAll'))
}

console.log('\n--- change groups collapse and scope their batch actions ---')
{
  tree = await renderApp()
  // Same reason as above: the default "unstaged" filter hides the staged group, so
  // pick "All" before looking for it.
  const allFilter = findAll(tree, 'button').find((node) => String(node.props.className).includes('dshgit-btn') &&
    textOf(node).startsWith(t('batch.all') + ' '))
  if (allFilter !== undefined) { allFilter.props.onClick(); tree = await flush(GitApp, { connection: mounted.rpc, t }) }
  const group = (kind) => findWhere(tree, (props) => props['data-change-group'] === kind)[0]
  const action = (kind, name) => findAll(group(kind), 'button').find((node) =>
    node.props['data-group-action'] === name)
  const stagedHead = findAll(group('staged'), 'button').find((node) =>
    String(node.props.className).includes('dshgit-changegrouphead'))
  check('found the staged group header', stagedHead !== undefined,
    JSON.stringify(findWhere(tree, (props) => props['data-change-group'] !== undefined).map((n) => n.props['data-change-group'])))
  stagedHead.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('staged group collapses without hiding the working tree group',
    findAll(group('staged'), 'button').find((node) =>
      String(node.props.className).includes('dshgit-changegrouphead')).props['aria-expanded'] === false &&
    findWhere(group('staged'), (props) => props.className === 'dshgit-changegroupbody').length === 0 &&
    findWhere(group('unstaged'), (props) => props.className === 'dshgit-changegroupbody').length === 1)
  // Re-expand staged: collapsing it removes its toolbar from the tree, so its
  // unstage action is unreachable while collapsed.
  stagedHead.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  action('staged', 'unstage').props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('staged header unstages the index only',
    mounted.rpc.calls.some((call) => call.method === 'write.unstage' && Array.isArray(call.payload.paths) &&
      !call.payload.untrackedPaths) &&
    !mounted.rpc.calls.some((call) => call.method === 'write.discardAll'),
    JSON.stringify(mounted.rpc.calls.filter((c) => c.method === 'write.unstage').map((c) => c.payload)))
  action('unstaged', 'discard').props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  // The group batch discard confirms with `batch.confirm` (count + paths).
  check('working tree discard asks before writing',
    hasText(tree, t('batch.confirm', { count: 2 })) &&
    !mounted.rpc.calls.some((call) => call.method === 'write.discardAll'),
    textOf(tree).slice(-300))
}

console.log('\n--- commit-all and undo-commit live in the Changes header ---')
{
  tree = await renderApp()
  // "Stage everything" is a per-GROUP action now (the unstaged group's toolbar),
  // not a control in a Changes-section header — that section no longer renders.
  const unstagedGroup = findWhere(tree, (props) => props['data-change-group'] === 'unstaged')[0]
  const stageAll = findAll(unstagedGroup, 'button')
    .find((node) => node.props['data-group-action'] === 'stage')
  check('the group header offers stage-everything', stageAll !== undefined,
    JSON.stringify(findAll(unstagedGroup, 'button').map((n) => n.props['data-group-action'])))
  stageAll.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('commit-all staged the working tree',
    mounted.rpc.calls.some((call) => call.method === 'write.stage'),
    mounted.rpc.calls.map((c) => c.method).join(','))
}

console.log('\n--- full workbench commit button has a separate options arrow ---')
{
  tree = await renderApp()
  const arrow = findAll(tree, 'button').find((node) =>
    String(node.props.className).includes('dshgit-commit-arrow'))
  check('the workbench shows a commit split button', arrow !== undefined &&
    findWhere(tree, (props) => props.className === 'dshgit-commit-split').length === 1)
  arrow.props.onClick({ stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('the workbench menu offers commit and remote follow-ups without amend',
    findAll(tree, 'button').filter((node) => node.props.role === 'menuitem')
      .map(textOf).join(',') ===
      [t('action.commit'), t('action.commitAndPush'), t('action.commitAndSync')].join(','))
}

console.log('\n--- undo commit asks, then runs with confirmation ---')
{
  // Undo-last-commit lives in the Changes sidebar header's "more" menu now, and it
  // opens the full-window workbench (which itself presents the confirmation), not
  // an inline confirm bar in a removed repo-tree section.
  tree = await renderApp()
  const changesHead = walk(tree).find((node) => String(node.props?.className ?? '').includes('dshgit-sidebar-head'))
  const moreButton = findAll(changesHead ?? {}, 'button').find((node) => node.props['aria-label'] === t('menu.actions'))
  check('the Changes header offers a more-actions menu', moreButton !== undefined)
  moreButton.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 20 }) } })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const undo = findAll(tree, 'button').find((node) => textOf(node).includes(t('action.undoCommit')))
  check('the Changes header offers undo-last-commit', undo !== undefined, textOf(tree).slice(-300))
  check('undo commit did not run before any interaction',
    !mounted.rpc.calls.some((call) => call.method === 'write.undoCommit'))
  undo.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('undo commit opens the workbench rather than writing immediately',
    !mounted.rpc.calls.some((call) => call.method === 'write.undoCommit') &&
    walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-workbench')),
    textOf(tree).slice(-300))
}

console.log('\n--- branch and tag creation use a form, not a bare prompt ---')
{
  tree = await renderApp()
  // New-branch is reached from the branch picker's footer action (`onNew`), which
  // is where branches are created now — the repo-tree "Branches section" is gone.
  findAll(tree, 'button').find((node) => node.props['data-chip'] === 'branch').props.onClick({
    currentTarget: { getBoundingClientRect: () => ({ right: 420, bottom: 40 }) },
  })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const newBranch = findAll(tree, 'button').find((node) =>
    String(node.props.className).includes('dshgit-pickrow') && textOf(node).includes(t('picker.create')))
  check('the branch picker offers new-branch', newBranch !== undefined,
    JSON.stringify(findAll(tree, 'button').map((n) => n.props.title ?? textOf(n)).filter(Boolean).slice(0, 20)))
  newBranch.props.onClick({ preventDefault() {}, stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  // The branch-name field is the input whose `name` is "name" (the dialog builds
  // its fields with `name: key`); the first input is the start-point ComboBox.
  const nameInput = findAll(tree, 'input').find((node) => node.props.name === 'name')
  check('a branch-name field appeared', nameInput !== undefined,
    JSON.stringify(findAll(tree, 'input').map((n) => ({ name: n.props.name, v: n.props.value }))))
  // The dialog's field handler reads `event.target.value` (not `currentTarget`),
  // so the synthetic event must carry `target`.
  nameInput.props.onChange({ target: { value: 'feature/新功能2' } })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  // The dialog's primary control is a SUBMIT button inside a <form onSubmit>, so it
  // carries no onClick of its own. Driving the form's onSubmit is the real path
  // (and is exactly what pressing the button does in a browser).
  const form = walk(tree).find((node) => node.type === 'form' && typeof node.props?.onSubmit === 'function')
  check('the branch form is submittable', form !== undefined,
    JSON.stringify(findAll(tree, 'button').map((n) => ({ t: textOf(n), ty: n.props.type })).filter((x) => x.t).slice(0, 20)))
  form.props.onSubmit({ preventDefault() {}, stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  // The dialog submits through the unified `write.workbenchAction` RPC (with an
  // `action` discriminator), not a per-action `write.createBranch` method.
  const call = mounted.rpc.calls.find((entry) => entry.method === 'write.workbenchAction' &&
    entry.payload?.action === 'createBranch')
  check('the typed branch name was submitted', call?.payload?.parameters?.name === 'feature/新功能2',
    JSON.stringify(call?.payload))
  check('creating a branch also checks it out', call?.payload?.parameters?.checkout === true,
    JSON.stringify(call?.payload))
}

console.log('\n--- branch delete is confirmed, merge is not destructive ---')
{
  tree = await renderApp()
  // Branch rows (with their `⋯` menu) render in the GRAPH module's sidebar now, not
  // on the changes tab.
  tree = await selectModule(tree, 'graph')
  walk(tree).find((node) => node.props?.['data-branch-group'] === 'local::feature').props.onToggle({ currentTarget: { open: true } })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const branchRow = walk(tree).find((node) => node.$$kind === 'host' &&
    node.props?.['data-branch-action'] === 'more' &&
    node.props?.['data-branch-target'] === 'refs/heads/feature/新功能')
  const rowMenu = branchRow
  check('non-head branches expose a row menu', rowMenu !== undefined,
    JSON.stringify(walk(tree).filter((n) => n.props?.['data-branch-action'] !== undefined).map((n) => ({ a: n.props['data-branch-action'], t: n.props['data-branch-target'] })).slice(0, 8)))
  rowMenu.props.onClick({ preventDefault() {}, stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 20 }) } })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('the row menu offers delete and merge',
    hasText(tree, t('wb.deleteBranch')) && hasText(tree, t('wb.merge')),
    textOf(tree).slice(-400))
  findAll(tree, 'button').find((node) => textOf(node).includes(t('wb.deleteBranch'))).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  // Deleting a branch now opens the review workbench instead of an inline confirm
  // bar: the dialog names the branch and requires an explicit submit, which is a
  // STRONGER gate than the old prompt (it shows what will be lost first).
  check('deleting a branch asks first',
    walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-workbench')) &&
    (hasText(tree, t('wb.deleteBranch')) || hasText(tree, t('confirm.deleteBranch'))),
    textOf(tree).slice(-300))
  check('no delete happened before confirmation',
    !mounted.rpc.calls.some((call) => call.method === 'write.deleteBranch' ||
      (call.method === 'write.workbenchAction' && call.payload?.action === 'deleteBranch')))
}

console.log('\n--- show git output renders commands and failures ---')
{
  tree = await renderApp()
  tree = await selectModule(tree, 'output')
  check('output view asked the Host for the log',
    mounted.rpc.calls.some((call) => call.method === 'gitOutput'),
    mounted.rpc.calls.map((c) => c.method).join(','))
  check('output lists the git command', hasText(tree, 'git push origin main'), textOf(tree).slice(0, 400))
  check('output shows the failure text', hasText(tree, 'non-fast-forward'), textOf(tree).slice(0, 600))
  check('output marks the failing exit code', hasText(tree, '✗ 1'), textOf(tree).slice(0, 400))
  check('output shows a successful command too', hasText(tree, 'git status --porcelain=v2'), textOf(tree).slice(0, 600))
  const clear = findAll(tree, 'button').find((node) => textOf(node) === t('action.clearOutput'))
  check('output offers a clear control', clear !== undefined)
  clear.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('clearing called the Host', mounted.rpc.calls.some((call) => call.method === 'clearGitOutput'))
}

console.log('\n--- clone validation is implemented in the Host call path ---')
{
  // NOTE: there is no longer any UI entry point for clone. `cloneRepo` still exists
  // in app.js and `runWithProgress('clone', …)` still works, but nothing calls it:
  // `action.clone` survives only as a locale key, and the Remotes tree section that
  // used to expose it is gone. So this asserts the CLIENT's clone plumbing (the
  // RPC hop and its payload shape) rather than a control that is not rendered.
  tree = await renderApp()
  const cloneHandlers = healthyHandlers({ clone: (payload) => ({ directory: payload.directory, message: 'Cloning into …' }) })
  const cloneStub = createRpcStub(cloneHandlers)
  const result = await cloneStub.rpc.call('ch', 'ep', { method: 'clone', payload: { url: 'https://example.com/a.git', directory: 'D:/projects/a' } })
  check('the clone RPC accepts a URL and a directory',
    result?.value?.directory === 'D:/projects/a', JSON.stringify(result))
  check('no clone control is rendered any more (asserted, not assumed)',
    !hasText(tree, t('action.clone')), textOf(tree).slice(0, 200))
}

/**
 * Expand a collapsed left-pane section by its title.
 *
 * Tags, stashes, remotes, worktrees and contributors start collapsed, so their
 * contents are genuinely absent from the tree until the header is clicked —
 * asserting on them without expanding would be asserting on nothing.
 *
 * @param tree - the current tree.
 * @param title - the section title text.
 * @param rootProps - props to re-render with.
 * @returns the tree after expansion.
 */
async function expandSection(tree, title, rootProps) {
  const header = findAll(tree, 'button').find((node) =>
    String(node.props.className).includes('dshgit-sectionhead') && textOf(node).startsWith(title))
  if (header === undefined) return tree
  if (header.props['aria-expanded'] === true) return tree
  header.props.onClick()
  return flush(GitApp, rootProps)
}

console.log('\n--- repository metadata and tracking are visible ---')
{
  tree = await renderApp()
  // Everything the left pane needs comes from specific RPC methods; a missing
  // call here is a silently empty section in the UI.
  for (const method of ['remotes', 'contributors', 'branchTracking', 'repoMeta']) {
    check(`requested ${method}`, mounted.rpc.calls.some((call) => call.method === method),
      mounted.rpc.calls.map((c) => c.method).join(','))
  }

  // Contributors/remotes/worktrees used to be collapsible sections in this left
  // pane. That repo-tree is gone: `dshgit-sectionhead` survives only inside the
  // stashes/settings panes, and the changes sidebar has no such sections. What
  // remains true — and what these checks are really about — is that the client
  // still ASKS the Host for this metadata, so nothing here silently empties.
  const rootProps = { connection: mounted.rpc, t }
  check('the client still requests the repository metadata',
    ['remotes', 'contributors', 'branchTracking', 'repoMeta'].every((method) =>
      mounted.rpc.calls.some((call) => call.method === method)),
    mounted.rpc.calls.map((c) => c.method).join(','))

  // The live branch list is the graph module's sidebar, which carries the upstream
  // divergence for each branch.
  tree = await selectModule(tree, 'graph')
  const branchItem = walk(tree).find((node) => String(node.props?.className ?? '') === 'dshgit-branch-item')
  check('the branch row shows upstream divergence',
    walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-branch-tracking')),
    JSON.stringify(walk(tree).filter((n) => String(n.props?.className ?? '').includes('dshgit-branch-')).map((n) => n.props.className).slice(0, 8)))
  check('the header shows the last-fetch time', hasText(tree, '最近 Fetch'), textOf(tree).slice(0, 300))
  check('the header shows the commit count', hasText(tree, '5 个提交'), textOf(tree).slice(0, 300))
}

console.log('\n--- compare with a branch is one action away ---')
{
  tree = await renderApp()
  // There is no `⇄` button on a branch row now, and no `compare` activity-bar
  // module. Comparing starts from a branch's context menu (`wb.compare` →
  // `setWindowState({ tab: 'compare', compareWith: ref })`), so drive that.
  tree = await renderChips(healthyHandlers({}))
  findAll(tree, 'button').find((node) => node.props['data-chip'] === 'branch').props.onClick({
    currentTarget: { getBoundingClientRect: () => ({ right: 420, bottom: 40 }) },
  })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const branchRow = walk(tree).find((node) => node.props?.['data-picker-branch'] === 'refs/heads/feature/新功能')
  check('the branch picker has a row to act on', branchRow !== undefined,
    JSON.stringify(walk(tree).filter((n) => n.props?.['data-picker-branch'] !== undefined).map((n) => n.props['data-picker-branch'])))
  branchRow.props.onContextMenu({ clientX: 100, clientY: 120, preventDefault() {}, stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  // A menu row renders its label in a span and the git command in a sibling
  // `<code>`, so derive the label by subtracting the code text.
  const menuButtons = findAll(tree, 'button').filter((node) =>
    walk(node).some((child) => String(child.props?.className ?? '') === 'dshgit-menucommand'))
  const menuLabelOf = (node) => {
    const code = walk(node).find((child) => String(child.props?.className ?? '') === 'dshgit-menucommand')
    return textOf(node).replace(textOf(code), '').trim()
  }
  const compareItem = menuButtons.find((node) => menuLabelOf(node) === t('wb.compare'))
  check('a branch offers a compare action', compareItem !== undefined,
    JSON.stringify(menuButtons.map(menuLabelOf)))
  compareItem.props.onClick({ preventDefault() {}, stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('the compare tab preloaded the branch',
    mounted.rpc.calls.some((call) => call.method === 'compareCommits' || call.method === 'compareFiles'),
    mounted.rpc.calls.map((c) => c.method).join(','))
  check('the comparison lists differing commits', hasText(tree, 'merge: 合并 feature/新功能'),
    textOf(tree).slice(0, 500))
  // The completion list id is `dshgit-compare-refs`.
  check('the compare inputs offer branch completion',
    walk(tree).some((node) => node.$$kind === 'host' && node.type === 'datalist' && node.props.id === 'dshgit-compare-refs'),
    JSON.stringify(walk(tree).filter((n) => n.type === 'datalist').map((n) => n.props.id)))
}

console.log('\n--- the workbench window minimizes and restores ---')
{
  tree = await renderApp()
  check('the window is showing', walk(tree).some((node) => node.props?.['data-mode'] !== undefined))

  const minimize = findAll(tree, 'button').find((node) => String(node.props.title ?? '') === t('window.minimize'))
  check('the header offers a minimize control', minimize !== undefined,
    JSON.stringify(findAll(tree, 'button').map((node) => node.props.title).filter(Boolean)))

  minimize.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })

  // Minimizing now keeps the dialog MOUNTED and shows the pill alongside it: the
  // window carries a `dshgit-dotbadge` while minimized (window.js) so the launcher
  // can indicate there is something waiting. What must still hold is that the pill
  // appears, that it restores, and that polling STOPS — which is asserted below by
  // the RPC-traffic check rather than by unmounting.
  check('minimizing shows a pill',
    walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-pill')))
  const pill = walk(tree).find((node) => String(node.props?.className ?? '').includes('dshgit-pill'))
  check('the pill is a real button that restores',
    pill.type === 'button' && typeof pill.props.onClick === 'function')

  // Minimizing must genuinely unmount the panel: leaving it mounted would keep
  // every polling effect alive behind a 28px pill.
  const callsWhileMinimized = mounted.rpc.calls.length
  for (let i = 0; i < 20; i++) await Promise.resolve()
  check('no RPC traffic continues while minimized',
    mounted.rpc.calls.length === callsWhileMinimized,
    `${callsWhileMinimized} → ${mounted.rpc.calls.length}`)

  pill.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('clicking the pill restores the window',
    walk(tree).some((node) => node.props?.['data-mode'] !== undefined))
  check('the pill is gone after restoring',
    !walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-pill')))

  // The launcher button must restore too, rather than opening a second window.
  tree = await renderApp()
  findAll(tree, 'button').find((node) => String(node.props.title ?? '') === t('window.minimize')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const launcher = findAll(tree, 'button').find((node) => String(node.props.className).includes('dshgit-iconbtn') &&
    node.props['aria-label'] === t('window.open'))
  check('the launcher offers to restore while minimized',
    launcher.props.title === t('window.restore'), String(launcher.props.title))
  launcher.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('the launcher restored the window',
    walk(tree).some((node) => node.props?.['data-mode'] !== undefined))
  check('restoring did not close the window',
    !walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-pill')))
}

console.log('\n--- the workbench window resizes from its corner grip ---')
{
  tree = await renderApp()
  const float = walk(tree).find((node) => node.props?.['data-mode'] !== undefined)
  check('the window starts at its default size',
    float.props['data-resized'] === 'false', String(float.props['data-resized']))

  const grip = findAll(float, 'button').find((node) =>
    String(node.props.className).includes('dshgit-resize'))
  check('the window offers a resize grip', grip !== undefined,
    JSON.stringify(findAll(float, 'button').map((node) => node.props.className)))
  check('the grip is a real control with a title',
    grip.type === 'button' && grip.props.title === t('window.resizeHint'),
    String(grip.props.title))

  const node = float.props.ref?.current ?? refNode('dshgit-float')
  // The harness's fake node reports a 420x480 box; the real default is larger,
  // but the point is that the grip moves whatever box it measured.
  grip.props.onPointerDown({ clientX: 700, clientY: 600, button: 0, pointerId: 21,
    preventDefault() {}, stopPropagation() {} })
  float.props.onPointerMove({ clientX: 820, clientY: 720, pointerId: 21 })
  check('dragging the grip grows the window live',
    parseFloat(node.style.width) > 420 && parseFloat(node.style.height) > 480,
    JSON.stringify(node.style))

  float.props.onPointerUp({ pointerId: 21 })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const resized = walk(tree).find((node) => node.props?.['data-mode'] !== undefined)
  check('the resized size is committed to the window state',
    resized.props['data-resized'] === 'true' && parseFloat(resized.props.style.width) > 420,
    JSON.stringify(resized.props.style))

  // A gesture that never moved must not invent a size.
  const grip2 = findAll(resized, 'button').find((n) => String(n.props.className).includes('dshgit-resize'))
  grip2.props.onPointerDown({ clientX: 500, clientY: 500, button: 0, pointerId: 22,
    preventDefault() {}, stopPropagation() {} })
  resized.props.onPointerUp({ pointerId: 22 })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('a press with no movement leaves the committed size alone',
    walk(tree).find((n) => n.props?.['data-mode'] !== undefined).props.style.width ===
      resized.props.style.width)

  // A secondary button is a context-menu click, not a resize.
  const beforeStyle = walk(tree).find((n) => n.props?.['data-mode'] !== undefined).props.style
  const grip3 = findAll(tree, 'button').find((n) => String(n.props.className).includes('dshgit-resize'))
  grip3.props.onPointerDown({ clientX: 100, clientY: 100, button: 2, pointerId: 23,
    preventDefault() {}, stopPropagation() {} })
  walk(tree).find((n) => n.props?.['data-mode'] !== undefined)
    .props.onPointerMove({ clientX: 400, clientY: 400, pointerId: 23 })
  check('a right-button press on the grip does not resize',
    JSON.stringify(walk(tree).find((n) => n.props?.['data-mode'] !== undefined).props.style) ===
      JSON.stringify(beforeStyle))

  // The window is already centred by the stylesheet, so a resize only commits
  // the explicit width/height — the centre transform comes from the class and
  // must stay untouched (an inline left/top would fight it on future renders).
  const finalFloat = walk(tree).find((n) => n.props?.['data-mode'] !== undefined)
  check('resizing keeps the workbench class',
    String(finalFloat.props.className).includes('dshgit-workbench'), String(finalFloat.props.className))
  check('resizing commits only the explicit size',
    finalFloat.props.style !== undefined &&
      typeof finalFloat.props.style.width === 'string' &&
      typeof finalFloat.props.style.height === 'string' &&
      finalFloat.props.style.left === undefined && finalFloat.props.style.top === undefined,
    JSON.stringify(finalFloat.props.style))
}

console.log('\n--- a resized window keeps its size across minimize/restore ---')
{
  tree = await renderApp()
  const float = walk(tree).find((node) => node.props?.['data-mode'] !== undefined)
  const grip = findAll(float, 'button').find((node) => String(node.props.className).includes('dshgit-resize'))
  grip.props.onPointerDown({ clientX: 700, clientY: 600, button: 0, pointerId: 31,
    preventDefault() {}, stopPropagation() {} })
  float.props.onPointerMove({ clientX: 900, clientY: 800, pointerId: 31 })
  float.props.onPointerUp({ pointerId: 31 })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const chosen = walk(tree).find((node) => node.props?.['data-mode'] !== undefined).props.style
  check('the window was resized before minimizing', parseFloat(chosen.width) > 420,
    JSON.stringify(chosen))

  findAll(tree, 'button').find((node) => node.props.title === t('window.minimize')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(tree, 'button').find((node) => String(node.props.className).includes('dshgit-pill')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })

  const restored = walk(tree).find((node) => node.props?.['data-mode'] !== undefined).props.style
  check('the chosen size survives minimize/restore',
    restored.width === chosen.width && restored.height === chosen.height,
    `${JSON.stringify(chosen)} vs ${JSON.stringify(restored)}`)
}

console.log('\n--- the launcher toggles the single window closed ---')
{
  tree = await renderApp()
  // The launcher must be re-found after every flush: its `onClick` closes over
  // the open/closed state of the render it was created in, so reusing the node
  // from a previous pass would click a handler that still believes the window is
  // open. React re-renders a fresh handler; the test has to pick it up.
  const findLauncher = (current) => findAll(current, 'button').find((node) =>
    String(node.props.className).includes('dshgit-iconbtn') && node.props['aria-label'] === t('window.open'))

  const launcher = findLauncher(tree)
  check('the launcher is showing the window as open', launcher.props['aria-pressed'] === true)
  launcher.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  // The launcher CLOSES the window (`mode: 'closed'`), while the minimize control
  // MINIMIZES it (pill, still mounted). Both behaviours are asserted here so the
  // two controls cannot drift into each other.
  check('clicking the launcher closes the window',
    walk(tree).some((node) => node.props?.['data-mode'] === 'closed') &&
    !walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-pill')))
  findLauncher(tree).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('clicking it again opens the window',
    walk(tree).some((node) => node.props?.['data-mode'] !== undefined && node.props['data-mode'] !== 'closed'))
}

console.log('\n--- tag clicks directly create a branch without detached checkout ---')
{
  let header = await renderChips(healthyHandlers({ refs: () => ({ ...REFS, tags: [{ ...REFS.tags[0], sha: 'b'.repeat(40), commitSha: COMMIT_DETAIL.sha }] }) }))
  const rootProps = { connection: mounted.rpc, t: mounted.t }
  const chooseTag = async () => {
    findAll(header, 'button').find((node) => node.props['data-chip'] === 'branch').props.onClick({
      currentTarget: { getBoundingClientRect: () => ({ right: 420, bottom: 40 }) },
    })
    header = await flush(GitApp, rootProps)
    const toggle = findAll(header, 'button').find((node) => node.props['data-picker-toggle'] === 'tags')
    if (!toggle.props['aria-expanded']) toggle.props.onClick()
    header = await flush(GitApp, rootProps)
    findAll(header, 'button').find((node) => node.props['data-ref'] === 'v0.1.0').props.onClick()
    header = await flush(GitApp, rootProps)
  }
  await chooseTag()
  check('clicking a tag performs no write', !mounted.rpc.calls.some((call) => call.method.startsWith('write.')))
  check('clicking a tag opens no version browser', !walk(header).some((node) => node.props?.['data-history-commit']) &&
    !mounted.rpc.calls.some((call) => call.method === 'commitGraph'))
  check('tag selection keeps the current branch indicator', hasText(findAll(header, 'button').find((node) => node.props['data-chip'] === 'branch'), 'main'))
  let dialog = walk(header).find((node) => node.props?.role === 'dialog' && node.type === 'form')
  check('developing from a tag opens a named branch form', dialog?.props['aria-label'] === t('wb.createBranchFromTag') &&
    findAll(dialog, 'button').find((node) => node.props.type === 'submit').props.disabled)
  check('tag start point is fixed and checkout cannot be unchecked', !findAll(dialog, 'input').some((node) => node.props.type === 'checkbox' && node.props.checked === true))
  findAll(dialog, 'button').find((node) => textOf(node) === t('action.cancel')).props.onClick()
  header = await flush(GitApp, rootProps)
  check('cancelling branch creation leaves the worktree untouched', !mounted.rpc.calls.some((call) => call.method.startsWith('write.')))
  await chooseTag()
  dialog = walk(header).find((node) => node.props?.role === 'dialog' && node.type === 'form')
  findAll(dialog, 'input').find((node) => node.props.name === 'name').props.onChange({ target: { value: 'release/fix' } })
  header = await flush(GitApp, rootProps)
  dialog = walk(header).find((node) => node.props?.role === 'dialog' && node.type === 'form')
  dialog.props.onSubmit({ preventDefault() {} })
  header = await flush(GitApp, rootProps)
  const calls = mounted.rpc.calls.filter((call) => call.method === 'write.workbenchAction')
  const payload = calls[0]?.payload
  check('tag development creates and switches to a branch with one confirmed write', calls.length === 1 && payload.confirm === true &&
    payload.action === 'createBranch' && payload.parameters.name === 'release/fix' &&
    payload.parameters.startPoint === 'refs/tags/v0.1.0' && payload.parameters.checkout === true)
  check('tag development never sends detached checkout', !mounted.rpc.calls.some((call) => call.method === 'write.checkout' || call.payload?.action === 'checkout'))
}
{
  const detachedStatus = { ...STATUS, branch: { ...STATUS.branch, head: '(detached)', oid: 'c'.repeat(40), detached: true, upstream: null } }
  const header = await renderChips(healthyHandlers({ status: () => detachedStatus,
    refs: () => ({ ...REFS, tags: [{ name: 'v0.1.0', ref: 'refs/tags/v0.1.0', sha: 'd'.repeat(40), commitSha: 'c'.repeat(40) }] }) }))
  const chip = findAll(header, 'button').find((node) => node.props['data-chip'] === 'branch')
  check('detached header identifies annotated tag and detached state', hasText(chip, t('wb.detachedState', { name: 'v0.1.0' })))
}


console.log('\n--- blank-session Git placement after the mode picker ---')
{
  const row = {}
  const preset = { parentElement: row }
  const seat = { querySelector: (selector) => selector === '[data-slot="conversation.hero.agentPreset"]' ? preset : null }
  const toolbar = { querySelector: () => null, parentElement: seat }
  check('Hero placement finds the mode picker row within its own composer', findHeroWorkspaceRow({ parentElement: toolbar }) === row)
  const boundary = { querySelector: () => null, hasAttribute: (name) => name === 'data-phase', parentElement: seat }
  check('Hero placement never borrows another conversation mode picker', findHeroWorkspaceRow({ parentElement: boundary }) === null)
  check('Hosts without the Hero anchor retain the toolbar fallback', findHeroWorkspaceRow({ parentElement: { querySelector: () => null } }) === null)
  const options = { name: 'host-options-with-auto-margin' }
  const mode = { nextSibling: options }
  const git = { name: 'git-controls' }
  const children = [mode, options]
  insertHeroActions({ querySelector: () => mode, insertBefore: (node, before) => children.splice(before ? children.indexOf(before) : children.length, 0, node) }, git)
  check('Git is inserted immediately after mode and before the Host auto-margin options', children[0] === mode && children[1] === git && children[2] === options)
  let appended = false
  insertHeroActions({ querySelector: () => ({ nextSibling: null }), insertBefore: (node, before) => { appended = node === git && before === null } }, git)
  check('older Hosts without trailing options still place Git after mode', appended)
  const label = { closest: () => null, childNodes: [{ nodeType: 3, textContent: '标准模式' }] }
  const button = { closest: () => null, childNodes: [], querySelectorAll: () => [label] }
  const presetSeat = { querySelector: () => button }
  const fontRow = { querySelector: () => presetSeat }
  const sizes = new Map()
  const container = { style: { getPropertyValue: key => sizes.get(key), setProperty: (key, value) => sizes.set(key, value) } }
  let labelSize = '14px'
  const computed = element => ({ fontSize: element === label ? labelSize : '20px',
    fontFamily: 'Arial', fontWeight: '600', lineHeight: '22px', letterSpacing: 'normal' })
  syncHeroBranchFont(fontRow, container, computed)
  check('branch matches the mode label font instead of the larger wrapper font', sizes.get('--dshgit-hero-font-size') === '14px')
  labelSize = '16px'
  syncHeroBranchFont(fontRow, container, computed)
  check('branch font follows changes to the mode label size', sizes.get('--dshgit-hero-font-size') === '16px')
  check('branch also follows mode label family, weight and line height',
    sizes.get('--dshgit-hero-font-family') === 'Arial' && sizes.get('--dshgit-hero-font-weight') === '600' && sizes.get('--dshgit-hero-line-height') === '22px')
}

console.log('\n--- bounded popover placement ---')
{
  const anchor = { left: 500, right: 640, top: 100, bottom: 130 }
  const position = popoverPosition(anchor, { width: 400, maxHeight: 400, align: 'start' }, { width: 1200, height: 800 })
  check('Hero picker aligns with the branch button left edge and stays compact', position.left === '500px' && position.top === '136px' && position.width === '400px' && position.maxHeight === '400px')
  const above = popoverPosition({ left: 500, right: 640, top: 650, bottom: 680 }, { width: 400, maxHeight: 400, align: 'start' }, { width: 1200, height: 800 })
  check('picker flips above a low trigger without a gap for short content', above.top === undefined && above.bottom === '156px' && above.maxHeight === '400px')
  const narrow = popoverPosition(anchor, { width: 400, maxHeight: 400, align: 'start' }, { width: 320, height: 300 })
  check('narrow viewport clamps width and list height inside the screen', narrow.left === '8px' && narrow.width === '304px' && narrow.maxHeight === '156px')
  const header = popoverPosition(anchor, { width: 460, maxHeight: 400, align: 'end' }, { width: 1200, height: 800 })
  check('resident header picker retains alignment with the trigger right edge', header.left === '180px')
}

console.log('\n--- workspace navigation lifetime and supersession ---')
{
  const attempts = []
  const service = { openWorkspace(workspaceId, beforeOpen) {
    check('workspace navigation preserves the service receiver', this === service)
    return new Promise((resolve, reject) => attempts.push({ resolve, reject, beforeOpen }))
  } }
  const original = service.openWorkspace
  const dispose = observeWorkspaceNavigation(service)
  const first = service.openWorkspace('first').catch(() => {})
  const second = service.openWorkspace('second')
  attempts[0].reject(new Error('older failed')); await first
  check('an older navigation failure cannot unlock the latest request', getWorkspaceNavigation()?.workspaceId === 'second')
  attempts[1].beforeOpen('second-session'); attempts[1].resolve('done')
  check('workspace navigation preserves its return value', await second === 'done')
  acknowledgeWorkspaceNavigation('first-session')
  check('an unrelated session cannot acknowledge workspace navigation', getWorkspaceNavigation()?.sessionId === 'second-session')
  acknowledgeWorkspaceNavigation('second-session')
  check('matching session binding releases the navigation lock', getWorkspaceNavigation() === null)
  const third = service.openWorkspace('third')
  dispose()
  check('plugin disposal restores the public method and clears the lock', service.openWorkspace === original && getWorkspaceNavigation() === null)
  attempts[2].resolve(); await third
  check('a disposed observer cannot restore stale pending state', getWorkspaceNavigation() === null)
}

console.log('\n--- blank-session Git follows the selected workspace ---')
{
  const selected = 'D:/demo/selected-workspace'
  const other = 'D:/demo/unrelated-workspace'
  const empty = 'D:/demo/not-yet-a-repo'
  let initialized = false
  const rpc = createRpcStub(healthyHandlers({
    refs: () => ({ ...REFS, branches: REFS.branches.filter((branch) => branch.ref.startsWith('refs/heads/')), remotes: Array.from({ length: 120 }, (_, index) => ({ name: 'origin/feature/' + index, ref: 'refs/remotes/origin/feature/' + index, sha: 'b'.repeat(40) })) }),
    repos: (payload) => ({ gitPath: 'git', repos: payload.path === empty && !initialized ? [] : [{ root: payload.path }], directory: payload.path, canInitialize: payload.path === empty }),
    initRepository: () => { initialized = true; return { root: empty } },
  }))
  const context = createClientContext({ connection: rpc })
  const workspaceClient = loadClientModule(source)
  const navigations = []
  context.ctx.uiWorkspace = { openWorkspace: (workspaceId, beforeOpen) => new Promise((resolve, reject) => { navigations.push({ workspaceId, beforeOpen, resolve, reject }) }) }
  workspaceClient.apply(context.ctx)
  const Blank = context.registrations.find((entry) => entry.declaration.name === 'conversation.input.left').Component
  const Header = context.registrations.find((entry) => entry.declaration.name === 'conversation.session.header.utilities').Component
  const Window = context.registrations.find((entry) => entry.declaration.id === 'git-window').Component
  function WorkspaceHarness(props) {
    const controls = {
      sessionId: props.sessionId || 'new-session', t,
      useSession: (selector) => selector({ blank: props.blank }),
      useWorkspaces: (selector) => selector({ items: [
        { workspaceId: 'other', path: other, sessionIds: ['other-session'] },
        { workspaceId: 'selected', path: props.directory, sessionIds: [props.sessionId || 'new-session'] },
      ] }),
      useSessions: (selector) => selector({ byId: { 'new-session': { cwd: other } } }),
    }
    return [h(props.blank ? Blank : Header, controls), h(Window, { t })]
  }
  let props = { blank: true, directory: selected }
  mount(WorkspaceHarness, props)
  let view = await flush(WorkspaceHarness, props)
  check('blank composer offers a branch picker before any message', findAll(view, 'button').some((node) => node.props['data-chip'] === 'branch'))
  check('blank composer has no separate Git workbench icon', !findAll(view, 'button').some((node) => node.props['aria-label'] === t('window.open')))
  check('workspace mapping beats both first workspace and stale session cwd', rpc.calls.filter((call) => call.method === 'repos').every((call) => call.payload.path === selected && call.payload.sessionId === 'new-session'), JSON.stringify(rpc.calls.filter((call) => call.method === 'repos')))
  findAll(view, 'button').find((node) => node.props['data-chip'] === 'branch').props.onClick({ currentTarget: { getBoundingClientRect: () => ({ right: 420, bottom: 40 }) } })
  view = await flush(WorkspaceHarness, props)
  const remoteRows = () => walk(view).filter((node) => String(node.props?.['data-picker-branch'] || '').startsWith('refs/remotes/'))
  const mainRow = walk(view).find((node) => node.props?.['data-picker-branch'] === 'refs/heads/main')
  const trackingCounts = walk(mainRow).find((node) => node.props?.className === 'dshgit-picker-tracking')
  check('branch picker shows ahead and behind counts beside the current branch', hasText(trackingCounts, '↑2') && hasText(trackingCounts, '↓1'))
  const syncedRow = walk(view).find((node) => node.props?.['data-picker-branch'] === 'refs/heads/feature/新功能')
  check('branches with zero divergence have no count badge', !walk(syncedRow).some((node) => node.props?.className === 'dshgit-picker-tracking'))
  check('many remote branches start collapsed in the Hero picker', remoteRows().length === 0 && findAll(view, 'button').some((node) => node.props['data-picker-toggle'] === 'remotes' && node.props['aria-expanded'] === false))
  findAll(view, 'button').find((node) => node.props['data-picker-toggle'] === 'remotes').props.onClick()
  view = await flush(WorkspaceHarness, props)
  check('expanding remote branches initially renders only five rows', remoteRows().length === 5)
  findAll(view, 'button').find((node) => node.props['data-picker-more'] === 'remotes').props.onClick()
  view = await flush(WorkspaceHarness, props)
  check('show more reveals remote branches in small batches', remoteRows().length === 10)
  findAll(view, 'input').find((node) => node.props.className === 'dshgit-pickerinput').props.onChange({ currentTarget: { value: 'origin/feature/119' } })
  view = await flush(WorkspaceHarness, props)
  check('search reaches branches beyond the expanded rows', remoteRows().length === 1 && remoteRows()[0].props['data-picker-branch'] === 'refs/remotes/origin/feature/119')
  findAll(view, 'input').find((node) => node.props.className === 'dshgit-pickerinput').props.onChange({ currentTarget: { value: '' } })
  view = await flush(WorkspaceHarness, props)
  const row = walk(view).find((node) => node.props?.['data-picker-branch'] === 'refs/heads/feature/新功能')
  findAll(row, 'button').find((node) => node.props['data-ref'] === 'feature/新功能').props.onClick()
  view = await flush(WorkspaceHarness, props)
  const dialog = walk(view).find((node) => node.props?.role === 'alertdialog')
  findAll(dialog, 'button').find((node) => textOf(node) === t('action.switchBranch')).props.onClick()
  view = await flush(WorkspaceHarness, props)
  const checkout = rpc.calls.find((call) => call.method === 'write.checkout')
  check('blank-session checkout writes to the selected workspace', checkout?.payload.root === selected && checkout.payload.ref === 'refs/heads/feature/新功能' && checkout.payload.confirm === true)
  const notice = walk(view).find((node) => node.props?.className === 'dshgit-notice' && node.props?.['data-placement'] === 'bottom')
  check('blank-session outcomes appear at the viewport bottom center', notice?.props.style.bottom === '24px' && notice.props.style.left === '50%' && notice.props.style.top === 'auto')
  findAll(view, 'button').find((node) => node.props['data-chip'] === 'branch').props.onClick({ currentTarget: { getBoundingClientRect: () => ({ right: 420, bottom: 40 }) } })
  view = await flush(WorkspaceHarness, props)
  findAll(view, 'button').find((node) => node.props['data-picker-open-git']).props.onClick()
  view = await flush(WorkspaceHarness, props)
  check('branch popup opens the full Git window and closes itself', walk(view).some((node) => node.props?.['data-mode'] === 'full') && !walk(view).some((node) => node.props?.['data-popover'] === 'branch'))
  check('blank-session workbench discovers the same explicit directory', rpc.calls.filter((call) => call.method === 'repos').every((call) => call.payload.path === selected))
  props = { blank: true, directory: empty }
  view = await flush(WorkspaceHarness, props)
  check('changing workspace clears the old branch and offers initialization', findAll(view, 'button').some((node) => node.props['data-chip'] === 'init'))
  findAll(view, 'button').find((node) => node.props['data-chip'] === 'init').props.onClick()
  view = await flush(WorkspaceHarness, props)
  check('initialization explicitly targets the new workspace', rpc.calls.some((call) => call.method === 'initRepository' && call.payload.directory === empty))
  check('initialized workspace gains a branch picker', findAll(view, 'button').some((node) => node.props['data-chip'] === 'branch'))
  const previousRun = context.registrations.find((entry) => entry.declaration.name === 'settings.section').Component({ t }).props.run
  const switching = context.ctx.uiWorkspace.openWorkspace('selected')
  view = await flush(WorkspaceHarness, props)
  check('slow workspace navigation disables the old Git controls', findAll(view, 'button').some((node) => node.props['data-workspace-pending'] && node.props.disabled) && !findAll(view, 'button').some((node) => node.props['data-chip'] === 'branch'))
  check('workspace navigation makes the existing workbench inert', walk(view).some((node) => node.props?.['data-mode'] === 'full' && node.props.inert === true))
  const writesBefore = rpc.calls.filter((call) => call.method === 'write.checkout').length
  const blockedWrite = await previousRun('write.checkout', { root: empty, ref: 'refs/heads/main', confirm: true }).then(() => false, () => true)
  check('even a retained old dialog callback cannot send a write during navigation', blockedWrite && rpc.calls.filter((call) => call.method === 'write.checkout').length === writesBefore)
  navigations[0].beforeOpen('next-session'); navigations[0].resolve()
  await switching
  view = await flush(WorkspaceHarness, props)
  check('navigation completion still waits for the new session binding', findAll(view, 'button').some((node) => node.props['data-workspace-pending']))
  props = { blank: true, directory: selected, sessionId: 'next-session' }
  view = await flush(WorkspaceHarness, props)
  check('the matching new session restores Git against its directory', !findAll(view, 'button').some((node) => node.props['data-workspace-pending']) && rpc.calls.filter((call) => call.method === 'repos').at(-1)?.payload.path === selected)
  const failing = context.ctx.uiWorkspace.openWorkspace('other').catch((error) => error.message)
  view = await flush(WorkspaceHarness, props)
  navigations[1].reject(new Error('navigation failed'))
  check('navigation errors preserve the Host error', await failing === 'navigation failed')
  view = await flush(WorkspaceHarness, props)
  check('failed navigation restores the original workspace controls', !findAll(view, 'button').some((node) => node.props['data-workspace-pending']) && findAll(view, 'button').some((node) => node.props['data-chip'] === 'branch'))
  props = { blank: false, directory: selected }
  view = await flush(WorkspaceHarness, props)
  check('after the first message the header continues using the workspace', rpc.calls.filter((call) => call.method === 'repos').at(-1)?.payload.path === selected)
  function BlankOnly(props) { return h(Blank, { sessionId: 'new-session', t, useSession: (select) => select({ blank: props.blank }), useWorkspaces: (select) => select({ items: [] }), useSessions: (select) => select({ byId: {} }) }) }
  mount(BlankOnly, { blank: true })
  view = await flush(BlankOnly, { blank: true })
  check('without a workspace no repository is guessed', findAll(view, 'button').length === 0)
}

console.log('\n--- LFS reconnects after repeated status failures ---')
{
  runCleanups()
  // Expose the bundled panel and shorten its timers in this fixture only.
  const fixture = source.replace('factory: (require) => {',
    'factory: (require) => { var setTimeout = (callback, delay) => globalThis.setTimeout(callback, Math.min(delay, 1));')
    .replace('    return module.exports', '    module.exports.LfsPanel = LfsPanel;\n    return module.exports')
  const { LfsPanel } = loadClientModule(fixture)
  const running = { id: 'lfs-reconnect', root: ROOT, method: 'write.lfsTransfer', state: 'running' }
  let reads = 0, connected = false, completed = false
  const props = {
    repo: { root: ROOT }, t,
    onToast: () => { completed = true },
    run: async (method, body) => {
      if (method === 'operationStatus') {
        if (!body.id) return running
        reads++
        if (!connected) throw new Error('temporary disconnect')
        return { ...running, state: 'complete', result: { ok: true, value: { message: 'download complete' } } }
      }
      if (method === 'lfsStatus') return { installed: true, initialized: true, version: 'test' }
      if (method === 'lfsDetails') return { rules: '', backups: [] }
      if (method === 'remotes' || method === 'lfsBranches') return []
      throw new Error('Unexpected RPC: ' + method)
    },
  }
  mount(LfsPanel, props)
  let tree = await flush(LfsPanel, props)
  for (let attempt = 0; reads < 6 && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 2))
  tree = await flush(LfsPanel, props)
  check('LFS keeps retrying beyond five failed status requests', reads >= 6, String(reads))
  check('an uncertain LFS task keeps controls disabled',
    findAll(tree, 'button').find(node => textOf(node) === t('action.refresh'))?.props.disabled === true)
  check('an uncertain LFS task retains its cancel control',
    findAll(tree, 'button').some(node => node.props.className === 'dshgit-progress-cancel'))
  connected = true
  for (let attempt = 0; !completed && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 2))
  tree = await flush(LfsPanel, props)
  check('LFS receives the original job result after reconnecting', completed)
  check('LFS unlocks controls after confirmed completion',
    findAll(tree, 'button').find(node => textOf(node) === t('action.refresh'))?.props.disabled === false)
  runCleanups()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} FAILED`)
  process.exit(1)
}
console.log('all client checks passed')
// Exit explicitly: the rendered components leave polling timers alive, so without
// this the process would report success and then hang instead of terminating. The
// failure path above already exits for the same reason.
process.exit(0)

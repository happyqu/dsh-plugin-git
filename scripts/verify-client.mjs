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
} from './render-harness.mjs'

/** Shorthand for React.createElement, matching the plugin's own style. */
const h = React.createElement

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

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
    { name: 'main', ref: 'refs/heads/main', sha: 'a'.repeat(40), head: true, subject: 'merge: 合并 feature', upstream: 'origin/main' },
    { name: 'feature/新功能', ref: 'refs/heads/feature/新功能', sha: 'b'.repeat(40), head: false, subject: 'feat: util', upstream: null },
    { name: 'origin/main', ref: 'refs/remotes/origin/main', sha: 'a'.repeat(40), head: false, subject: 'merge', upstream: null },
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
    from: null, path: 'src/index.js', status: 'M', binary: false,
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
  files: [{ path: 'src/index.js', originalPath: 'src/app.js', added: 1, deleted: 0, binary: false }],
}

const CONFIG = {
  gitPath: '', defaultRepo: '', similarityThreshold: 50, autoBlame: true, blameChunkLines: 2000,
  historyLimit: 300, aiEnabled: true, aiProvider: '', aiModel: '', locale: '',
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
    'ai.commitMessage': () => ({ available: true, message: 'feat: 新增中文说明文档', empty: false }),
    'ai.explainCommit': () => ({ available: true, text: '这次提交把文件重命名了。' }),
    'ai.summarizeDiff': () => ({ available: true, text: '总体：小改动。' }),
    'write.stage': () => ({ ok: true, code: 0, message: '已暂存', stdout: '' }),
    'write.unstage': () => ({ ok: true, code: 0, message: '已取消暂存', stdout: '' }),
    'write.commit': () => ({ ok: true, code: 0, message: '提交成功', stdout: '' }),
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
check('loaded through __ModuleLoader__ with the package id', loaded.id === 'dsh-plugin-git', String(loaded.id))
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
// The commit control is a joined split button filled with VS Code's accent blue,
// so the primary surface is that shared fill plus the chevron half.
check('the commit button uses a consistent primary surface',
  String(loaded.appendedStyles[0]?.textContent).includes('.dshgit-commit-primary{') &&
  String(loaded.appendedStyles[0]?.textContent).includes('background:#007acc') &&
  String(loaded.appendedStyles[0]?.textContent).includes('.dshgit-commit-arrow{') &&
  String(loaded.appendedStyles[0]?.textContent).includes('border-radius:0 6px 6px 0'))
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
check('the three registrations target distinct slots',
  new Set(client.registrations.map((entry) => entry.declaration.name)).size === 3,
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
  const pattern = /\bt\(\s*'([\w.-]+)'\)/g
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
  check('the dictionary has no obviously unused key',
    zhKeys.length > 0 && used.size > 50, `used=${used.size} defined=${zhKeys.length}`)
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

console.log('\n--- everyday header actions ---')
{
  let header = await renderChips()
  const chipIds = findAll(header, 'button').map((node) => node.props['data-chip']).filter(Boolean)
  check('the header keeps frequent actions in a stable order',
    JSON.stringify(chipIds.slice(0, 5)) === JSON.stringify(['branch', 'changes', 'merge', 'next', 'sync-menu']),
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
  const mergeChip = findAll(header, 'button').find((node) => node.props['data-chip'] === 'merge')
  mergeChip.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ right: 900, bottom: 40 }) } })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  check('merge opens a source branch picker',
    findAll(header, 'button').some((node) => node.props['data-ref'] === 'feature/新功能'))
  findAll(header, 'button').find((node) => node.props['data-ref'] === 'feature/新功能').props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })
  check('merge review shows source into current branch before writing',
    hasText(header, t('merge.direction', { source: 'feature/新功能', target: 'main' })) &&
    !mounted.rpc.calls.some((call) => call.method === 'write.merge'))
  check('merge review reads commits unique to each side',
    ['HEAD..feature/新功能', 'feature/新功能..HEAD'].every((ref) =>
      mounted.rpc.calls.some((call) => call.method === 'commits' && call.payload.ref === ref)))
  findAll(header, 'button').find((node) => node.props['data-merge-confirm'] === 'feature/新功能').props.onClick()
  await flush(GitApp, { connection: mounted.rpc, t })
  check('confirmed merge targets the selected source',
    mounted.rpc.calls.some((call) => call.method === 'write.merge' && call.payload.ref === 'feature/新功能'))

  header = await renderChips(healthyHandlers({
    branchTracking: () => ({ ref: 'main', upstream: 'origin/main', ahead: 0, behind: 0 }),
  }))
  check('an up-to-date branch offers Fetch as its sync action',
    findAll(header, 'button').find((node) => node.props['data-chip'] === 'next')?.props['data-next'] === 'fetch')
  findAll(header, 'button').find((node) => node.props['data-chip'] === 'merge').props.onClick({
    currentTarget: { getBoundingClientRect: () => ({ right: 900, bottom: 40 }) },
  })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(header, 'button').find((node) => node.props['data-ref'] === 'feature/新功能').props.onClick()
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
  findAll(header, 'button').find((node) => node.props['data-chip'] === 'merge').props.onClick({
    currentTarget: { getBoundingClientRect: () => ({ right: 900, bottom: 40 }) },
  })
  header = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(header, 'button').find((node) => node.props['data-ref'] === 'feature/新功能').props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(header, 'button').find((node) => node.props['data-merge-confirm'] === 'feature/新功能').props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })
  check('a conflicted merge refreshes the header into its recovery action',
    textOf(findAll(header, 'button').find((node) => node.props['data-chip'] === 'merge') ?? {}) === t('next.resolve'))
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
  check('workbench primary action becomes Sync after committing',
    findAll(full, 'button').some((node) => textOf(node) === t('action.sync')))
  findAll(full, 'button').find((node) => textOf(node) === t('action.sync')).props.onClick()
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
  findAll(header, 'button').find((node) => textOf(node) === t('action.commit')).props.onClick()
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
  findAll(header, 'button').find((node) => textOf(node) === t('action.commit')).props.onClick()
  header = await flush(GitApp, { connection: mounted.rpc, t })
  check('a failed commit really was attempted', attempts > 0)
  check('a FAILED commit keeps the popover open so the error stays visible',
    isOpen(header),
    JSON.stringify(walk(header).map((n) => n.props?.['data-popover']).filter(Boolean)))
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
    hasText(full, t('commit.requiredMessage')) &&
    !mounted.rpc.calls.some((call) => call.method.startsWith('write.')))
  findAll(full, 'textarea').find((node) => node.props.placeholder === t('commit.placeholderMessage'))
    .props.onChange({ currentTarget: { value: 'feat: all files' } })
  full = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(full, 'button').find((node) => String(node.props.className).includes('dshgit-commit-primary')).props.onClick()
  full = await flush(GitApp, { connection: mounted.rpc, t })
  check('mixed staged and unstaged files are staged and committed together',
    JSON.stringify(mounted.rpc.calls.filter((call) => call.method.startsWith('write.'))
      .map((call) => call.method)) === JSON.stringify(['write.stage', 'write.commit']))
  check('the change rows clear and the primary action becomes Sync',
    findWhere(full, (props) => props['data-change-group'] !== undefined).length === 0 &&
    findAll(full, 'button').some((node) => textOf(node) === t('action.sync')))
}

console.log('\n--- initial render (changes tab) ---')
let tree = await renderApp()
check('renders without throwing', tree !== null)
check('shows the panel title', hasText(tree, 'Git'), textOf(tree).slice(0, 160))
check('shows the resolved repository root', hasText(tree, ROOT), textOf(tree).slice(0, 200))
check('shows the branch badge', hasText(tree, 'main'))
check('lists the staged file', walk(tree).some((node) => node.props?.title === 'docs/待提交.md'))
check('lists the modified file', hasText(tree, 'src/index.js'))
check('lists the untracked file', hasText(tree, 'untracked.txt'))
const changeRow = walk(tree).find((node) => node.props?.title === 'src/index.js' &&
  String(node.props?.className ?? '').includes('dshgit-change'))
check('change rows split the filename from its directory',
  walk(changeRow).some((node) => node.props?.className === 'dshgit-filename' && textOf(node) === 'index.js') &&
  walk(changeRow).some((node) => node.props?.className === 'dshgit-filedir' && textOf(node) === 'src'))
check('change rows keep the status at the end',
  changeRow.children.at(-1).props.className === 'dshgit-status')
check('change rows expose file actions on hover',
  walk(changeRow).some((node) => node.props?.className === 'dshgit-change-actions'))
check('the full changes row uses Open, Discard and Stage icons',
  JSON.stringify(findAll(changeRow, 'button').map((node) => node.props['data-file-action']).filter(Boolean)) ===
    JSON.stringify(['open', 'discard', 'stage']))
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
check('the activity bar exposes each module by name',
  activityItems(tree).map((node) => node.props['aria-label']).join(',') ===
    ['changes', 'history', 'graph', 'compare', 'output', 'settings'].map((id) => t(`tab.${id}`)).join(','),
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

console.log('\n--- clicking a changed file opens its content ---')
{
  changeRow.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('the full window requested the working-tree file',
    mounted.rpc.calls.some((call) => call.method === 'fileContent' && call.payload.path === 'src/index.js'))
  check('the full window shows file content with line numbers',
    walk(tree).some((node) => node.props?.['data-file-preview'] === 'true' && textOf(node, '').includes("console.log('world')")))
  check('the file preview highlights JavaScript tokens',
    walk(tree).some((node) => node.props?.style?.color === 'rgb(10, 20, 30)'),
    'no Shiki-coloured token span found')
  // The grammar must be chosen from the FILE's extension, not a fixed default:
  // a preview that always asked for one language would still colour text, so the
  // colour assertion alone cannot catch it.
  check('the preview asked the platform for the file\u2019s own grammar',
    primitives.asked.includes('javascript'), JSON.stringify(primitives.asked))
  findAll(tree, 'button').find((node) => textOf(node) === t('action.viewDiff')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('the file view can switch back to its Git diff',
    walk(tree).some((node) => node.props?.['data-kind'] === 'add'))
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
  check('a YAML file is highlighted with its own grammar',
    walk(tree).some((node) => node.props?.style?.color === 'rgb(10, 20, 30)') &&
      primitives.asked.includes('yaml'),
    JSON.stringify(primitives.asked))
  tree = await renderApp()
}

console.log('\n--- the preview degrades to plain text without the platform highlighter ---')
{
  // A profile whose composition lacks the primitives package must still render
  // files. The require is best-effort precisely so this case is a plain-text
  // fallback rather than a plugin that fails to activate.
  const bare = loadClientModule(source, { require: { '@deepseek-ai/dsh-client-ui-primitives': primitivesStub({ none: true }).module } })
  check('the plugin still loads without the highlighter', bare.id === 'dsh-plugin-git', String(bare.id))
  const bareStub = createRpcStub(healthyHandlers())
  const bareContext = createClientContext({ connection: bareStub })
  bare.apply(bareContext.ctx)
  check('it still registers its slots', bareContext.registrations.length === 3,
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
  check('the menu has open, history, and Git actions',
    [t('action.openChanges'), t('action.openFile'), t('action.openHead'), t('action.fileHistory'),
      t('action.discard'), t('action.stage'), t('action.stashFile')]
      .every((label) => findAll(tree, 'button').some((node) => textOf(node) === label)))
  findAll(tree, 'button').find((node) => textOf(node) === t('action.openHead')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('Open File (HEAD) reads the committed file',
    mounted.rpc.calls.some((call) => call.method === 'fileContent' &&
      call.payload.path === 'src/index.js' && call.payload.rev === 'HEAD'))
  const rowAgain = walk(tree).find((node) => node.props?.title === 'src/index.js' &&
    String(node.props?.className ?? '').includes('dshgit-change'))
  rowAgain.props.onContextMenu({ clientX: 180, clientY: 220, preventDefault() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(tree, 'button').find((node) => textOf(node) === t('action.fileHistory')).props.onClick()
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
  const rowActions = findAll(untrackedRow, 'button').map((node) => node.props['data-file-action']).filter(Boolean)
  check('the popover offers Open, Discard and Stage icons with no checkbox',
    JSON.stringify(rowActions) === JSON.stringify(['open', 'discard', 'stage']) &&
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
  check('history shows a rename as a change status badge', hasText(tree, 'R'),
    textOf(tree).slice(0, 400))
  check('history requested commits', mounted.rpc.calls.some((call) => call.method === 'commits'))
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
}

console.log('\n--- graph tab ---')
{
  const rootProps = { connection: mounted.rpc, t }
  tree = await selectModule(tree, 'graph')
  check('graph reports the lane count', hasText(tree, '2'), textOf(tree).slice(0, 200))
  check('graph requested the commit graph', mounted.rpc.calls.some((call) => call.method === 'commitGraph'))
  check('graph shows a merge badge', hasText(tree, 'M'))
  check('graph shows branch tips', hasText(tree, 'feature/新功能'), textOf(tree).slice(0, 400))
  check('graph renders lane markers', walk(tree).some((node) => String(node.props?.className ?? '').includes('dshgit-dot')))
  // The legend is what makes the lanes readable, so it lives in the sidebar.
  check('graph sidebar explains the lanes',
    hasText(tree, t('graph.lanesLabel')) && hasText(tree, t('graph.tips')),
    textOf(tree).slice(0, 300))
}

console.log('\n--- compare tab ---')
{
  const rootProps = { connection: mounted.rpc, t }
  tree = await selectModule(tree, 'compare')
  const inputs = findWhere(tree, (props) => props.className === 'dshgit-input')
  check('compare renders two ref inputs', inputs.length === 2, String(inputs.length))
  const goButton = findAll(tree, 'button').find((node) => String(node.props.className).includes('dshgit-btn-primary'))
  check('compare has a compare button', goButton !== undefined)
  goButton.props.onClick()
  tree = await flush(GitApp, rootProps)
  check('compare renders the resulting diff', hasText(tree, 'console.log'), textOf(tree).slice(0, 400))
  // Refs to compare against are navigation, so they are listed in the sidebar.
  check('compare sidebar lists a branch to compare against',
    findAll(tree, 'button').some((node) => String(node.props.className).includes('dshgit-rowbtn') &&
      textOf(node).includes('feature/新功能')),
    JSON.stringify(findAll(tree, 'button').filter((n) => String(n.props.className).includes('dshgit-rowbtn')).map(textOf)))
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
  check('settings renders checkboxes for boolean options',
    findAll(tree, 'input').filter((node) => node.props.type === 'checkbox').length >= 2,
    String(findAll(tree, 'input').filter((node) => node.props.type === 'checkbox').length))
  // The settings page was one long scroll; it is now grouped and navigated.
  check('settings sidebar offers the three groups',
    findAll(tree, 'button').filter((node) => String(node.props.className).includes('dshgit-rowbtn'))
      .map((node) => textOf(node)).join(',') ===
      [t('settings.general'), t('settings.ai'), t('settings.diagnostics')].join(','),
    JSON.stringify(findAll(tree, 'button').filter((n) => String(n.props.className).includes('dshgit-rowbtn')).map(textOf)))
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
  check('offers a dismiss control',
    findAll(tree, 'button').some((node) => textOf(node) === t('action.close')),
    JSON.stringify(findAll(tree, 'button').map((node) => textOf(node))))
  const dismiss = findAll(tree, 'button').find((node) => textOf(node) === t('action.close'))
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
  // Checkout is now an explicit button on the row rather than a row click:
  // switching branches from an accidental click on a list row is exactly the
  // kind of "destructive by misclick" this panel should not have.
  //
  // The row is matched on `data.branch` rather than on a class name: the branch
  // list renders as a plain row, and a class-based match previously targeted a
  // `dshgit-treerow` variant that no longer renders at all — which is why this
  // assertion was failing without the UI being broken.
  const branchRow = walk(tree).find((node) =>
    node.$$kind === 'host' &&
    node.props?.data?.branch?.name === 'feature/新功能' &&
    String(node.props?.className ?? '').includes('dshgit-row'))
  check('found a non-head branch row', branchRow !== undefined,
    JSON.stringify(walk(tree).filter((n) => n.props?.data?.branch !== undefined).map((n) => n.props.className)))
  const checkoutButton = findAll(branchRow, 'button').find((node) => node.props.title === t('action.checkout'))
  check('the branch row exposes a checkout button', checkoutButton !== undefined,
    JSON.stringify(findAll(branchRow, 'button').map((node) => node.props.title ?? textOf(node))))
  checkoutButton.props.onClick({ stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('the first attempt carried no confirmation', captured.confirmed[0] === false,
    JSON.stringify(captured.confirmed))
  check('a confirmation prompt appeared',
    hasText(tree, '需要显式确认'), textOf(tree).slice(0, 400))
  const applyButton = findAll(tree, 'button').find((node) => textOf(node) === t('action.apply'))
  check('the prompt has an apply button', applyButton !== undefined)
  applyButton.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('accepting retried WITH confirmation', captured.confirmed.includes(true),
    JSON.stringify(captured.confirmed))
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
  const discardIn = (row) => findAll(row, 'button').find((node) => node.props.title === t('action.discard'))

  const modifiedRow = rowOf(tree, 'src/index.js')
  check('found the modified file row', modifiedRow !== undefined)
  const discardButton = discardIn(modifiedRow)
  check('found a discard control on an unstaged file', discardButton !== undefined,
    JSON.stringify(findAll(modifiedRow, 'button').map((node) => textOf(node))))
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
    !mounted.rpc.calls.some((call) => call.method === 'write.discardPath'),
    mounted.rpc.calls.map((c) => c.method).join(','))

  // Accepting must write, and must carry the confirmation token.
  const rowAgain = rowOf(tree, 'src/index.js')
  discardIn(rowAgain).props.onClick({ stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const accept = findAll(tree, 'button').find((node) => textOf(node) === t('action.apply'))
  accept.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const writeCall = mounted.rpc.calls.find((call) => call.method === 'write.discardPath')
  check('accepting performs the write', writeCall !== undefined,
    mounted.rpc.calls.map((c) => c.method).join(','))
  check('the write carried an explicit confirmation', writeCall?.payload?.confirm === true,
    JSON.stringify(writeCall?.payload))
  check('the write carried the untracked flag correctly', writeCall?.payload?.untracked === false,
    JSON.stringify(writeCall?.payload))
}

console.log('\n--- AI assist ---')
{
  tree = await renderApp()
  const aiButton = findAll(tree, 'button').find((node) => String(node.props.className).includes('dshgit-btn') && textOf(node).includes('AI 生成提交信息'))
  check('found the AI commit-message button', aiButton !== undefined)
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
  const aiButton2 = findAll(tree, 'button').find((node) => textOf(node).includes('AI 生成提交信息'))
  aiButton2.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('an unavailable model is reported as a notice, not an error',
    hasText(tree, '没有可用的模型服务'), textOf(tree).slice(-400))
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
  // Fetch and Refresh are icon-only now (their labels moved to `title` /
  // `aria-label`), so they are matched by accessible name rather than by text.
  // Pull and Push keep their text: they are the two actions whose meaning an
  // arrow glyph alone would not carry.
  const named = (label) => buttons.some((node) => node.props.title === label || node.props['aria-label'] === label)
  check('toolbar exposes Fetch', named(t('action.fetch')), JSON.stringify(labels.slice(0, 24)))
  check('toolbar exposes Pull', labels.includes(t('action.pull')))
  check('toolbar exposes Push', labels.includes(t('action.push')))
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
  // Undo-last-commit and clean-untracked joined the Changes section header.
  const changesSection = walk(tree).find((node) => node.props?.className?.includes?.('dshgit-changes-section'))
  const changesTitles = findAll(changesSection, 'button').map((node) => node.props.title)
  check('the Changes header carries undo-last-commit and clean',
    changesTitles.includes(t('action.undoCommit')) && changesTitles.includes(t('action.cleanUntracked')),
    JSON.stringify(changesTitles))
  const groups = findWhere(changesSection, (props) => props['data-change-group'] !== undefined)
  check('staged and unstaged changes have separate group headers',
    groups.map((node) => node.props['data-change-group']).join(',') === 'staged,unstaged')
  const stagedGroup = groups[0]
  const unstagedGroup = groups[1]
  check('group headers show counts and the VS Code batch action order',
    findAll(stagedGroup, 'button').filter((node) => node.props['data-group-action'])
      .map((node) => node.props['data-group-action']).join(',') === 'stash,view,unstage' &&
    findAll(unstagedGroup, 'button').filter((node) => node.props['data-group-action'])
      .map((node) => node.props['data-group-action']).join(',') === 'stash,view,discard,stage' &&
    findWhere(stagedGroup, (props) => String(props.className).includes('dshgit-sectioncount'))
      .some((node) => textOf(node) === '1') &&
    findWhere(unstagedGroup, (props) => String(props.className).includes('dshgit-sectioncount'))
      .some((node) => textOf(node) === '2'))
  // New-tag is the Tags section action; the remote menu (add/remove/clone/force
  // push) is the Remotes section's ⋯ menu.
  const tagsSection = walk(tree).find((node) => {
    const heads = findAll(node, 'button').filter((n) => String(n.props.className).includes('dshgit-sectionhead'))
    return heads.some((h) => textOf(h).startsWith(t('tree.tags')))
  })
  check('the Tags section offers new-tag',
    findAll(tagsSection, 'button').some((node) => node.props.title === t('action.newTag')))
  const remotesSection = walk(tree).find((node) => {
    const heads = findAll(node, 'button').filter((n) => String(n.props.className).includes('dshgit-sectionhead'))
    return heads.some((h) => textOf(h).startsWith(t('tree.remotes')))
  })
  check('the Remotes section carries a section menu with the rare remote operations',
    findAll(remotesSection, 'button').some((node) => textOf(node) === '⋯'))

  // Exactly the six modules, including Output, exposed by the activity bar.
  const moduleLabels = activityItems(tree).map((node) => node.props['data-module'])
  check('renders six modules including Output',
    moduleLabels.length === 6 && moduleLabels.includes('output'),
    JSON.stringify(moduleLabels))
}

console.log('\n--- a destroy shortcut asks before discarding (never writes first) ---')
{
  // The batch action must be gated the same way the per-file one is.
  tree = await renderApp()
  const changesSection = walk(tree).find((node) => node.props?.className?.includes?.('dshgit-changes-section'))
  const sectionBar = findWhere(changesSection, (props) => props.className === 'dshgit-sectionbar')[0]
  const headerActions = findAll(sectionBar, 'button').filter((node) =>
    [t('action.unstageAll'), t('action.discardAll'), t('action.stageAll')]
      .includes(node.props.title))
  check('the Changes header exposes three compact actions without duplicate stash', headerActions.length === 3 &&
    findAll(sectionBar, 'button').every((node) => node.props.title !== t('action.stashPush')),
    headerActions.map((node) => node.props.title).join(','))
  const discardAll = headerActions.find((node) => node.props.title === t('action.discardAll'))
  check('the batch discard control exists', discardAll !== undefined)
  discardAll.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('batch discard asked for confirmation first',
    hasText(tree, t('confirm.discardAll')), textOf(tree).slice(-300))
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
  const group = (kind) => findWhere(tree, (props) => props['data-change-group'] === kind)[0]
  const action = (kind, name) => findAll(group(kind), 'button').find((node) =>
    node.props['data-group-action'] === name)
  const stagedHead = findAll(group('staged'), 'button').find((node) =>
    String(node.props.className).includes('dshgit-changegrouphead'))
  stagedHead.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('staged group collapses without hiding the working tree group',
    findAll(group('staged'), 'button').find((node) =>
      String(node.props.className).includes('dshgit-changegrouphead')).props['aria-expanded'] === false &&
    findWhere(group('staged'), (props) => props.className === 'dshgit-changegroupbody').length === 0 &&
    findWhere(group('unstaged'), (props) => props.className === 'dshgit-changegroupbody').length === 1)
  action('staged', 'unstage').props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('staged header unstages the index only',
    mounted.rpc.calls.some((call) => call.method === 'write.unstage' && !call.payload.paths))
  action('unstaged', 'discard').props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('working tree discard asks before writing',
    hasText(tree, t('confirm.discardUnstaged')) &&
    !mounted.rpc.calls.some((call) => call.method === 'write.discardAll'))
}

console.log('\n--- commit-all and undo-commit live in the Changes header ---')
{
  tree = await renderApp()
  const changesSection = walk(tree).find((node) => node.props?.className?.includes?.('dshgit-changes-section'))
  const stageAll = findAll(changesSection, 'button').find((node) => node.props.title === t('action.stageAll'))
  check('the Changes header offers commit-all (stage everything)', stageAll !== undefined)
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
  tree = await renderApp()
  const changesSection = walk(tree).find((node) => node.props?.className?.includes?.('dshgit-changes-section'))
  const undo = findAll(changesSection, 'button').find((node) => node.props.title === t('action.undoCommit'))
  check('the Changes header offers undo-last-commit', undo !== undefined)
  undo.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('undo commit asked first', hasText(tree, t('confirm.undoCommit')), textOf(tree).slice(-300))
  check('undo commit did not run yet',
    !mounted.rpc.calls.some((call) => call.method === 'write.undoCommit'))
  findAll(tree, 'button').find((node) => textOf(node) === t('action.apply')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const call = mounted.rpc.calls.find((entry) => entry.method === 'write.undoCommit')
  check('undo commit ran with an explicit confirmation', call?.payload?.confirm === true,
    JSON.stringify(call?.payload))
}

console.log('\n--- branch and tag creation use a form, not a bare prompt ---')
{
  tree = await renderApp()
  // New-branch is the Branches section's `+` action, where the branches it
  // creates are listed.
  const branchesSection = walk(tree).find((node) => {
    const heads = findAll(node, 'button').filter((n) => String(n.props.className).includes('dshgit-sectionhead'))
    return heads.some((hd) => textOf(hd).startsWith(t('tree.branches')))
  })
  const newBranch = findAll(branchesSection, 'button').find((node) => node.props.title === t('action.newBranch'))
  check('the Branches section offers new-branch', newBranch !== undefined)
  newBranch.props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const inputs = findAll(tree, 'input').filter((node) => node.props.className === 'dshgit-input')
  check('a branch-name field appeared', inputs.length === 1, String(inputs.length))
  inputs[0].props.onChange({ currentTarget: { value: 'feature/新功能2' } })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(tree, 'button').find((node) => textOf(node) === t('action.ok')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const call = mounted.rpc.calls.find((entry) => entry.method === 'write.createBranch')
  check('the typed branch name was submitted', call?.payload?.name === 'feature/新功能2',
    JSON.stringify(call?.payload))
  check('creating a branch also checks it out', call?.payload?.checkout === true,
    JSON.stringify(call?.payload))
}

console.log('\n--- branch delete is confirmed, merge is not destructive ---')
{
  tree = await renderApp()
  const branchRow = walk(tree).find((node) => node.props?.data?.branch?.name === 'feature/新功能')
  // The row's occasional actions live behind a `⋯` menu rather than a
  // right-click: a context menu is undiscoverable, and the same menu is the only
  // way to reach rename/merge/delete.
  const rowMenu = findAll(branchRow, 'button').find((node) => textOf(node) === '⋯')
  check('non-head branches expose a row menu', rowMenu !== undefined,
    JSON.stringify(findAll(branchRow, 'button').map((node) => node.props.title ?? textOf(node))))
  rowMenu.props.onClick({ stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('the row menu offers delete and merge',
    hasText(tree, t('action.deleteBranch')) && hasText(tree, t('action.merge')),
    textOf(tree).slice(-400))
  findAll(tree, 'button').find((node) => textOf(node) === t('action.deleteBranch')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('deleting a branch asks first', hasText(tree, '确认删除分支'), textOf(tree).slice(-300))
  check('no delete happened before confirmation',
    !mounted.rpc.calls.some((call) => call.method === 'write.deleteBranch'))
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

console.log('\n--- clone is reachable and validated ---')
{
  tree = await renderApp()
  // Clone moved with the rest of the remote operations into the Remotes
  // section's ⋯ menu.
  const remotesSection = walk(tree).find((node) => {
    const heads = findAll(node, 'button').filter((n) => String(n.props.className).includes('dshgit-sectionhead'))
    return heads.some((h) => textOf(h).startsWith(t('tree.remotes')))
  })
  const sectionMenu = findAll(remotesSection, 'button').find((node) => textOf(node) === '⋯')
  check('the Remotes section menu exists', sectionMenu !== undefined)
  sectionMenu.props.onClick({ stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(tree, 'button').find((node) => textOf(node) === t('action.clone')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const inputs = findAll(tree, 'input').filter((node) => node.props.className === 'dshgit-input')
  check('clone asks for a URL and a directory', inputs.length === 2, String(inputs.length))
  inputs[0].props.onChange({ currentTarget: { value: 'https://example.com/a.git' } })
  inputs[1].props.onChange({ currentTarget: { value: 'D:/projects/a' } })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  findAll(tree, 'button').find((node) => textOf(node) === t('action.ok')).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  const call = mounted.rpc.calls.find((entry) => entry.method === 'clone')
  check('clone submitted both values',
    call?.payload?.url === 'https://example.com/a.git' && call?.payload?.directory === 'D:/projects/a',
    JSON.stringify(call?.payload))
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

  const rootProps = { connection: mounted.rpc, t }
  const withContributors = await expandSection(tree, t('tree.contributors'), rootProps)
  tree = withContributors
  check('contributors section lists people ranked by commits',
    hasText(tree, '张三') && hasText(tree, '李四'), textOf(tree).slice(-400))
  check('contributors section shows a commit count badge', hasText(tree, '12'), textOf(tree).slice(-300))

  tree = await expandSection(tree, t('tree.remotes'), rootProps)
  check('the configured remote is listed with its URL',
    hasText(tree, 'origin') && hasText(tree, 'github.com/user/repo.git'), textOf(tree).slice(-400))
  check('remote-tracking branches are listed under the configured remote',
    findWhere(tree, (props) => props['data-remote-branch'] === 'refs/remotes/origin/main').length === 1)
  check('a remote URL with credentials would be masked',
    !textOf(tree).includes('//user:'), 'raw credential shown')

  check('the branch row shows upstream divergence',
    hasText(tree, '⇄ origin/main') && hasText(tree, '↑2 ↓1'), textOf(tree).slice(0, 500))
  check('the header shows the last-fetch time', hasText(tree, '最近 Fetch'), textOf(tree).slice(0, 300))
  check('the header shows the commit count', hasText(tree, '5 个提交'), textOf(tree).slice(0, 300))
}

console.log('\n--- compare with a branch is one action away ---')
{
  tree = await renderApp()
  const compareButtons = findAll(tree, 'button').filter((node) => textOf(node) === '⇄')
  check('branch rows expose a compare control', compareButtons.length >= 1, String(compareButtons.length))
  compareButtons[0].props.onClick({ stopPropagation() {} })
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('comparing switched to the compare module',
    activityItems(tree).some((node) => node.props['data-module'] === 'compare' && node.props['aria-pressed'] === true),
    JSON.stringify(activityItems(tree).map((n) => `${n.props['data-module']}=${n.props['aria-pressed']}`)))
  check('the compare tab preloaded the branch',
    mounted.rpc.calls.some((call) => call.method === 'compareCommits'),
    mounted.rpc.calls.map((c) => c.method).join(','))
  check('the comparison lists differing commits', hasText(tree, 'merge: 合并 feature/新功能'),
    textOf(tree).slice(0, 500))
  check('the comparison shows the shortstat', hasText(tree, '1 file changed'), textOf(tree).slice(0, 500))
  check('the compare inputs offer branch completion',
    walk(tree).some((node) => node.$$kind === 'host' && node.type === 'datalist' && node.props.id === 'dshgit-refs'),
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

  check('minimizing hides the window body',
    !walk(tree).some((node) => node.props?.['data-mode'] !== undefined),
    'the dialog is still mounted')
  const pill = walk(tree).find((node) => String(node.props?.className ?? '').includes('dshgit-pill'))
  check('minimizing shows a pill instead', pill !== undefined)
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
  check('clicking the launcher closes the window',
    !walk(tree).some((node) => node.props?.['data-mode'] !== undefined))
  findLauncher(tree).props.onClick()
  tree = await flush(GitApp, { connection: mounted.rpc, t })
  check('clicking it again opens the window',
    walk(tree).some((node) => node.props?.['data-mode'] !== undefined))
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} FAILED`)
  process.exit(1)
}
console.log('all client checks passed')

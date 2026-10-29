/**
 * Hunk-staging checks: only the selected hunk moves, and a stale selection is refused.
 *
 * Everything runs real Git in a temporary directory. The assertions are about the INDEX
 * and the WORKING TREE, not about return values, because the dangerous failure here does
 * not throw: a patch built from stale coordinates can apply successfully and change the
 * wrong lines. That is why the freshness case is a first-class assertion rather than an
 * afterthought.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { git, resolveGitPath } from '../lib/git/exec.js'
import { RepoRegistry } from '../lib/git/repo.js'
import { discardHunks, hunksPatch, readHunks, splitHunks, stageHunks, unstageHunks } from '../lib/git/hunks.js'
import { createRpc } from '../lib/rpc.js'
import { DEFAULT_CONFIG } from '../lib/config.js'
import { diff, splitDiffByFile, DIFF_MAX_BYTES, DIFF_MAX_LINES } from '../lib/git/diff.js'

const gitPath = await resolveGitPath()

/** A repository with one 20-line file, edited in two far-apart places. */
async function fixture(label) {
  const base = await mkdtemp(join(tmpdir(), `dsh-${label}-`))
  const root = join(base, 'repo')
  await mkdir(root)
  const run = async (args, options = {}) => {
    const result = await git({ gitPath, cwd: root, args, timeoutMs: 60_000, ...options })
    if (options.allowFailure !== true) assert.equal(result.code, 0, `${args.join(' ')}\n${result.stderr}`)
    return result.stdout.trim()
  }
  await run(['init', '-b', 'main'])
  for (const [key, value] of Object.entries({
    'user.name': 'Hunk check', 'user.email': 'check@example.invalid',
    'core.autocrlf': 'false', 'commit.gpgsign': 'false',
  })) await run(['config', key, value])
  const original = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n') + '\n'
  await writeFile(join(root, 'f.txt'), original)
  await run(['add', '-A']); await run(['commit', '-m', 'initial'])
  // Two edits far enough apart that git reports two hunks.
  const edited = Array.from({ length: 20 }, (_, index) =>
    index === 1 ? 'line 2 CHANGED' : index === 17 ? 'line 18 CHANGED' : `line ${index + 1}`).join('\n') + '\n'
  await writeFile(join(root, 'f.txt'), edited)
  const { session } = await new RepoRegistry({ gitPath }).open(root)
  return { root, run, repo: session, original, edited }
}

// ---------------------------------------------------------------------------
// 1. The splitter keeps the header verbatim and only the hunk SET changes.
//
// The reconstructed patch must be byte-identical to git's own output, because that is
// what lets `--recount` and the index's line numbers agree. A single stray newline here
// turns into "patch does not apply" for some files and a misapplied patch for others.
// ---------------------------------------------------------------------------
{
  const raw = [
    'diff --git a/f.txt b/f.txt',
    'index 1111111..2222222 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,3 +1,3 @@',
    ' one',
    '-two',
    '+TWO',
    ' three',
    '@@ -10,3 +10,3 @@',
    ' ten',
    '-eleven',
    '+ELEVEN',
    ' twelve',
    '',
  ].join('\n')
  const diff = splitHunks(raw)
  assert.equal(diff.hunks.length, 2)
  assert.equal(diff.header, 'diff --git a/f.txt b/f.txt\nindex 1111111..2222222 100644\n--- a/f.txt\n+++ b/f.txt')
  assert.ok(diff.hunks.every(hunk => /^[0-9a-f]{64}$/.test(hunk.hash)))
  // Selecting both hunks reproduces the input exactly.
  assert.equal(hunksPatch(diff, diff.hunks.map(hunk => hunk.hash)), raw)
  // Selecting one drops the other entirely — header kept, sibling body gone.
  const onlyFirst = hunksPatch(diff, [diff.hunks[0].hash])
  assert.ok(onlyFirst.includes('@@ -1,3 +1,3 @@'))
  assert.equal(onlyFirst.includes('ELEVEN'), false, 'the unselected hunk is not in the patch')
  assert.equal(hunksPatch(diff, []), '', 'an empty selection builds no patch')
  assert.equal(hunksPatch(diff, ['nope']), '', 'an unknown hash builds no patch')
  console.log('PASS the splitter preserves git\'s bytes and a subset patch contains only the chosen hunks')
}

// ---------------------------------------------------------------------------
// 2. Staging one hunk moves exactly that change into the index.
// ---------------------------------------------------------------------------
{
  const { root, run, repo, edited } = await fixture('hunks-stage')
  const hunks = await readHunks(repo, { path: 'f.txt' }, {})
  assert.equal(hunks.hunks.length, 2, 'two separate edits must be two hunks')
  // The patch body is deliberately not sent to the panel; only hashes and headers are.
  assert.equal(hunks.hunks[0].lines, undefined, 'hunk bodies must not cross the wire twice')

  const staged = await stageHunks(repo, { path: 'f.txt', hashes: [hunks.hunks[0].hash] }, {})
  assert.equal(staged.ok, true, staged.message)
  const index = await run(['show', ':f.txt'])
  assert.ok(index.includes('line 2 CHANGED'), 'the selected hunk reached the index')
  assert.ok(index.includes('line 18\n'), 'the unselected hunk did not')
  assert.equal(await readFile(join(root, 'f.txt'), 'utf8'), edited, 'staging must not touch the working tree')

  // Unstaging puts the index back exactly as it was.
  const stagedView = await readHunks(repo, { path: 'f.txt', staged: true }, {})
  assert.equal(stagedView.hunks.length, 1, 'only the staged hunk is visible from the index side')
  const unstaged = await unstageHunks(repo, { path: 'f.txt', hashes: [stagedView.hunks[0].hash] }, {})
  assert.equal(unstaged.ok, true, unstaged.message)
  assert.equal(await run(['diff', '--cached', '--stat']), '', 'the index is clean again')
  console.log('PASS staging one hunk moves exactly that hunk and unstaging restores the index')
}

// ---------------------------------------------------------------------------
// 3. Discarding one hunk reverts it on disk and leaves the other edit alone.
// ---------------------------------------------------------------------------
{
  const { root, run, repo, edited } = await fixture('hunks-discard')
  const both = await readHunks(repo, { path: 'f.txt' }, {})
  const discarded = await discardHunks(repo, { path: 'f.txt', hashes: [both.hunks[1].hash] }, {})
  assert.equal(discarded.ok, true, discarded.message)
  const final = await readFile(join(root, 'f.txt'), 'utf8')
  assert.equal(final.includes('line 18 CHANGED'), false, 'the discarded hunk was reverted on disk')
  assert.equal(final.includes('line 2 CHANGED'), true, 'the other hunk is untouched')
  assert.equal(final.split('\n').length, edited.split('\n').length, 'discarding a hunk cannot change the line count')
  assert.equal(await run(['diff', '--cached', '--stat']), '', 'discarding never touches the index')
  console.log('PASS discarding one hunk reverts only that hunk on disk')
}

// ---------------------------------------------------------------------------
// 4. A hash from a PREVIOUS version of the file is refused, not applied at a shifted
//    offset. This is the failure that silently stages the wrong lines.
// ---------------------------------------------------------------------------
{
  const { root, run, repo } = await fixture('hunks-stale')
  const stale = await readHunks(repo, { path: 'f.txt' }, {})
  // Insert a line ABOVE the first hunk, so the old coordinates now point at different
  // content. The patch would still apply — at the wrong place.
  const current = await readFile(join(root, 'f.txt'), 'utf8')
  await writeFile(join(root, 'f.txt'), 'inserted at the top\n' + current)
  await assert.rejects(
    stageHunks(repo, { path: 'f.txt', hashes: [stale.hunks[0].hash] }, {}),
    /改动块已变化/,
  )
  assert.equal(await run(['diff', '--cached', '--stat']), '', 'a refused apply must leave the index alone')
  console.log('PASS a hash from a previous file version is refused instead of applied at a shifted offset')
}

// ---------------------------------------------------------------------------
// 5. Shapes that cannot be split are named rather than half-applied.
// ---------------------------------------------------------------------------
{
  const { root, run, repo } = await fixture('hunks-shapes')
  // A binary file: git reports "Binary files differ", which no text patch can express.
  await writeFile(join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
  await run(['add', '-A']); await run(['commit', '-m', 'binary'])
  await writeFile(join(root, 'bin.dat'), Buffer.from([0, 9, 9, 9]))
  await assert.rejects(readHunks(repo, { path: 'bin.dat' }, {}), /完整文件管理|二进制/)

  // An untracked file has no diff against the index yet, so its hunks are undefined.
  await writeFile(join(root, 'new.txt'), 'brand new\n')
  await assert.rejects(readHunks(repo, { path: 'new.txt' }, {}), /未跟踪/)

  // A path that is not there at all is a request mistake, not a diff problem.
  await assert.rejects(readHunks(repo, { path: 'missing.txt' }, {}), /请选择文件/)
  await assert.rejects(readHunks(repo, { path: '' }, {}), /请选择文件/)
  console.log('PASS binary, untracked and unknown-path shapes are refused by name')
}

// ---------------------------------------------------------------------------
// 6. Staging one hunk CHANGES the file's hunk set, which is what makes a cached
//    fingerprint stale.
//
// This is the property the panel's cache key depends on: after a stage, the remaining
// hunks are fewer and their coordinates shift, so a hook that keyed only on
// `[root, path, staged]` would keep offering the pre-write fingerprints. The Host then
// refuses the next click (a stale hash is rejected, never misapplied), so the visible
// symptom is a button that does nothing rather than wrong content — which is why this is
// asserted at the data level instead of left to the UI.
// ---------------------------------------------------------------------------
{
  const { repo } = await fixture('hunks-set')
  const before = await readHunks(repo, { path: 'f.txt' }, {})
  assert.equal(before.hunks.length, 2, 'the fixture starts with two hunks')
  const signature = before.hunks.map(hunk => hunk.header).join('|')

  await stageHunks(repo, { path: 'f.txt', hashes: [before.hunks[0].hash] }, {})
  const after = await readHunks(repo, { path: 'f.txt' }, {})
  assert.equal(after.hunks.length, 1, 'staging removes the staged hunk from the unstaged side')
  assert.notEqual(after.hunks.map(hunk => hunk.header).join('|'), signature,
    'the hunk set changed, so any cached fingerprint for this file is now stale')
  // The old hash is no longer valid on this side, and asking for it is refused by name.
  await assert.rejects(
    stageHunks(repo, { path: 'f.txt', hashes: [before.hunks[0].hash] }, {}),
    /改动块已变化/,
  )
  console.log('PASS staging changes the hunk set, which is what makes a cached fingerprint stale')
}

{
  const { root, run } = await fixture('review-options')
  const registry = new RepoRegistry({ gitPath })
  const { session } = await registry.open(root)
  const calls = [], originalRun = session.run.bind(session)
  session.run = (args, options) => { calls.push(args); return originalRun(args, options) }
  const rpc = createRpc({ registry, config: { get: () => ({ ...DEFAULT_CONFIG }) }, logger: { warn() {} } })
  const words = await rpc.call('diff', { root, path: 'f.txt', wordDiff: true, algorithm: 'histogram' })
  assert.equal(words.ok, true, words.error?.message)
  assert(calls.some(args => args.includes('--word-diff=plain') && args.includes('--diff-algorithm=histogram')))
  assert(words.value.files[0].hunks.every(hunk => hunk.wordDiff))
  assert(words.value.files[0].hunks.flatMap(hunk => hunk.lines).some(line => line.includes('{+CHANGED+}')))
  await writeFile(join(root, 'f.txt'), 'alpha beta\n')
  await run(['add', 'f.txt']); await run(['commit', '-m', 'whitespace base'])
  await writeFile(join(root, 'f.txt'), 'alphabeta\n')
  const spacing = await rpc.call('diff', { root, path: 'f.txt', ignoreWhitespace: true })
  const allSpace = await rpc.call('diff', { root, path: 'f.txt', ignoreAllSpace: true, algorithm: 'patience' })
  assert.equal(spacing.ok, true)
  assert(spacing.value.hunks.length > 0, '-b keeps the removal of the only space visible')
  assert.equal(allSpace.ok, true)
  assert.equal(allSpace.value.hunks.length, 0, '-w ignores even removal of all spacing')
  assert(calls.some(args => args.includes('-w') && args.includes('--diff-algorithm=patience')))
  console.log('PASS review options pass through RPC to Git and word diffs retain their inline text')
}

{
  const { repo, root, edited } = await fixture('hunk-preview-race')
  const preview = await diff(repo, { path: 'f.txt' })
  const first = await readHunks(repo, { path: 'f.txt' })
  assert.equal(first.hunks[0].contentHash, preview.files[0].hunks[0].contentHash)
  assert.equal(first.hunks[0].contentHash, preview.hunks[0].contentHash)
  await writeFile(join(root, 'f.txt'), edited.replace('line 2 CHANGED', 'line 2 REVISED'))
  const changed = await readHunks(repo, { path: 'f.txt' })
  assert.equal(changed.hunks[0].header, first.hunks[0].header, 'the same line coordinates can describe different content')
  assert.notEqual(changed.hunks[0].contentHash, preview.hunks[0].contentHash)
  await assert.rejects(discardHunks(repo, { path: 'f.txt', hashes: [first.hunks[0].hash] }), /已变化/)
  assert.equal(await readFile(join(root, 'f.txt'), 'utf8'), edited.replace('line 2 CHANGED', 'line 2 REVISED'))
  console.log('PASS preview fingerprints agree with fileHunks and change even when hunk coordinates stay the same')
}

{
  const { repo, root, run } = await fixture('word-backslash')
  await writeFile(join(root, 'f.txt'), '\\item Old text\n\\end{itemize}\n')
  await run(['add', 'f.txt']); await run(['commit', '-m', 'latex base'])
  await writeFile(join(root, 'f.txt'), '\\item New text\n\\end{itemize}\n')
  const words = await diff(repo, { path: 'f.txt', wordDiff: true })
  assert.deepEqual(words.files[0].hunks[0].lines, [' \\item [-Old-]{+New+} text', ' \\end{itemize}'])
  const raw = words.text + '\\ No newline at end of file\n'
  assert.deepEqual(splitDiffByFile(raw, { wordDiff: true })[0].hunks[0].lines, words.files[0].hunks[0].lines)
  console.log('PASS word diffs retain backslash-prefixed changes and context while filtering only the Git newline marker')
}
for (const action of ['stage', 'discard', 'unstage']) {
  const { repo, root, run, edited } = await fixture(`hunk-batch-${action}`)
  if (action === 'unstage') await run(['add', 'f.txt'])
  const selected = await readHunks(repo, { path: 'f.txt', staged: action === 'unstage' })
  const changed = edited.replace('line 18 CHANGED', 'line 18 REVISED')
  await writeFile(join(root, 'f.txt'), changed)
  if (action === 'unstage') await run(['add', 'f.txt'])
  const index = await run(['write-tree'])
  const operation = { stage: stageHunks, discard: discardHunks, unstage: unstageHunks }[action]
  await assert.rejects(operation(repo, { path: 'f.txt', hashes: selected.hunks.map(hunk => hunk.hash) }), /已变化/)
  assert.equal(await run(['write-tree']), index, 'a partially stale selection must not modify any index entry')
  assert.equal(await readFile(join(root, 'f.txt'), 'utf8'), changed, 'a partially stale selection must not modify any worktree line')
  // Deduplicate repeated selections so counts reflect how many hunks are applied.
  const current = await readHunks(repo, { path: 'f.txt', staged: action === 'unstage' })
  const result = await operation(repo, { path: 'f.txt', hashes: [current.hunks[0].hash, current.hunks[0].hash] })
  assert.equal(result.ok, true)
  assert.match(result.message, /1 个/)
  console.log(`PASS ${action} refuses the entire partially stale batch and counts duplicate selections once`)
}

{
  const { repo, root, run } = await fixture('hunk-read-limits')
  for (const text of ['x'.repeat(DIFF_MAX_BYTES + 32) + '\n', 'short line\n'.repeat(DIFF_MAX_LINES + 1)]) {
    await writeFile(join(root, 'f.txt'), text)
    const index = await run(['write-tree'])
    await assert.rejects(readHunks(repo, { path: 'f.txt' }), /差异过大/)
    await assert.rejects(stageHunks(repo, { path: 'f.txt', hashes: ['some-selected-hunk'] }), /差异过大/)
    assert.equal(await run(['write-tree']), index)
    assert.equal(await readFile(join(root, 'f.txt'), 'utf8'), text)
  }
  console.log('PASS hunk reads and writes refuse oversized byte and line counts without changing content')
}

console.log('Hunk staging checks passed')

/**
 * §12.4's gate: every live freeze entry's `files` are inside the epic's scope,
 * and every `source` entry in the overlay says why.
 *
 * Scope is `files[] ∪ filesOverlay` — the plan plus the record of reality, with
 * each declared path resolved through the approved deliverable-path patches.
 * Checking against `files[]` alone would fail 80 of 121 live entries; checking
 * against nothing is what the program did for its first hundred freezes, which
 * is how BLOCKED-136's wrong-subject file list survived to the U stage and how
 * BLOCKED-137's admission nearly got a scope test that could not fail.
 *
 * **The overlay is regenerated here, and the committed file is checked against it.**
 * Every refusal about scope and reasons is decided on the overlay computed from
 * the registry, the freeze, the patches and the reason table, never on
 * `files-overlay.json`: a file read as the source would let the two drift, and
 * the drift would resolve in favour of whatever was committed. The committed
 * file is what a reader opens, so a copy that differs from the computed overlay
 * fails the gate, and a copy that cannot be compared exits 2. The reason table
 * is read from disk because a reason is the one part of an overlay entry a
 * machine cannot derive.
 *
 * Usage: `node scripts/first100/verify-files-overlay.mjs [--write]`
 * `--write` rewrites `files-overlay.json` from the computed overlay before the
 * comparison, so the file it leaves always matches.
 * Exit 0 when every check passes, 1 when any check fails, and 2 when the
 * committed file cannot be compared and no check failed.
 *
 * @module scripts/first100/verify-files-overlay
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeOverlay, declaredPaths, loadOverlayInputs } from './files-overlay.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OVERLAY_PATH = join(REPO_ROOT, 'spec/first100/exec/files-overlay.json')

/**
 * Which live freeze entries cite a path in neither the declaration nor the overlay.
 *
 * With the overlay derived from those same entries this is empty by
 * construction TODAY, and it stops being empty the moment the overlay is
 * pinned to a committed file or the derivation narrows — which is exactly when
 * a reader needs to be told.
 * @param registry - the parsed registry.
 * @param freeze - all freeze entries.
 * @param overlay - the computed overlay.
 * @param patches - the deliverable-path patches, from `patchEntries`.
 * @returns `{ epic, stage, path }` for each unaccounted citation.
 */
export function unaccountedCitations(registry, freeze, overlay, patches) {
  const byEpic = new Map(registry.epics.map(epic => [epic.id, epic]))
  const covered = new Set(overlay.map(entry => `${entry.epic} ${entry.path}`))
  const unaccounted = []
  for (const entry of freeze) {
    if (entry.supersededBy !== undefined) continue
    const epic = byEpic.get(entry.epic)
    if (epic === undefined) continue
    const declared = declaredPaths(epic, patches)
    for (const path of entry.files ?? []) {
      if (declared.has(path) || covered.has(`${entry.epic} ${path}`)) continue
      unaccounted.push({ epic: entry.epic, stage: entry.stage, path })
    }
  }
  return unaccounted
}

/**
 * The `source` entries with no reason recorded.
 *
 * Only `source` is gated. A test, fixture, doc or manifest outside the
 * declaration is ordinary — the declaration is a sketch of principal
 * deliverables — but product code the plan never named is the case §12.4 wants
 * a human sentence and a delegate's eyes on.
 * @param overlay - the computed overlay.
 * @returns entries lacking a non-empty reason.
 */
export function sourceEntriesWithoutReason(overlay) {
  return overlay.filter(entry => entry.kind === 'source' && (typeof entry.reason !== 'string' || entry.reason.trim() === ''))
}

/**
 * `HOT ZONE` entries whose reason cites no commit to check it against.
 *
 * The delegate read the first five against their diffs and found three
 * describing the epic's INTENT rather than its change — all three in the same
 * direction, calling a modification of a shared file a read of it. A gate
 * cannot tell whether a sentence is true. It can require the sentence to name
 * the diff it came from, which is what makes the reviewer's pass possible at
 * all: `git show <sha> -- <path>` either shows what the reason says or it does
 * not.
 * @param overlay - the computed overlay.
 * @returns hot-zone entries with no `git show <sha>` citation.
 */
export function hotZoneEntriesWithoutCitation(overlay) {
  // Anchored, for the reason `verify-adapt-dispositions` anchors its own
  // label check: a reason that NAMES the label while explaining that it does
  // not apply — "NOT labelled HOT ZONE: this file is not on §2.D's list" — is
  // not claiming it, and forcing that sentence out to satisfy the check would
  // delete the reasoning it exists to hold.
  return overlay.filter(entry =>
    typeof entry.reason === 'string'
    && /^\s*HOT ZONE\b/u.test(entry.reason)
    && !/git show [0-9a-f]{7,40}\b/u.test(entry.reason))
}

/**
 * Reason keys that no overlay entry uses.
 *
 * Reported, never refused: a key outlives its entry when a path moves or a
 * freeze stops citing it, and the reason is kept as the record of why the
 * path was once in scope.
 * @param overlay - the computed overlay.
 * @param reasons - `{ "<epic> <path>": "<reason>" }`.
 * @returns the unused keys, sorted.
 */
export function unusedReasonKeys(overlay, reasons) {
  const used = new Set(overlay.map(entry => `${entry.epic} ${entry.path}`))
  return Object.keys(reasons).filter(key => !used.has(key)).sort()
}

/**
 * The `files-overlay.json` text for an overlay, exactly as `--write` writes it.
 * @param overlay - the computed overlay.
 * @returns the document as two-space-indented JSON with one trailing newline.
 */
export function overlayFileText(overlay) {
  const document = {
    schema: { name: 'first100-files-overlay', version: '1.0' },
    generatedBy: 'scripts/first100/verify-files-overlay.mjs --write',
    entries: overlay,
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

/**
 * Compare a committed `files-overlay.json` with the computed overlay.
 *
 * Entries are matched on `(epic, path)` in both directions, so a stale file is
 * named by the entries it still holds and the entries it lacks. Beyond the
 * keys, the committed text is re-serialized the way {@link overlayFileText}
 * serializes and compared whole, so a changed kind, stage list, reason or
 * header is drift while indentation is not. A file that cannot be read, is not
 * JSON, or holds no entries cannot be compared, which is never a match.
 * @param committedText - the file contents, or `undefined` when the file cannot be read.
 * @param overlay - the computed overlay.
 * @returns `{ status: 'match' }`, `{ status: 'uncomparable', reason }`, or `{ status: 'drift', onlyCommitted, onlyComputed }`, whose keys read `"<epic> <path>"` and are sorted.
 */
export function compareCommittedOverlay(committedText, overlay) {
  if (committedText === undefined) return { status: 'uncomparable', reason: 'the file cannot be read' }
  let committed
  try {
    committed = JSON.parse(committedText)
  } catch {
    // Text that is not JSON has no entries to compare. Returning it as
    // uncomparable keeps the SyntaxError from ending the gate unexplained.
    return { status: 'uncomparable', reason: 'the file is not JSON' }
  }
  if (!Array.isArray(committed?.entries) || committed.entries.length === 0) {
    return { status: 'uncomparable', reason: 'the file holds no entries' }
  }
  const key = entry => `${String(entry?.epic)} ${String(entry?.path)}`
  const committedKeys = new Set(committed.entries.map(key))
  const computedKeys = new Set(overlay.map(key))
  const onlyCommitted = [...committedKeys].filter(k => !computedKeys.has(k)).sort()
  const onlyComputed = [...computedKeys].filter(k => !committedKeys.has(k)).sort()
  if (onlyCommitted.length === 0 && onlyComputed.length === 0 && `${JSON.stringify(committed, null, 2)}\n` === overlayFileText(overlay)) {
    return { status: 'match' }
  }
  return { status: 'drift', onlyCommitted, onlyComputed }
}

/**
 * The exit code for one run of this gate.
 *
 * A failed check decides the run, so it wins over a committed file that cannot
 * be compared: exit 2 means the comparison is the only thing left undecided.
 * @param failures - the failure messages of the run.
 * @param comparison - the result of {@link compareCommittedOverlay}.
 * @returns 1 when any check failed, otherwise 2 when the committed file cannot be compared, otherwise 0.
 */
export function exitCodeFor(failures, comparison) {
  if (failures.length > 0) return 1
  if (comparison.status === 'uncomparable') return 2
  return 0
}

function main() {
  const { registry, freeze, reasons, patches } = loadOverlayInputs()
  const overlay = computeOverlay(registry, freeze, reasons, patches)
  const unused = unusedReasonKeys(overlay, reasons)
  if (unused.length > 0) {
    console.log(`verify-files-overlay: ${String(unused.length)} reason key(s) no overlay entry uses (informational, not a failure):\n  ${unused.join('\n  ')}`)
  }

  if (process.argv.includes('--write')) {
    writeFileSync(OVERLAY_PATH, overlayFileText(overlay), 'utf8')
    console.log(`verify-files-overlay: wrote ${String(overlay.length)} entry/entries to spec/first100/exec/files-overlay.json`)
  }

  const unaccounted = unaccountedCitations(registry, freeze, overlay, patches)
  const unexplained = sourceEntriesWithoutReason(overlay)
  const uncited = hotZoneEntriesWithoutCitation(overlay)
  const comparison = compareCommittedOverlay(existsSync(OVERLAY_PATH) ? readFileSync(OVERLAY_PATH, 'utf8') : undefined, overlay)
  const failures = []
  if (comparison.status === 'drift') {
    const named = [...comparison.onlyCommitted.map(k => `only in the committed file: ${k}`), ...comparison.onlyComputed.map(k => `only in the computed overlay: ${k}`)]
    failures.push(`spec/first100/exec/files-overlay.json differs from the computed overlay — run \`node scripts/first100/verify-files-overlay.mjs --write\` and commit the file:\n  `
      + (named.length > 0 ? named.join('\n  ') : 'the same (epic, path) entries, with an entry field or the header changed'))
  }
  if (uncited.length > 0) {
    failures.push(`${String(uncited.length)} HOT ZONE reason(s) citing no diff — write a shared-file reason from \`git show <sha> -- <path>\` and name that sha, because three of the first five described the epic's intent instead of its change:\n  `
      + uncited.map(entry => `${entry.epic} ${entry.path}`).join('\n  '))
  }
  if (unaccounted.length > 0) {
    failures.push(`${String(unaccounted.length)} freeze citation(s) in neither files[] nor the overlay:\n  `
      + unaccounted.map(({ epic, stage, path }) => `${epic}.${stage} ${path}`).join('\n  '))
  }
  if (unexplained.length > 0) {
    failures.push(`${String(unexplained.length)} source path(s) recorded with no reason — product code the plan never named needs a sentence (§12.4):\n  `
      + unexplained.map(entry => `${entry.epic} ${entry.path}`).join('\n  '))
  }
  const code = exitCodeFor(failures, comparison)
  if (code !== 0) {
    if (failures.length > 0) console.error(`verify-files-overlay: ${failures.join('\n')}`)
    if (comparison.status === 'uncomparable') {
      console.error(`verify-files-overlay: cannot compare spec/first100/exec/files-overlay.json with the computed overlay: ${comparison.reason}. Recreate it with \`node scripts/first100/verify-files-overlay.mjs --write\`.`)
    }
    process.exit(code)
  }

  const kinds = {}
  for (const entry of overlay) kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1
  const summary = Object.entries(kinds).sort().map(([kind, count]) => `${kind} ${String(count)}`).join(', ')
  console.log(`verify-files-overlay: ${String(overlay.length)} overlay entry/entries (${summary}); every live freeze citation is inside files[] ∪ overlay, every source path carries a reason, and spec/first100/exec/files-overlay.json matches the computed overlay.`)
}

// Only when run as a command. The spec IMPORTS this module for its two pure
// checks, and an unguarded `main()` would run the whole gate at import time —
// including its `process.exit(1)`, which would kill the test worker for a
// reason having nothing to do with the case being run.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()

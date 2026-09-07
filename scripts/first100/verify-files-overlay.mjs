/**
 * §12.4's gate: every live freeze entry's `files` are inside the epic's scope,
 * and every `source` entry in the overlay says why.
 *
 * Scope is `files[] ∪ filesOverlay` — the plan plus the record of reality.
 * Checking against `files[]` alone would fail 80 of 121 live entries; checking
 * against nothing is what the program did for its first hundred freezes, which
 * is how BLOCKED-136's wrong-subject file list survived to the U stage and how
 * BLOCKED-137's admission nearly got a scope test that could not fail.
 *
 * **The overlay is regenerated here, not read from disk.** A committed file
 * would let the two drift, and the drift would always resolve in favour of
 * whatever was committed — which is the failure this gate exists to catch, one
 * level up. What IS read from disk is the reason table, because a reason is
 * the one part of an overlay entry a machine cannot derive.
 *
 * Usage: `node scripts/first100/verify-files-overlay.mjs [--write]`
 * `--write` refreshes the generated `files-overlay.json` for readers; it never
 * decides the gate.
 *
 * @module scripts/first100/verify-files-overlay
 */
import { writeFileSync } from 'node:fs'
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
 * @returns `{ epic, stage, path }` for each unaccounted citation.
 */
export function unaccountedCitations(registry, freeze, overlay) {
  const byEpic = new Map(registry.epics.map(epic => [epic.id, epic]))
  const covered = new Set(overlay.map(entry => `${entry.epic} ${entry.path}`))
  const unaccounted = []
  for (const entry of freeze) {
    if (entry.supersededBy !== undefined) continue
    const epic = byEpic.get(entry.epic)
    if (epic === undefined) continue
    const declared = declaredPaths(epic)
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

function main() {
  const { registry, freeze, reasons } = loadOverlayInputs()
  const overlay = computeOverlay(registry, freeze, reasons)

  if (process.argv.includes('--write')) {
    const document = {
      schema: { name: 'first100-files-overlay', version: '1.0' },
      generatedBy: 'scripts/first100/verify-files-overlay.mjs --write',
      entries: overlay,
    }
    writeFileSync(OVERLAY_PATH, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    console.log(`verify-files-overlay: wrote ${String(overlay.length)} entry/entries to spec/first100/exec/files-overlay.json`)
  }

  const unaccounted = unaccountedCitations(registry, freeze, overlay)
  const unexplained = sourceEntriesWithoutReason(overlay)
  const uncited = hotZoneEntriesWithoutCitation(overlay)
  const failures = []
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
  if (failures.length > 0) {
    console.error(`verify-files-overlay: ${failures.join('\n')}`)
    process.exit(1)
  }

  const kinds = {}
  for (const entry of overlay) kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1
  const summary = Object.entries(kinds).sort().map(([kind, count]) => `${kind} ${String(count)}`).join(', ')
  console.log(`verify-files-overlay: ${String(overlay.length)} overlay entry/entries (${summary}); every live freeze citation is inside files[] ∪ overlay, and every source path carries a reason.`)
}

// Only when run as a command. The spec IMPORTS this module for its two pure
// checks, and an unguarded `main()` would run the whole gate at import time —
// including its `process.exit(1)`, which would kill the test worker for a
// reason having nothing to do with the case being run.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()

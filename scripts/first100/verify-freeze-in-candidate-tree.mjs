/**
 * Check that every GREEN cell's frozen cases existed in the tree that was
 * observed — acceptance predicate (v).
 *
 * A frozen case is evidence because it is a PRE-COMMITMENT: the cases are
 * fixed, then the run happens, so the run cannot be shopped for. Nothing
 * enforced the order. `frozenAtUtc` looks like it could, and cannot: it is
 * hand-written (the values cluster on round minutes), so it records what a
 * writer typed rather than when the freeze happened. Comparing it against a
 * machine-recorded observation time produced 38 apparent failures, of which a
 * second pass showed most were a field backfilled after the fact rather than a
 * freeze taken late ([BLOCKED-132](../../spec/first100/exec/BLOCKED-QUEUE.md)).
 *
 * **This check reads no timestamp at all.** The candidate SHA is a tree, and a
 * tree either contains the freeze record or does not:
 *
 * > For each GREEN cell, every live freeze entry for its `(epic, stage)` must
 * > appear in `<candidateSha>:spec/first100/exec/command-freeze.json`.
 *
 * That is decidable from the repository alone, offline, with no clock to
 * trust. A record absent from the observed tree was written after the
 * observation, or the stage was superseded and never re-observed — the two
 * causes differ, and neither is a pre-commitment.
 *
 * Entries are matched on `(epic, stage)` plus the exact set of `expectCases`,
 * not on position or on a generated id: an entry that gained or lost a title
 * after the observation is a different commitment, and must not match the one
 * that was observed.
 *
 * **What this does NOT claim.** A missing record does not mean the result is
 * false. The titles did pass in the cited report, coverage closure still holds,
 * and `verify-cells-recomputable` still recomputes the verdict. What is missing
 * is the ordering link, which exists to stop a case being written to fit a run
 * already seen. Guarding against a vacuous case is the mutation proof's job,
 * not this one's.
 *
 * Usage: `node scripts/first100/verify-freeze-in-candidate-tree.mjs`
 *
 * @module scripts/first100/verify-freeze-in-candidate-tree
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FREEZE_PATH = 'spec/first100/exec/command-freeze.json'
const LEDGER_PATH = join(REPO_ROOT, 'spec/first100/exec/ledger.json')

/**
 * The freeze entries recorded in one commit's tree.
 * @param sha - the candidate commit to read.
 * @returns its freeze entries, or `undefined` when the tree cannot be read.
 */
function freezeEntriesAt(sha) {
  try {
    const raw = execFileSync('git', ['show', `${sha}:${FREEZE_PATH}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    return JSON.parse(raw).entries ?? []
  } catch {
    // A candidate SHA absent from this clone (a pruned branch, a shallow
    // fetch) is UNREADABLE, never a pass: reporting "no missing entries"
    // for a tree nobody could open is the failure this whole check exists
    // to stop.
    return undefined
  }
}

/** The identity of a freeze commitment: its stage, and the exact set of titles it pins. */
const commitmentKey = entry =>
  JSON.stringify([entry.epic, entry.stage, entry.supplementSeq ?? null, [...entry.expectCases ?? []].sort()])

function main() {
  const rows = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')).rows
  const live = JSON.parse(readFileSync(join(REPO_ROOT, FREEZE_PATH), 'utf8')).entries
    .filter(entry => entry.supersededBy === undefined)

  const treeCache = new Map()
  const verified = []
  const missing = []
  const unreadable = []

  for (const [epic, row] of Object.entries(rows)) {
    for (const [stage, cell] of Object.entries(row.cells ?? {})) {
      if (cell.status !== 'GREEN' || cell.candidateSha === undefined) continue
      // A supplement is its own observation with its own candidate SHA and its
      // own freeze entry, so the PRIMARY cell answers only for entries without
      // a `supplementSeq`. Folding them together made a newly added supplement
      // report the primary cell as missing a record that was never the primary
      // cell's to carry -- found by this gate on its own author.
      const commitments = live.filter(entry => entry.epic === epic && entry.stage === stage && entry.supplementSeq === undefined)
      if (commitments.length === 0) continue

      if (!treeCache.has(cell.candidateSha)) treeCache.set(cell.candidateSha, freezeEntriesAt(cell.candidateSha))
      const observed = treeCache.get(cell.candidateSha)
      if (observed === undefined) {
        unreadable.push(`${epic}.${stage}: candidate ${cell.candidateSha} is not readable in this clone`)
        continue
      }

      const observedKeys = new Set(observed.map(commitmentKey))
      const absent = commitments.filter(entry => !observedKeys.has(commitmentKey(entry)))
      if (absent.length === 0) verified.push(`${epic}.${stage}`)
      else missing.push(`${epic}.${stage}: ${String(absent.length)} live freeze entry/entries absent from ${cell.candidateSha.slice(0, 10)}`)
    }
  }

  for (const [epic, row] of Object.entries(rows)) {
    for (const [key, supplement] of Object.entries(row.supplements ?? {})) {
      if (supplement.status !== 'GREEN' || supplement.candidateSha === undefined) continue
      const [stage, seq] = key.split('.')
      const commitments = live.filter(entry =>
        entry.epic === epic && entry.stage === stage && entry.supplementSeq === Number(seq))
      if (commitments.length === 0) continue
      if (!treeCache.has(supplement.candidateSha)) treeCache.set(supplement.candidateSha, freezeEntriesAt(supplement.candidateSha))
      const observed = treeCache.get(supplement.candidateSha)
      if (observed === undefined) {
        unreadable.push(`${epic}.${key}: candidate ${supplement.candidateSha} is not readable in this clone`)
        continue
      }
      const observedKeys = new Set(observed.map(commitmentKey))
      const absent = commitments.filter(entry => !observedKeys.has(commitmentKey(entry)))
      if (absent.length === 0) verified.push(`${epic}.${key}`)
      else missing.push(`${epic}.${key}: ${String(absent.length)} live freeze entry/entries absent from ${supplement.candidateSha.slice(0, 10)}`)
    }
  }

  for (const line of missing) console.error(`  MISSING  ${line}`)
  for (const line of unreadable) console.error(`  UNREADABLE  ${line}`)
  const total = verified.length + missing.length + unreadable.length
  if (missing.length === 0 && unreadable.length === 0) {
    console.log(`verify-freeze-in-candidate-tree: ${String(total)} GREEN cell(s) — every live freeze entry is present in the tree that was observed.`)
    return
  }
  console.error(
    `verify-freeze-in-candidate-tree: ${String(missing.length)} MISSING and ${String(unreadable.length)} UNREADABLE of ${String(total)} GREEN cell(s). `
    + 'A freeze absent from the observed tree was written after the observation, or the stage was superseded and never re-observed. '
    + 'Neither is a pre-commitment. Re-observe the cell on a tree containing its live freeze entries.',
  )
  process.exit(1)
}

main()

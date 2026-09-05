#!/usr/bin/env node
/**
 * Per-epic start-of-work readiness gate for the First-100 program.
 *
 * The program schedules work in waves, but a wave barrier makes every epic in
 * wave N+1 wait for the slowest epic in wave N even when it depends on only one
 * of them. This gate replaces the barrier with the two conditions that are
 * actually load-bearing, so an epic starts as soon as they hold:
 *
 *   1. Every one of the epic's own `predecessors` is ACCEPTED, or has landed
 *      every applicable stage cell. A predecessor expresses "I need your work
 *      to exist", not "I need your books closed", so an epic held back only by
 *      an unproven clause no longer blocks its successors (BLOCKED-087's
 *      confusion in its second location). Wave membership is not consulted —
 *      it stays a bookkeeping and dependency-expression field, never a start
 *      condition.
 *   2. The epic's declared file set is disjoint from the declared file set of
 *      every in-flight epic. Two epics writing one file concurrently would
 *      produce a merge conflict whose resolution is not covered by either
 *      epic's frozen command, so the later one waits for the earlier to land.
 *
 * An epic is in flight when it is not ACCEPTED and at least one of its stage
 * cells has left NOT_RUN — that is, work has started but has not landed.
 *
 * Fail-closed by construction: every path that cannot compute both conditions
 * from real registry and ledger data exits non-zero. An unknown epic id, a
 * predecessor absent from the ledger, a missing or empty file list, and an
 * unreadable input are all NOT READY, never a pass by default.
 *
 * Usage:
 *   node scripts/first100/check-ready.mjs P4-05     # gate one epic
 *   node scripts/first100/check-ready.mjs           # list every ready epic
 *
 * Exit codes: 0 ready (or, with no argument, listing succeeded); 1 not ready or
 * undecidable.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const REGISTRY_PATH = resolve(REPO, 'tests/first100/registry.json')
const LEDGER_PATH = resolve(REPO, 'spec/first100/exec/ledger.json')

/**
 * Read and parse one JSON input, treating every failure as undecidable.
 * @param path - absolute path of the JSON document to read.
 * @returns the parsed document.
 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`)
  }
}

/**
 * Report an undecidable input and exit non-zero, never returning.
 * @param message - what could not be decided.
 * @returns never; the process exits with code 1.
 */
function fail(message) {
  console.error(`NOT READY (undecidable): ${message}`)
  process.exit(1)
}

/**
 * Every file path an epic declares, across its top-level `files` and all four
 * stage file lists. Both are consulted because a stage may name a file the
 * top-level list omits, and a write to either conflicts identically.
 * @param epic - the registry row to collect declared paths from.
 * @returns the epic's declared paths as a set, deduplicated across stages.
 */
function declaredFiles(epic) {
  const paths = new Set()
  for (const path of epic.files ?? []) paths.add(path)
  for (const stage of Object.values(epic.stages ?? {})) {
    for (const path of stage?.files ?? []) paths.add(path)
  }
  if (paths.size === 0) fail(`epic ${epic.id} declares no files — cannot compute a file-overlap verdict`)
  return paths
}

/**
 * Whether an epic has started but not landed, and so may hold a write lock on
 * its declared files.
 * @param row - the ledger row to classify.
 * @param epicId - the epic's registry id, to resolve which stages are N/A.
 * @param epicStages - registry stage declarations by epic id.
 * @returns true when the epic is not ACCEPTED and some stage cell has left NOT_RUN.
 */
function isInFlight(row, epicId, epicStages) {
  if (row.status === 'ACCEPTED') return false
  const cells = Object.values(row.cells ?? {})
  const started = cells.some(cell => cell?.status !== undefined && cell.status !== 'NOT_RUN')
  if (!started) return false
  // An epic whose every started cell is GREEN has finished writing. Condition 2
  // exists to stop two epics writing one file CONCURRENTLY; a finished epic's
  // writes are history, not competition, so holding its files would block a
  // conflict that can no longer happen.
  //
  // "not accepted" and "still writing" are different states, and treating them
  // as one silently converts an acceptance lock into a permanent write lock:
  // a lock exists so a row is not marked ACCEPTED while a clause is unproven,
  // which says nothing about whether its files are still moving. Before this
  // check, P4-05 and P6-01 -- every cell GREEN, acceptance withheld by locks --
  // held every file they declared, and `check-ready` reported zero startable
  // epics (BLOCKED-087).
  //
  // GREEN is sufficient evidence that the writes have LANDED, but only because
  // of a coincidence between two mechanisms: a cell can be greened solely from
  // `first100-exact-sha.yml`'s exact-SHA artifact, which runs on a pushed
  // commit. Recorded here rather than left implicit -- if the greening path
  // ever accepts an observation from an unpushed tree, this equivalence stops
  // holding and this check would silently release locks on files that never
  // landed.
  // EVERY non-N/A cell must be GREEN, not merely every cell that has started.
  // Checking only started cells would release an epic that finished its
  // Contract stage while its Usage and Fault stages sit at NOT_RUN -- P2-03 is
  // exactly that today, and it is genuinely mid-work.
  return !everyApplicableCellGreen(row, epicId, epicStages)
}

/**
 * Whether every stage cell this epic actually has is GREEN — that is, whether
 * all of its declared work has landed.
 *
 * Shared by BOTH start conditions because both ask the same question about a
 * predecessor or neighbour: has this epic finished writing? Acceptance is a
 * separate fact, and conflating the two is the defect BLOCKED-087 records.
 * @param row - the ledger row to classify.
 * @param epicId - the epic's registry id, to resolve which stages are N/A.
 * @param epicStages - registry stage declarations by epic id.
 * @returns true when every non-N/A stage cell is GREEN.
 */
function everyApplicableCellGreen(row, epicId, epicStages) {
  const stages = epicStages.get(epicId) ?? {}
  const applicable = ['C', 'P', 'U', 'F'].filter(stage => stages[stage]?.nOf !== 'N/A')
  return applicable.every(stage => row.cells?.[stage]?.status === 'GREEN')
}

/**
 * Whether any cell has left NOT_RUN.
 * @param row - the ledger row to classify.
 * @returns true when work on this epic has begun.
 */
function hasStarted(row) {
  return Object.values(row.cells ?? {}).some(cell => cell?.status !== undefined && cell.status !== 'NOT_RUN')
}

const registry = readJson(REGISTRY_PATH)
const registryRows = Array.isArray(registry) ? registry : (registry.epics ?? registry.rows ?? Object.values(registry))
if (!Array.isArray(registryRows) || registryRows.length === 0) fail(`${REGISTRY_PATH} yielded no epic rows`)

const ledger = readJson(LEDGER_PATH)
const ledgerRows = ledger.rows
if (ledgerRows === undefined) fail(`${LEDGER_PATH} has no "rows" — regenerate it with generate-ledger.mjs`)

const byId = new Map(registryRows.map(epic => [epic.id, epic]))
const stagesById = new Map(registryRows.map(epic => [epic.id, epic.stages ?? {}]))

/**
 * Decide both start conditions for one epic against the current ledger.
 * @param id - the registry id of the epic to gate.
 * @returns `{ready: true}` when both conditions hold, otherwise `{ready: false, reasons}`
 * naming every unmet condition; exits non-zero instead of returning when a
 * condition cannot be computed at all.
 */
function decide(id) {
  const epic = byId.get(id)
  if (epic === undefined) fail(`epic ${id} is not in ${REGISTRY_PATH}`)

  const reasons = []

  // Condition 1 — every predecessor ACCEPTED.
  for (const predecessorId of epic.predecessors ?? []) {
    const row = ledgerRows[predecessorId]
    if (row === undefined) fail(`epic ${id}'s predecessor ${predecessorId} has no ledger row`)
    // ACCEPTED, or every applicable cell GREEN. A predecessor expresses "I
    // need your work to exist", never "I need your books closed" -- and an
    // epic held back only by an unproven clause has nonetheless delivered
    // every file its successor reads.
    //
    // This is BLOCKED-087's confusion in its SECOND location. That entry
    // separated "unaccepted" from "still writing" in condition 2 (the file
    // lock) and left condition 1 carrying the same conflation, which was
    // found only when it produced two circular dependencies: P6-01's lock is
    // owned by P6-02 while P6-02 waits on P6-01 being ACCEPTED, and P4-05's
    // lock is owned by P4-07 while P4-07 waits on P4-06, whose own lock has
    // no assigned owner. Neither cycle is anyone's mistake; both follow from
    // one field carrying two meanings.
    if (row.status !== 'ACCEPTED' && !everyApplicableCellGreen(row, predecessorId, stagesById)) {
      reasons.push(`predecessor ${predecessorId} is ${row.status} and has not landed every applicable stage cell`)
    }
  }

  // Condition 2 — no declared-file overlap with any in-flight epic.
  const own = declaredFiles(epic)
  for (const [otherId, row] of Object.entries(ledgerRows)) {
    if (otherId === id || !isInFlight(row, otherId, stagesById)) continue
    const other = byId.get(otherId)
    if (other === undefined) fail(`in-flight ledger row ${otherId} has no registry entry — cannot compute its file set`)
    const shared = [...declaredFiles(other)].filter(path => own.has(path))
    if (shared.length > 0) {
      reasons.push(`shares ${shared.length} file(s) with in-flight ${otherId}: ${shared.join(', ')}`)
    }
  }

  return reasons.length === 0 ? { ready: true } : { ready: false, reasons }
}

const target = process.argv[2]

if (target !== undefined) {
  const verdict = decide(target)
  if (verdict.ready) {
    // "ACCEPTED or fully landed", not "ACCEPTED": P1-03 is admitted today on a
    // predecessor that is NOT accepted (P1-02, every cell GREEN, acceptance
    // withheld by a live lock). Saying ACCEPTED here would state something
    // false about the very condition just evaluated.
    console.log(`READY: ${target} — every predecessor ACCEPTED or fully landed, no declared-file overlap with any in-flight epic`)
    process.exit(0)
  }
  console.error(`NOT READY: ${target}`)
  for (const reason of verdict.reasons) console.error(`  - ${reason}`)
  process.exit(1)
}

const ready = []
const inFlight = []
const blockedByPredecessor = []
const blockedByOverlap = []
const awaitingAcceptance = []
for (const epic of registryRows) {
  const row = ledgerRows[epic.id]
  if (row === undefined) fail(`epic ${epic.id} has no ledger row`)
  if (row.status === 'ACCEPTED') continue
  if (isInFlight(row, epic.id, stagesById)) {
    inFlight.push(epic.id)
    continue
  }
  // An epic whose every applicable cell is GREEN has no work left to start; it
  // is waiting on acceptance, not on capacity. It stops being in flight so it
  // releases its file locks, but listing it as startable would send someone to
  // an epic with nothing to do.
  if (hasStarted(row)) {
    awaitingAcceptance.push(epic.id)
    continue
  }
  const verdict = decide(epic.id)
  if (verdict.ready) {
    ready.push(epic.id)
    continue
  }
  // Which condition failed, so a zero count can be read without opening the
  // ledger. An epic failing both is counted under predecessors: an unmet
  // predecessor cannot be worked around, while a file overlap clears on its
  // own as the other epic finishes.
  const target = verdict.reasons.some(reason => reason.startsWith('predecessor '))
    ? blockedByPredecessor
    : blockedByOverlap
  target.push(epic.id)
}

console.log(`${ready.length} epic(s) ready to start:`)
for (const id of ready) console.log(`  ${id}  (wave ${byId.get(id).wave})`)
// Facts only, never an interpretation. `0 epic(s) ready to start` was the sole
// symptom of BLOCKED-087, a defect that froze the admission gate, and it is
// byte-identical to the output of a program where every epic is legitimately
// busy. The line could not distinguish its own two meanings, so the counts
// that separate them are printed beside it. Whether a given state is expected
// is the reader's judgment and is deliberately not stated here.
console.log(`  in flight: ${inFlight.length}${inFlight.length > 0 ? ` — ${inFlight.join(' ')}` : ''}`)
console.log(`  blocked by predecessors: ${blockedByPredecessor.length}${blockedByPredecessor.length > 0 ? ` — ${blockedByPredecessor.join(' ')}` : ''}`)
console.log(`  blocked by file overlap: ${blockedByOverlap.length}${blockedByOverlap.length > 0 ? ` — ${blockedByOverlap.join(' ')}` : ''}`)
console.log(`  awaiting acceptance: ${awaitingAcceptance.length}${awaitingAcceptance.length > 0 ? ` — ${awaitingAcceptance.join(' ')}` : ''}`)
// The five buckets partition every non-ACCEPTED epic. Printing the total lets
// a reader confirm that: counts that fail to reconcile mean this listing is
// hiding a state, which is the failure mode the whole block exists to prevent.
//
// This guard has NO reachable failure while the buckets above are correct, so
// no test can drive it directly and none claims to. Its coverage is indirect:
// deleting any bucket's push makes the totals disagree and reddens the cases
// that assert them. It is here for the next edit that adds a sixth state and
// forgets to print it — the same omission that made BLOCKED-087 invisible.
const accounted = ready.length + inFlight.length + blockedByPredecessor.length
  + blockedByOverlap.length + awaitingAcceptance.length
const outstanding = Object.values(ledgerRows).filter(row => row.status !== 'ACCEPTED').length
if (accounted !== outstanding) {
  fail(`listing accounts for ${accounted} epic(s) but ${outstanding} are not ACCEPTED — a state is unaccounted for`)
}
console.log(`  (${accounted} of ${outstanding} non-ACCEPTED epics accounted for)`)
process.exit(0)

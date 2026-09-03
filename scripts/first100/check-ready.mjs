#!/usr/bin/env node
/**
 * Per-epic start-of-work readiness gate for the First-100 program.
 *
 * The program schedules work in waves, but a wave barrier makes every epic in
 * wave N+1 wait for the slowest epic in wave N even when it depends on only one
 * of them. This gate replaces the barrier with the two conditions that are
 * actually load-bearing, so an epic starts as soon as they hold:
 *
 *   1. Every one of the epic's own `predecessors` is ACCEPTED in the ledger.
 *      Wave membership is not consulted — it stays a bookkeeping and
 *      dependency-expression field, not a start condition.
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
 * @returns true when the epic is not ACCEPTED and some stage cell has left NOT_RUN.
 */
function isInFlight(row) {
  if (row.status === 'ACCEPTED') return false
  return Object.values(row.cells ?? {}).some(cell => cell?.status !== undefined && cell.status !== 'NOT_RUN')
}

const registry = readJson(REGISTRY_PATH)
const registryRows = Array.isArray(registry) ? registry : (registry.epics ?? registry.rows ?? Object.values(registry))
if (!Array.isArray(registryRows) || registryRows.length === 0) fail(`${REGISTRY_PATH} yielded no epic rows`)

const ledger = readJson(LEDGER_PATH)
const ledgerRows = ledger.rows
if (ledgerRows === undefined) fail(`${LEDGER_PATH} has no "rows" — regenerate it with generate-ledger.mjs`)

const byId = new Map(registryRows.map(epic => [epic.id, epic]))

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
    if (row.status !== 'ACCEPTED') reasons.push(`predecessor ${predecessorId} is ${row.status}, not ACCEPTED`)
  }

  // Condition 2 — no declared-file overlap with any in-flight epic.
  const own = declaredFiles(epic)
  for (const [otherId, row] of Object.entries(ledgerRows)) {
    if (otherId === id || !isInFlight(row)) continue
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
    console.log(`READY: ${target} — every predecessor ACCEPTED, no declared-file overlap with any in-flight epic`)
    process.exit(0)
  }
  console.error(`NOT READY: ${target}`)
  for (const reason of verdict.reasons) console.error(`  - ${reason}`)
  process.exit(1)
}

const ready = []
for (const epic of registryRows) {
  const row = ledgerRows[epic.id]
  if (row === undefined) fail(`epic ${epic.id} has no ledger row`)
  if (row.status === 'ACCEPTED' || isInFlight(row)) continue
  if (decide(epic.id).ready) ready.push(epic.id)
}

console.log(`${ready.length} epic(s) ready to start:`)
for (const id of ready) console.log(`  ${id}  (wave ${byId.get(id).wave})`)
process.exit(0)

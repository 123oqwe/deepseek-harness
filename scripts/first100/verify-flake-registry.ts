/**
 * Mechanically enforces the BLOCKED-023 (2026-09-02) flake-registry evidence
 * standard: every `spec/first100/exec/flake-registry.json` entry must
 * satisfy (a) >=2 occurrences on >=2 distinct `candidateSha` values
 * (cross-SHA reproduction), or (b) >=2 occurrences on the SAME
 * `candidateSha` with genuine outcome divergence -- at least one 'failed'
 * and at least one 'passed' occurrence on that SHA (same-SHA attempt-level
 * non-determinism). Standard (b) never accepts same-SHA occurrences that
 * are all 'failed' -- a deterministic failure never registers under this
 * schema's own description; this script is the mechanical backstop for
 * that rule, not just prose in the schema file.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface Occurrence {
  ciRunUrl: string
  candidateSha: string
  observedAtUtc: string
  outcome: 'failed' | 'passed'
}

interface FlakeEntry {
  testFile: string
  testFullName: string
  occurrences: Occurrence[]
  unrelatedNote: string
  registeredAtUtc: string
  registeredBy: string
}

const root = resolve(import.meta.dirname, '..', '..')
const REGISTRY_PATH = resolve(root, 'spec/first100/exec/flake-registry.json')

/** True when this entry's occurrences satisfy either BLOCKED-023 evidence standard. */
function satisfiesEvidenceStandard(entry: FlakeEntry): { valid: boolean; reason?: string } {
  const shas = new Set(entry.occurrences.map(o => o.candidateSha))
  if (shas.size >= 2) return { valid: true }

  // Standard (b): all occurrences share one SHA -- require genuine divergence.
  if (shas.size === 1) {
    const outcomes = new Set(entry.occurrences.map(o => o.outcome))
    if (outcomes.has('failed') && outcomes.has('passed')) return { valid: true }
    if (outcomes.has('failed') && !outcomes.has('passed')) {
      return { valid: false, reason: 'same candidateSha, but every occurrence is "failed" -- this is a deterministic failure, never a flake; must not be registered' }
    }
    return { valid: false, reason: 'same candidateSha, but no "failed" occurrence recorded -- divergence requires at least one failure and one pass' }
  }
  return { valid: false, reason: 'fewer than 2 occurrences' }
}

function main(): void {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as { entries: FlakeEntry[] }
  const failures: string[] = []

  for (const entry of registry.entries) {
    if (entry.occurrences.length < 2) {
      failures.push(`${entry.testFile} :: ${entry.testFullName} -- fewer than 2 occurrences (minItems: 2)`)
      continue
    }
    const check = satisfiesEvidenceStandard(entry)
    if (!check.valid) {
      failures.push(`${entry.testFile} :: ${entry.testFullName} -- ${check.reason}`)
    }
  }

  // A test registered twice. Reported rather than fatal, and the distinction is
  // the point: absorption asks whether a failing test's fullName appears in this
  // registry, so a second entry for the same test changes no decision — it is
  // redundant bookkeeping, not a weakened gate. Making it fatal would also make
  // the repository red with no legal repair, since this registry is append-only
  // by its own schema and the duplicate cannot be removed.
  //
  // It exists because one was added on 2026-09-05 without checking whether the
  // test was already registered; it was, three days earlier, with STRONGER
  // evidence. Printing it is what stops the next person from re-deriving a
  // rerun that has already been done (BLOCKED-113).
  const seen = new Map<string, string>()
  const duplicates: string[] = []
  for (const entry of registry.entries) {
    const key = `${entry.testFile}\u0000${entry.testFullName}`
    const first = seen.get(key)
    if (first === undefined) seen.set(key, entry.registeredAtUtc)
    else duplicates.push(`${entry.testFile} :: registered ${first} and again ${entry.registeredAtUtc}`)
  }
  if (duplicates.length > 0) {
    console.log(
      `verify-flake-registry: ${duplicates.length} duplicate registration(s) -- redundant, not invalid:\n  ${duplicates.join('\n  ')}`,
    )
  }

  if (failures.length > 0) {
    console.error(`verify-flake-registry: ${failures.length} entr${failures.length === 1 ? 'y' : 'ies'} fail the BLOCKED-023 evidence standard:\n  ${failures.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`verify-flake-registry: ${registry.entries.length} entr${registry.entries.length === 1 ? 'y' : 'ies'} checked, all satisfy the BLOCKED-023 evidence standard.`)
}

main()

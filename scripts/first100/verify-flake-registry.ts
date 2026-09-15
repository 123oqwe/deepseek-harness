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
// ajv's DEFAULT export is draft-07 and refuses this schema outright with
// `no schema with key or ref ".../2020-12/schema"`. The 2020-12 build is a
// separate entry point.
import Ajv2020 from 'ajv/dist/2020'
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
const SCHEMA_PATH = resolve(root, 'spec/first100/exec/flake-registry.schema.json')

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

/** The registry as this script reads it: `candidates` is part of the file and was absent from the old type. */
export interface FlakeRegistry {
  entries: FlakeEntry[]
  candidates?: unknown[]
}

/**
 * Every reason a flake registry is not acceptable, in the order a reader should fix them: its shape against the
 * schema first, then the append idempotency key the schema cannot express, then the BLOCKED-023 evidence standard.
 * @param registry - the parsed `flake-registry.json`.
 * @param schema - the parsed `flake-registry.schema.json`.
 * @returns one message per failure; empty when the registry is acceptable. Schema failures start with `SCHEMA`.
 */
export function registryFailures(registry: FlakeRegistry, schema: object): string[] {
  const failures: string[] = []

  // Shape before content: a malformed file should fail on its shape, not on an
  // evidence standard it was never in a position to satisfy.
  // strict, so a misspelled schema keyword is refused at compile time instead of silently checking nothing.
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)
  if (!validate(registry)) {
    for (const error of validate.errors ?? []) {
      const extra = (error.params as { additionalProperty?: string }).additionalProperty
      failures.push(`SCHEMA ${error.instancePath || '/'} ${error.message ?? ''}${extra === undefined ? '' : ` (${extra})`}`)
    }
  }

  // (b) is NOT expressible in the schema: absorbedByCell is optional by design,
  // so JSON Schema cannot forbid the deletion that breaks idempotency. A duplicate
  // append repeats the run, the SHA and the outcome; the same run and SHA with a
  // divergent outcome is a re-attempt, the BLOCKED-023 evidence an entry exists
  // to record, and is never refused.
  for (const entry of registry.entries) {
    const byRunSha = new Map<string, number>()
    for (const o of entry.occurrences) {
      const k = `${o.ciRunUrl} ${o.candidateSha} ${o.outcome}`
      byRunSha.set(k, (byRunSha.get(k) ?? 0) + 1)
    }
    for (const o of entry.occurrences) {
      const k = `${o.ciRunUrl} ${o.candidateSha} ${o.outcome}`
      if ((o as { absorbedByCell?: string }).absorbedByCell === undefined && (byRunSha.get(k) ?? 0) > 1) {
        failures.push(
          `${entry.testFile} :: an occurrence on ${o.candidateSha} shares (ciRunUrl, candidateSha, outcome) with a sibling and carries no absorbedByCell -- `
          + 'that field is the third part of the append idempotency key (generate-ledger.mjs:674-678); without it a re-green of the same cell from '
          + 'the same run appends a duplicate and inflates the rate this entry is judged by',
        )
      }
    }
  }

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
  return failures
}

function main(): void {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as FlakeRegistry
  const failures = registryFailures(registry, JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as object)

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

// Only when run as a command. The spec imports registryFailures above.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) main()

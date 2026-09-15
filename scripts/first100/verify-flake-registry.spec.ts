/**
 * Controls for the flake registry's enforcer: the schema it validates against,
 * the append idempotency key the schema cannot express, and the BLOCKED-023
 * evidence standard.
 *
 * Every control starts from the live registry and schema, so a later edit to
 * either is measured against real data rather than a hand-built sample.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { registryFailures } from './verify-flake-registry.ts'
import type { FlakeRegistry } from './verify-flake-registry.ts'

const root = resolve(import.meta.dirname, '..', '..')
const schema = JSON.parse(readFileSync(resolve(root, 'spec/first100/exec/flake-registry.schema.json'), 'utf8')) as object
const live = (): FlakeRegistry & Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(root, 'spec/first100/exec/flake-registry.json'), 'utf8')) as FlakeRegistry & Record<string, unknown>

type Loose = Record<string, unknown>

describe('flake registry controls (2026-09-15)', () => {
  it('(a) accepts the live registry', () => {
    expect(registryFailures(live(), schema)).toStrictEqual([])
  })

  it('(b) refuses an occurrence that shares (ciRunUrl, candidateSha) with a sibling and carries no absorbedByCell', () => {
    const registry = live()
    const occurrences = registry.entries[0]?.occurrences as unknown as Loose[]
    const twin = { ...occurrences[0] }
    delete twin.absorbedByCell
    const original = { ...occurrences[0] }
    delete original.absorbedByCell
    occurrences.splice(0, 1, original, twin)
    const failures = registryFailures(registry, schema)
    expect(failures.some(failure => failure.includes('carries no absorbedByCell') && failure.includes('idempotency key'))).toBe(true)
  })

  it('(b2) accepts the same run and SHA with a divergent outcome, which is re-attempt evidence rather than a duplicate', () => {
    const registry = live()
    const occurrences = registry.entries[3]?.occurrences as unknown as Loose[]
    const first = occurrences[0] as Loose
    occurrences.push({ ...first, outcome: first.outcome === 'failed' ? 'passed' : 'failed', observedAtUtc: '2026-09-15T09:00:00Z' })
    expect(registryFailures(registry, schema)).toStrictEqual([])
  })

  it('(c) refuses an entry carrying a field the schema does not declare', () => {
    const registry = live()
    ;(registry.entries[0] as unknown as Loose).hunch = 'feels flaky'
    expect(registryFailures(registry, schema)).toContain('SCHEMA /entries/0 must NOT have additional properties (hunch)')
  })

  it('(d) accepts a candidate carrying two occurrences, so minItems stays 1', () => {
    const registry = live()
    const candidates = registry.candidates as Loose[]
    expect(candidates.some(candidate => (candidate.occurrences as unknown[]).length === 2)).toBe(true)
    expect(registryFailures(registry, schema)).toStrictEqual([])
  })

  it('(e) refuses a candidate that does not say why it is not registered', () => {
    const registry = live()
    delete (registry.candidates as Loose[])[0]?.whyNotRegistered
    expect(registryFailures(registry, schema).some(failure => failure.startsWith('SCHEMA /candidates/0') && failure.includes('whyNotRegistered'))).toBe(true)
  })

  it('(f) refuses prose left at the entry level, the shape before the notes migration', () => {
    const registry = live()
    const entry = registry.entries[0] as unknown as Loose & { notes: Loose }
    entry.backfillNote = entry.notes.backfillNote
    expect(registryFailures(registry, schema)).toContain('SCHEMA /entries/0 must NOT have additional properties (backfillNote)')
  })
})

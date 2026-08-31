/**
 * R0-3 / M0.C — vitest wrapper that runs the spec-repair checker.
 *
 * Discovered by vitest via the added `spec/**\/*.spec.ts` testIncludes entry.
 * The checker logic lives in `./first100-spec-repair-tests.ts` (the contract
 * named artifact, reused by R0-4's runner); this file is a thin adapter that
 * proves green on the committed R0-1+R0-2 state and red against each failure
 * mode (negative controls) by mutating a deep copy of the real registry.
 */
import { describe, expect, it } from 'vitest'
import {
  checkArtifacts,
  checkRegistry,
  deepCopy,
  parseDecisionLayers,
  readJson,
  readRegistry,
  type Registry,
} from './first100-spec-repair-tests.ts'

const withErrors = (mutate: (reg: Registry) => void): number => {
  const reg = deepCopy(readRegistry())
  mutate(reg)
  return checkRegistry(reg).length
}

describe('R0-3 spec-repair checker', () => {
  it('green: the committed registry satisfies the ownership/DAG contract', () => {
    const errs = checkRegistry(readRegistry())
    expect(errs, errs.join('\n')).toEqual([])
  })

  it('green: generated artifacts project exactly the 100 registry epics', () => {
    const errs = checkArtifacts(readRegistry())
    expect(errs, errs.join('\n')).toEqual([])
  })

  it('red: absence of the committed artifacts is rejected (fails closed)', () => {
    expect(() => readJson<unknown>('tests/first100/registry-absent.json')).toThrow()
  })

  it('red: forged primaryLayer value is rejected', () => {
    expect(withErrors(reg => { reg.epics[0]!.primaryLayer = 'L7_BOGUS' })).toBeGreaterThan(0)
  })

  it('red: a distribution-preserving primaryLayer swap between two epics is rejected (exact per-id layer)', () => {
    const reg = deepCopy(readRegistry())
    const byId = new Map(reg.epics.map(e => [e.id, e]))
    const pinned = parseDecisionLayers()
    // Pick two epics whose PINNED layers differ. Swapping their primaryLayer
    // values keeps the L0–L6 distribution identical (enum + count checks still
    // pass) but violates the exact per-id mapping — only the per-id check fires.
    const aId = [...pinned.keys()].find(id => byId.has(id))!
    const bId = [...pinned.keys()].find(id => id !== aId && pinned.get(id) !== pinned.get(aId))!
    const a = byId.get(aId)!
    const b = byId.get(bId)!
    const aLayer = a.primaryLayer
    const bLayer = b.primaryLayer
    expect(aLayer).not.toBe(bLayer)
    a.primaryLayer = bLayer
    b.primaryLayer = aLayer
    const errs = checkRegistry(reg)
    const perIdErrs = errs.filter(e => e.includes('pinned exact layer'))
    expect(perIdErrs.some(e => e.startsWith(`${aId}:`))).toBe(true)
    expect(perIdErrs.some(e => e.startsWith(`${bId}:`))).toBe(true)
  })

  it('red: placeholder `epic-owner/*` owner is rejected', () => {
    expect(withErrors(reg => { reg.epics[0]!.canonicalOwner = 'epic-owner/self' })).toBeGreaterThan(0)
  })

  it('red: unrecorded same-wave duplicate owner is rejected', () => {
    const reg = deepCopy(readRegistry())
    const waveWithTwo = [...new Set(reg.epics.map(e => e.wave))].find(
      w => reg.epics.filter(e => e.wave === w).length >= 2,
    )!
    const [a, b] = reg.epics.filter(e => e.wave === waveWithTwo)
    a!.files.push({ path: 'packages/fake/fake/src/dup.ts', kind: 'N' })
    b!.files.push({ path: 'packages/fake/fake/src/dup.ts', kind: 'N' })
    expect(checkRegistry(reg).length).toBeGreaterThan(0)
  })

  it('red: missing predecessor is rejected', () => {
    expect(withErrors(reg => { reg.epics[1]!.predecessors = ['P0-99'] })).toBeGreaterThan(0)
  })

  it('red: reverse edge (cycle) is rejected', () => {
    expect(withErrors(reg => { reg.epics[0]!.predecessors = [reg.epics[1]!.id] })).toBeGreaterThan(0)
  })

  it('red: empty wave is rejected', () => {
    expect(withErrors(reg => {
      const w1 = reg.epics[0]!.wave
      for (const e of reg.epics) if (e.wave === w1) e.wave = w1 + 1
    })).toBeGreaterThan(0)
  })

  it('red: missing stage is rejected', () => {
    expect(withErrors(reg => { delete reg.epics[0]!.stages.C })).toBeGreaterThan(0)
  })

  it('red: a >5-file slice is rejected', () => {
    expect(withErrors(reg => { reg.epics[0]!.stages.C!.files = ['a', 'b', 'c', 'd', 'e', 'f'] })).toBeGreaterThan(0)
  })
})

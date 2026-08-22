import { describe, it, expect } from 'vitest'
import { replay, checkNoExternalSideEffects, checkSchemaCompat, RecordedWorld } from '../src/index.ts'
import type { ReplayBundle } from '../src/types.ts'

function makeBundle(overrides: Partial<ReplayBundle> = {}): ReplayBundle {
  return {
    bundleId: 'b1',
    schemaFingerprint: 'fp-v1',
    runPlan: { steps: ['s1', 's2'] },
    events: [{ type: 'start' }, { type: 'end' }],
    modelStreams: [],
    externalObservations: new Map([['obs-1', { status: 'ok' }]]),
    policyInputs: [{ policy: 'allow' }],
    clockSeed: 42,
    randomSeed: 99,
    artifactRefs: [],
    ...overrides,
  }
}

describe('P7-08 Deterministic Replay', () => {
  it('replays bundle with matching projection', () => {
    const bundle = makeBundle()
    const result = replay(bundle, (_b, _w) => ({
      events: [{ type: 'start' }, { type: 'end' }],
      policies: [{ policy: 'allow' }],
      outcome: 'success',
    }))
    expect(result.allMatched).toBe(true)
    expect(result.diffs).toHaveLength(0)
  })

  it('detects projection mismatch', () => {
    const bundle = makeBundle()
    const result = replay(bundle, (_b, _w) => ({
      events: [{ type: 'different' }],
      policies: [{ policy: 'allow' }],
      outcome: 'fail',
    }))
    expect(result.allMatched).toBe(false)
    expect(result.diffs.length).toBeGreaterThan(0)
  })

  it('recorded world provides deterministic observations', () => {
    const bundle = makeBundle()
    const world = new RecordedWorld(bundle)
    expect(world.observe('obs-1')).toEqual({ status: 'ok' })
    expect(world.has('obs-2')).toBe(false)
  })

  it('replay produces no real external side effects', () => {
    const bundle = makeBundle()
    const world = new RecordedWorld(bundle)
    const check = checkNoExternalSideEffects(world)
    expect(check.passed).toBe(true)
    expect(check.networkCalls).toBe(0)
    expect(check.writeCalls).toBe(0)
  })

  it('detects when network calls are made during replay', () => {
    const bundle = makeBundle()
    const world = new RecordedWorld(bundle)
    world.recordNetworkCall()
    const check = checkNoExternalSideEffects(world)
    expect(check.passed).toBe(false)
    expect(check.networkCalls).toBe(1)
  })

  it('schema compatibility check', () => {
    expect(checkSchemaCompat('fp-v1', 'fp-v1').compatible).toBe(true)
    expect(checkSchemaCompat('fp-v1', 'fp-v2').compatible).toBe(false)
  })

  it('shadow mode does not produce policy diffs', () => {
    const bundle = makeBundle()
    const result = replay(bundle, (_b, _w) => ({
      events: [{ type: 'start' }, { type: 'end' }],
      policies: [{ policy: 'deny' }],
      outcome: 'shadow',
    }), true)
    expect(result.allMatched).toBe(true)
  })

  it('finds first divergence in diffs', () => {
    const bundle = makeBundle()
    const result = replay(bundle, (_b, _w) => ({
      events: [{ type: 'start' }, { type: 'changed' }],
      policies: [{ policy: 'allow' }],
      outcome: 'fail',
    }))
    expect(result.diffs.length).toBeGreaterThan(0)
    expect(result.diffs.some(d => !d.matched)).toBe(true)
  })

  it('100x replay produces identical results', () => {
    const bundle = makeBundle()
    let lastHash = ''
    for (let i = 0; i < 100; i++) {
      const result = replay(bundle, (_b, _w) => ({
        events: [{ type: 'start' }, { type: 'end' }],
        policies: [{ policy: 'allow' }],
        outcome: 'success',
      }))
      const hash = JSON.stringify(result.normalizedProjection)
      if (i > 0) expect(hash).toBe(lastHash)
      lastHash = hash
    }
  })

  it('outcome is returned from replay', () => {
    const bundle = makeBundle()
    const result = replay(bundle, (_b, _w) => ({
      events: [{ type: 'start' }, { type: 'end' }],
      policies: [{ policy: 'allow' }],
      outcome: 'success',
    }))
    expect(result.outcome).toBe('success')
  })
})

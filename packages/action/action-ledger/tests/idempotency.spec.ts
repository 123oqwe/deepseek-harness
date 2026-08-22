import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prepare, markSent, markConfirmed, markAmbiguous, compensate, getEntry, getByState, isConfirmed, clearLedger } from '../src/index.ts'

describe('P4-12 Idempotency Ledger', () => {
  beforeEach(() => clearLedger())
  afterEach(() => clearLedger())

  it('prepares an entry', () => {
    const entry = prepare({ idempotencyKey: 'key-1', actionManifestDigest: 'digest', providerId: 'api', externalTarget: 'https://api.example.com' })
    expect(entry.state).toBe('prepared')
  })

  it('returns confirmed entry on duplicate prepare', () => {
    prepare({ idempotencyKey: 'key-1', actionManifestDigest: 'd', providerId: 'api', externalTarget: 'url' })
    markSent('key-1')
    markConfirmed('key-1', { ok: true })
    const dup = prepare({ idempotencyKey: 'key-1', actionManifestDigest: 'd', providerId: 'api', externalTarget: 'url' })
    expect(dup.state).toBe('confirmed')
    expect(dup.result).toEqual({ ok: true })
  })

  it('transitions prepared -> sent -> confirmed', () => {
    prepare({ idempotencyKey: 'k', actionManifestDigest: 'd', providerId: 'p', externalTarget: 't' })
    markSent('k')
    const confirmed = markConfirmed('k', { result: 'ok' })
    expect(confirmed.state).toBe('confirmed')
    expect(isConfirmed('k')).toBe(true)
  })

  it('marks ambiguous on timeout', () => {
    prepare({ idempotencyKey: 'k', actionManifestDigest: 'd', providerId: 'p', externalTarget: 't' })
    markSent('k')
    const amb = markAmbiguous('k')
    expect(amb.state).toBe('ambiguous')
  })

  it('compensates an entry', () => {
    prepare({ idempotencyKey: 'k', actionManifestDigest: 'd', providerId: 'p', externalTarget: 't' })
    markSent('k')
    const comp = compensate('k', 'rollback needed')
    expect(comp.state).toBe('compensated')
    expect(comp.compensationReason).toBe('rollback needed')
  })

  it('getByState filters entries', () => {
    prepare({ idempotencyKey: 'k1', actionManifestDigest: 'd', providerId: 'p', externalTarget: 't' })
    prepare({ idempotencyKey: 'k2', actionManifestDigest: 'd', providerId: 'p', externalTarget: 't' })
    markSent('k2')
    markConfirmed('k2', {})
    expect(getByState('prepared')).toHaveLength(1)
    expect(getByState('confirmed')).toHaveLength(1)
  })
})

import { describe, it, expect } from 'vitest'
import { PROFILES, getProfile, validateProfile, type PolicyProfile } from '../src/schema.ts'

describe('P2-11 Policy Profile', () => {
  it('has 4 predefined profiles', () => {
    expect(PROFILES).toHaveLength(4)
  })

  it('observe-only has no writable paths', () => {
    const profile = getProfile('observe-only')
    expect(profile?.fs.writable).toHaveLength(0)
  })

  it('production-controlled uses container execution', () => {
    const profile = getProfile('production-controlled')
    expect(profile?.executionWorld).toBe('container')
  })

  it('no profile disables kernel hard deny', () => {
    for (const p of PROFILES) {
      expect(p.kernelHardDenyDisabled).toBe(false)
    }
  })

  it('profiles have increasing privilege levels', () => {
    const observe = getProfile('observe-only')!
    const team = getProfile('team-standard')!
    expect(team.budget.maxTokens).toBeGreaterThan(observe.budget.maxTokens)
  })

  it('validates valid profile', () => {
    const result = validateProfile(PROFILES[0]!)
    expect(result.valid).toBe(true)
  })

  it('rejects profile with kernel hard deny disabled', () => {
    const invalid: PolicyProfile = { ...PROFILES[0]!, kernelHardDenyDisabled: true }
    const result = validateProfile(invalid)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('kernelHardDeny'))).toBe(true)
  })

  it('rejects profile with L0 plugin trust', () => {
    const invalid: PolicyProfile = { ...PROFILES[0]!, pluginTrust: { minLevel: 'L0-unknown' } }
    const result = validateProfile(invalid)
    expect(result.valid).toBe(false)
  })

  it('production requires L4 plugins', () => {
    const profile = getProfile('production-controlled')
    expect(profile?.pluginTrust.minLevel).toBe('L4-production')
  })

  it('all profiles can serialize', () => {
    for (const p of PROFILES) {
      const json: string = JSON.stringify(p)
      const parsed: PolicyProfile = JSON.parse(json) as PolicyProfile
      expect(parsed.name).toBe(p.name)
    }
  })
})

import { describe, it, expect } from 'vitest'
import { getSupportedVersions, isSupported, negotiate, compareVersions, formatVersion } from '../src/version.ts'
import { discoverCapabilities, hasCapability, getCapability, type ServerCapability } from '../src/capabilities.ts'

describe('P8-01 Protocol Version Negotiation', () => {
  it('has supported versions', () => {
    const versions = getSupportedVersions()
    expect(versions.length).toBeGreaterThan(0)
  })

  it('isSupported checks version', () => {
    expect(isSupported({ major: 0, minor: 1 })).toBe(true)
    expect(isSupported({ major: 99, minor: 0 })).toBe(false)
  })

  it('negotiates exact version match', () => {
    const result = negotiate({ major: 0, minor: 1 }, [{ major: 0, minor: 1 }])
    expect(result.agreed).toBe(true)
    expect(result.agreedVersion!.major).toBe(0)
  })

  it('negotiates backward compatible version', () => {
    const result = negotiate({ major: 0, minor: 1 }, [{ major: 0, minor: 2 }])
    expect(result.agreed).toBe(true)
  })

  it('fails on major version mismatch', () => {
    const result = negotiate({ major: 1, minor: 0 }, [{ major: 0, minor: 1 }])
    expect(result.agreed).toBe(false)
  })

  it('compareVersions orders correctly', () => {
    expect(compareVersions({ major: 0, minor: 1 }, { major: 0, minor: 2 })).toBeLessThan(0)
    expect(compareVersions({ major: 1, minor: 0 }, { major: 0, minor: 1 })).toBeGreaterThan(0)
  })

  it('formatVersion produces readable string', () => {
    expect(formatVersion({ major: 0, minor: 1 })).toBe('v0.1')
  })

  it('discovers server capabilities', () => {
    const caps: ServerCapability[] = [
      { name: 'session:prompt', version: '0.1', optional: false },
      { name: 'session:event', version: '0.1', optional: false },
      { name: 'session:status', version: '0.1', optional: true },
    ]
    const result = discoverCapabilities('deepseek-harness-sdk-runtime', '0.1.0', caps)
    expect(result.serverName).toBe('deepseek-harness-sdk-runtime')
    expect(result.capabilities.length).toBe(3)
  })

  it('hasCapability checks existence', () => {
    const result = discoverCapabilities('test', '0.1', [{ name: 'test:cap', version: '0.1', optional: false }])
    expect(hasCapability(result, 'test:cap')).toBe(true)
    expect(hasCapability(result, 'nonexistent')).toBe(false)
  })

  it('getCapability returns the capability', () => {
    const result = discoverCapabilities('test', '0.1', [{ name: 'test:cap', version: '0.1', optional: false }])
    const cap = getCapability(result, 'test:cap')
    expect(cap).toBeDefined()
    expect(cap!.name).toBe('test:cap')
  })
})

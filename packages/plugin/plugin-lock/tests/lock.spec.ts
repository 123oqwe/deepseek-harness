import { describe, it, expect } from 'vitest'
import { generateLock, computeLockHash, verifyLockIntegrity, resolvePlugin, detectDrift, type LockedDependency } from '../src/index.ts'

const deps: LockedDependency[] = [
  { name: 'dep-a', version: '1.0.0', resolved: 'https://example.com/dep-a-1.0.0.tgz', integrity: 'sha512-abc', optional: false },
  { name: 'dep-b', version: '2.0.0', resolved: 'https://example.com/dep-b-2.0.0.tgz', integrity: 'sha512-def', optional: true },
]

describe('P1-03 Plugin Lock File', () => {
  it('generates a lock file', () => {
    const lock = generateLock([{ name: 'plugin-a', version: '1.0.0', dependencies: deps }])
    expect(lock.version).toBe(1)
    expect(Object.keys(lock.plugins)).toContain('plugin-a')
    expect(lock.plugins['plugin-a']!.version).toBe('1.0.0')
  })

  it('computes deterministic hash', () => {
    const lock = generateLock([{ name: 'plugin-a', version: '1.0.0', dependencies: deps }])
    const hash1 = computeLockHash(lock)
    const hash2 = computeLockHash(lock)
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('verifies lock integrity', () => {
    const lock = generateLock([{ name: 'plugin-a', version: '1.0.0', dependencies: deps }])
    const hash = computeLockHash(lock)
    expect(verifyLockIntegrity(lock, hash)).toBe(true)
    expect(verifyLockIntegrity(lock, 'wrong')).toBe(false)
  })

  it('resolves plugin from lock', () => {
    const lock = generateLock([{ name: 'plugin-a', version: '1.0.0', dependencies: deps }])
    const resolved = resolvePlugin(lock, 'plugin-a')
    expect(resolved).toBeDefined()
    expect(resolved!.dependencies.length).toBe(2)
    expect(resolvePlugin(lock, 'nonexistent')).toBeUndefined()
  })

  it('detects drift between lock files', () => {
    const lock1 = generateLock([{ name: 'a', version: '1.0', dependencies: [] }, { name: 'b', version: '2.0', dependencies: [] }])
    const lock2 = generateLock([{ name: 'a', version: '1.1', dependencies: [] }, { name: 'c', version: '3.0', dependencies: [] }])
    const drifts = detectDrift(lock1, lock2)
    expect(drifts.some(d => d.includes("'b'"))).toBe(true)
    expect(drifts.some(d => d.includes("'c'"))).toBe(true)
    expect(drifts.some(d => d.includes('1.0') && d.includes('1.1'))).toBe(true)
  })
})

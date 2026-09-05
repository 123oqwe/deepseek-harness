/**
 * P1-03 Provider stage: building a candidate lock from an observed install.
 *
 * The generator's central obligation is NOT to invent. Some of must[0]'s nine
 * facts are readable from an installed package; the rest are properties of how
 * it was published and are absent unless the package declares them. A
 * generator that filled those in with plausible values would produce a lock
 * that looks complete and verifies nothing — the exact failure this epic
 * exists to prevent, committed by the tool meant to prevent it.
 */

import { describe, expect, it } from 'vitest'
import {
  buildCandidateLock,
  computeManifestDigest,
  isUnavailable,
  summarizeLockCoverage,
  UNAVAILABLE_PREFIX,
} from '../src/candidate.ts'
import { validateLock } from '../src/types.ts'
import type { ObservedPackage } from '../src/candidate.ts'

function observed(name: string, overrides: Partial<ObservedPackage> = {}): ObservedPackage {
  return {
    name,
    version: '1.0.0',
    manifest: { name, version: '1.0.0' },
    dependencies: [],
    grantedCapabilities: [],
    ...overrides,
  }
}

describe('P1-03 must[1]: the candidate records observations and marks the rest', () => {
  it('marks integrity, source commit and signature identity when the package declares none', () => {
    const candidate = buildCandidateLock([observed('alpha')])
    const entry = candidate?.entries[0]

    // Each marker names WHY the fact is missing, so a reader is not left to
    // guess whether it was unavailable or simply dropped.
    expect(isUnavailable(entry?.integrity ?? '')).toBe(true)
    expect(isUnavailable(entry?.sourceCommit ?? '')).toBe(true)
    expect(isUnavailable(entry?.signatureIdentity ?? '')).toBe(true)
    expect(entry?.integrity).toContain('installer-recorded-no-integrity')
  })

  it('records a declared provenance fact verbatim instead of marking it', () => {
    const candidate = buildCandidateLock([observed('alpha', {
      integrity: 'sha512-real',
      sourceCommit: 'abc123',
      signatureIdentity: 'github:acme/alpha',
    })])
    const entry = candidate?.entries[0]

    expect(entry?.integrity).toBe('sha512-real')
    expect(isUnavailable(entry?.signatureIdentity ?? '')).toBe(false)
  })

  it('always computes the manifest digest, since that IS observable', () => {
    const candidate = buildCandidateLock([observed('alpha')])

    // The one fact of the four that an installed directory always carries.
    expect(candidate?.entries[0]?.manifestDigest.startsWith('sha256-')).toBe(true)
    expect(isUnavailable(candidate?.entries[0]?.manifestDigest ?? '')).toBe(false)
  })

  it('digests a manifest independently of its key order', () => {
    // Two installs of one package must not differ because their JSON was
    // written in a different order; otherwise the digest reports drift for a
    // reformat.
    expect(computeManifestDigest({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(computeManifestDigest({ b: { d: 3, c: 2 }, a: 1 }))
  })

  it('reports a different digest when the manifest content actually differs', () => {
    expect(computeManifestDigest({ a: 1 })).not.toBe(computeManifestDigest({ a: 2 }))
  })
})

describe('P1-03: a generated candidate is already valid', () => {
  it('emits entries in canonical order with a resolved load order', () => {
    const candidate = buildCandidateLock([
      observed('zeta', { dependencies: ['alpha'] }),
      observed('alpha'),
    ])

    // Emitting an invalid candidate would push the failure to commit time,
    // where the reason is harder to read.
    expect(candidate?.entries.map(entry => entry.name)).toEqual(['alpha', 'zeta'])
    expect(candidate?.loadOrder).toEqual(['alpha', 'zeta'])
    expect(validateLock(candidate!)).toEqual({ valid: true })
  })

  it('drops a dependency on a package outside the observed set', () => {
    // A lock entry may only depend on another entry, so keeping an external
    // dependency would make every generated candidate invalid.
    const candidate = buildCandidateLock([observed('alpha', { dependencies: ['left-pad'] })])

    expect(candidate?.entries[0]?.dependencies).toEqual([])
    expect(validateLock(candidate!)).toEqual({ valid: true })
  })

  it('returns no candidate at all when the observed graph has a cycle', () => {
    const cyclic = buildCandidateLock([
      observed('alpha', { dependencies: ['beta'] }),
      observed('beta', { dependencies: ['alpha'] }),
    ])

    expect(cyclic).toBeUndefined()
  })
})

describe('P1-03: coverage is reported, so "locked" is not overstated', () => {
  it('counts observed facts against unavailable ones', () => {
    const candidate = buildCandidateLock([
      observed('alpha', { integrity: 'sha512-real', sourceCommit: 'abc', signatureIdentity: 'github:acme/alpha' }),
      observed('beta'),
    ])

    // alpha: four observed. beta: manifest digest observed, three marked.
    expect(summarizeLockCoverage(candidate!)).toEqual({ observed: 5, unavailable: 3 })
  })

  it('reports a fully-marked lock as mostly unavailable rather than as locked', () => {
    const candidate = buildCandidateLock([observed('alpha'), observed('beta')])
    const coverage = summarizeLockCoverage(candidate!)

    // A real lock file that pins no archive. Saying "locked" without saying
    // this would overstate what the file guarantees.
    expect(coverage.unavailable).toBeGreaterThan(coverage.observed)
  })

  it('marks nothing when every package declares full provenance', () => {
    const candidate = buildCandidateLock([observed('alpha', {
      integrity: 'sha512-real', sourceCommit: 'abc', signatureIdentity: 'github:acme/alpha',
    })])

    expect(summarizeLockCoverage(candidate!)).toEqual({ observed: 4, unavailable: 0 })
  })

  it('uses one recognizable prefix for every marker', () => {
    const candidate = buildCandidateLock([observed('alpha')])
    const entry = candidate?.entries[0]

    for (const fact of [entry?.integrity, entry?.sourceCommit, entry?.signatureIdentity]) {
      expect(fact?.startsWith(UNAVAILABLE_PREFIX)).toBe(true)
    }
  })
})

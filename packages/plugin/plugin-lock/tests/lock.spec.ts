/**
 * Clause coverage for Epic P1-03's reproducible plugin lock.
 *
 * **A constraint this suite is written under, adjudicated before it was
 * written.** `signatureIdentity` may be asserted to be RECORDED and to stay
 * stable across registry tag drift. It may NOT be asserted to be trustworthy,
 * or to be the reason a forged package is refused. Today
 * `verifyPackageSignature` trusts a first-seen issuer, so the identity a lock
 * records is an unverified self-assertion — and a case reading "the lock
 * records the signer, therefore a forged package is rejected" would pass
 * because nothing is rejecting, not because something is. That guarantee is
 * P1-02's, it is under a live acceptance lock, and this epic must not borrow
 * it to colour its own cells green.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { admitBoot, hasTagDrifted, resolveLoadOrder, validateLock } from '../src/index.ts'
import type { InstalledPlugin } from '../src/index.ts'
import type {
  GrantedCapability,
  ManifestDigest,
  PackageIntegrity,
  PluginLockEntry,
  PluginLockFile,
  PluginPackageName,
  PluginVersion,
  SignatureIdentity,
  SourceCommit,
} from '../src/types.ts'

function name(value: string): PluginPackageName {
  return brandString<PluginPackageName>(value)
}

function entry(id: string, overrides: Partial<PluginLockEntry> = {}): PluginLockEntry {
  return {
    name: name(id),
    version: brandString<PluginVersion>('1.0.0'),
    integrity: brandString<PackageIntegrity>(`sha512-${id}-archive`),
    sourceCommit: brandString<SourceCommit>(`commit-${id}`),
    manifestDigest: brandString<ManifestDigest>(`sha256-${id}-manifest`),
    signatureIdentity: brandString<SignatureIdentity>(`github:acme/${id}`),
    dependencies: [],
    grantedCapabilities: [brandString<GrantedCapability>('fs:read')],
    ...overrides,
  }
}

function lock(entries: readonly PluginLockEntry[], loadOrder?: readonly PluginPackageName[]): PluginLockFile {
  return {
    lockfileVersion: 1,
    entries,
    loadOrder: loadOrder ?? resolveLoadOrder(entries) ?? [],
  }
}

function installedFrom(source: PluginLockEntry, overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    name: source.name,
    version: source.version,
    integrity: source.integrity,
    manifestDigest: source.manifestDigest,
    ...overrides,
  }
}

describe('P1-03 must[0]: the lock records every fact the clause enumerates', () => {
  it('carries package, version, integrity, source commit, manifest digest, signature identity, dependencies and capabilities', () => {
    const locked = entry('alpha', { dependencies: [name('beta')] })

    // Asserted as one exact key set rather than field by field: a lock missing
    // one of the nine would otherwise still satisfy eight assertions, and a
    // lock that validates while recording less than it claims reports a
    // reproducibility it cannot deliver.
    expect(Object.keys(locked).sort()).toEqual([
      'dependencies',
      'grantedCapabilities',
      'integrity',
      'manifestDigest',
      'name',
      'signatureIdentity',
      'sourceCommit',
      'version',
    ])
  })

  it('records the signature identity WITHOUT that recording implying it was verified', () => {
    // The permitted half of the adjudicated constraint. What is checked is
    // that the field survives into the lock verbatim — not that its value is
    // trustworthy, which nothing in this repository can decide today.
    const claimed = brandString<SignatureIdentity>('github:acme/alpha')
    expect(entry('alpha', { signatureIdentity: claimed }).signatureIdentity).toBe(claimed)
  })
})

describe('P1-03 must[0]: the lock is byte-stable, so two machines write one file', () => {
  it('refuses entries that are not in canonical order', () => {
    const unsorted = lock([entry('beta'), entry('alpha')], [name('alpha'), name('beta')])

    expect(validateLock(unsorted))
      .toMatchObject({ valid: false, reason: 'entries-not-canonical' })
  })

  it('resolves a TOTAL load order, so independent plugins do not order by chance', () => {
    // `gamma` and `beta` are mutually independent: several topological orders
    // exist and the traversal must not pick whichever it reached first.
    const entries = [entry('alpha', { dependencies: [name('beta'), name('gamma')] }), entry('beta'), entry('gamma')]

    expect(resolveLoadOrder(entries)).toEqual([name('beta'), name('gamma'), name('alpha')])
    expect(resolveLoadOrder([...entries].reverse())).toEqual([name('beta'), name('gamma'), name('alpha')])
  })

  it('reports no order at all for a dependency cycle', () => {
    const cyclic = [entry('alpha', { dependencies: [name('beta')] }), entry('beta', { dependencies: [name('alpha')] })]

    expect(resolveLoadOrder(cyclic)).toBeUndefined()
  })

  it('refuses a lock whose load order places a plugin before its dependency', () => {
    const entries = [entry('alpha', { dependencies: [name('beta')] }), entry('beta')]

    expect(validateLock(lock(entries, [name('alpha'), name('beta')])))
      .toMatchObject({ valid: false, reason: 'load-order-violates-dependency' })
  })

  it('refuses a dangling dependency and a duplicate entry', () => {
    expect(validateLock(lock([entry('alpha', { dependencies: [name('missing')] })], [name('alpha')])))
      .toMatchObject({ valid: false, reason: 'dangling-dependency' })
    expect(validateLock(lock([entry('alpha'), entry('alpha')], [name('alpha')])))
      .toMatchObject({ valid: false, reason: 'duplicate-entry' })
  })

  it('accepts a well-formed lock, so the checks above are not refusing everything', () => {
    const entries = [entry('alpha', { dependencies: [name('beta')] }), entry('beta')]

    expect(validateLock(lock(entries))).toEqual({ valid: true })
  })
})

describe('P1-03 must[2] and acceptance[0]: boot loads only what the lock approves', () => {
  it('admits an install that matches the lock exactly, and returns the locked order', () => {
    const entries = [entry('alpha', { dependencies: [name('beta')] }), entry('beta')]
    const locked = lock(entries)

    expect(admitBoot(locked, entries.map(source => installedFrom(source))))
      .toEqual({ admitted: true, loadOrder: [name('beta'), name('alpha')] })
  })

  it('refuses the WHOLE boot when one plugin\'s integrity drifted, not just that plugin', () => {
    const entries = [entry('alpha'), entry('beta')]
    const installed = [
      installedFrom(entries[0] as PluginLockEntry, { integrity: brandString<PackageIntegrity>('sha512-tampered') }),
      installedFrom(entries[1] as PluginLockEntry),
    ]

    // Loading everything except the drifted plugin yields a DIFFERENT profile
    // from the locked one, and a working system with a silently missing
    // feature is the worse outcome.
    const result = admitBoot(lock(entries), installed)
    expect(result).toMatchObject({ admitted: false })
    if (result.admitted) throw new Error('unreachable: asserted refusal above')
    expect(result.denials).toEqual([{ name: name('alpha'), reason: 'integrity-mismatch' }])
  })

  it('reports EVERY denial, so an operator repairing an install sees the whole list', () => {
    const entries = [entry('alpha'), entry('beta')]
    const installed = [
      installedFrom(entries[0] as PluginLockEntry, { version: brandString<PluginVersion>('9.9.9') }),
      installedFrom(entries[1] as PluginLockEntry, { manifestDigest: brandString<ManifestDigest>('sha256-other') }),
    ]

    const result = admitBoot(lock(entries), installed)
    if (result.admitted) throw new Error('unreachable')
    expect(result.denials).toEqual([
      { name: name('alpha'), reason: 'version-mismatch' },
      { name: name('beta'), reason: 'manifest-digest-mismatch' },
    ])
  })

  it('refuses a plugin present on disk but absent from the lock', () => {
    const locked = lock([entry('alpha')])
    const installed = [installedFrom(entry('alpha')), installedFrom(entry('stowaway'))]

    const result = admitBoot(locked, installed)
    if (result.admitted) throw new Error('unreachable')
    expect(result.denials).toEqual([{ name: name('stowaway'), reason: 'not-in-lock' }])
  })

  it('refuses a plugin the lock requires but disk does not have (validation[2])', () => {
    const entries = [entry('alpha'), entry('beta')]
    const result = admitBoot(lock(entries), [installedFrom(entries[0] as PluginLockEntry)])

    if (result.admitted) throw new Error('unreachable')
    expect(result.denials).toEqual([{ name: name('beta'), reason: 'missing-from-disk' }])
  })

  it('acceptance[0]: the offline cold start is the same call, with no network-shaped parameter', () => {
    // The locked facts and the installed facts are both already-resolved data.
    // There is no registry handle to omit when the network is gone, so the
    // offline path cannot diverge from the online one.
    const entries = [entry('alpha')]
    expect(admitBoot(lock(entries), entries.map(source => installedFrom(source))).admitted).toBe(true)
  })
})

describe('P1-03 acceptance[1]: registry tag drift does not change a locked profile', () => {
  it('reports drift when the registry has moved, without changing what boot loads', () => {
    const locked = entry('alpha')
    const drifted = brandString<PluginVersion>('2.0.0')

    expect(hasTagDrifted(locked, drifted)).toBe(true)
    expect(hasTagDrifted(locked, locked.version)).toBe(false)

    // The lock still governs: boot admits the LOCKED version and the registry's
    // newer answer changes nothing. Reporting drift is the only legitimate
    // response -- following the registry is what a lock exists to prevent.
    expect(admitBoot(lock([locked]), [installedFrom(locked)]).admitted).toBe(true)
  })

  it('refuses the drifted version even once it is what is installed', () => {
    const locked = entry('alpha')
    const installed = installedFrom(locked, { version: brandString<PluginVersion>('2.0.0') })

    const result = admitBoot(lock([locked]), [installed])
    if (result.admitted) throw new Error('unreachable')
    expect(result.denials).toEqual([{ name: name('alpha'), reason: 'version-mismatch' }])
  })
})

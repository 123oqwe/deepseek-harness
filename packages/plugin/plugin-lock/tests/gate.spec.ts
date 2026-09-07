/**
 * P1-03 Usage stage: the production-boot lock gate (must[2]).
 *
 * The question these cases decide is the one that comes before `admitBoot`:
 * what a boot does with a profile that has no lock. Nothing in this repository
 * generates a lock yet, so both answers break something — refusing breaks
 * every existing boot, admitting lets must[2] read as enforced while enforcing
 * nothing. The policy is therefore a required parameter, and these cases pin
 * that both branches are reachable and distinguishable.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { gateProductionBoot } from '../src/gate.ts'
import { admitBoot, UNAVAILABLE_PREFIX } from '../src/index.ts'
import { WORKSPACE_LINK_PREFIX } from '../src/lockfile-integrity.ts'
import { resolveLoadOrder } from '../src/types.ts'
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
    integrity: brandString<PackageIntegrity>(`sha512-${id}`),
    sourceCommit: brandString<SourceCommit>(`commit-${id}`),
    manifestDigest: brandString<ManifestDigest>(`sha256-${id}`),
    signatureIdentity: brandString<SignatureIdentity>(`github:acme/${id}`),
    dependencies: [],
    grantedCapabilities: [brandString<GrantedCapability>('fs:read')],
    ...overrides,
  }
}

function lock(entries: readonly PluginLockEntry[]): PluginLockFile {
  return { lockfileVersion: 1, entries, loadOrder: resolveLoadOrder(entries) ?? [] }
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

describe('P1-03 must[2]: a locked profile boots only what the lock approves', () => {
  it('admits a matching install and reports the boot as verified', () => {
    const entries = [entry('alpha', { dependencies: [name('beta')] }), entry('beta')]
    const outcome = gateProductionBoot(lock(entries), entries.map(source => installedFrom(source)), 'refuse')

    expect(outcome).toEqual({ admitted: true, loadOrder: [name('beta'), name('alpha')], verified: true })
  })

  it('refuses a drifted install and does not soften admitBoot\'s verdict', () => {
    const entries = [entry('alpha')]
    const drifted = [installedFrom(entries[0] as PluginLockEntry, { integrity: brandString<PackageIntegrity>('sha512-other') })]
    const outcome = gateProductionBoot(lock(entries), drifted, 'warn-and-proceed')

    // The unlocked-profile policy governs ONLY the absent-lock case. A profile
    // that HAS a lock is judged against it whatever the policy says, or
    // 'warn-and-proceed' would become a way to skip verification entirely.
    expect(outcome).toMatchObject({ admitted: false })
    if (outcome.admitted || !('admission' in outcome)) throw new Error('unreachable')
    expect(outcome.admission).toMatchObject({ admitted: false })
  })
})

describe('P1-03: an unlocked profile is a deployment decision, not a default', () => {
  it('refuses when the policy is refuse, naming the gate rather than a plugin', () => {
    const outcome = gateProductionBoot(undefined, [installedFrom(entry('alpha'))], 'refuse')

    // The refusal names the GATE. Reporting a per-plugin denial would tell an
    // operator to fix a plugin when the real state is that nothing was locked.
    expect(outcome).toEqual({ admitted: false, gateReason: 'no-lock-file' })
  })

  it('proceeds when the policy allows it, but marks the boot UNVERIFIED', () => {
    const installed = [installedFrom(entry('alpha'))]
    const outcome = gateProductionBoot(undefined, installed, 'warn-and-proceed')

    // `verified: false` is the whole point of this branch. Without it a caller
    // could not tell an unlocked boot from a checked one, and "loaded
    // successfully" would mean two different things.
    expect(outcome).toEqual({ admitted: true, loadOrder: [name('alpha')], verified: false })
  })

  it('marks a locked, matching boot verified and an unlocked one not, on the same install', () => {
    const entries = [entry('alpha')]
    const installed = entries.map(source => installedFrom(source))

    const locked = gateProductionBoot(lock(entries), installed, 'warn-and-proceed')
    const unlocked = gateProductionBoot(undefined, installed, 'warn-and-proceed')

    // Same plugins, same policy, both admitted — and the two outcomes must
    // still be distinguishable, because only one of them checked anything.
    expect(locked).toMatchObject({ admitted: true, verified: true })
    expect(unlocked).toMatchObject({ admitted: true, verified: false })
  })
})

describe('P1-03 must[0]: an unverifiable integrity is not evidence (BLOCKED-135)', () => {
  it('refuses a package whose integrity is the `unavailable:` marker on BOTH sides, since two absences are not agreement', () => {
    // The defect this closes: the marker used to match itself. A lock
    // recording `unavailable:` and a boot recomputing `unavailable:` compared
    // EQUAL, so the integrity check passed while verifying nothing — and
    // because nothing ever wrote the field it read, that was every real
    // package.
    const unverifiable = entry('alpha', { integrity: brandString<PackageIntegrity>(`${UNAVAILABLE_PREFIX}installer-recorded-no-integrity`) })
    const outcome = admitBoot(lock([unverifiable]), [installedFrom(unverifiable)])
    expect(outcome.admitted).toBe(false)
    expect(!outcome.admitted && outcome.denials.map(denial => denial.reason)).toContain('integrity-unverifiable')
  })

  it('admits the same package once BOTH sides carry a real digest, so the refusal is caused by the marker', () => {
    // The control. Without it, the case above is satisfied by a gate that
    // refuses every package, and `integrity-unverifiable` would say nothing
    // about markers in particular.
    const verifiable = entry('alpha')
    expect(admitBoot(lock([verifiable]), [installedFrom(verifiable)]).admitted).toBe(true)
  })

  it('refuses when only the INSTALL side is unverifiable, so a lock with a real digest cannot be satisfied by an absence', () => {
    const locked = entry('alpha')
    const installed = installedFrom(locked, { integrity: brandString<PackageIntegrity>(`${UNAVAILABLE_PREFIX}installer-recorded-no-integrity`) })
    const outcome = admitBoot(lock([locked]), [installed])
    expect(outcome.admitted).toBe(false)
    expect(!outcome.admitted && outcome.denials.map(denial => denial.reason)).toContain('integrity-unverifiable')
  })

  it('admits a workspace link, whose integrity records the link target because there is no archive to hash', () => {
    // The exemption, and it is narrow: a workspace link genuinely has no
    // published archive. It is admitted because its integrity is a real
    // observation of what it is, not a marker standing in for one that is
    // missing.
    const linked = entry('alpha', { integrity: brandString<PackageIntegrity>(`${WORKSPACE_LINK_PREFIX}packages/plugin/alpha`) })
    expect(admitBoot(lock([linked]), [installedFrom(linked)]).admitted).toBe(true)
  })
})

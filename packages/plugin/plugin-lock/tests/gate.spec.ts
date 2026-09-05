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

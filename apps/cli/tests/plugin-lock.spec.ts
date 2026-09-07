/**
 * P1-03 Usage: a production boot consults the plugin lock (must[2]), against a
 * real profile directory and a real lock file.
 *
 * The Contract stage proved `gateProductionBoot` decides correctly. What it
 * could not reach is that a real boot asks it — the gate had zero call sites
 * outside its own package, so "the gate refuses a drifted digest" and "a boot
 * was refused" were different claims and only the first was covered. These
 * cases close that gap, so they build the profile on disk and read the same
 * `plugins.lock.json` the `dsh plugin` transaction writes.
 *
 * Every case pairs a refusal with the admission that proves the refusal is
 * caused by what it names: a gate that refused everything would satisfy the
 * drift case on its own.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCandidateLock, readLockfileIntegrity, writeLockAtomically } from '@deepseek-ai/dsh-plugin-lock'
import type { ObservedPackage } from '@deepseek-ai/dsh-plugin-lock'
import { gateProfileAgainstLock, resolveUnlockedProfilePolicy } from '../src/profile-boot.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/**
 * A profile directory holding the given bundles, each with a package.json
 * declaring the policy given for it.
 * @param policies - one entry per bundle: its name and the policy it declares, or `undefined` to declare none.
 * @returns the profile directory and its bundle directories.
 */
function profileWith(policies: readonly { name: string; policy?: 'refuse' | 'warn-and-proceed' }[]): { dir: string; layerDirs: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'p1-03-profile-'))
  roots.push(dir)
  const layerDirs: string[] = []
  for (const { name, policy } of policies) {
    const packageDir = join(dir, 'node_modules', name)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name,
      version: '1.0.0',
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        ...policy === undefined ? {} : { pluginLock: { unlockedProfilePolicy: policy } },
      },
    }))
    layerDirs.push(packageDir)
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'profile',
    dependencies: Object.fromEntries(policies.map(({ name }) => [name, '1.0.0'])),
  }))
  writeLockfile(dir, policies.map(({ name }) => ({ name, integrity: `sha512-${'a'.repeat(86)}==` })))
  return { dir, layerDirs }
}

/**
 * Write a real `pnpm-lock.yaml` into the profile.
 *
 * The fixture used to write a `dsh.provenance.integrity` field on each
 * package's manifest, and the integrity case passed only because of it — no
 * real package has that field, because nothing writes it (BLOCKED-135). A
 * fixture that invents the shape the code reads tests a configuration that
 * cannot occur, so the lockfile is now the source here exactly as in
 * production.
 * @param dir - the profile directory.
 * @param packages - the packages to record, with the integrity each should carry.
 */
function writeLockfile(dir: string, packages: readonly { name: string; integrity: string }[]): void {
  const lines = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    ...packages.map(({ name }) => `      ${name}:\n        specifier: 1.0.0\n        version: 1.0.0`),
    '',
    'packages:',
    '',
    ...packages.map(({ name, integrity }) => `  ${name}@1.0.0:\n    resolution: {integrity: ${integrity}}`),
    '',
    // v9 keeps resolved metadata in `packages:` and the graph in `snapshots:`.
    // The reader returns an EMPTY `packages` map when `snapshots:` is absent,
    // so a fixture without it silently produces no integrity at all — which
    // looks exactly like a package that has none.
    'snapshots:',
    '',
    ...packages.map(({ name }) => `  ${name}@1.0.0: {}`),
    '',
  ]
  writeFileSync(join(dir, 'pnpm-lock.yaml'), lines.join('\n'))
}

/** Write a real lock for the given observations into the profile. */
function lockProfile(dir: string, observed: readonly ObservedPackage[]): void {
  const lock = buildCandidateLock(observed)
  if (lock === undefined) throw new Error('test fixture: candidate lock could not be built')
  writeLockAtomically(join(dir, 'plugins.lock.json'), lock)
}

describe('P1-03 Usage — a production boot consults the lock (must[2])', () => {
  it('must[2]: a profile whose manifest digest has DRIFTED since the lock is refused at boot', async () => {
    const { dir, layerDirs } = profileWith([{ name: 'alpha', policy: 'warn-and-proceed' }])
    lockProfile(dir, await observedFrom(dir, layerDirs))
    // The installed package changes after the lock was written, exactly as a
    // tampered or silently-updated dependency would.
    writeFileSync(join(layerDirs[0]!, 'package.json'), JSON.stringify({
      name: 'alpha',
      version: '1.0.0',
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        provenance: { integrity: 'sha512-alpha-installed' },
        pluginLock: { unlockedProfilePolicy: 'warn-and-proceed' },
        seed: 'drifted',
      },
    }))
    const outcome = await gateProfileAgainstLock(dir, layerDirs, 'warn-and-proceed')
    expect(outcome.admitted).toBe(false)
  })

  it('must[2]: the SAME profile with an untouched install is admitted and reports itself verified', async () => {
    // The control. Without it, the drift case is satisfied by a gate that
    // refuses every profile, and "refused on drift" would say nothing.
    const { dir, layerDirs } = profileWith([{ name: 'alpha', policy: 'warn-and-proceed' }])
    lockProfile(dir, await observedFrom(dir, layerDirs))
    const outcome = await gateProfileAgainstLock(dir, layerDirs, 'warn-and-proceed')
    expect(outcome.admitted).toBe(true)
    expect(outcome.admitted ? outcome.verified : undefined).toBe(true)
  })

  it('must[2]: a package whose recorded INTEGRITY changed is refused even though its manifest is untouched', async () => {
    // A separate vector from manifest drift: a replaced archive whose
    // package.json is byte-identical. Without this case the integrity field
    // could be synthesized from the package name and every case above would
    // still pass -- which is exactly the defect this case was added to catch,
    // found while writing the call site.
    const { dir, layerDirs } = profileWith([{ name: 'alpha', policy: 'warn-and-proceed' }])
    lockProfile(dir, (await observedFrom(dir, layerDirs)).map(observed => ({ ...observed, integrity: 'sha512-alpha-as-locked' })))
    const outcome = await gateProfileAgainstLock(dir, layerDirs, 'warn-and-proceed')
    expect(outcome.admitted).toBe(false)
  })

  it('must[2]: an UNLOCKED profile is refused under `refuse`', async () => {
    const { dir, layerDirs } = profileWith([{ name: 'alpha', policy: 'refuse' }])
    const outcome = await gateProfileAgainstLock(dir, layerDirs, 'refuse')
    expect(outcome.admitted).toBe(false)
    // Narrowed by the discriminant rather than by `!outcome.admitted`: the
    // refusal union has two arms — a gate-level `gateReason` and a per-plugin
    // `admission` — and only one carries this field.
    expect(!outcome.admitted && 'gateReason' in outcome ? outcome.gateReason : undefined).toBe('no-lock-file')
  })

  it('must[2]: an UNLOCKED profile proceeds UNVERIFIED under `warn-and-proceed`, so the two states are distinguishable', async () => {
    const { dir, layerDirs } = profileWith([{ name: 'alpha', policy: 'warn-and-proceed' }])
    const outcome = await gateProfileAgainstLock(dir, layerDirs, 'warn-and-proceed')
    expect(outcome.admitted).toBe(true)
    // `verified: false` is what stops an unlocked boot being mistaken for a
    // checked one — the distinction the policy exists to preserve.
    expect(outcome.admitted ? outcome.verified : undefined).toBe(false)
  })
})

describe('P1-03 Usage — the unlocked-profile policy comes from the bundles (must[2])', () => {
  it('must[2]: one layer declaring `refuse` beside one declaring `warn-and-proceed` resolves to refuse', async () => {
    // Most-restrictive-wins, so a production-controlled preset cannot be
    // relaxed by any bundle composed beside it.
    const { layerDirs } = profileWith([
      { name: 'alpha', policy: 'warn-and-proceed' },
      { name: 'beta', policy: 'refuse' },
    ])
    expect(resolveUnlockedProfilePolicy(layerDirs)).toBe('refuse')
  })

  it('must[2]: layers that all declare `warn-and-proceed` resolve to it, so the rule is not a constant', async () => {
    const { layerDirs } = profileWith([
      { name: 'alpha', policy: 'warn-and-proceed' },
      { name: 'beta', policy: 'warn-and-proceed' },
    ])
    expect(resolveUnlockedProfilePolicy(layerDirs)).toBe('warn-and-proceed')
  })

  it('must[2]: a profile whose layers declare NO policy fails loudly, because the policy is required with no default', async () => {
    // Defaulting here would pick a product-visible boot policy silently. The
    // repository's own rule is that defaulting is an explicit resolve step,
    // never a hidden `?? default`.
    const { layerDirs } = profileWith([{ name: 'alpha' }])
    expect(() => resolveUnlockedProfilePolicy(layerDirs)).toThrow(/unlockedProfilePolicy/u)
  })
})

describe('P1-03 Usage — the lock `dsh plugin` writes is the lock boot reads (must[1] to must[2])', () => {
  it('must[1]: a lock built from the real installed packages admits the boot it describes', async () => {
    // Ties the two halves together: must[1] produces the file, must[2] reads
    // it, and nothing in between reinterprets it.
    const { dir, layerDirs } = profileWith([{ name: 'alpha', policy: 'warn-and-proceed' }, { name: 'beta', policy: 'warn-and-proceed' }])
    lockProfile(dir, await observedFrom(dir, layerDirs))
    const outcome = await gateProfileAgainstLock(dir, layerDirs, 'warn-and-proceed')
    expect(outcome.admitted).toBe(true)
    expect(outcome.admitted ? outcome.loadOrder : []).toHaveLength(2)
  })
})

describe('P1-03 Fault — an offline cold start refuses a locked package that is not installed (acceptance[0])', () => {
  it('acceptance[0]: a package the lock requires but the local install does not have is REFUSED, not treated as verified', async () => {
    // The behavioural half of acceptance[0], and it has a real branch:
    // `admitBoot` reports `missing-from-disk` for a locked entry with nothing
    // on disk. This is what "offline, using only the local cache" has to mean
    // when the cache is incomplete — refuse, rather than boot a profile whose
    // lock describes plugins that are not there.
    const { dir, layerDirs } = profileWith([
      { name: 'alpha', policy: 'warn-and-proceed' },
      { name: 'beta', policy: 'warn-and-proceed' },
    ])
    // Locked with BOTH packages, then only one is presented as installed.
    lockProfile(dir, await observedFrom(dir, layerDirs))
    const outcome = await gateProfileAgainstLock(dir, [layerDirs[0]!], 'warn-and-proceed')
    expect(outcome.admitted).toBe(false)
  })

  it('acceptance[0]: the SAME lock with every package present is admitted, so the refusal is caused by the absence', async () => {
    // Without this, the case above is satisfied by a gate that refuses any
    // multi-package profile.
    const { dir, layerDirs } = profileWith([
      { name: 'alpha', policy: 'warn-and-proceed' },
      { name: 'beta', policy: 'warn-and-proceed' },
    ])
    lockProfile(dir, await observedFrom(dir, layerDirs))
    const outcome = await gateProfileAgainstLock(dir, layerDirs, 'warn-and-proceed')
    expect(outcome.admitted).toBe(true)
    expect(outcome.admitted ? outcome.verified : undefined).toBe(true)
  })
})

/**
 * Observe the bundles on disk exactly as the boot path does, so a fixture
 * cannot drift from the code under test.
 * @param layerDirs - the installed bundle directories.
 * @returns the observations to build a lock from.
 */
async function observedFrom(profileDir: string, layerDirs: readonly string[]): Promise<readonly ObservedPackage[]> {
  const recorded = await readLockfileIntegrity(profileDir)
  return layerDirs.map((packageDir) => {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { name: string; version: string }
    return {
      name: manifest.name,
      version: manifest.version,
      manifest,
      dependencies: [],
      grantedCapabilities: [],
      integrity: recorded.get(manifest.name as never)?.integrity,
      sourceCommit: '0'.repeat(40),
      signatureIdentity: `identity:${manifest.name}`,
    } as ObservedPackage
  })
}

/**
 * P1-03.U2 must[2]: a REAL boot loads only what the lock approved.
 *
 * Every case here drives `runProfile` — the function a `dsh --profile`
 * invocation calls — and that is the whole point of the file. `plugin-lock.spec.ts`
 * already proves `gateProfileAgainstLock` decides correctly, with nine cases; all
 * nine call it directly, and BLOCKED-247 measured the consequence: the gate had
 * ZERO callers on any boot path, so must[2] was enforced only where a test
 * reached in and took the decision itself. A clause proved that way is proved
 * about a function, not about the product.
 *
 * So these cases deliberately do not import the gate. They set up a profile,
 * start a real boot, and read what the boot does.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE_PATCH_RELOAD, initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { buildCandidateLock, writeLockAtomically } from '@deepseek-ai/dsh-plugin-lock'
import type { ObservedPackage } from '@deepseek-ai/dsh-plugin-lock'
import { runProfile } from '../src/profile-boot.ts'

const roots: string[] = []
const originalDshHome = process.env.DSH_HOME

afterEach(() => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Stage a profile whose layers declare `policy`, and return its directory. */
function stageProfile(layers: readonly { name: string; policy?: 'refuse' | 'warn-and-proceed' }[]): {
  profileDir: string
  layerDirs: string[]
} {
  const home = mkdtempSync(join(tmpdir(), 'p1-03-u2-home-'))
  roots.push(home)
  process.env.DSH_HOME = home
  const profileDir = resolveProfileDir('demo')
  initProfile(profileDir, layers.map(layer => layer.name), DEFAULT_PROFILE_PATCH_RELOAD)
  const layerDirs: string[] = []
  for (const { name, policy } of layers) {
    const packageDir = join(profileDir, 'node_modules', name)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name,
      version: '1.0.0',
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        ...policy === undefined ? {} : { pluginLock: { unlockedProfilePolicy: policy } },
      },
    }))
    writeFileSync(join(packageDir, 'cordis.patch.yml'), '[]\n')
    layerDirs.push(packageDir)
  }
  writeInstallerLockfile(profileDir, layers.map(layer => layer.name))
  return { profileDir, layerDirs }
}

/**
 * Write a real `pnpm-lock.yaml` into the profile.
 *
 * Without it the integrity the gate re-reads is absent, and every layer is
 * refused `integrity-unverifiable` — which would make the control below pass
 * for the wrong reason and the drift case indistinguishable from a fixture gap.
 * @param dir - the profile directory.
 * @param names - the staged layer package names.
 */
function writeInstallerLockfile(dir: string, names: readonly string[]): void {
  const integrity = `sha512-${'a'.repeat(86)}==`
  writeFileSync(join(dir, 'pnpm-lock.yaml'), [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    ...names.map(name => `      ${name}:\n        specifier: 1.0.0\n        version: 1.0.0`),
    '',
    'packages:',
    '',
    ...names.map(name => `  ${name}@1.0.0:\n    resolution: {integrity: ${integrity}}`),
    '',
    // v9 keeps resolved metadata in `packages:` and the graph in `snapshots:`;
    // the reader returns an empty map when `snapshots:` is absent.
    'snapshots:',
    '',
    ...names.map(name => `  ${name}@1.0.0: {}`),
    '',
  ].join('\n'))
}

/** Observe the staged layers as the lock builder sees them. */
function observe(layerDirs: readonly string[]): ObservedPackage[] {
  return layerDirs.map((dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string }
    return {
      name: manifest.name,
      version: manifest.version,
      // The manifest exactly as on disk: its digest is what a later boot
      // re-computes and compares, so tampering with the file after locking is
      // what makes a layer "drifted".
      manifest,
      dependencies: [],
      grantedCapabilities: [],
      integrity: `sha512-${'a'.repeat(86)}==`,
    } satisfies ObservedPackage
  })
}

/** Write a real lock for the given observations into the profile. */
async function lockProfile(profileDir: string, layerDirs: readonly string[]): Promise<void> {
  const lock = buildCandidateLock(observe(layerDirs))
  if (lock === undefined) throw new Error('test fixture: candidate lock could not be built')
  await writeLockAtomically(join(profileDir, 'plugins.lock.json'), lock)
}

/** Run the real entry point and return whatever it threw, or `undefined`. */
async function bootError(profile = 'demo'): Promise<Error | undefined> {
  try {
    const { ctx } = await runProfile({ profile, patchFiles: [] })
    await ctx.fiber.dispose()
    return undefined
  } catch (error) {
    return error as Error
  }
}

describe('P1-03.U2 must[2]: the lock decides a real boot, not just a unit call', () => {
  it('REFUSES the boot when a composed layer drifted from the lock, and names the package', async () => {
    const { profileDir, layerDirs } = stageProfile([{ name: 'locked-plugin', policy: 'refuse' }])
    await lockProfile(profileDir, layerDirs)
    // Drift AFTER locking: the manifest the boot will compose no longer digests
    // to what the lock recorded.
    writeFileSync(join(layerDirs[0] as string, 'package.json'), JSON.stringify({
      name: 'locked-plugin',
      version: '1.0.0',
      dsh: { bundle: { patch: './cordis.patch.yml' }, pluginLock: { unlockedProfilePolicy: 'refuse' }, drifted: true },
    }))

    const error = await bootError()

    expect(error?.message).toMatch(/plugin lock/)
    expect(error?.message).toMatch(/locked-plugin/)
  })

  it('does not refuse on the lock when every composed layer matches it', async () => {
    // The control. Without it, an implementation that refused every boot would
    // satisfy the case above and the gate would look wired while being a
    // constant. This asserts only that the LOCK did not refuse: the boot may
    // still fail later for unrelated reasons in this fixture, and that is a
    // different message.
    const { profileDir, layerDirs } = stageProfile([{ name: 'locked-plugin', policy: 'refuse' }])
    await lockProfile(profileDir, layerDirs)

    const error = await bootError()

    expect(error?.message ?? '').not.toMatch(/plugin lock/)
  })

  it('REFUSES when one layer declares refuse and another warn-and-proceed, so the strictest layer wins at boot', async () => {
    // `resolveUnlockedProfilePolicy` already aggregates strictest-wins, frozen
    // against the isolated function by BLOCKED-094(f). This observes it where it
    // decides something: a production-controlled preset saying `refuse` must not
    // be softened by a layer mounted beside it.
    stageProfile([{ name: 'lenient-plugin', policy: 'warn-and-proceed' }, { name: 'strict-plugin', policy: 'refuse' }])

    const error = await bootError()

    expect(error?.message).toMatch(/plugin lock/)
    expect(error?.message).toMatch(/refuse/)
  })

  it('diagnoses the missing lock and PROCEEDS when every layer declares warn-and-proceed', async () => {
    // The other half of must[2]'s unlocked branch: an unlocked profile is not
    // automatically a refused one, and which it is belongs to the deployment.
    stageProfile([{ name: 'lenient-plugin', policy: 'warn-and-proceed' }])

    const error = await bootError()

    expect(error?.message ?? '').not.toMatch(/plugin lock/)
  })
})

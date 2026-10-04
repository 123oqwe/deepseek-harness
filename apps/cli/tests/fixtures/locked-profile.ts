/**
 * Record packages staged in a profile's own `node_modules` the way
 * `dsh plugin add` leaves them, so a boot's lock gate (P1-03 must[2]) admits
 * them: the profile's `pnpm-lock.yaml` records one integrity per package, and
 * `plugins.lock.json` is committed through the plugin-lock functions
 * `dsh plugin` uses. Shared by the specs that stage profile-local packages
 * for a reason other than the lock.
 * @module apps/cli/tests/fixtures/locked-profile
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCandidateLock, planLockCommit, type PluginLockFile, writeLockAtomically } from '@deepseek-ai/dsh-plugin-lock'

/** The integrity the fixture install records for every package. */
const FIXTURE_INTEGRITY = `sha512-${'c'.repeat(86)}==`

/**
 * Lock the named packages, each already staged under `<profileDir>/node_modules/<name>`.
 * Name exactly the packages the boot resolves from the profile directory: a
 * locked package the boot does not resolve reads as missing from disk.
 * @param profileDir - the profile directory.
 * @param names - the staged package names.
 */
export async function lockStagedPackages(profileDir: string, names: readonly string[]): Promise<void> {
  const observed = names.map((name) => {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'node_modules', name, 'package.json'), 'utf8')) as { version?: unknown }
    if (typeof manifest.version !== 'string') throw new Error(`locked-profile fixture: ${name} has no version`)
    return { name, version: manifest.version, manifest }
  })
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    // Quoted as pnpm quotes a scoped name: a plain YAML key cannot start with `@`.
    ...observed.map(({ name, version }) => `      '${name}':\n        specifier: ${version}\n        version: ${version}`),
    '',
    'packages:',
    '',
    ...observed.map(({ name, version }) => `  '${name}@${version}':\n    resolution: {integrity: ${FIXTURE_INTEGRITY}}`),
    '',
    // pnpm's reader returns no packages at all when `snapshots:` is absent.
    'snapshots:',
    '',
    ...observed.map(({ name, version }) => `  '${name}@${version}': {}`),
    '',
  ].join('\n'))
  const empty: PluginLockFile = { lockfileVersion: 1, entries: [], loadOrder: [] }
  const candidate = buildCandidateLock(observed.map(({ name, version, manifest }) => ({
    name,
    version,
    manifest,
    dependencies: [],
    grantedCapabilities: [],
    integrity: FIXTURE_INTEGRITY,
  })))
  if (candidate === undefined) throw new Error('locked-profile fixture: the staged packages form a dependency cycle')
  const decision = planLockCommit(empty, candidate, empty)
  if (!decision.committed) throw new Error(`locked-profile fixture: the lock was not committed (${decision.reason}): ${decision.detail}`)
  await writeLockAtomically(join(profileDir, 'plugins.lock.json'), decision.lock)
}

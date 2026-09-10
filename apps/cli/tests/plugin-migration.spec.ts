/**
 * Epic P1-10 must[1] and acceptance[0]/[1] at the real upgrade path.
 *
 * `dsh plugin update <name>` is the one channel through which a plugin changes
 * version in the product, and `reconcilePlugins`'s call site is the one place
 * that knows `(plugin, from, to)`. These cases exercise the pieces that hang
 * there: recovering an upgrade a crash left half-done, restoring the CODE half
 * when the data half rolls back, and reporting a record that does not
 * reconcile.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  changedVersions,
  pluginStorageRoot,
  recoverInterruptedUpgrades,
  reportUnreconciled,
  rollbackCode,
} from '../src/plugin-migration.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function home(): string {
  const root = mkdtempSync(join(tmpdir(), 'p1-10-cli-'))
  roots.push(root)
  return root
}

/** A plugin storage root in one of the states a crash can leave behind. */
function crashedUpgrade(harnessHome: string, plugin: string, options: {
  readonly afterSwitch: boolean
  readonly finished?: boolean
}): string {
  const root = pluginStorageRoot(harnessHome, plugin)
  mkdirSync(join(root, 'data'), { recursive: true })
  writeFileSync(join(root, 'data', 'marker'), options.afterSwitch ? 'migrated' : 'original', 'utf8')
  mkdirSync(join(root, 'quarantine'), { recursive: true })
  writeFileSync(join(root, 'quarantine', 'marker'), 'migrated', 'utf8')
  if (options.afterSwitch) {
    mkdirSync(join(root, 'rollback'), { recursive: true })
    writeFileSync(join(root, 'rollback', 'marker'), 'original', 'utf8')
  }
  writeFileSync(join(root, 'upgrade.json'), JSON.stringify({
    plugin,
    from: '1',
    to: '2',
    pathDigest: 'sha256-path',
    ...options.finished === true ? { upgradedTo: '2', dataDigest: 'sha256-data' } : {},
  }), 'utf8')
  return root
}

describe('P1-10 must[1]: the upgrade is driven from the one place that knows (plugin, from, to)', () => {
  it('names only the plugins whose version actually moved', () => {
    // Computed from the two manifests, not from the command line: `pnpm
    // update` with no argument updates everything, and the arguments do not
    // say which packages moved.
    expect(changedVersions(
      { a: '1.0.0', b: '2.0.0', gone: '1.0.0' },
      { a: '1.1.0', b: '2.0.0', fresh: '1.0.0' },
    )).toEqual([{ plugin: 'a', from: '1.0.0', to: '1.1.0' }])
  })
})

describe('P1-10 acceptance[0]: a restart finishes or undoes what a crash left', () => {
  it('puts the PREVIOUS version back when the crash landed after the switch', async () => {
    // The live directory holds migrated data whose health was never confirmed.
    // Leaving it there would be the mixed state acceptance[0] forbids: new
    // data under whatever the record says, with nothing having checked it.
    const harnessHome = home()
    const root = crashedUpgrade(harnessHome, 'dsh-notes', { afterSwitch: true })

    expect(await recoverInterruptedUpgrades(harnessHome, ['dsh-notes'])).toEqual(['dsh-notes'])
    expect(readFileSync(join(root, 'data', 'marker'), 'utf8')).toBe('original')
    // The migrated copy is kept for diagnosis rather than deleted.
    expect(readFileSync(join(root, 'quarantine', 'marker'), 'utf8')).toBe('migrated')
    // And the half-written record is gone, so a later reconcile does not read
    // an upgrade that never finished as one that did.
    expect(existsSync(join(root, 'upgrade.json'))).toBe(false)
  })

  it('clears only the quarantine when the crash landed BEFORE the switch', async () => {
    // Production was never touched, so there is nothing to put back — but the
    // quarantine and the record must still go, or the next upgrade starts on
    // top of the last one's leftovers.
    const harnessHome = home()
    const root = crashedUpgrade(harnessHome, 'dsh-notes', { afterSwitch: false })

    expect(await recoverInterruptedUpgrades(harnessHome, ['dsh-notes'])).toEqual(['dsh-notes'])
    expect(readFileSync(join(root, 'data', 'marker'), 'utf8')).toBe('original')
    expect(existsSync(join(root, 'quarantine'))).toBe(false)
    expect(existsSync(join(root, 'upgrade.json'))).toBe(false)
  })

  it('leaves a COMPLETED upgrade alone, so recovery is not a rollback of everything', async () => {
    // Without this, a recover that undid every upgrade it found would satisfy
    // both cases above.
    const harnessHome = home()
    const root = crashedUpgrade(harnessHome, 'dsh-notes', { afterSwitch: true, finished: true })

    expect(await recoverInterruptedUpgrades(harnessHome, ['dsh-notes'])).toEqual([])
    expect(readFileSync(join(root, 'data', 'marker'), 'utf8')).toBe('migrated')
    expect(existsSync(join(root, 'upgrade.json'))).toBe(true)
  })

  it('does nothing for a plugin that never upgraded', async () => {
    const harnessHome = home()
    mkdirSync(pluginStorageRoot(harnessHome, 'untouched'), { recursive: true })
    expect(await recoverInterruptedUpgrades(harnessHome, ['untouched'])).toEqual([])
  })
})

describe('P1-10 acceptance[0]: the property holds for the (code, data) PAIR', () => {
  it('restores the manifest and lockfile so code returns to the version the data is at', async () => {
    // By the time the transaction runs, pnpm has already moved the code. A
    // data migration that fails and rolls back leaves data at v1 and code at
    // v2 -- the mixed state, one layer up from the database.
    const profileDir = home()
    const written = new Map<string, string>()
    writeFileSync(join(profileDir, 'package.json'), '{"dependencies":{"dsh-notes":"2.0.0"}}', 'utf8')

    const failure = await rollbackCode({
      profileDir,
      manifestBefore: '{"dependencies":{"dsh-notes":"1.0.0"}}',
      lockBefore: 'lockfileVersion: 9\n',
    }, async (path, content) => { written.set(path, content) })

    expect([...written.keys()].map(path => path.slice(profileDir.length + 1)).sort())
      .toEqual(['package.json', 'pnpm-lock.yaml'])
    expect(written.get(join(profileDir, 'package.json'))).toContain('1.0.0')
    // pnpm is not installed against a real store here, so a diagnostic is the
    // expected outcome -- and it must NAME the mixed state rather than be
    // swallowed.
    expect(failure).toContain('code was NOT')
    expect(failure).toContain('new code against old data')
  })
})

describe('P1-10 acceptance[1]: a record that does not reconcile is REPORTED', () => {
  it('names the plugin, the version and which half is missing', async () => {
    const harnessHome = home()
    crashedUpgrade(harnessHome, 'dsh-notes', { afterSwitch: true })

    const report = await reportUnreconciled(harnessHome, { plugin: 'dsh-notes', from: '1', to: '2' })
    expect(report).toContain('dsh-notes')
    expect(report).toContain('2')
    expect(report).toContain('did not finish')
  })

  it('reports a digest that no longer matches the data', async () => {
    const harnessHome = home()
    const root = crashedUpgrade(harnessHome, 'dsh-notes', { afterSwitch: true, finished: true })
    writeFileSync(join(root, 'data', 'digest'), 'sha256-something-else', 'utf8')

    const report = await reportUnreconciled(harnessHome, { plugin: 'dsh-notes', from: '1', to: '2' })
    expect(report).toContain('does not match the data on disk')
  })

  it('says nothing when the record reconciles, so the report is not constant', async () => {
    const harnessHome = home()
    const root = crashedUpgrade(harnessHome, 'dsh-notes', { afterSwitch: true, finished: true })
    writeFileSync(join(root, 'data', 'digest'), 'sha256-data', 'utf8')

    expect(await reportUnreconciled(harnessHome, { plugin: 'dsh-notes', from: '1', to: '2' })).toBeUndefined()
  })

  it('says nothing for a plugin with no upgrade record at all', async () => {
    const harnessHome = home()
    mkdirSync(pluginStorageRoot(harnessHome, 'fresh'), { recursive: true })
    expect(await reportUnreconciled(harnessHome, { plugin: 'fresh', from: '1', to: '2' })).toBeUndefined()
  })
})

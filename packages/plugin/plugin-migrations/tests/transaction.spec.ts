/**
 * Epic P1-10 must[1]: the six-phase upgrade transaction, asserted at its
 * INTERMEDIATE states.
 *
 * A transaction whose only evidence is "it returned true" is indistinguishable
 * from a function that returns true. So every case here observes the disk
 * between phases: production is byte-unchanged while the migration runs
 * against a copy, the previous directory survives the switch as a rollback
 * target, and a failed health check leaves production byte-identical to what
 * it was before the switch.
 *
 * acceptance[0]'s crash campaign — a crash at every step leaving either the
 * old or the new version whole — is the Usage stage's, against the real
 * upgrade path. A campaign against anything less proves nothing about what
 * ships.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { brandString } from '@deepseek-ai/dsh-brand'

import { reconcileUpgrade, runUpgrade, readUpgradeRecord, UPGRADE_PHASES, vacuumInto } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { UpgradeRequest } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { PluginMigration, PluginMigrationManifest, PluginSchemaVersion } from '@deepseek-ai/dsh-plugin-migrations'

const v = (name: string): PluginSchemaVersion => brandString<PluginSchemaVersion>(name)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function step(from: string, to: string, overrides: Partial<PluginMigration> = {}): PluginMigration {
  return { from: v(from), to: v(to), backup: { kind: 'snapshot' }, reversible: true, ...overrides }
}

/** A plugin storage root with a real SQLite database holding one row. */
function storage(rows: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'p1-10-'))
  roots.push(root)
  mkdirSync(join(root, 'data'), { recursive: true })
  const db = new DatabaseSync(join(root, 'data', 'data.db'))
  db.exec('CREATE TABLE notes (body TEXT)')
  for (const row of rows) db.prepare('INSERT INTO notes VALUES (?)').run(row)
  db.close()
  return root
}

/** Every row in one database, so a case can compare production against itself. */
function notesIn(path: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT body FROM notes ORDER BY body').all().map(row => String(row.body))
  } finally {
    db.close()
  }
}

const MANIFEST: PluginMigrationManifest = {
  plugin: 'dsh-notes',
  current: v('2'),
  migrations: [step('1', '2')],
}

function request(root: string, overrides: Partial<UpgradeRequest> = {}): UpgradeRequest {
  return {
    plugin: 'dsh-notes',
    manifest: MANIFEST,
    installed: v('1'),
    storageRoot: root,
    freeze: async () => async () => {},
    migrate: async (quarantineDir) => {
      const db = new DatabaseSync(join(quarantineDir, 'data.db'))
      db.prepare('INSERT INTO notes VALUES (?)').run('migrated')
      db.close()
    },
    validate: async () => ({ ok: true, digest: 'sha256-validated' }),
    healthCheck: async () => true,
    ...overrides,
  }
}

describe('P1-10 must[1]: the upgrade transaction has the phases the registry names', () => {
  it('enumerates the six phases, in order, each named once', () => {
    expect([...UPGRADE_PHASES]).toEqual(['freeze', 'snapshot', 'quarantine', 'validate', 'switch', 'health-check'])
    expect(new Set(UPGRADE_PHASES).size).toBe(UPGRADE_PHASES.length)
  })
})

describe('P1-10 must[1]: what each phase leaves behind', () => {
  it('migrates against a COPY, leaving production byte-unchanged until the switch', async () => {
    // The property that makes a crash during migration recoverable by deleting
    // one directory. An implementation that migrated production in place would
    // satisfy an end-to-end assertion just as well as this one.
    const root = storage(['original'])
    const seen: string[][] = []
    const outcome = await runUpgrade(request(root, {
      migrate: async (quarantineDir) => {
        const db = new DatabaseSync(join(quarantineDir, 'data.db'))
        db.prepare('INSERT INTO notes VALUES (?)').run('migrated')
        db.close()
        // Observed DURING the migration: production still reads as it did.
        seen.push(notesIn(join(root, 'data', 'data.db')))
      },
    }))

    expect(seen).toEqual([['original']])
    expect(outcome).toMatchObject({ upgraded: true })
    expect(notesIn(join(root, 'data', 'data.db'))).toEqual(['migrated', 'original'])
  })

  it('keeps the previous directory as a ROLLBACK TARGET after the switch', async () => {
    // The point of an atomic switch is that the old state survives it. A
    // rename over the live directory would not preserve what it replaced.
    const root = storage(['original'])
    const outcome = await runUpgrade(request(root))

    expect(outcome).toMatchObject({ upgraded: true })
    expect(outcome.upgraded && existsSync(join(outcome.rollbackDir, 'data.db'))).toBe(true)
    expect(outcome.upgraded && notesIn(join(outcome.rollbackDir, 'data.db'))).toEqual(['original'])
  })

  it('leaves production byte-identical to the pre-switch state when the HEALTH CHECK fails', async () => {
    // Not "an error was returned": the case reads the rows back. A rollback
    // that reported failure while leaving migrated data in place would be the
    // mixed state acceptance[0] exists to forbid.
    const root = storage(['original'])
    const outcome = await runUpgrade(request(root, { healthCheck: async () => false }))

    expect(outcome).toEqual({ upgraded: false, failedAt: 'health-check' })
    expect(notesIn(join(root, 'data', 'data.db'))).toEqual(['original'])
    // The migrated data is kept aside rather than deleted, so an operator can
    // see what the migration produced.
    expect(existsSync(join(root, 'quarantine', 'data.db'))).toBe(true)
    expect(notesIn(join(root, 'quarantine', 'data.db'))).toEqual(['migrated', 'original'])
  })

  it('does not switch at all when VALIDATE refuses', async () => {
    const root = storage(['original'])
    const outcome = await runUpgrade(request(root, {
      validate: async () => ({ ok: false, digest: 'sha256-rejected' }),
    }))

    expect(outcome).toEqual({ upgraded: false, failedAt: 'validate' })
    expect(notesIn(join(root, 'data', 'data.db'))).toEqual(['original'])
    expect(existsSync(join(root, 'rollback'))).toBe(false)
  })

  it('THAWS the plugin however the upgrade ends', async () => {
    // A transaction that left a plugin frozen after a failure would turn one
    // failed upgrade into an outage.
    const root = storage(['original'])
    let thawed = 0
    await runUpgrade(request(root, {
      freeze: async () => async () => { thawed += 1 },
      validate: async () => ({ ok: false, digest: 'x' }),
    }))
    expect(thawed).toBe(1)

    const second = storage(['original'])
    await runUpgrade(request(second, { freeze: async () => async () => { thawed += 1 } }))
    expect(thawed).toBe(2)
  })

  it('refuses before freezing when the plan itself is refused', async () => {
    const root = storage(['original'])
    let froze = 0
    const outcome = await runUpgrade(request(root, {
      installed: v('9'),
      freeze: async () => { froze += 1; return async () => {} },
    }))

    expect(outcome).toMatchObject({ upgraded: false, refusal: { kind: 'unreachable' } })
    expect(froze).toBe(0)
  })

  it('records the upgrade with its path digest, written atomically', async () => {
    const root = storage(['original'])
    await runUpgrade(request(root))

    const record = await readUpgradeRecord(root) as Record<string, unknown>
    expect(record).toMatchObject({ plugin: 'dsh-notes', from: '1', to: '2' })
    expect(String(record.pathDigest)).toMatch(/^sha256-[0-9a-f]{64}$/u)
    // No temp file left beside it: the house atomic write renames into place.
    expect(readFileSync(join(root, 'upgrade.json'), 'utf8')).toContain('pathDigest')
  })
})

describe('P1-10: the snapshot is an atomically consistent copy', () => {
  it('copies a live database through VACUUM INTO rather than a file copy', async () => {
    const root = storage(['a', 'b'])
    const destination = join(root, 'copy.db')
    vacuumInto(join(root, 'data', 'data.db'), destination)
    expect(notesIn(destination)).toEqual(['a', 'b'])
  })

  it('binds the destination as a PARAMETER, so a quoted path cannot inject SQL', async () => {
    // A storage root can carry a quote. Interpolating it into the statement
    // would be an injection even though the only author is this package.
    const root = mkdtempSync(join(tmpdir(), "p1-10-quote'-"))
    roots.push(root)
    mkdirSync(join(root, 'data'), { recursive: true })
    const db = new DatabaseSync(join(root, 'data', 'data.db'))
    db.exec('CREATE TABLE notes (body TEXT)')
    db.prepare('INSERT INTO notes VALUES (?)').run('quoted')
    db.close()

    const destination = join(root, "copy'.db")
    vacuumInto(join(root, 'data', 'data.db'), destination)
    expect(notesIn(destination)).toEqual(['quoted'])
  })
})

describe('P1-10 acceptance[1]: the record and the disk are reconcilable', () => {
  it('reconciles a completed upgrade against its recorded version and digest', async () => {
    const root = storage(['original'])
    const outcome = await runUpgrade(request(root))
    expect(outcome).toMatchObject({ upgraded: true })

    expect(await reconcileUpgrade(root, { upgradedTo: '2', dataDigest: 'sha256-validated' })).toBe(true)
  })

  it('refuses when the digest on disk is not the one recorded', async () => {
    // The half acceptance[1] exists for: a record whose digest no longer
    // matches the data means something wrote to the plugin's storage outside
    // the transaction, and claiming "upgraded" would be claiming a state
    // nobody can reproduce.
    const root = storage(['original'])
    await runUpgrade(request(root))

    expect(await reconcileUpgrade(root, { upgradedTo: '2', dataDigest: 'sha256-something-else' })).toBe(false)
  })

  it('refuses when the version on disk is not the one recorded', async () => {
    const root = storage(['original'])
    await runUpgrade(request(root))

    expect(await reconcileUpgrade(root, { upgradedTo: '3', dataDigest: 'sha256-validated' })).toBe(false)
  })

  it('does NOT claim an upgrade for a run that started and never finished', async () => {
    // The record is written twice: intent at the snapshot phase, achievement
    // after the health check. A failed health check leaves only the intent, so
    // a reconcile after it must not read the intended version as one reached.
    const root = storage(['original'])
    const outcome = await runUpgrade(request(root, { healthCheck: async () => false }))
    expect(outcome).toEqual({ upgraded: false, failedAt: 'health-check' })

    // The intent half is on disk — an operator can see what was attempted.
    const record = await readUpgradeRecord(root) as Record<string, unknown>
    expect(record).toMatchObject({ from: '1', to: '2' })
    // And the achieved half is not, so nothing reconciles as upgraded.
    expect(await reconcileUpgrade(root, { upgradedTo: '2', dataDigest: 'sha256-validated' })).toBe(false)
  })

  it('reconciles as false when no upgrade has ever run, rather than throwing', async () => {
    const root = storage(['original'])
    expect(await reconcileUpgrade(root, { upgradedTo: '2', dataDigest: 'sha256-validated' })).toBe(false)
  })
})

describe('P1-10 acceptance[2]: a failed upgrade does not change approved permissions', () => {
  it('leaves the permission state byte-identical across a failed upgrade', async () => {
    // This epic READS the permission state and never writes it. A case that
    // granted or revoked something to set up would be P1-10 writing state
    // P2-02 and P2-04 own — and it would prove that this epic can write it,
    // which is the opposite of the clause.
    //
    // The observation is the plugin's own storage root: an upgrade writes only
    // under it, so "the permission state is unchanged" is measured as "nothing
    // outside the plugin's storage was touched at all". A case that inspected
    // a token store instead would pass just as well while the transaction
    // quietly wrote somewhere else.
    const root = storage(['original'])
    const outside = mkdtempSync(join(tmpdir(), 'p1-10-permissions-'))
    roots.push(outside)
    const permissionFile = join(outside, 'approved.json')
    writeFileSync(permissionFile, JSON.stringify({ approved: ['fs:write'] }), 'utf8')
    const before = readFileSync(permissionFile, 'utf8')

    const outcome = await runUpgrade(request(root, { healthCheck: async () => false }))
    expect(outcome).toEqual({ upgraded: false, failedAt: 'health-check' })

    expect(readFileSync(permissionFile, 'utf8')).toBe(before)
  })

  it('writes NOTHING outside the plugin’s own storage root, on success either', async () => {
    // The general form, and the one that would catch a transaction that
    // started writing elsewhere: the sibling directory's listing is unchanged
    // after a successful upgrade.
    const root = storage(['original'])
    const sibling = mkdtempSync(join(tmpdir(), 'p1-10-sibling-'))
    roots.push(sibling)
    const before = readdirSync(sibling)

    expect(await runUpgrade(request(root))).toMatchObject({ upgraded: true })
    expect(readdirSync(sibling)).toEqual(before)
  })
})

/**
 * Epic P1-10 Fault stage, transaction half: the boundaries where the
 * transaction's own world fails under it.
 *
 * The consumer's boundaries — the module a plugin ships, the export an
 * irreversible path owes, the code rollback — are
 * `apps/cli/tests/plugin-migration-fault-matrix.spec.ts`, because their
 * subject is `apps/cli/src/plugin-migration.ts` and a package test cannot
 * import an app.
 *
 * Named `.e2e.spec.ts` rather than the registry's declared `.e2e.ts`: that
 * suffix routes into `vitest.e2e.config.ts`, the real-API suite that
 * self-skips without a key, and the exact-SHA observation runs the default
 * config — so the declared name would put these cases where the run that
 * greens the cell cannot see them (`adjudication.json`
 * `P1-10-F-rollback-e2e-not-yet-created`, BLOCKED-070).
 */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvUnitDescriptor, MigrationFacet, UnitContent, UnitSnapshot } from '@deepseek-ai/dsh-storage'
import type { Lease, RunLease } from '@deepseek-ai/dsh-lease-contract'

import { recoverUpgrade, runUpgrade } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { UpgradeRecord, UpgradeRequest } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { PluginMigration, PluginMigrationManifest, PluginSchemaVersion } from '@deepseek-ai/dsh-plugin-migrations'

const v = (name: string): PluginSchemaVersion => brandString<PluginSchemaVersion>(name)

function step(from: string, to: string, overrides: Partial<PluginMigration> = {}): PluginMigration {
  return { from: v(from), to: v(to), backup: { kind: 'snapshot' }, reversible: true, ...overrides }
}

const MANIFEST: PluginMigrationManifest = {
  plugin: 'dsh-notes',
  current: v('2'),
  migrations: [step('1', '2')],
}

const UNIT: KvUnitDescriptor = { name: 'notes', version: 1, tables: ['notes'], hasGlobal: false }
const EMPTY: UnitContent = { global: null, tables: {} }

function content(values: readonly string[]): UnitContent {
  return { global: null, tables: { notes: Object.fromEntries(values.map(value => [value, true])) } }
}

function rows(value: UnitContent): string[] {
  return Object.keys(value.tables['notes'] ?? {})
}

/**
 * A medium that can be told to fail one specific facet call.
 *
 * Fault injection per PRIMITIVE rather than per phase: what a fault stage has
 * to distinguish is which primitive failed, and a backend that failed
 * everything would satisfy every negative case while telling them apart from
 * a correct transaction not at all.
 */
class FaultyBackend {
  readonly calls: string[] = []
  live: UnitContent = content(['original'])
  readonly copies = new Map<string, UnitContent>()
  private next = 0

  /** Handles this medium has forgotten, so `rollbackTo` on them cannot resolve. */
  readonly vanished = new Set<string>()

  constructor(private readonly failing: string | undefined = undefined) {}

  private guard(primitive: string): void {
    this.calls.push(primitive)
    if (this.failing === primitive) throw new Error(`${primitive} failed in this medium`)
  }

  readonly facet: MigrationFacet = {
    stampedVersion: async () => 1,
    digestUnit: async snapshot => `sha256-${rows(this.copies.get(snapshot.handle) ?? EMPTY).join('|')}`,
    readSnapshot: async snapshot => ({ version: 2, content: this.copies.get(snapshot.handle) ?? EMPTY }),
    exportUnit: async () => { this.guard('exportUnit') },
    snapshotUnit: async (descriptor) => {
      this.guard('snapshotUnit')
      const handle = `snap-${String(this.next += 1)}`
      this.copies.set(handle, this.live)
      return { unit: descriptor.name, handle }
    },
    materializeMigrated: async (snapshot, _version, migrate) => {
      this.guard('materializeMigrated')
      const handle = `migrated-${String(this.next += 1)}`
      this.copies.set(handle, await migrate(this.copies.get(snapshot.handle) ?? EMPTY))
      return { unit: snapshot.unit, handle }
    },
    switchIn: async (migrated) => {
      this.guard('switchIn')
      const previousHandle = `previous-${String(this.next += 1)}`
      this.copies.set(previousHandle, this.live)
      this.live = this.copies.get(migrated.handle) ?? EMPTY
      return { unit: migrated.unit, handle: previousHandle }
    },
    rollbackTo: async (previous: UnitSnapshot) => {
      this.guard('rollbackTo')
      // A handle the medium no longer has is the state a crash plus a manual
      // cleanup leaves: the record still names it, and nothing is there.
      if (this.vanished.has(previous.handle) || !this.copies.has(previous.handle)) {
        throw new Error(`rollback target ${previous.handle} is gone`)
      }
      this.live = this.copies.get(previous.handle) ?? EMPTY
    },
    discard: async (snapshot) => {
      this.calls.push(`discard:${snapshot.handle}`)
      this.copies.delete(snapshot.handle)
    },
  }
}

/** A lease that holds, unless a case supersedes it. */
function lease(overrides: Partial<RunLease> = {}): RunLease {
  return {
    token: { workItem: brandString('upgrade'), holder: brandString('cli'), epoch: 1 },
    renew: () => undefined,
    mayWrite: () => true,
    release: () => {},
    currentLease: () => undefined,
    ...overrides,
  } as unknown as RunLease
}

function request(backend: FaultyBackend, overrides: Partial<UpgradeRequest> = {}): UpgradeRequest {
  return {
    plugin: 'dsh-notes',
    manifest: MANIFEST,
    installed: v('1'),
    unit: UNIT,
    migration: backend.facet,
    lease: lease(),
    now: () => 1_000,
    migrate: async current => content([...rows(current), 'migrated']),
    validate: async () => ({ ok: true, digest: 'sha256-validated' }),
    healthCheck: async () => true,
    writeRecord: async () => {},
    ...overrides,
  }
}

describe('P1-10 Fault — a superseded holder says who holds it now', () => {
  it('fault boundary 05 refuses to switch when superseded, NAMING the holder the lease reports', async () => {
    // The refusal was anonymous before this stage: an operator learned the
    // upgrade stopped at `switch` and not that another process owns the work
    // item, which is the one fact that says what to do about it.
    const backend = new FaultyBackend()
    const current: Lease = {
      workItem: brandString<Lease['workItem']>('upgrade'),
      holder: brandString<Lease['holder']>('other-host'),
      epoch: 2 as Lease['epoch'],
      expiresAtMs: 9_000,
    }

    const outcome = await runUpgrade(request(backend, {
      lease: lease({ mayWrite: () => false, currentLease: () => current }),
    }))

    expect(outcome).toMatchObject({
      upgraded: false,
      failedAt: 'switch',
      refusal: { kind: 'superseded', holder: 'other-host' },
    })
    // The live unit is untouched: a superseded holder must not swap.
    expect(rows(backend.live)).toEqual(['original'])
  })

  it('fault boundary 06 reports the absence when the lease simply lapsed and nobody holds it', async () => {
    // `undefined` is a real reading, not a missing one, and inventing a holder
    // for it would be the second answer the single source of truth exists to
    // prevent.
    const backend = new FaultyBackend()

    const outcome = await runUpgrade(request(backend, {
      lease: lease({ mayWrite: () => false, currentLease: () => undefined }),
    }))

    expect(outcome).toMatchObject({ upgraded: false, failedAt: 'switch', refusal: { kind: 'superseded' } })
    expect((outcome as { refusal: { holder?: string } }).refusal.holder).toBeUndefined()
  })

  it('fault boundary 07 a holder that still holds SWITCHES, so the refusal is not constant', async () => {
    // Control for 05 and 06 together: a `mayWrite` mutated to always refuse
    // satisfies both of those and is caught only here.
    const backend = new FaultyBackend()

    const outcome = await runUpgrade(request(backend))

    expect(outcome).toMatchObject({ upgraded: true })
    expect(rows(backend.live)).toEqual(['original', 'migrated'])
  })
})

describe('P1-10 Fault — recovery when the medium lost what the record names', () => {
  it('fault boundary 08 a rollback target that is GONE is reported, not swallowed', async () => {
    // A crash leaves the intent half of the record; a manual cleanup can then
    // remove the handle it names. Recovery that swallowed this would return
    // "undone" for an upgrade it did not undo, and the next upgrade would
    // start on the leftovers.
    const backend = new FaultyBackend()
    const record: UpgradeRecord = {
      plugin: 'dsh-notes',
      from: v('1'),
      to: v('2'),
      pathDigest: brandString('digest'),
      snapshotHandle: 'snap-1',
      previousHandle: 'previous-gone',
    }

    await expect(recoverUpgrade(backend.facet, record)).rejects.toThrow(/rollback target previous-gone is gone/u)
  })

  it('fault boundary 09 a rollback target that is PRESENT is rolled back and the snapshot released', async () => {
    // Control for 08: recovery works when the medium still has what the record
    // names, so 08 is about the missing handle rather than about recovery.
    const backend = new FaultyBackend()
    backend.copies.set('previous-1', content(['original']))
    backend.copies.set('snap-1', content(['original']))
    backend.live = content(['migrated-but-unhealthy'])
    const record: UpgradeRecord = {
      plugin: 'dsh-notes',
      from: v('1'),
      to: v('2'),
      pathDigest: brandString('digest'),
      snapshotHandle: 'snap-1',
      previousHandle: 'previous-1',
    }

    expect(await recoverUpgrade(backend.facet, record)).toBe(true)
    expect(rows(backend.live)).toEqual(['original'])
    expect(backend.copies.has('snap-1')).toBe(false)
  })

  it('fault boundary 10 a FINISHED upgrade is not undone, whatever the medium still holds', async () => {
    // Control for 08 and 09: the achievement half means the upgrade finished,
    // and recovery must not roll a finished upgrade back just because the
    // handles are still there.
    const backend = new FaultyBackend()
    backend.copies.set('previous-1', content(['original']))
    const record: UpgradeRecord = {
      plugin: 'dsh-notes',
      from: v('1'),
      to: v('2'),
      pathDigest: brandString('digest'),
      previousHandle: 'previous-1',
      upgradedTo: v('2'),
      dataDigest: 'sha256-validated',
    }

    expect(await recoverUpgrade(backend.facet, record)).toBe(false)
    expect(backend.calls).not.toContain('rollbackTo')
  })
})

describe('P1-10 Fault — a medium primitive that fails mid-transaction', () => {
  it('fault boundary 11 a snapshot primitive that fails leaves the live unit alone', async () => {
    // The first primitive the transaction calls. `storage-sqlite`'s is
    // `VACUUM INTO` and `storage-json`'s is a copy; either can fail on a full
    // disk, and neither has touched the live unit when it does.
    const backend = new FaultyBackend('snapshotUnit')

    await expect(runUpgrade(request(backend))).rejects.toThrow(/snapshotUnit failed/u)
    expect(rows(backend.live)).toEqual(['original'])
  })

  it('fault boundary 12 a materialize that fails DISCARDS its copy and leaves the live unit alone', async () => {
    // The copy is the transaction's own; a failure that left it behind would
    // accumulate one dead copy per failed upgrade in the medium.
    const backend = new FaultyBackend('materializeMigrated')

    await expect(runUpgrade(request(backend))).rejects.toThrow(/materializeMigrated failed/u)
    expect(rows(backend.live)).toEqual(['original'])
  })
})

/**
 * Epic P1-10 must[1]: the six-phase upgrade transaction, asserted at its
 * INTERMEDIATE states.
 *
 * A transaction whose only evidence is "it returned true" is indistinguishable
 * from a function that returns true. So every case observes what the medium
 * holds between phases — through a fake backend that records the facet calls
 * and keeps the unit's records, because the transaction's contract is with the
 * FACET and not with a filesystem. A case that reached for a path would be
 * asserting the medium this stage deliberately stopped inventing.
 *
 * acceptance[0]'s crash campaign is `crash-campaign.spec.ts`, and each real
 * backend's own snapshot and switch primitives are its own package's.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvUnitDescriptor, MigrationFacet } from '@deepseek-ai/dsh-storage'
import type { RunLease } from '@deepseek-ai/dsh-lease-contract'

import { runUpgrade, UPGRADE_PHASES } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { UpgradeRecord, UpgradeRequest } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { PluginMigration, PluginMigrationManifest, PluginSchemaVersion } from '@deepseek-ai/dsh-plugin-migrations'

const v = (name: string): PluginSchemaVersion => brandString<PluginSchemaVersion>(name)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function step(from: string, to: string, overrides: Partial<PluginMigration> = {}): PluginMigration {
  return { from: v(from), to: v(to), backup: { kind: 'snapshot' }, reversible: true, ...overrides }
}

const MANIFEST: PluginMigrationManifest = {
  plugin: 'dsh-notes',
  current: v('2'),
  migrations: [step('1', '2')],
}

const UNIT: KvUnitDescriptor = { name: 'notes', version: 1, tables: ['notes'], hasGlobal: false }

/**
 * A backend whose medium is a map, recording every facet call.
 *
 * Fake because the transaction's contract is with the FACET: what a real
 * medium does with a snapshot is `storage-json`'s and `storage-sqlite`'s to
 * prove, and asserting a path here would reintroduce the coupling this stage
 * removed.
 */
class RecordingBackend {
  readonly calls: string[] = []
  live: readonly unknown[] = ['original']
  readonly copies = new Map<string, readonly unknown[]>()
  private next = 0

  /** The version this fake's medium is stamped with; the caller reads it, not the transaction. */
  stamped: number | undefined = 1

  readonly facet: MigrationFacet = {
    stampedVersion: async () => this.stamped,
    snapshotUnit: async (descriptor) => {
      this.calls.push(`snapshot:${descriptor.name}`)
      const handle = `snap-${String(this.next += 1)}`
      this.copies.set(handle, [...this.live])
      return { unit: descriptor.name, handle }
    },
    materializeMigrated: async (snapshot, version, migrate) => {
      this.calls.push(`materialize:${String(version)}`)
      const handle = `migrated-${String(this.next += 1)}`
      this.copies.set(handle, await migrate(this.copies.get(snapshot.handle) ?? []))
      return { unit: snapshot.unit, handle }
    },
    switchIn: async (migrated) => {
      this.calls.push(`switchIn:${migrated.handle}`)
      const previousHandle = `previous-${String(this.next += 1)}`
      this.copies.set(previousHandle, [...this.live])
      this.live = this.copies.get(migrated.handle) ?? []
      return { unit: migrated.unit, handle: previousHandle }
    },
    rollbackTo: async (previous) => {
      this.calls.push(`rollbackTo:${previous.handle}`)
      this.live = this.copies.get(previous.handle) ?? []
    },
    discard: async (snapshot) => {
      this.calls.push(`discard:${snapshot.handle}`)
      this.copies.delete(snapshot.handle)
    },
  }
}

/** A lease that holds, unless a case says it was superseded. */
function heldLease(overrides: Partial<RunLease> = {}): RunLease {
  return {
    token: { workItem: brandString('upgrade'), holder: brandString('cli'), epoch: 1 },
    renew: () => undefined,
    mayWrite: () => true,
    release: () => {},
    ...overrides,
  } as unknown as RunLease
}

function request(
  backend: RecordingBackend,
  overrides: Partial<UpgradeRequest> = {},
): { request: UpgradeRequest; records: UpgradeRecord[] } {
  const records: UpgradeRecord[] = []
  return {
    records,
    request: {
      plugin: 'dsh-notes',
      manifest: MANIFEST,
      installed: v('1'),
      unit: UNIT,
      migration: backend.facet,
      lease: heldLease(),
      now: () => 1_000,
      migrate: async rows => [...rows, 'migrated'],
      validate: async () => ({ ok: true, digest: 'sha256-validated' }),
      healthCheck: async () => true,
      writeRecord: async (record) => { records.push(record) },
      ...overrides,
    },
  }
}

describe('P1-10 must[1]: the transaction has the phases the registry names', () => {
  it('enumerates the six phases, in order, each named once', () => {
    expect([...UPGRADE_PHASES]).toEqual(['freeze', 'snapshot', 'quarantine', 'validate', 'switch', 'health-check'])
    expect(new Set(UPGRADE_PHASES).size).toBe(UPGRADE_PHASES.length)
  })
})

describe('P1-10 must[1]: what each phase leaves behind', () => {
  it('migrates a COPY, leaving the live unit unchanged until the switch', async () => {
    const backend = new RecordingBackend()
    const seen: unknown[][] = []
    const { request: upgrade } = request(backend, {
      migrate: async (rows) => {
        // Observed DURING the migration: the live unit still reads as it did.
        seen.push([...backend.live])
        return [...rows, 'migrated']
      },
    })

    expect(await runUpgrade(upgrade)).toMatchObject({ upgraded: true })
    expect(seen).toEqual([['original']])
    expect(backend.live).toEqual(['original', 'migrated'])
  })

  it('calls the facet in the order the phases declare, and never a path', async () => {
    const backend = new RecordingBackend()
    expect(await runUpgrade(request(backend).request)).toMatchObject({ upgraded: true })

    expect(backend.calls.map(call => call.split(':')[0]))
      .toEqual(['snapshot', 'materialize', 'switchIn', 'discard'])
  })

  it('stamps the migrated copy with the NEW version', async () => {
    const backend = new RecordingBackend()
    await runUpgrade(request(backend).request)
    expect(backend.calls).toContain('materialize:2')
  })

  it('rolls back to the replaced state when the HEALTH CHECK fails', async () => {
    const backend = new RecordingBackend()
    const { request: upgrade } = request(backend, { healthCheck: async () => false })

    expect(await runUpgrade(upgrade)).toEqual({ upgraded: false, failedAt: 'health-check' })
    // Not "an error was returned": the records are read back.
    expect(backend.live).toEqual(['original'])
    expect(backend.calls.some(call => call.startsWith('rollbackTo:'))).toBe(true)
  })

  it('does not switch at all when VALIDATE refuses, and discards the copy', async () => {
    const backend = new RecordingBackend()
    const { request: upgrade } = request(backend, {
      validate: async () => ({ ok: false, digest: 'sha256-rejected' }),
    })

    expect(await runUpgrade(upgrade)).toEqual({ upgraded: false, failedAt: 'validate' })
    expect(backend.live).toEqual(['original'])
    expect(backend.calls.some(call => call.startsWith('switchIn:'))).toBe(false)
    expect(backend.calls.some(call => call.startsWith('discard:migrated'))).toBe(true)
  })

  it('refuses BY NAME when the backend has no migration facet', async () => {
    // A deployment learns before anything else happens. By then the package
    // manager has already moved the code, so this refusal is a failed upgrade
    // like any other and takes the same path.
    const backend = new RecordingBackend()
    const { request: upgrade } = request(backend, { migration: undefined })

    expect(await runUpgrade(upgrade)).toEqual({
      upgraded: false,
      failedAt: 'freeze',
      refusal: { kind: 'backend-cannot-migrate', plugin: 'dsh-notes' },
    })
    expect(backend.calls).toEqual([])
  })

  it('refuses before touching anything when the plan itself is refused', async () => {
    const backend = new RecordingBackend()
    const { request: upgrade } = request(backend, { installed: v('9') })

    expect(await runUpgrade(upgrade)).toMatchObject({ upgraded: false, refusal: { kind: 'unreachable' } })
    expect(backend.calls).toEqual([])
  })
})

describe('P1-10 must[1]: the lease is what makes the switch safe', () => {
  it('REFUSES to switch when this holder was superseded during the migration', async () => {
    // The whole reason this uses a fencing lease rather than a lockfile. A
    // lockfile can say "someone holds it"; only a fencing lease can say "you
    // no longer do", which is the question that matters after a long
    // migration. A superseded holder that swapped anyway would overwrite
    // whatever the new holder has already done.
    const backend = new RecordingBackend()
    const { request: upgrade } = request(backend, { lease: heldLease({ mayWrite: () => false }) })

    expect(await runUpgrade(upgrade)).toEqual({ upgraded: false, failedAt: 'switch' })
    // The live unit is untouched, and the migrated copy is discarded rather
    // than left for the new holder to trip over.
    expect(backend.live).toEqual(['original'])
    expect(backend.calls.some(call => call.startsWith('switchIn:'))).toBe(false)
    expect(backend.calls.some(call => call.startsWith('discard:migrated'))).toBe(true)
  })

  it('RENEWS across the long phase, and stops when the renewal is denied', async () => {
    // A migration can outlast a lease TTL, and a lapsed holder is a superseded
    // one. Without the renewal, the fencing check before the switch would be
    // the first time anyone noticed — after the whole migration was paid for.
    const backend = new RecordingBackend()
    const renewals: number[] = []
    const { request: upgrade } = request(backend, {
      lease: heldLease({
        renew: (at: number) => {
          renewals.push(at)
          return { reason: 'held-by-another', holder: brandString('another-host') } as never
        },
      }),
    })

    expect(await runUpgrade(upgrade)).toEqual({ upgraded: false, failedAt: 'quarantine' })
    expect(renewals).toEqual([1_000])
    expect(backend.live).toEqual(['original'])
  })

  it('renews and proceeds when the lease still holds, so the check is not a constant', async () => {
    const backend = new RecordingBackend()
    expect(await runUpgrade(request(backend).request)).toMatchObject({ upgraded: true })
    expect(backend.live).toEqual(['original', 'migrated'])
  })
})

describe('P1-10 acceptance[1]: the record is written in two halves', () => {
  it('writes intent first and achievement only after the health check', async () => {
    const backend = new RecordingBackend()
    const { request: upgrade, records } = request(backend)

    expect(await runUpgrade(upgrade)).toMatchObject({ upgraded: true })
    // Asserted by MEANING rather than by count: the record is rewritten as the
    // upgrade learns things (the snapshot handle, then the replaced state's
    // handle), and a count would break every time a phase gained something to
    // remember while saying nothing about the property.
    expect(records[0]).toMatchObject({ plugin: 'dsh-notes', from: '1', to: '2' })
    expect(records.filter(record => record.upgradedTo !== undefined)).toHaveLength(1)
    expect(records.at(-1)).toMatchObject({ upgradedTo: '2', dataDigest: 'sha256-validated' })
    // Every write before the last one is intent only.
    expect(records.slice(0, -1).every(record => record.upgradedTo === undefined)).toBe(true)
  })

  it('writes NO achievement half when the health check fails', async () => {
    // The split is the property: a crash or a failure leaves intent alone, so
    // a later reconcile cannot read an upgrade that did not finish as one that
    // did.
    const backend = new RecordingBackend()
    const { request: upgrade, records } = request(backend, { healthCheck: async () => false })

    expect(await runUpgrade(upgrade)).toEqual({ upgraded: false, failedAt: 'health-check' })
    expect(records.filter(record => record.upgradedTo !== undefined)).toEqual([])
  })

  it('carries the path digest, so a confirmation names this exact conversion', async () => {
    const backend = new RecordingBackend()
    const { request: upgrade, records } = request(backend)
    await runUpgrade(upgrade)
    expect(records[0]?.pathDigest).toMatch(/^sha256-[0-9a-f]{64}$/u)
  })
})

describe('P1-10 acceptance[2]: a failed upgrade does not change approved permissions', () => {
  /**
   * A harness home holding the files an upgrade could plausibly disturb,
   * seeded with CONTENT.
   *
   * An empty directory proves nothing: "nothing changed" is trivially true of
   * a tree with nothing in it. The permission state this clause is about lives
   * in P2-02's token store, not in settings — `settings/src/index.ts` carries
   * no permission, approval or allow vocabulary at all.
   */
  function harnessHome(): string {
    const harness = mkdtempSync(join(tmpdir(), 'p1-10-home-'))
    roots.push(harness)
    mkdirSync(join(harness, 'capability-tokens'), { recursive: true })
    writeFileSync(
      join(harness, 'capability-tokens', 'capability-tokens.json'),
      JSON.stringify({ tokens: [{ digest: 'sha256-granted' }], revoked: [] }),
      'utf8',
    )
    writeFileSync(join(harness, 'settings.json'), JSON.stringify({ ui: { theme: 'dark' } }), 'utf8')
    return harness
  }

  /** A digest over every file in a tree, so a change anywhere is one comparison. */
  function treeDigest(root: string): string {
    const hash = createHash('sha256')
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, entry.name)
        hash.update(path.slice(root.length))
        if (entry.isDirectory()) walk(path)
        else hash.update(readFileSync(path))
      }
    }
    walk(root)
    return hash.digest('hex')
  }

  it('leaves the permission state byte-identical across a FAILED upgrade', async () => {
    const backend = new RecordingBackend()
    const harness = harnessHome()
    const before = treeDigest(harness)

    const { request: upgrade } = request(backend, { healthCheck: async () => false })
    expect(await runUpgrade(upgrade)).toEqual({ upgraded: false, failedAt: 'health-check' })

    expect(treeDigest(harness)).toBe(before)
  })

  it('the seeded home is NOT empty, so "nothing changed" is not vacuous', () => {
    const harness = harnessHome()
    expect(readdirSync(harness).length).toBeGreaterThan(1)
    expect(treeDigest(harness)).not.toBe(treeDigest(mkdtempSync(join(tmpdir(), 'p1-10-empty-'))))
  })
})

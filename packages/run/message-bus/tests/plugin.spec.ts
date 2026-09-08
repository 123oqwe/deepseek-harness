/**
 * The bus as a mounted service (Epic P4-06 Provider, §12.35-2(b)).
 *
 * `openBusStore` had no production caller and no plugin: every consumer would
 * have opened its own store and decided for its callers where the bus lives —
 * and that directory is what makes a bus shared at all. These cases mount the
 * plugin the way a profile does and assert on what a consumer injecting
 * `ctx.messageBus` gets.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, describe, expect, it } from 'vitest'
import MessageBusPlugin from '../src/plugin.ts'
import type { TenantId } from '../src/outbox.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A fresh directory this file cleans up. */
function root(): string {
  const created = mkdtempSync(join(tmpdir(), 'dsh-bus-plugin-'))
  roots.push(created)
  return created
}

/** One arriving message, with the fields the store keys on. */
function message(id: string) {
  return { id, epoch: 1, source: 'sender-a', type: 'domain/thing', time: '2026-09-08T00:00:00.000Z', data: { n: 1 } }
}

const POLICY = { tenant: brandString<TenantId>('tenant-a'), priority: 0, deadlineMs: 9_999_999_999_999 }

describe('P4-06 Provider: the bus is a mounted service', () => {
  it('publishes ctx.messageBus, and a commit through it is durable in the configured directory', async () => {
    const directory = root()
    const ctx = new Context()
    await ctx.plugin(MessageBusPlugin, { directory })

    ctx.messageBus.commitIntake({
      message: message('m1'),
      claimedByTurn: 1,
      outbox: [{ target: 'peer', payload: { n: 1 }, ...POLICY }],
    })

    // Read back through the SERVICE, then again through a second handle on the
    // same directory: the assertion is about what landed on disk, not about
    // what one in-process object remembers.
    expect(ctx.messageBus.domainEvents().map(event => event.id)).toEqual(['m1'])
    await ctx.fiber.dispose()
    const reopened = new Context()
    await reopened.plugin(MessageBusPlugin, { directory })
    expect(reopened.messageBus.outboxRows().map(row => row.record.state)).toEqual(['pending'])
    await reopened.fiber.dispose()
  })

  it('gives every committed row the store-owned delivery fields, not the caller-supplied ones', async () => {
    // The caller supplies policy — tenant, priority, deadline. `state`,
    // `attempts` and `receipt` are the store's, so a caller cannot commit a row
    // that claims to have been sent already.
    const ctx = new Context()
    await ctx.plugin(MessageBusPlugin, { directory: root() })

    ctx.messageBus.commitIntake({
      message: message('m2'),
      claimedByTurn: 1,
      outbox: [{ target: 'peer', payload: { n: 2 }, ...POLICY, priority: 7 }],
    })

    const [row] = ctx.messageBus.outboxRows()
    expect(row?.record).toMatchObject({ state: 'pending', attempts: 0, receipt: null, priority: 7, tenant: 'tenant-a' })
    await ctx.fiber.dispose()
  })

  it('REFUSES a bus file an older format wrote, naming the path and both versions', async () => {
    // The pre-release stance is that a backend rejects an old on-disk format.
    // The version row was written and never read until §12.35-2(a), so a
    // version-1 file would have failed later with a SQL error naming a missing
    // column rather than the format — which sends an operator looking at the
    // wrong thing.
    const directory = root()
    const db = new DatabaseSync(join(directory, 'bus.sqlite'))
    db.exec('CREATE TABLE schema_version (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL)')
    db.exec('INSERT INTO schema_version (singleton, version) VALUES (1, 1)')
    db.close()

    const ctx = new Context()
    await expect(ctx.plugin(MessageBusPlugin, { directory })).rejects.toThrow(/format version 1.*writes 2/su)
  })

  it('opens a directory that does not exist yet, so a first boot is not a failure', async () => {
    const directory = join(root(), 'nested', 'bus')
    writeFileSync(join(roots[roots.length - 1] as string, 'marker'), '')
    const ctx = new Context()

    await expect(ctx.plugin(MessageBusPlugin, { directory })).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})

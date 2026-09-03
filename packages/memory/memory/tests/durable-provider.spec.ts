/**
 * Provider-stage suite for the Memory capability seam (first100 registry
 * P6-01, P stage): the durable, file-backed `MemoryProvider`
 * (`createDurableFileMemoryProvider`, `../src/index.ts`) exercised through the
 * real registered `ctx.memory` service, never through a parallel mechanism.
 *
 * Every durability case constructs a SECOND provider instance over the same
 * directory, sharing no in-memory value with the first, so an in-memory double
 * cannot pass: cross-instance visibility can only come from the backing file.
 *
 * RED by design: `createDurableFileMemoryProvider()` returns a provider whose
 * methods throw `not implemented`. Every case below asserts the real expected
 * behavior of an implemented durable provider, so each currently fails on that
 * genuine mismatch, never on a missing module or a syntax error.
 * @module
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRuntime, {
  MemoryRecordId,
  createDurableFileMemoryProvider,
  createFakeMemoryProvider,
  type MemoryAccessContext,
  type MemoryScope,
} from '@deepseek-ai/dsh-memory'
import { createUserPrincipal, PrincipalId, TenantId, type Principal } from '@deepseek-ai/dsh-principal'

/** A fresh, empty directory for one test's durable backing file. */
function freshDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-memory-durable-'))
}

/**
 * Mount a MemoryRuntime carrying one durable provider over `directory`. Each
 * call builds a brand-new provider instance, so two calls over the same
 * directory share no in-memory value — only the backing file.
 */
async function mountDurable(directory: string, config: ConstructorParameters<typeof MemoryRuntime>[1] = {}): Promise<MemoryRuntime> {
  const ctx = new Context()
  await ctx.plugin(MemoryRuntime, config)
  ctx.memory.registerProvider(createDurableFileMemoryProvider({ directory }))
  return ctx.memory
}

function principalFor(tenant: string): Principal {
  return createUserPrincipal(PrincipalId('user-1'), TenantId(tenant))
}

function scopeFor(tenant: string, sessionId?: string): MemoryScope {
  return sessionId === undefined ? { tenantId: TenantId(tenant) } : { tenantId: TenantId(tenant), sessionId }
}

function accessContextFor(tenant: string, options: { sessionId?: string; maxRecords?: number } = {}): MemoryAccessContext {
  return {
    principal: principalFor(tenant),
    purpose: 'recall',
    scope: scopeFor(tenant, options.sessionId),
    contextBudget: { maxRecords: options.maxRecords ?? 10 },
  }
}

describe('P-stage durability: a record outlives the provider instance that wrote it', () => {
  it('a second provider instance over the same directory reads back a record the first instance proposed', async () => {
    const directory = freshDirectory()
    const first = await mountDurable(directory)
    const { id } = await first.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'survives the writer' } })

    const second = await mountDurable(directory)
    await expect(second.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toMatchObject({
      id,
      content: { note: 'survives the writer' },
    })
  })

  it('a provider instance over a different directory does not see the first directory\'s record — durability is per-directory, never process-global', async () => {
    const written = freshDirectory()
    const first = await mountDurable(written)
    const { id } = await first.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'only in the first directory' } })

    const elsewhere = await mountDurable(freshDirectory())
    await expect(elsewhere.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toBeUndefined()
    await expect(elsewhere.export({ accessContext: accessContextFor('tenant-a') })).resolves.toStrictEqual({ records: [], truncated: false })
  })

  it('a revise() by one instance is the content a later instance reads back', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    const { id } = await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'before' } })
    await writer.revise({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), id, content: { note: 'after' } })

    const reader = await mountDurable(directory)
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toMatchObject({ content: { note: 'after' } })
  })

  it('a forget() by one instance stays forgotten for a later instance, while a sibling record it did not forget stays readable', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    const doomed = await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'doomed' } })
    const kept = await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'kept' } })
    await writer.forget({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), id: doomed.id })

    const reader = await mountDurable(directory)
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id: doomed.id })).resolves.toBeUndefined()
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id: kept.id })).resolves.toMatchObject({ content: { note: 'kept' } })
  })

  it('query() from a later instance finds an earlier instance\'s record by case-insensitive substring', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'The Capital Of France' } })

    const reader = await mountDurable(directory)
    const result = await reader.query({ accessContext: accessContextFor('tenant-a'), query: 'capital of france' })
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({ content: { note: 'The Capital Of France' } })
  })

  it('query() from a later instance returns no records for a term absent from every stored record', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'the capital of france' } })

    const reader = await mountDurable(directory)
    await expect(reader.query({ accessContext: accessContextFor('tenant-a'), query: 'zzz-absent-term' })).resolves.toStrictEqual({ records: [], truncated: false })
  })

  it('a second instance mints ids distinct from every id the first instance minted, and both records remain readable', async () => {
    const directory = freshDirectory()
    const first = await mountDurable(directory)
    const a = await first.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'from the first instance' } })
    const b = await first.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'also from the first instance' } })

    const second = await mountDurable(directory)
    const c = await second.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'from the second instance' } })
    expect([a.id, b.id]).not.toContain(c.id)

    const reader = await mountDurable(directory)
    const exported = await reader.export({ accessContext: accessContextFor('tenant-a') })
    expect(exported.records.map(record => record.id).sort()).toStrictEqual([a.id, b.id, c.id].sort())
  })

  it('export() over a directory with no backing file yet resolves zero records rather than throwing', async () => {
    const memory = await mountDurable(freshDirectory())
    await expect(memory.export({ accessContext: accessContextFor('tenant-a') })).resolves.toStrictEqual({ records: [], truncated: false })
  })

  it('a record read back by a later instance is exactly {id, principal, content, updatedAt}, with the principal round-tripped unchanged', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    const content = { note: 'round-tripped through the file' }
    const { id } = await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content })

    const reader = await mountDurable(directory)
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toStrictEqual({
      id,
      principal: principalFor('tenant-a'),
      content,
      updatedAt: expect.any(String) as unknown,
    })
  })
})

describe('must[3]: every read is scoped — the durable provider filters by the read\'s scope', () => {
  it('export() scoped to one tenant returns that tenant\'s record and never the other tenant\'s, from the same backing directory', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'belongs to tenant-a' } })
    await writer.propose({ principal: principalFor('tenant-b'), scope: scopeFor('tenant-b'), content: { note: 'belongs to tenant-b' } })

    const reader = await mountDurable(directory)
    const forA = await reader.export({ accessContext: accessContextFor('tenant-a') })
    expect(forA.records.map(record => record.content)).toStrictEqual([{ note: 'belongs to tenant-a' }])
    const forB = await reader.export({ accessContext: accessContextFor('tenant-b') })
    expect(forB.records.map(record => record.content)).toStrictEqual([{ note: 'belongs to tenant-b' }])
  })

  it('get() resolves undefined for a record id proposed under a different tenant, even though the id exists in the same backing file', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    const { id } = await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'tenant-a only' } })

    const reader = await mountDurable(directory)
    await expect(reader.get({ accessContext: accessContextFor('tenant-b'), id })).resolves.toBeUndefined()
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toMatchObject({ id })
  })

  it('export() scoped to one sessionId returns only that session\'s record, while a tenant-wide scope naming no sessionId returns both', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a', 'session-1'), content: { note: 'from session-1' } })
    await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a', 'session-2'), content: { note: 'from session-2' } })

    const reader = await mountDurable(directory)
    const scopedToOne = await reader.export({ accessContext: accessContextFor('tenant-a', { sessionId: 'session-1' }) })
    expect(scopedToOne.records.map(record => record.content)).toStrictEqual([{ note: 'from session-1' }])

    const tenantWide = await reader.export({ accessContext: accessContextFor('tenant-a') })
    expect(tenantWide.records.map(record => record.content)).toStrictEqual([{ note: 'from session-1' }, { note: 'from session-2' }])
  })

  it('revise() rejects an id proposed under a different tenant with MEMORY_RECORD_NOT_FOUND, leaving the record\'s content untouched', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    const { id } = await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'original' } })

    const attacker = await mountDurable(directory)
    await expect(attacker.revise({
      principal: principalFor('tenant-b'),
      scope: scopeFor('tenant-b'),
      id,
      content: { note: 'cross-tenant overwrite' },
    })).rejects.toMatchObject({ name: 'MemoryError', code: 'MEMORY_RECORD_NOT_FOUND' })

    const reader = await mountDurable(directory)
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toMatchObject({ content: { note: 'original' } })
  })

  it('revise() rejects an id that was never proposed in any tenant with MEMORY_RECORD_NOT_FOUND', async () => {
    const memory = await mountDurable(freshDirectory())
    await expect(memory.revise({
      principal: principalFor('tenant-a'),
      scope: scopeFor('tenant-a'),
      id: MemoryRecordId('durable-file-never-proposed'),
      content: { note: 'attempted direct write' },
    })).rejects.toMatchObject({ name: 'MemoryError', code: 'MEMORY_RECORD_NOT_FOUND' })
  })

  it('query() at exactly contextBudget.maxRecords returns every match untruncated', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    for (const n of [1, 2, 3]) {
      await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: `budgeted ${n}` } })
    }

    const reader = await mountDurable(directory)
    const result = await reader.query({ accessContext: accessContextFor('tenant-a', { maxRecords: 3 }), query: 'budgeted' })
    expect(result.records).toHaveLength(3)
    expect(result.truncated).toBe(false)
  })

  it('query() one record over contextBudget.maxRecords truncates to the budget and flags truncated', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    for (const n of [1, 2, 3, 4]) {
      await writer.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: `budgeted ${n}` } })
    }

    const reader = await mountDurable(directory)
    const result = await reader.query({ accessContext: accessContextFor('tenant-a', { maxRecords: 3 }), query: 'budgeted' })
    expect(result.records).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })
})

describe('must[1]: the durable provider is one interchangeable backend among others', () => {
  it('with providerId pinned to durable-file alongside a registered in-memory fake, the record is written durably and read back by a later instance', async () => {
    const directory = freshDirectory()
    const ctx = new Context()
    await ctx.plugin(MemoryRuntime, { providerId: 'durable-file' })
    ctx.memory.registerProvider(createDurableFileMemoryProvider({ directory }))
    const fake = createFakeMemoryProvider()
    ctx.memory.registerProvider(fake)

    const { id } = await ctx.memory.propose({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'routed to the durable backend' } })

    // The in-memory fake never saw the write: it is registered but not selected.
    await expect(fake.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toBeUndefined()

    const reader = await mountDurable(directory)
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toMatchObject({ content: { note: 'routed to the durable backend' } })
  })
})

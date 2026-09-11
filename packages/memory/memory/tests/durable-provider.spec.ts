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

import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
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


/** The document the durable provider keeps, read straight off disk. */
function storedRecords(directory: string): { id: string; confidence?: number; provenance?: unknown }[] {
  const document = JSON.parse(readFileSync(join(directory, 'memory.json'), 'utf8')) as {
    records: { id: string; confidence?: number; provenance?: unknown }[]
  }
  return document.records
}

/** Brand a raw string as a source event id, as P6-02's vocabulary spells it. */
const SourceEventId = (id: string): never => id as never

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
    const { id } = await first.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'survives the writer' } })

    const second = await mountDurable(directory)
    await expect(second.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toMatchObject({
      id,
      content: { note: 'survives the writer' },
    })
  })

  it('a provider instance over a different directory does not see the first directory\'s record — durability is per-directory, never process-global', async () => {
    const written = freshDirectory()
    const first = await mountDurable(written)
    const { id } = await first.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'only in the first directory' } })

    const elsewhere = await mountDurable(freshDirectory())
    await expect(elsewhere.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toBeUndefined()
    await expect(elsewhere.export({ accessContext: accessContextFor('tenant-a') })).resolves.toStrictEqual({ records: [], truncated: false })
  })

  it('a revise() by one instance is the content a later instance reads back', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    const { id } = await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'before' } })
    await writer.revise({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), id, content: { note: 'after' } })

    const reader = await mountDurable(directory)
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toMatchObject({ content: { note: 'after' } })
  })

  it('a forget() by one instance stays forgotten for a later instance, while a sibling record it did not forget stays readable', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    const doomed = await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'doomed' } })
    const kept = await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'kept' } })
    await writer.forget({ principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), id: doomed.id })

    const reader = await mountDurable(directory)
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id: doomed.id })).resolves.toBeUndefined()
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id: kept.id })).resolves.toMatchObject({ content: { note: 'kept' } })
  })

  it('query() from a later instance finds an earlier instance\'s record by case-insensitive substring', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'The Capital Of France' } })

    const reader = await mountDurable(directory)
    const result = await reader.query({ accessContext: accessContextFor('tenant-a'), query: 'capital of france' })
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({ content: { note: 'The Capital Of France' } })
  })

  it('query() from a later instance returns no records for a term absent from every stored record', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'the capital of france' } })

    const reader = await mountDurable(directory)
    await expect(reader.query({ accessContext: accessContextFor('tenant-a'), query: 'zzz-absent-term' })).resolves.toStrictEqual({ records: [], truncated: false })
  })

  it('a second instance mints ids distinct from every id the first instance minted, and both records remain readable', async () => {
    const directory = freshDirectory()
    const first = await mountDurable(directory)
    const a = await first.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'from the first instance' } })
    const b = await first.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'also from the first instance' } })

    const second = await mountDurable(directory)
    const c = await second.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'from the second instance' } })
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
    const { id } = await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content })

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
    await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'belongs to tenant-a' } })
    await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-b'), scope: scopeFor('tenant-b'), content: { note: 'belongs to tenant-b' } })

    const reader = await mountDurable(directory)
    const forA = await reader.export({ accessContext: accessContextFor('tenant-a') })
    expect(forA.records.map(record => record.content)).toStrictEqual([{ note: 'belongs to tenant-a' }])
    const forB = await reader.export({ accessContext: accessContextFor('tenant-b') })
    expect(forB.records.map(record => record.content)).toStrictEqual([{ note: 'belongs to tenant-b' }])
  })

  it('get() resolves undefined for a record id proposed under a different tenant, even though the id exists in the same backing file', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    const { id } = await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'tenant-a only' } })

    const reader = await mountDurable(directory)
    await expect(reader.get({ accessContext: accessContextFor('tenant-b'), id })).resolves.toBeUndefined()
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toMatchObject({ id })
  })

  it('export() scoped to one sessionId returns only that session\'s record, while a tenant-wide scope naming no sessionId returns both', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a', 'session-1'), content: { note: 'from session-1' } })
    await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a', 'session-2'), content: { note: 'from session-2' } })

    const reader = await mountDurable(directory)
    const scopedToOne = await reader.export({ accessContext: accessContextFor('tenant-a', { sessionId: 'session-1' }) })
    expect(scopedToOne.records.map(record => record.content)).toStrictEqual([{ note: 'from session-1' }])

    const tenantWide = await reader.export({ accessContext: accessContextFor('tenant-a') })
    expect(tenantWide.records.map(record => record.content)).toStrictEqual([{ note: 'from session-1' }, { note: 'from session-2' }])
  })

  it('revise() rejects an id proposed under a different tenant with MEMORY_RECORD_NOT_FOUND, leaving the record\'s content untouched', async () => {
    const directory = freshDirectory()
    const writer = await mountDurable(directory)
    const { id } = await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'original' } })

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
      await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: `budgeted ${n}` } })
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
      await writer.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: `budgeted ${n}` } })
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

    const { id } = await ctx.memory.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'routed to the durable backend' } })

    // The in-memory fake never saw the write: it is registered but not selected.
    await expect(fake.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toBeUndefined()

    const reader = await mountDurable(directory)
    await expect(reader.get({ accessContext: accessContextFor('tenant-a'), id })).resolves.toMatchObject({ content: { note: 'routed to the durable backend' } })
  })
})

describe('durable memory is written for its owner only', () => {
  it('creates the directory 0700, so nothing else on the host can traverse into it', async () => {
    // A user's durable memory is their content. The directory mode is what
    // stops a traversal reaching the document at all.
    const directory = join(freshDirectory(), 'memory')
    const memory = await mountDurable(directory)

    await memory.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'private' } })

    expect(statSync(directory).mode & 0o777).toBe(0o700)
  })

  it('writes the document 0600, which the directory mode does not do for it', async () => {
    // Asserted separately from the directory, because the two stop different
    // things: this is what a backup pass, a synced folder or a bind mount that
    // already holds a path to the file runs into.
    const directory = join(freshDirectory(), 'memory')
    const memory = await mountDurable(directory)

    await memory.propose({ origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'), scope: scopeFor('tenant-a'), content: { note: 'private' } })

    const document = readdirSync(directory).find(entry => !entry.endsWith('.tmp'))
    expect(document, 'the durable document').toBeDefined()
    expect(statSync(join(directory, document ?? '')).mode & 0o777).toBe(0o600)
  })
})

describe('memory is scoped to the workspace that wrote it', () => {
  const workspaceA = { canonicalPath: '/projects/alpha', identity: 'dev-1:ino-10:1700000000000' }
  const workspaceB = { canonicalPath: '/projects/beta', identity: 'dev-1:ino-20:1700000000000' }

  it('does not recall another workspace of the same tenant', async () => {
    // The whole point of the dimension: one tenant, two projects, one durable
    // file — and what alpha wrote is not what beta reads.
    const directory = freshDirectory()
    const memory = await mountDurable(directory)
    await memory.propose({
      origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'),
      scope: { tenantId: TenantId('tenant-a'), workspace: workspaceA },
      content: { note: 'alpha only' },
    })

    const seen = await memory.query({
      accessContext: { ...accessContextFor('tenant-a'), scope: { tenantId: TenantId('tenant-a'), workspace: workspaceB } },
      query: 'alpha',
    })

    expect(seen.records).toEqual([])
  })

  it('recalls its own workspace, so the refusal above is not a blanket one', async () => {
    // Control. A scope check mutated to refuse everything satisfies the case
    // above and is caught only here.
    const directory = freshDirectory()
    const memory = await mountDurable(directory)
    await memory.propose({
      origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'),
      scope: { tenantId: TenantId('tenant-a'), workspace: workspaceA },
      content: { note: 'alpha only' },
    })

    const seen = await memory.query({
      accessContext: { ...accessContextFor('tenant-a'), scope: { tenantId: TenantId('tenant-a'), workspace: workspaceA } },
      query: 'alpha',
    })

    expect(seen.records).toHaveLength(1)
  })

  it('does not inherit the memories of a directory it replaced: same path, new identity', async () => {
    // A re-cloned repository resolves to the same path with a new inode. The
    // records belong to the directory that was there before, and handing them
    // to whoever owns that path now is the leak this matches on identity to
    // prevent.
    const directory = freshDirectory()
    const memory = await mountDurable(directory)
    await memory.propose({
      origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'),
      scope: { tenantId: TenantId('tenant-a'), workspace: workspaceA },
      content: { note: 'written before the rebuild' },
    })

    const rebuilt = { canonicalPath: workspaceA.canonicalPath, identity: 'dev-1:ino-99:1800000000000' }
    const seen = await memory.query({
      accessContext: { ...accessContextFor('tenant-a'), scope: { tenantId: TenantId('tenant-a'), workspace: rebuilt } },
      query: 'written',
    })

    expect(seen.records).toEqual([])
  })

  it('a reader naming NO workspace sees only records written without one', async () => {
    // Omitting the field must not be a way around the boundary. A reader with
    // no workspace is not a reader of every workspace.
    const directory = freshDirectory()
    const memory = await mountDurable(directory)
    await memory.propose({
      origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'),
      scope: { tenantId: TenantId('tenant-a'), workspace: workspaceA },
      content: { note: 'belongs to alpha' },
    })
    await memory.propose({
      origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: principalFor('tenant-a'),
      scope: { tenantId: TenantId('tenant-a') },
      content: { note: 'belongs to no workspace' },
    })

    const seen = await memory.query({ accessContext: accessContextFor('tenant-a'), query: 'belongs' })

    expect(seen.records).toHaveLength(1)
    expect(seen.records[0]?.content).toEqual({ note: 'belongs to no workspace' })
  })
})

describe('a stored record carries the origin its writer stated', () => {
  it('refuses a version-1 document by name rather than reading it as origin-less', async () => {
    // Records written before `provenance`/`confidence` existed describe claims
    // whose origin this build cannot know. Reading them as though the origin
    // were merely absent would present a guess as a stored fact, so the reader
    // refuses the document and says which version it found. The pre-release
    // stance is that a backend rejects an old on-disk format, not that it
    // migrates or infers one.
    const directory = freshDirectory()
    writeFileSync(join(directory, 'memory.json'), `${JSON.stringify({ version: 1, records: [] })}\n`, 'utf8')
    const memory = await mountDurable(directory)

    await expect(memory.query({ accessContext: accessContextFor('tenant-a'), query: 'anything' }))
      .rejects.toThrow(/unsupported durable memory format version 1/u)
  })

  it('fixes an asserted claim at confidence 1 without the caller stating one', async () => {
    // Vocabulary, not a default: `user-asserted` means a named party said it.
    // The request type has no way to attach a confidence to this branch, so the
    // number cannot have come from a caller.
    const directory = freshDirectory()
    const memory = await mountDurable(directory)

    const { id } = await memory.propose({
      origin: { kind: 'user-asserted', assertedBy: 'ada' },
      principal: principalFor('tenant-a'),
      scope: scopeFor('tenant-a'),
      content: { note: 'a person said this' },
    })

    const stored = storedRecords(directory).find(record => record.id === id)
    expect(stored?.confidence).toBe(1)
    expect(stored?.provenance).toEqual({ kind: 'user-asserted', assertedBy: 'ada' })
  })

  it('stores an inferred claim at the confidence its writer stated, not a house number', async () => {
    const directory = freshDirectory()
    const memory = await mountDurable(directory)

    const { id } = await memory.propose({
      origin: { kind: 'derived', sourceEvents: [SourceEventId('evt-1')], confidence: 0.4 },
      principal: principalFor('tenant-a'),
      scope: scopeFor('tenant-a'),
      content: { note: 'inferred from one event' },
    })

    const stored = storedRecords(directory).find(record => record.id === id)
    expect(stored?.confidence).toBe(0.4)
    expect(stored?.provenance).toMatchObject({ kind: 'derived', sourceEvents: ['evt-1'] })
  })
})

describe('a rebuilt workspace can be recognized without being read', () => {
  const before = { canonicalPath: '/projects/alpha', identity: 'dev-1:ino-10:1700000000000' }
  const after = { canonicalPath: '/projects/alpha', identity: 'dev-1:ino-99:1800000000000' }

  it('counts what the displaced directory left, so a consumer can say so', async () => {
    const directory = freshDirectory()
    const memory = await mountDurable(directory)
    await memory.propose({
      origin: { kind: 'user-asserted', assertedBy: 'test' },
      principal: principalFor('tenant-a'),
      scope: { tenantId: TenantId('tenant-a'), workspace: before },
      content: { note: 'written before the rebuild' },
    })

    const count = await memory.countRebuiltAt({
      accessContext: { ...accessContextFor('tenant-a'), scope: { tenantId: TenantId('tenant-a'), workspace: after } },
      canonicalPath: after.canonicalPath,
      currentIdentity: after.identity,
    })

    expect(count).toBe(1)
  })

  it('returns a NUMBER and nothing else, so it is not a way around the scope check', async () => {
    // The negative half, and the reason this method returns a count: a reader
    // in the rebuilt directory must not receive the displaced directory's
    // content or ids. `query` for the same path still sees nothing.
    const directory = freshDirectory()
    const memory = await mountDurable(directory)
    await memory.propose({
      origin: { kind: 'user-asserted', assertedBy: 'test' },
      principal: principalFor('tenant-a'),
      scope: { tenantId: TenantId('tenant-a'), workspace: before },
      content: { note: 'secret from the previous clone' },
    })
    const rebuiltContext = {
      ...accessContextFor('tenant-a'),
      scope: { tenantId: TenantId('tenant-a'), workspace: after },
    }

    const count = await memory.countRebuiltAt({
      accessContext: rebuiltContext,
      canonicalPath: after.canonicalPath,
      currentIdentity: after.identity,
    })
    const seen = await memory.query({ accessContext: rebuiltContext, query: 'secret' })

    expect(typeof count).toBe('number')
    expect(seen.records).toEqual([])
    expect(JSON.stringify(seen)).not.toContain('secret from the previous clone')
  })

  it('does not count another TENANT\'s records at the same path', async () => {
    // Found by a surviving mutation: dropping the tenant check from the counter
    // changed nothing, because no case exercised it. Two tenants can hold the
    // same canonical path — a shared checkout, or simply the same directory
    // name — and a count that crossed them would report one tenant's history to
    // another, through the one method that deliberately crosses workspaces.
    const directory = freshDirectory()
    const memory = await mountDurable(directory)
    await memory.propose({
      origin: { kind: 'user-asserted', assertedBy: 'test' },
      principal: principalFor('tenant-b'),
      scope: { tenantId: TenantId('tenant-b'), workspace: before },
      content: { note: 'belongs to another tenant' },
    })

    const count = await memory.countRebuiltAt({
      accessContext: { ...accessContextFor('tenant-a'), scope: { tenantId: TenantId('tenant-a'), workspace: after } },
      canonicalPath: after.canonicalPath,
      currentIdentity: after.identity,
    })

    expect(count).toBe(0)
  })

  it('counts nothing when the path is untouched, so the count is not constant', async () => {
    const directory = freshDirectory()
    const memory = await mountDurable(directory)
    await memory.propose({
      origin: { kind: 'user-asserted', assertedBy: 'test' },
      principal: principalFor('tenant-a'),
      scope: { tenantId: TenantId('tenant-a'), workspace: before },
      content: { note: 'still the same directory' },
    })

    const count = await memory.countRebuiltAt({
      accessContext: { ...accessContextFor('tenant-a'), scope: { tenantId: TenantId('tenant-a'), workspace: before } },
      canonicalPath: before.canonicalPath,
      currentIdentity: before.identity,
    })

    expect(count).toBe(0)
  })
})

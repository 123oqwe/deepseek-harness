/**
 * Contract-stage conformance suite for the Memory capability seam (first100
 * registry P6-01, C stage). Case titles map 1:1 (split where one clause
 * covers more than one distinct behavior) to `registry.json`'s P6-01
 * `acceptance[]`/`must[]` clauses, cited verbatim in each title/comment.
 *
 * RED by design: `createLocalReferenceMemoryProvider()` and
 * `createFakeMemoryProvider()` (`../src/index.ts`) are intentionally
 * unimplemented stubs — every method rejects with a plain `not implemented`
 * error. Every case below asserts the REAL expected behavior once a provider
 * is implemented, so every case currently fails on that genuine mismatch
 * (an unimplemented `MemoryProvider` method, or a not-yet-added seam
 * enforcement), never on a missing module or a syntax error. The routing
 * (`MemoryRuntime.registerProvider`/provider selection) is real, matching
 * `WebRuntime` (`@deepseek-ai/dsh-web`) — only provider-level business logic
 * is stubbed.
 * @module
 */

import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRuntime, {
  MemoryRecordId,
  createFakeMemoryProvider,
  createLocalReferenceMemoryProvider,
  type MemoryAccessContext,
  type MemoryProvider,
  type MemoryScope,
} from '@deepseek-ai/dsh-memory'
import { createUserPrincipal, PrincipalId, TenantId, type Principal } from '@deepseek-ai/dsh-principal'

/** Mount a MemoryRuntime on a fresh root context with the given config. */
async function mountMemory(config: ConstructorParameters<typeof MemoryRuntime>[1] = {}): Promise<{ ctx: Context; memory: MemoryRuntime }> {
  const ctx = new Context()
  await ctx.plugin(MemoryRuntime, config)
  return { ctx, memory: ctx.memory }
}

function testPrincipal(): Principal {
  return createUserPrincipal(PrincipalId('user-1'), TenantId('tenant-a'))
}

function testScope(): MemoryScope {
  return { tenantId: TenantId('tenant-a') }
}

function testAccessContext(): MemoryAccessContext {
  return {
    principal: testPrincipal(),
    purpose: 'recall',
    scope: testScope(),
    contextBudget: { maxRecords: 10 },
  }
}

/**
 * Shared conformance suite (`acceptance[0]`: "at least local reference
 * provider and fake provider pass conformance") run once per provider. The
 * six `it()` blocks below jointly exercise `must[0]`'s six verbs.
 */
function runConformance(label: string, createProvider: () => MemoryProvider): void {
  describe(`conformance: ${label} (acceptance[0] + must[0])`, () => {
    it('propose() accepts a candidate record and resolves a new MemoryRecordId', async () => {
      const { memory } = await mountMemory()
      memory.registerProvider(createProvider())
      await expect(memory.propose({
        principal: testPrincipal(),
        scope: testScope(),
        content: { note: 'first memory' },
      })).resolves.toMatchObject({ id: expect.any(String) as unknown })
    })

    it('query() resolves matching records honoring the caller-supplied context budget', async () => {
      const { memory } = await mountMemory()
      memory.registerProvider(createProvider())
      await expect(memory.query({
        accessContext: testAccessContext(),
        query: 'first memory',
      })).resolves.toMatchObject({ records: expect.any(Array) as unknown, truncated: expect.any(Boolean) as unknown })
    })

    it('get() resolves the record previously created by propose()', async () => {
      const { memory } = await mountMemory()
      memory.registerProvider(createProvider())
      const proposed = await memory.propose({ principal: testPrincipal(), scope: testScope(), content: { note: 'roundtrip' } })
      await expect(memory.get({ accessContext: testAccessContext(), id: proposed.id })).resolves.toMatchObject({
        id: proposed.id,
        content: { note: 'roundtrip' },
      })
    })

    it('revise() updates an existing record, reflected by a later get()', async () => {
      const { memory } = await mountMemory()
      memory.registerProvider(createProvider())
      const proposed = await memory.propose({ principal: testPrincipal(), scope: testScope(), content: { note: 'before' } })
      await memory.revise({ principal: testPrincipal(), scope: testScope(), id: proposed.id, content: { note: 'after' } })
      await expect(memory.get({ accessContext: testAccessContext(), id: proposed.id })).resolves.toMatchObject({ content: { note: 'after' } })
    })

    it('forget() removes a record so a later get() resolves undefined', async () => {
      const { memory } = await mountMemory()
      memory.registerProvider(createProvider())
      const proposed = await memory.propose({ principal: testPrincipal(), scope: testScope(), content: { note: 'temporary' } })
      await memory.forget({ principal: testPrincipal(), scope: testScope(), id: proposed.id })
      await expect(memory.get({ accessContext: testAccessContext(), id: proposed.id })).resolves.toBeUndefined()
    })

    it('export() resolves every record visible to the access context', async () => {
      const { memory } = await mountMemory()
      memory.registerProvider(createProvider())
      await memory.propose({ principal: testPrincipal(), scope: testScope(), content: { note: 'exported' } })
      await expect(memory.export({ accessContext: testAccessContext() })).resolves.toMatchObject({
        records: expect.arrayContaining([expect.objectContaining({ content: { note: 'exported' } })]) as unknown,
      })
    })
  })
}

runConformance('local reference provider', createLocalReferenceMemoryProvider)
runConformance('fake provider', createFakeMemoryProvider)

describe('must[1]: memory provider is replaceable', () => {
  it('swapping the registered provider changes which provider serves the same runtime call', async () => {
    const { memory } = await mountMemory()
    const providerA = createFakeMemoryProvider()
    const providerB = createLocalReferenceMemoryProvider()
    const proposeA = vi.spyOn(providerA, 'propose')
    const proposeB = vi.spyOn(providerB, 'propose')
    const request = { principal: testPrincipal(), scope: testScope(), content: { note: 'routed' } }

    const disposeA = memory.registerProvider(providerA)
    await memory.propose(request).catch(() => undefined)
    expect(proposeA).toHaveBeenCalledTimes(1)
    expect(proposeB).not.toHaveBeenCalled()

    disposeA()
    memory.registerProvider(providerB)
    await memory.propose(request).catch(() => undefined)
    expect(proposeB).toHaveBeenCalledTimes(1)
    // Provider A no longer receives calls once disposed and replaced.
    expect(proposeA).toHaveBeenCalledTimes(1)

    // Genuinely failing assertion: once a provider is implemented, propose()
    // through the currently-active provider resolves with a real record id.
    await expect(memory.propose(request)).resolves.toMatchObject({ id: expect.any(String) as unknown })
  })
})

describe('must[2]: consumers reach memory only through the Service Definition', () => {
  it('a provider object alone is inert — it takes effect only once registered on ctx.memory', async () => {
    const provider = createFakeMemoryProvider()
    const { memory } = await mountMemory()
    const request = { principal: testPrincipal(), scope: testScope(), content: { note: 'unrouted' } }

    // Before registration, ctx.memory (the sole Service Definition entry
    // point) has nothing to route to — merely constructing a provider object
    // does not make it reachable.
    await expect(memory.propose(request)).rejects.toMatchObject({ name: 'MemoryError', code: 'MEMORY_PROVIDER_UNAVAILABLE' })

    memory.registerProvider(provider)
    // Genuinely failing assertion: once implemented, routing through
    // ctx.memory after registration resolves with a real record id.
    await expect(memory.propose(request)).resolves.toMatchObject({ id: expect.any(String) as unknown })
  })
})

describe('acceptance[1]: no bypass exists for a model to directly write durable memory', () => {
  it('revise() rejects an id that was never returned by propose()', async () => {
    const { memory } = await mountMemory()
    memory.registerProvider(createFakeMemoryProvider())
    const forgedId = MemoryRecordId('forged-never-proposed')
    await expect(memory.revise({
      principal: testPrincipal(),
      scope: testScope(),
      id: forgedId,
      content: { note: 'attempted direct write' },
    })).rejects.toMatchObject({ name: 'MemoryError', code: 'MEMORY_RECORD_NOT_FOUND' })
  })
})

describe('must[3]: every read is scoped by principal, purpose, scope, and context budget', () => {
  it('query() rejects a request whose access context is missing any of the four required fields', async () => {
    const { memory } = await mountMemory()
    memory.registerProvider(createFakeMemoryProvider())
    const complete = testAccessContext()
    const incompleteVariants: Record<string, MemoryAccessContext> = {
      principal: { ...complete, principal: undefined } as unknown as MemoryAccessContext,
      purpose: { ...complete, purpose: '' },
      scope: { ...complete, scope: undefined } as unknown as MemoryAccessContext,
      contextBudget: { ...complete, contextBudget: undefined } as unknown as MemoryAccessContext,
    }
    for (const accessContext of Object.values(incompleteVariants)) {
      await expect(memory.query({ accessContext, query: 'q' })).rejects.toMatchObject({
        name: 'MemoryError',
        code: 'MEMORY_ACCESS_CONTEXT_REQUIRED',
      })
    }
  })

  // get() and export() carry the identical MemoryAccessContext (`./types.ts`)
  // must[3] names by dimension, not by verb — a bug isolated to either
  // method's own enforcement must be caught here, not only on query()'s.
  it('get() rejects a request whose access context is missing any of the four required fields', async () => {
    const { memory } = await mountMemory()
    memory.registerProvider(createFakeMemoryProvider())
    const complete = testAccessContext()
    const incompleteVariants: Record<string, MemoryAccessContext> = {
      principal: { ...complete, principal: undefined } as unknown as MemoryAccessContext,
      purpose: { ...complete, purpose: '' },
      scope: { ...complete, scope: undefined } as unknown as MemoryAccessContext,
      contextBudget: { ...complete, contextBudget: undefined } as unknown as MemoryAccessContext,
    }
    for (const accessContext of Object.values(incompleteVariants)) {
      await expect(memory.get({ accessContext, id: MemoryRecordId('irrelevant-for-this-check') })).rejects.toMatchObject({
        name: 'MemoryError',
        code: 'MEMORY_ACCESS_CONTEXT_REQUIRED',
      })
    }
  })

  it('export() rejects a request whose access context is missing any of the four required fields', async () => {
    const { memory } = await mountMemory()
    memory.registerProvider(createFakeMemoryProvider())
    const complete = testAccessContext()
    const incompleteVariants: Record<string, MemoryAccessContext> = {
      principal: { ...complete, principal: undefined } as unknown as MemoryAccessContext,
      purpose: { ...complete, purpose: '' },
      scope: { ...complete, scope: undefined } as unknown as MemoryAccessContext,
      contextBudget: { ...complete, contextBudget: undefined } as unknown as MemoryAccessContext,
    }
    for (const accessContext of Object.values(incompleteVariants)) {
      await expect(memory.export({ accessContext })).rejects.toMatchObject({
        name: 'MemoryError',
        code: 'MEMORY_ACCESS_CONTEXT_REQUIRED',
      })
    }
  })
})

describe('acceptance[2]: Memory is not Session Query, and their boundary is documented', () => {
  it('docs/subsystems/memory.md exists, and a resolved memory record is structurally distinct from a Session Query transcript entry', async () => {
    expect(existsSync(new URL('../../../../docs/subsystems/memory.md', import.meta.url))).toBe(true)

    const { memory } = await mountMemory()
    memory.registerProvider(createFakeMemoryProvider())
    const content = { note: 'not a transcript entry' }
    const proposed = await memory.propose({ principal: testPrincipal(), scope: testScope(), content })
    // A MemoryRecordView is EXACTLY {id, principal, content, updatedAt} — no
    // session-transcript-shaped fields (no `role`, `seq`, or surface
    // `content` blocks) and, unlike toMatchObject, no other extra property a
    // stub or wrong implementation could tack on and still pass a subset
    // match: toStrictEqual rejects any key beyond this exact set.
    await expect(memory.get({ accessContext: testAccessContext(), id: proposed.id })).resolves.toStrictEqual({
      id: proposed.id,
      principal: testPrincipal(),
      content,
      updatedAt: expect.any(String) as unknown,
    })
  })
})

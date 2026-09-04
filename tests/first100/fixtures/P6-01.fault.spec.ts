/**
 * P6-01 F-stage fault qualification: the provider-neutral Memory seam
 * (`@deepseek-ai/dsh-memory`'s `MemoryRuntime` and its three shipped
 * providers) put under the conditions the Contract, Provider and Usage stages
 * never subjected it to — a read whose access context is complete but whose
 * tenant is not the record's, a context budget that is not a sane positive
 * count, and a durable store that is damaged rather than clean.
 *
 * `must[3]` requires that "所有读取受 principal、purpose、scope 和 context
 * budget". Contract stage proved that the seam REJECTS an incomplete access
 * context, and Provider stage proved that `durable-file` filters by scope.
 * Neither proved that a COMPLETE access context actually bounds the result of
 * the other two providers. The seam's two guards are
 * `requireCompleteAccessContext`, which checks the presence of the four
 * fields, and `capRecords`, which checks a count — a clause guarded by the
 * shape of its input rather than by its effect, which is why `must[3]` reads
 * as covered and is not. Every scope case below therefore supplies a complete,
 * valid access context and asks what comes back.
 *
 * Cases fail against the code as landed and name a real defect the fix-round
 * closes. Cases prefixed `CHARACTERIZATION:` pass already: they pin fault
 * handling that is correct today, or a residual this stage deliberately does
 * not close, so a later change cannot silently regress or silently inherit it.
 *
 * Every assertion is on observable memory state or on a rejection's `name`
 * and `code`, both of which this repository raises itself. No case asserts on
 * a `JSON.parse` message (V8-version-dependent) or on temp-path equality
 * (macOS resolves `/var` through a symlink to `/private/var`), so none can
 * pass on macOS while being false on Linux.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRuntime, {
  MemoryRecordId,
  createDurableFileMemoryProvider,
  createFakeMemoryProvider,
  createLocalReferenceMemoryProvider,
  type MemoryAccessContext,
  type MemoryProvider,
  type MemoryScope,
} from '@deepseek-ai/dsh-memory'
import { createUserPrincipal, PrincipalId, TenantId, type Principal } from '@deepseek-ai/dsh-principal'

const TENANT_A = TenantId('tenant-a')
const TENANT_B = TenantId('tenant-b')

/** Directories this fixture created, removed after each case (specs fork concurrently). */
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

/** A fresh directory owned by the calling case through teardown. */
async function ownedDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-p6-01-fault-'))
  temporaryDirectories.push(directory)
  return directory
}

/** Mount a MemoryRuntime on a fresh root context with the given config. */
async function mountMemory(config: ConstructorParameters<typeof MemoryRuntime>[1] = {}): Promise<MemoryRuntime> {
  const ctx = new Context()
  await ctx.plugin(MemoryRuntime, config)
  return ctx.memory
}

function principalOf(tenantId: TenantId): Principal {
  return createUserPrincipal(PrincipalId(`user-of-${tenantId}`), tenantId)
}

/** A complete, valid access context — every `must[3]` dimension present. */
function accessContextOf(tenantId: TenantId, contextBudget: MemoryAccessContext['contextBudget'] = { maxRecords: 10 }): MemoryAccessContext {
  return { principal: principalOf(tenantId), purpose: 'recall', scope: { tenantId }, contextBudget }
}

function scopeOf(tenantId: TenantId): MemoryScope {
  return { tenantId }
}

/**
 * The two in-memory providers the package exports for production use. They are
 * shipped factories, not test doubles: `createFakeMemoryProvider`'s name
 * describes its retrieval mechanism, not its reachability.
 */
const inMemoryProviders: readonly (readonly [string, () => MemoryProvider])[] = [
  ['local-reference', createLocalReferenceMemoryProvider],
  ['fake', createFakeMemoryProvider],
]

/**
 * `must[3]` + `validation[1]` ("测试跨 tenant/scope 读取") against the two
 * in-memory providers. Each case proposes under `tenant-a` and then acts under
 * a complete `tenant-b` access context, so nothing here is rejected for a
 * malformed request — the request is valid and the answer is wrong.
 */
for (const [label, createProvider] of inMemoryProviders) {
  describe(`must[3]: the ${label} provider bounds a complete read by its scope`, () => {
    it(`${label}: export() under tenant-b returns no record proposed under tenant-a`, async () => {
      const memory = await mountMemory()
      memory.registerProvider(createProvider())
      await memory.propose({ principal: principalOf(TENANT_A), scope: scopeOf(TENANT_A), content: { secret: 'tenant-a-only' } })
      await expect(memory.export({ accessContext: accessContextOf(TENANT_B) })).resolves.toMatchObject({ records: [] })
    })

    it(`${label}: query() under tenant-b matches no record proposed under tenant-a, even on an exact content term`, async () => {
      const memory = await mountMemory()
      memory.registerProvider(createProvider())
      await memory.propose({ principal: principalOf(TENANT_A), scope: scopeOf(TENANT_A), content: { secret: 'tenant-a-only' } })
      await expect(memory.query({ accessContext: accessContextOf(TENANT_B), query: 'tenant-a-only' })).resolves.toMatchObject({ records: [] })
    })

    it(`${label}: get() under tenant-b resolves undefined for an id proposed under tenant-a`, async () => {
      const memory = await mountMemory()
      memory.registerProvider(createProvider())
      const proposed = await memory.propose({ principal: principalOf(TENANT_A), scope: scopeOf(TENANT_A), content: { secret: 'tenant-a-only' } })
      await expect(memory.get({ accessContext: accessContextOf(TENANT_B), id: proposed.id })).resolves.toBeUndefined()
    })

    // Cross-tenant reach is not only a read leak: `forget` and `revise` are
    // writes, so a wrong scope filter here destroys or rewrites another
    // tenant's record rather than merely disclosing it.
    it(`${label}: forget() under tenant-b leaves the tenant-a record it names intact`, async () => {
      const memory = await mountMemory()
      memory.registerProvider(createProvider())
      const proposed = await memory.propose({ principal: principalOf(TENANT_A), scope: scopeOf(TENANT_A), content: { secret: 'tenant-a-only' } })
      await memory.forget({ principal: principalOf(TENANT_B), scope: scopeOf(TENANT_B), id: proposed.id })
      await expect(memory.get({ accessContext: accessContextOf(TENANT_A), id: proposed.id })).resolves.toMatchObject({ content: { secret: 'tenant-a-only' } })
    })

    it(`${label}: revise() under tenant-b rejects a tenant-a id and leaves its content unchanged`, async () => {
      const memory = await mountMemory()
      memory.registerProvider(createProvider())
      const proposed = await memory.propose({ principal: principalOf(TENANT_A), scope: scopeOf(TENANT_A), content: { secret: 'tenant-a-only' } })
      await expect(memory.revise({
        principal: principalOf(TENANT_B),
        scope: scopeOf(TENANT_B),
        id: proposed.id,
        content: { secret: 'overwritten-by-tenant-b' },
      })).rejects.toMatchObject({ name: 'MemoryError', code: 'MEMORY_RECORD_NOT_FOUND' })
      await expect(memory.get({ accessContext: accessContextOf(TENANT_A), id: proposed.id })).resolves.toMatchObject({ content: { secret: 'tenant-a-only' } })
    })

    // A tenant must still see its own records: a filter that returns nothing
    // would pass every case above while destroying the seam's purpose. This
    // case passes at RED by design — `control:`, not `CHARACTERIZATION:`,
    // because it guards the fix against over-reach rather than pinning
    // existing fault handling.
    it(`control: ${label}: a same-tenant read still sees the record, so the scope filter bounds rather than blocks`, async () => {
      const memory = await mountMemory()
      memory.registerProvider(createProvider())
      const proposed = await memory.propose({ principal: principalOf(TENANT_A), scope: scopeOf(TENANT_A), content: { secret: 'tenant-a-only' } })
      await expect(memory.get({ accessContext: accessContextOf(TENANT_A), id: proposed.id })).resolves.toMatchObject({ id: proposed.id })
      await expect(memory.export({ accessContext: accessContextOf(TENANT_A) })).resolves.toMatchObject({ records: [expect.objectContaining({ id: proposed.id })] })
    })

    // A scope naming a sessionId narrows within the tenant, matching the rule
    // `createDurableFileMemoryProvider` already documents and implements.
    it(`${label}: a read scoped to one sessionId does not see a sibling session's record in the same tenant`, async () => {
      const memory = await mountMemory()
      memory.registerProvider(createProvider())
      await memory.propose({ principal: principalOf(TENANT_A), scope: { tenantId: TENANT_A, sessionId: 'session-1' }, content: { note: 'session-1' } })
      const scopedRead: MemoryAccessContext = { ...accessContextOf(TENANT_A), scope: { tenantId: TENANT_A, sessionId: 'session-2' } }
      await expect(memory.export({ accessContext: scopedRead })).resolves.toMatchObject({ records: [] })
    })
  })
}

/**
 * `must[3]`'s context-budget half. `capRecords` compares
 * `records.length <= maxRecords` and then `slice(0, maxRecords)`; a negative
 * budget makes the comparison false and the slice count-from-the-end, so the
 * seam drops only the last record while setting `truncated: true`. A
 * magnitude-dependent partial result that reports itself as a successful
 * truncation is worse than a uniform failure, because the flag asserts the
 * bound was applied.
 */
describe('must[3]: a context budget that is not a sane positive count bounds the read to nothing', () => {
  /** Propose `count` records under tenant-a and read them all back under `contextBudget`. */
  async function readUnderBudget(contextBudget: MemoryAccessContext['contextBudget'], count: number): Promise<{ length: number; truncated: boolean }> {
    const memory = await mountMemory()
    memory.registerProvider(createLocalReferenceMemoryProvider())
    for (let index = 0; index < count; index += 1) {
      await memory.propose({ principal: principalOf(TENANT_A), scope: scopeOf(TENANT_A), content: { index } })
    }
    const result = await memory.export({ accessContext: accessContextOf(TENANT_A, contextBudget) })
    return { length: result.records.length, truncated: result.truncated }
  }

  it('a maxRecords of -1 returns zero records rather than all but the last one', async () => {
    await expect(readUnderBudget({ maxRecords: -1 }, 3)).resolves.toStrictEqual({ length: 0, truncated: true })
  })

  it('every negative maxRecords returns the same zero records, so the result does not depend on the budget\'s magnitude', async () => {
    const results = await Promise.all([-1, -2, -5, -100].map(maxRecords => readUnderBudget({ maxRecords }, 3)))
    expect(results).toStrictEqual(Array.from({ length: 4 }, () => ({ length: 0, truncated: true })))
  })

  it('CHARACTERIZATION: a maxRecords of 0 already returns zero records and flags truncated', async () => {
    await expect(readUnderBudget({ maxRecords: 0 }, 3)).resolves.toStrictEqual({ length: 0, truncated: true })
  })

  /**
   * `MemoryContextBudget.maxTokens` is declared in `../../../packages/memory/memory/src/types.ts`
   * and read by no code in this repository: `capRecords` consults only
   * `maxRecords`. This case pins that it is inert rather than asserting a
   * bound the seam does not implement — enforcing it needs a token-estimation
   * policy, which is behaviour extension beyond what this stage's fault cases
   * prove, and belongs to a later stage. It is the sixth declared field in
   * this program with no producer or consumer, which is a finding about how
   * these vocabularies are written rather than about this field.
   */
  it('CHARACTERIZATION: maxTokens is declared but inert — a tiny token budget bounds nothing', async () => {
    const memory = await mountMemory()
    memory.registerProvider(createLocalReferenceMemoryProvider())
    for (let index = 0; index < 3; index += 1) {
      await memory.propose({ principal: principalOf(TENANT_A), scope: scopeOf(TENANT_A), content: { index, filler: 'x'.repeat(5000) } })
    }
    await expect(memory.export({ accessContext: accessContextOf(TENANT_A, { maxTokens: 1 }) })).resolves.toMatchObject({ records: expect.any(Array) as unknown, truncated: false })
    const result = await memory.export({ accessContext: accessContextOf(TENANT_A, { maxTokens: 1 }) })
    expect(result.records).toHaveLength(3)
  })
})

/**
 * The durable store is read precisely when a process restarts, which is when
 * it is most likely to be damaged. `createDurableFileMemoryProvider`'s reader
 * raises a `MemoryError` naming the file for an unrecognized version but lets
 * `JSON.parse` throw a bare `SyntaxError` for a damaged document — the same
 * failure class reported two different ways from adjacent lines.
 */
describe('a damaged durable store fails as a MemoryError naming the file, not as a bare parser error', () => {
  /** Write `body` as the backing document of a fresh directory and try to read it back. */
  async function exportFrom(body: string): Promise<unknown> {
    const directory = await ownedDirectory()
    await writeFile(join(directory, 'memory.json'), body, 'utf8')
    const provider = createDurableFileMemoryProvider({ directory })
    return provider.export({ accessContext: accessContextOf(TENANT_A) })
  }

  it('a corrupt backing document rejects with a MemoryError carrying a machine-routable code', async () => {
    await expect(exportFrom('{not json')).rejects.toMatchObject({ name: 'MemoryError', code: 'MEMORY_CORRUPT_STORE' })
  })

  it('a document truncated mid-record rejects with the same MemoryError code, not a parser error', async () => {
    await expect(exportFrom('{"version":1,"records":[{"id":"a"')).rejects.toMatchObject({ name: 'MemoryError', code: 'MEMORY_CORRUPT_STORE' })
  })

  it('CHARACTERIZATION: a document declaring an unknown format version already rejects with MEMORY_UNSUPPORTED_FORMAT_VERSION', async () => {
    await expect(exportFrom('{"version":99,"records":[]}')).rejects.toMatchObject({ name: 'MemoryError', code: 'MEMORY_UNSUPPORTED_FORMAT_VERSION' })
  })

  it('CHARACTERIZATION: a well-formed document that is not an object rejects rather than reading as zero records', async () => {
    await expect(exportFrom('[]')).rejects.toMatchObject({ name: 'MemoryError', code: 'MEMORY_UNSUPPORTED_FORMAT_VERSION' })
  })

  it('CHARACTERIZATION: an empty backing document reads as zero records, since a never-written store is a first boot rather than damage', async () => {
    await expect(exportFrom('')).resolves.toMatchObject({ records: [], truncated: false })
  })
})

/** Provider-registry and provider-failure faults the seam has never been shown. */
describe('provider faults reach the caller as they are raised, without a catch-all', () => {
  it('CHARACTERIZATION: registering a second provider under an already-registered id rejects with MEMORY_DUPLICATE_PROVIDER', async () => {
    const memory = await mountMemory()
    memory.registerProvider(createFakeMemoryProvider())
    expect(() => memory.registerProvider(createFakeMemoryProvider())).toThrow(expect.objectContaining({ name: 'MemoryError', code: 'MEMORY_DUPLICATE_PROVIDER' }) as Error)
  })

  it('CHARACTERIZATION: a first registration still succeeds after a duplicate is rejected, so the registry is not left poisoned', async () => {
    const memory = await mountMemory()
    memory.registerProvider(createLocalReferenceMemoryProvider())
    expect(() => memory.registerProvider(createLocalReferenceMemoryProvider())).toThrow()
    await expect(memory.propose({ principal: principalOf(TENANT_A), scope: scopeOf(TENANT_A), content: { note: 'still routed' } })).resolves.toMatchObject({ id: expect.any(String) as unknown })
  })

  /**
   * The seam wraps no provider call, so a backend failure surfaces as the
   * provider raised it. Pinned rather than changed: `MemoryError` chains a
   * `cause`, and re-wrapping every provider rejection would be a catch-all of
   * the kind this epic's `gate` forbids.
   */
  it('CHARACTERIZATION: a provider that rejects mid-query surfaces its own rejection, not a seam-invented one', async () => {
    const memory = await mountMemory()
    const provider = createFakeMemoryProvider()
    const failure = new Error('backend exploded')
    memory.registerProvider({ ...provider, query: () => Promise.reject(failure) })
    await expect(memory.query({ accessContext: accessContextOf(TENANT_A), query: 'anything' })).rejects.toBe(failure)
  })

  /**
   * The residual this stage does not close. Scope is enforced inside each
   * provider, so a provider that ignores it returns whatever it likes and the
   * seam passes it through. The seam cannot post-filter: `MemoryRecordView` is
   * exactly `{id, principal, content, updatedAt}` and carries no tenant, so
   * there is nothing for `MemoryRuntime` to compare the read's scope against.
   * Closing it requires a scope field on `MemoryRecordView` in
   * `../../../packages/memory/memory/src/types.ts`, which is a Contract
   * surface: that is a C supersession, or P6-02's canonical `MemoryRecord`,
   * and not this stage's to take. Pinned so the next reader meets the reason
   * rather than rediscovering the gap.
   */
  it('CHARACTERIZATION: a hostile provider still returns out-of-scope records, because the seam has no tenant on the record to check', async () => {
    const memory = await mountMemory()
    const foreign = {
      id: MemoryRecordId('foreign-tenant-record'),
      principal: principalOf(TENANT_A),
      content: { secret: 'tenant-a-only' },
      updatedAt: new Date().toISOString(),
    }
    memory.registerProvider({
      ...createFakeMemoryProvider(),
      export: () => Promise.resolve({ records: [foreign], truncated: false }),
    })
    await expect(memory.export({ accessContext: accessContextOf(TENANT_B) })).resolves.toMatchObject({ records: [foreign] })
  })
})

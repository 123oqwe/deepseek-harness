/**
 * Epic P6-02 Usage stage: the record rules reached through the shipped write
 * path, rather than proven against values a case built for itself.
 *
 * §12.19-1 withdrew this epic's sign-off because `validateRecord` and its
 * siblings have no production caller. `preflight-P6-02-U.md` measures what
 * that leaves: P6-02's VOCABULARY is consumed — `MemoryClaimOrigin` is derived
 * from `MemoryProvenance` and every durable record stores it — while none of
 * its DECISIONS is. These cases are the first of those decisions to get a
 * caller.
 *
 * Every case goes through `ctx.memory.propose()`. A case that called
 * `validateRecord` itself would prove the function again and prove nothing
 * about the path, which is exactly the gap the withdrawal names.
 * @module
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRuntime, {
  createDurableFileMemoryProvider,
  createLocalReferenceMemoryProvider,
  type MemoryAccessContext,
  type MemoryProvider,
  type SourceEventId,
} from '@deepseek-ai/dsh-memory'
import { createUserPrincipal, PrincipalId, TenantId, type Principal } from '@deepseek-ai/dsh-principal'
import { brandString } from '@deepseek-ai/dsh-brand'

const principal: Principal = createUserPrincipal(PrincipalId('user-1'), TenantId('tenant-a'))
const scope = { tenantId: TenantId('tenant-a') }
const accessContext: MemoryAccessContext = {
  principal,
  purpose: 'recall',
  scope,
  contextBudget: { maxRecords: 10 },
}

/** Mount the seam over one provider. Both providers run every case: the rule is the seam's, not a backend's. */
async function mount(provider: MemoryProvider): Promise<MemoryRuntime> {
  const ctx = new Context()
  await ctx.plugin(MemoryRuntime)
  ctx.memory.registerProvider(provider)
  return ctx.memory
}

const providers: readonly (readonly [string, () => MemoryProvider])[] = [
  ['local-reference', () => createLocalReferenceMemoryProvider()],
  ['durable-file', () => createDurableFileMemoryProvider({ directory: mkdtempSync(join(tmpdir(), 'p6-02-u-')) })],
]

for (const [label, createProvider] of providers) {
  describe(`P6-02 acceptance[0] through the seam: the ${label} provider never stores an untraceable claim`, () => {
    it(`${label}: refuses a derived claim that names no source event`, async () => {
      // The exact request the type admits and the path accepted: `sourceEvents`
      // is `readonly SourceEventId[]`, and an empty array satisfies it. Before
      // this rule was wired, the record was written and acceptance[0] — "every
      // memory traces to at least one source or is explicitly marked
      // user-asserted" — was false on a shipped write.
      const memory = await mount(createProvider())

      await expect(memory.propose({
        origin: { kind: 'derived', sourceEvents: [], confidence: 0.5 },
        principal,
        scope,
        content: { note: 'traces to nothing' },
      })).rejects.toMatchObject({ code: 'MEMORY_CLAIM_UNTRACEABLE' })
    })

    it(`${label}: stores nothing when it refuses, so the refusal is not merely a thrown error`, async () => {
      // A rejection that still wrote would leave acceptance[0] false and the
      // caller unaware. The store is read back through the same seam.
      const memory = await mount(createProvider())

      await expect(memory.propose({
        origin: { kind: 'derived', sourceEvents: [], confidence: 0.5 },
        principal,
        scope,
        content: { note: 'traces to nothing' },
      })).rejects.toThrow()

      await expect(memory.export({ accessContext })).resolves.toMatchObject({ records: [] })
    })

    it(`${label}: refuses a user-asserted claim that names nobody`, async () => {
      // The stricter half, and the reason the seam calls `isTraceable` rather
      // than restating `validateRecord`'s derived-only branch: "the user said
      // so" with no asserter is the same blank origin wearing the other
      // variant's label, and it would otherwise be the way around the rule
      // above.
      const memory = await mount(createProvider())

      await expect(memory.propose({
        origin: { kind: 'user-asserted', assertedBy: '' },
        principal,
        scope,
        content: { note: 'nobody said so' },
      })).rejects.toMatchObject({ code: 'MEMORY_CLAIM_UNTRACEABLE' })
    })

    it(`${label}: accepts a derived claim that names one source, so the refusal is not blanket`, async () => {
      const memory = await mount(createProvider())

      const { id } = await memory.propose({
        origin: { kind: 'derived', sourceEvents: [brandString<SourceEventId>('evt-1')], confidence: 0.5 },
        principal,
        scope,
        content: { note: 'traces somewhere' },
      })

      await expect(memory.get({ accessContext, id })).resolves.toMatchObject({ content: { note: 'traces somewhere' } })
    })

    it(`${label}: accepts a user-asserted claim, which names a responsible party instead of a source`, async () => {
      // acceptance[0]'s second half, and the reason the refusal above is not
      // "every claim needs a source": a claim with no source must declare
      // itself user-asserted, which names who is answerable for it.
      const memory = await mount(createProvider())

      const { id } = await memory.propose({
        origin: { kind: 'user-asserted', assertedBy: 'operator' },
        principal,
        scope,
        content: { note: 'a person said so' },
      })

      await expect(memory.get({ accessContext, id })).resolves.toMatchObject({ content: { note: 'a person said so' } })
    })
  })
}

/**
 * P6-02 acceptance[1] and must[2] reached from the read path.
 *
 * Both decisions read fields that only reached disk with the v3 record, so
 * neither could have been wired before it: `isDefaultRetrievable` reads
 * `status` and `validUntil`, `admitToIndex` reads `sensitivity`.
 *
 * They are wired into `query()` and nowhere else, because `query()` IS the
 * default retrieval this build has — free text in, matching records out —
 * and it is also the only thing here that plays the part of an index. `get()`
 * by id and `export()` are explicit requests for a named record or for
 * everything a caller may see; withholding from those would not be
 * "keeping a record out of the index", it would be making it unreadable by
 * its owner, which is a different rule nobody wrote.
 */
for (const [label, createProvider] of providers) {
  describe(`P6-02 acceptance[1] through the seam: the ${label} provider's default retrieval`, () => {
    it(`${label}: withholds a record whose validity has passed`, async () => {
      const memory = await mount(createProvider())
      await memory.propose({
        origin: { kind: 'user-asserted', assertedBy: 'operator' },
        principal,
        scope,
        content: { note: 'stale-token' },
        validUntil: '2000-01-01T00:00:00.000Z',
      })

      await expect(memory.query({ accessContext, query: 'stale-token' }))
        .resolves.toMatchObject({ records: [] })
    })

    it(`${label}: returns an unexpired record, so the refusal above is not blanket`, async () => {
      const memory = await mount(createProvider())
      await memory.propose({
        origin: { kind: 'user-asserted', assertedBy: 'operator' },
        principal,
        scope,
        content: { note: 'fresh-token' },
        validUntil: '2099-01-01T00:00:00.000Z',
      })

      const found = await memory.query({ accessContext, query: 'fresh-token' })
      expect(found.records).toHaveLength(1)
    })
  })
}

/**
 * P6-02 must[2] has a subject and no consumption point in this build.
 *
 * `admitToIndex` decides correctly — the Contract stage pins that, including
 * its refusal of an unstated sensitivity — and nothing asks it. This build
 * constructs no embedding and no index; `query()` scans records the caller is
 * already entitled to read, which is not the derived artifact the clause
 * names, and `get()`/`export()` hand the same record over regardless.
 *
 * The case below records that absence as an observation rather than a
 * comment, so it is the thing that goes red the day someone wires the
 * decision into the search. That is not a regression to fix by deleting this
 * case: it is the ruling (BLOCKED-198) asking to be re-read, because applying
 * the rule there withholds every record whose writer stated no sensitivity —
 * and no shipped writer states one, `dsh-memory-context` included.
 */
for (const [label, createProvider] of providers) {
  describe(`P6-02 must[2] through the seam: the ${label} provider has no index to admit to`, () => {
    it(`${label}: the default search still returns content whose sensitivity nobody stated`, async () => {
      const memory = await mount(createProvider())
      await memory.propose({
        origin: { kind: 'user-asserted', assertedBy: 'operator' },
        principal,
        scope,
        content: { note: 'unassessed-token' },
      })

      const found = await memory.query({ accessContext, query: 'unassessed-token' })
      expect(found.records).toHaveLength(1)
    })
  })
}

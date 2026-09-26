/**
 * Driver for P6-03's third slice on the shipped composition: acceptance[1]
 * (「forget 后主存、索引、cache、projection 在 SLA 内清除并留下合规 tombstone。」),
 * acceptance[2] (「导出包含来源和冲突状态。」) and must[3]'s merge and supersede
 * (「支持 merge、supersede、forget、export、right-to-erasure，并传播到索引。」).
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * the base layer's `memory` row enabled over `./.memory` (`./base.patch.yml`)
 * and its `memory-context` row enabled (`./recall.patch.yml`), pins the Trust
 * Kernel as the shipped launcher does, and then, in order:
 * 1. proposes one complete `normal` record per role, each content carrying a
 *    marker only it holds, in the workspace the session works in;
 * 2. builds a second reader of the same store, a durable-file provider over
 *    `./.memory`, which reads `forgotten` before it is forgotten;
 * 3. runs one turn whose task is the recall key only `recalled` holds, so
 *    `memory-context` puts `recalled` into that turn's model request;
 * 4. forgets `forgotten` and `recalled`, and runs every store, index and
 *    second-reader check as soon as `forget` resolves;
 * 5. runs one more turn in the same session and reads its model requests;
 * 6. supersedes `older` with `newer`, merges `merged` into `survivor`, and
 *    merges `cross-from` (session a) into `cross-into` (session b), first
 *    without an authorization and then with one naming both scopes;
 * 7. exports, and asks the default search for every record by its marker.
 *
 * The third slice's verbs and fields are `ctx.memory.supersede`,
 * `ctx.memory.merge`, the export records' `provenance`, `status` and
 * `relations`, and the export result's `tombstones`. The seam this driver
 * compiles against has none of them, so they are reached through
 * {@link ThirdSlice}; a step that throws is reported, not fatal. It prints one
 * `P6-03-LIFECYCLE <json>` line.
 * @module tests/first100/fixtures/loader/p6-03-proposal/lifecycle-driver
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { createDurableFileMemoryProvider } from '@deepseek-ai/dsh-memory'
import type {
  MemoryAccessContext,
  MemoryClaimOrigin,
  MemoryProposeRequest,
  MemoryRecordId,
  MemoryScope,
  SourceEventId,
} from '@deepseek-ai/dsh-memory'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createUserPrincipal, type Principal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { observeWorkspaceIdentity } from '@deepseek-ai/dsh-workspace'
import { MockAdapter, textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** One record as the third slice's export returns it. */
interface ExportedRecord {
  readonly id: MemoryRecordId
  readonly provenance?: unknown
  readonly status?: string
  readonly relations?: readonly { readonly kind: string; readonly target: MemoryRecordId }[]
}

/** One tombstone as the third slice's export returns it. */
interface ExportedTombstone {
  readonly id?: unknown
  readonly forgottenAt?: unknown
  readonly forgottenBy?: unknown
}

/** What the third slice's export returns. */
interface ExportedMemory {
  readonly records: readonly ExportedRecord[]
  readonly tombstones?: readonly ExportedTombstone[]
}

/** The two scopes a cross-scope merge moves between, and who authorized it (P6-02 acceptance[2]). */
interface MergeAuthorization {
  readonly from: MemoryScope
  readonly into: MemoryScope
  readonly authorizedBy: string
}

/** One record a merge names, with the scope it belongs to. */
interface MergeEnd {
  readonly scope: MemoryScope
  readonly id: MemoryRecordId
}

/** The verbs P6-03's third slice adds to `ctx.memory`, and its export, as this driver calls them. */
interface ThirdSlice {
  /** Record that `id` supersedes `supersedes`; both records persist (P6-02 must[1]). */
  supersede(request: {
    readonly principal: Principal
    readonly scope: MemoryScope
    readonly id: MemoryRecordId
    readonly supersedes: MemoryRecordId
  }): Promise<void>
  /** Merge `from` into `into`; across scopes only with an authorization naming both. */
  merge(request: {
    readonly principal: Principal
    readonly from: MergeEnd
    readonly into: MergeEnd
    readonly authorization?: MergeAuthorization
  }): Promise<void>
  /** Every record and tombstone the access context may see. */
  export(request: { readonly accessContext: MemoryAccessContext }): Promise<ExportedMemory>
}

const [configPath, recallPath] = process.argv.slice(2)
if (configPath === undefined || recallPath === undefined) {
  throw new Error('p6-03 lifecycle driver requires the base and recall overlay paths')
}
// The host user acts in `$DSH_TENANT`, else `local`; `./recall.patch.yml` reads in `local`.
process.env.DSH_TENANT = ''

const PROVIDER = 'p6-03-lifecycle-mock'
/** The task of the turn that recalls `recalled`: only that record's content holds it. */
const RECALL_KEY = 'p6-03-lifecycle-recall-key'
const cwd = process.cwd()
const storeDirectory = join(cwd, '.memory')
const observed = await observeWorkspaceIdentity(cwd)
const tenantId = TenantId('local')
const principal = createUserPrincipal(PrincipalId('p6-03-writer'), tenantId)
// The workspace scope `memory-context` reads under for a session working in `cwd`.
const workspace = {
  canonicalPath: observed.canonicalPath,
  identity: `${String(observed.volume.device)}:${String(observed.volume.inode)}:${String(observed.volume.createdAtMs)}`,
}
const scope: MemoryScope = { tenantId, workspace }
const sessionA: MemoryScope = { tenantId, workspace, sessionId: 'p6-03-session-a' }
const sessionB: MemoryScope = { tenantId, workspace, sessionId: 'p6-03-session-b' }
const accessContext: MemoryAccessContext = { principal, purpose: 'p6-03 third slice red first', scope, contextBudget: { maxRecords: 50 } }
const asserted: MemoryClaimOrigin = { kind: 'user-asserted', assertedBy: 'p6-03-writer' }
const derived: MemoryClaimOrigin = { kind: 'derived', sourceEvents: [brandString<SourceEventId>('p6-03-source-event')], confidence: 0.8 }
const stated = {
  purpose: 'answer questions about this project',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  sensitivity: 'normal',
} as const

/**
 * The marker only one record's content carries.
 * @param name - the record's name.
 * @returns the marker.
 */
function marker(name: string): string {
  return `p6-03-lifecycle-${name}-marker`
}

/**
 * The code an error carries, or its text.
 * @param error - what a step threw.
 * @returns the code or the text.
 */
function failureOf(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : String(error)
}

/**
 * Whether any file under the memory store directory holds `text`.
 * @param text - the content to look for.
 * @returns true when some file holds it.
 */
function storeHolds(text: string): boolean {
  const pending = [storeDirectory]
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (readFileSync(path, 'utf8').includes(text)) return true
    }
  }
  return false
}

/** Every record by name, each content carrying its own marker, in the order the driver proposes them. */
const proposals = new Map<string, MemoryProposeRequest>([
  ['forgotten', { principal, scope, origin: asserted, ...stated, content: { note: marker('forgotten') } }],
  ['recalled', { principal, scope, origin: asserted, ...stated, content: { note: `${RECALL_KEY} ${marker('recalled')}` } }],
  ['asserted', { principal, scope, origin: asserted, ...stated, content: { note: marker('asserted') } }],
  ['derived', { principal, scope, origin: derived, ...stated, content: { note: marker('derived') } }],
  ['older', { principal, scope, origin: asserted, ...stated, content: { note: marker('older') } }],
  ['newer', { principal, scope, origin: asserted, ...stated, content: { note: marker('newer') } }],
  ['merged', { principal, scope, origin: asserted, ...stated, content: { note: marker('merged') } }],
  ['survivor', { principal, scope, origin: asserted, ...stated, content: { note: marker('survivor') } }],
  ['cross-from', { principal, scope: sessionA, origin: asserted, ...stated, content: { note: marker('cross-from') } }],
  ['cross-into', { principal, scope: sessionB, origin: asserted, ...stated, content: { note: marker('cross-into') } }],
])

const ctx = await bootProductionProfile({
  binName: 'p6-03-lifecycle',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined), resolveConfigPath(recallPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})
try {
  const third = ctx.memory as unknown as ThirdSlice
  const thrown: Record<string, string> = {}
  const ids = new Map<string, MemoryRecordId>()
  const step = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run()
    } catch (error: unknown) {
      thrown[name] = failureOf(error)
    }
  }
  const idOf = (name: string): MemoryRecordId => {
    const id = ids.get(name)
    if (id === undefined) throw new Error(`propose:${name} minted no id`)
    return id
  }
  const nameOf = (id: MemoryRecordId): string => [...ids].find(([, known]) => known === id)?.[0] ?? String(id)
  // Whether the default search for a record's marker returns that record, by id: a merge
  // may leave another record carrying the marker, and that is not this record being active.
  const isActive = async (name: string): Promise<boolean> => {
    const id = ids.get(name)
    if (id === undefined) return false
    const { records } = await ctx.memory.query({ accessContext, query: marker(name) })
    return records.some(record => record.id === id)
  }

  for (const [name, request] of proposals) {
    await step(`propose:${name}`, async () => { ids.set(name, (await ctx.memory.propose(request)).id) })
  }

  const reader = createDurableFileMemoryProvider({ directory: storeDirectory })
  const readerSees = async (name: string): Promise<{ get: boolean; search: boolean; export: boolean } | null> => {
    const id = ids.get(name)
    if (id === undefined) return null
    return {
      get: (await reader.get({ accessContext, id })) !== undefined,
      search: (await reader.query({ accessContext, query: marker(name) })).records.some(record => record.id === id),
      export: (await reader.export({ accessContext })).records.some(record => record.id === id),
    }
  }
  const readerBefore = await readerSees('forgotten')

  const adapter = new MockAdapter(Array.from({ length: 16 }, () => textResponse('ok')))
  ctx.llm.registerAdapter([PROVIDER], adapter)
  // Every question is rejected, including the shipped headless profile's workspace-trust question.
  ctx.on('approval/request', () => Promise.resolve('rejected' as const))
  // Created after boot, as a shipped launcher creates its root agent.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd,
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  await step('turn-before-forget', () => runFixtureTurn(ctx, { task: RECALL_KEY }))
  const requestsBeforeForget = adapter.requests.length

  for (const name of ['forgotten', 'recalled']) {
    await step(`forget:${name}`, () => ctx.memory.forget({ principal, scope, id: idOf(name) }))
  }

  // acceptance[1]: every check below runs as soon as forget resolves.
  const forgottenId = ids.get('forgotten')
  let tombstone: { readonly forgottenAt: string | null; readonly forgottenBy: string; readonly carriesContent: boolean } | null = null
  let exportFound = false
  try {
    const exported = await third.export({ accessContext })
    exportFound = exported.records.some(record => record.id === forgottenId)
    const found = exported.tombstones?.find(entry => entry.id === forgottenId)
    if (found !== undefined) {
      tombstone = {
        forgottenAt: typeof found.forgottenAt === 'string' ? found.forgottenAt : null,
        forgottenBy: JSON.stringify(found.forgottenBy ?? null),
        carriesContent: JSON.stringify(found).includes(marker('forgotten')),
      }
    }
  } catch (error: unknown) {
    thrown['export-after-forget'] = failureOf(error)
  }
  const forget = {
    tombstone,
    storeReadable: existsSync(storeDirectory) && storeHolds(marker('asserted')),
    storeHoldsForgotten: existsSync(storeDirectory) && storeHolds(marker('forgotten')),
    getFound: forgottenId !== undefined && (await ctx.memory.get({ accessContext, id: forgottenId })) !== undefined,
    searchFound: await isActive('forgotten'),
    exportFound,
    readerBefore,
    readerAfter: await readerSees('forgotten'),
  }

  await step('turn-after-forget', () => runFixtureTurn(ctx, { task: 'p6-03-lifecycle-after-forget' }))
  // Model requests of the session's own steps; a request made for another purpose (a title) is not one.
  const carriesRecalled = (requests: typeof adapter.requests): boolean =>
    requests.filter(request => request.purpose === undefined).some(request => JSON.stringify(request.messages).includes(marker('recalled')))
  const projection = {
    before: carriesRecalled(adapter.requests.slice(0, requestsBeforeForget)),
    after: carriesRecalled(adapter.requests.slice(requestsBeforeForget)),
    requestsAfter: adapter.requests.slice(requestsBeforeForget).filter(request => request.purpose === undefined).length,
  }

  await step('supersede', () => third.supersede({ principal, scope, id: idOf('newer'), supersedes: idOf('older') }))
  await step('merge', () => third.merge({ principal, from: { scope, id: idOf('merged') }, into: { scope, id: idOf('survivor') } }))
  let unauthorizedCode: string | null = null
  try {
    await third.merge({ principal, from: { scope: sessionA, id: idOf('cross-from') }, into: { scope: sessionB, id: idOf('cross-into') } })
    unauthorizedCode = 'merged'
  } catch (error: unknown) {
    unauthorizedCode = failureOf(error)
  }
  const unauthorizedMerge = {
    code: unauthorizedCode,
    fromActive: await isActive('cross-from'),
    intoActive: await isActive('cross-into'),
  }
  await step('merge-authorized', () => third.merge({
    principal,
    from: { scope: sessionA, id: idOf('cross-from') },
    into: { scope: sessionB, id: idOf('cross-into') },
    authorization: { from: sessionA, into: sessionB, authorizedBy: 'p6-03-writer' },
  }))

  const exported: Record<string, { provenance: unknown; status: string | null; relations: { kind: string; target: string }[] | null } | null> = {}
  try {
    const { records } = await third.export({ accessContext })
    for (const name of proposals.keys()) {
      const record = records.find(entry => entry.id === ids.get(name))
      exported[name] = record === undefined ? null : {
        provenance: record.provenance ?? null,
        status: record.status ?? null,
        relations: record.relations?.map(relation => ({ kind: relation.kind, target: nameOf(relation.target) })) ?? null,
      }
    }
  } catch (error: unknown) {
    thrown['export-final'] = failureOf(error)
  }
  const active: Record<string, boolean> = {}
  for (const name of proposals.keys()) active[name] = await isActive(name)

  process.stdout.write(`P6-03-LIFECYCLE ${JSON.stringify({ thrown, forget, projection, unauthorizedMerge, exported, active })}\n`)
} finally {
  await ctx.fiber.dispose()
}

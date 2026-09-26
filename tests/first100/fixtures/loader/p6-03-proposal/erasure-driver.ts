/**
 * Driver for P6-03's right-to-erasure on the shipped composition: must[3]
 * (「支持 merge、supersede、forget、export、right-to-erasure，并传播到索引。」).
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * the base layer's `memory` row enabled over `./.memory` (`./base.patch.yml`)
 * and proposes one complete `normal` record per role, each content carrying a
 * marker only it holds:
 * - `erased-a` and `erased-b`: about the subject to erase, in sessions a and b
 *   of the first workspace of tenant `local`;
 * - `erased-second`: about the same subject, in a second workspace of `local`;
 * - `kept-subject`: about another subject, in session a of the first workspace;
 * - `kept-tenant`: about the subject to erase, in tenant `other`, which the
 *   requester, a user of `local`, may not process.
 *
 * A user of `local` then asks to erase everything about the subject in its
 * tenant. The driver reads, for every record, the default search and export of
 * its own tenant and workspace, and scans the store directory. It prints one
 * `P6-03-ERASURE <json>` line.
 *
 * The erasure verb is `ctx.memory.erase({ principal, tenantId, subject })`, and
 * the export result's `tombstones` is the third slice's. The seam this driver
 * compiles against has neither, so they are reached through {@link Erasure}; a
 * step that throws is reported, not fatal.
 * @module tests/first100/fixtures/loader/p6-03-proposal/erasure-driver
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MemoryAccessContext, MemoryProposeRequest, MemoryRecordId, MemoryScope, MemorySubject } from '@deepseek-ai/dsh-memory'
import { createUserPrincipal, type Principal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** One tombstone as the third slice's export returns it. */
interface ExportedTombstone {
  readonly id?: unknown
  readonly forgottenAt?: unknown
  readonly forgottenBy?: unknown
}

/** The erasure verb P6-03 adds to `ctx.memory`, and the third slice's export, as this driver calls them. */
interface Erasure {
  /** Forget every record about `subject` in `tenantId`, in every session and workspace of it. */
  erase(request: { readonly principal: Principal; readonly tenantId: TenantId; readonly subject: MemorySubject }): Promise<unknown>
  /** Every record and tombstone the access context may see. */
  export(request: { readonly accessContext: MemoryAccessContext }): Promise<{
    readonly records: readonly { readonly id: MemoryRecordId }[]
    readonly tombstones?: readonly ExportedTombstone[]
  }>
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p6-03 erasure driver requires the overlay path')

const storeDirectory = join(process.cwd(), '.memory')
const local = TenantId('local')
const other = TenantId('other')
const requester = createUserPrincipal(PrincipalId('p6-03-erasure-requester'), local)
const writer = createUserPrincipal(PrincipalId('p6-03-writer'), local)
const otherWriter = createUserPrincipal(PrincipalId('p6-03-other-writer'), other)
const firstWorkspace = { canonicalPath: '/projects/p6-03-erasure', identity: 'p6-03-erasure-volume:1:1' }
const secondWorkspace = { canonicalPath: '/projects/p6-03-erasure-second', identity: 'p6-03-erasure-volume:2:2' }
const erasedSubject = brandString<MemorySubject>('p6-03-subject-erased')
const keptSubject = brandString<MemorySubject>('p6-03-subject-kept')
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
  return `p6-03-erasure-${name}-marker`
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
  if (!existsSync(storeDirectory)) return false
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

/**
 * One complete proposal about `subject`, carrying the marker of `name`.
 * @param name - the record's name.
 * @param principal - its writer.
 * @param scope - where it is written.
 * @param subject - who the claim is about.
 * @returns the proposal.
 */
function proposal(name: string, principal: Principal, scope: MemoryScope, subject: MemorySubject): MemoryProposeRequest {
  return {
    principal,
    scope,
    subject,
    origin: { kind: 'user-asserted', assertedBy: principal.id },
    ...stated,
    content: { note: marker(name) },
  }
}

/** Every record by name, in the order the driver proposes them. */
const proposals = new Map<string, MemoryProposeRequest>([
  ['erased-a', proposal('erased-a', writer, { tenantId: local, workspace: firstWorkspace, sessionId: 'p6-03-session-a' }, erasedSubject)],
  ['erased-b', proposal('erased-b', writer, { tenantId: local, workspace: firstWorkspace, sessionId: 'p6-03-session-b' }, erasedSubject)],
  ['erased-second', proposal('erased-second', writer, { tenantId: local, workspace: secondWorkspace }, erasedSubject)],
  ['kept-subject', proposal('kept-subject', writer, { tenantId: local, workspace: firstWorkspace, sessionId: 'p6-03-session-a' }, keptSubject)],
  ['kept-tenant', proposal('kept-tenant', otherWriter, { tenantId: other, workspace: firstWorkspace }, erasedSubject)],
])

const ctx = await bootProductionProfile({
  binName: 'p6-03-erasure',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const erasure = ctx.memory as unknown as Erasure
  const thrown: Record<string, string> = {}
  const ids = new Map<string, MemoryRecordId>()
  for (const [name, request] of proposals) {
    try {
      ids.set(name, (await ctx.memory.propose(request)).id)
    } catch (error: unknown) {
      thrown[`propose:${name}`] = failureOf(error)
    }
  }

  try {
    await erasure.erase({ principal: requester, tenantId: local, subject: erasedSubject })
  } catch (error: unknown) {
    thrown.erase = failureOf(error)
  }

  const records: Record<string, {
    readonly active: boolean
    readonly exported: boolean
    readonly tombstone: { readonly carriesContent: boolean } | null
    readonly inStore: boolean
  } | null> = {}
  for (const [name, request] of proposals) {
    const id = ids.get(name)
    if (id === undefined) {
      records[name] = null
      continue
    }
    // Each record is read in its own tenant and workspace, by that tenant's user, across every session.
    const reader = request.scope.tenantId === local ? requester : otherWriter
    const scope: MemoryScope = {
      tenantId: request.scope.tenantId,
      ...request.scope.workspace === undefined ? {} : { workspace: request.scope.workspace },
    }
    const accessContext: MemoryAccessContext = { principal: reader, purpose: 'p6-03 erasure red first', scope, contextBudget: { maxRecords: 50 } }
    const { records: found } = await ctx.memory.query({ accessContext, query: marker(name) })
    let exported = false
    let tombstone: { readonly carriesContent: boolean } | null = null
    try {
      const result = await erasure.export({ accessContext })
      exported = result.records.some(record => record.id === id)
      const entry = result.tombstones?.find(candidate => candidate.id === id)
      if (entry !== undefined) tombstone = { carriesContent: JSON.stringify(entry).includes(marker(name)) }
    } catch (error: unknown) {
      thrown[`export:${name}`] = failureOf(error)
    }
    records[name] = {
      active: found.some(record => record.id === id),
      exported,
      tombstone,
      inStore: storeHolds(marker(name)),
    }
  }

  process.stdout.write(`P6-03-ERASURE ${JSON.stringify({ thrown, records })}\n`)
} finally {
  await ctx.fiber.dispose()
}

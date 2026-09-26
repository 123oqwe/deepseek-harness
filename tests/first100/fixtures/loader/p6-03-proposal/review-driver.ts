/**
 * Driver for P6-03's second slice on the shipped composition: must[0]
 * (「Agent 只能提交 MemoryProposal，包含证据、预期用途、TTL、敏感等级。」) and the
 * review lifecycle of a proposal the policy holds (list, approve, reject).
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * the base layer's `memory` row enabled, and proposes through the composed
 * `ctx.memory.propose`:
 * - for must[0], three `normal` proposals that are complete but for one field:
 *   `no-purpose` states no intended use, `no-ttl` states no TTL, and
 *   `open-ended` states "no expiry" explicitly as `validUntil: null` (the
 *   control);
 * - for the lifecycle, one complete `normal` proposal (`accepted`) and two
 *   complete `sensitive` ones (`approved`, `rejected`).
 *
 * It then lists the proposals pending review, approves `approved`, rejects
 * `rejected`, lists again, and asks the default search for every proposal's
 * marker. It prints one `P6-03-REVIEW <json>` line.
 *
 * The review verbs are `ctx.memory.listPending`, `ctx.memory.approve` and
 * `ctx.memory.reject`. The seam this driver compiles against today has none
 * of them, so they are reached through {@link MemoryReview}; a step that
 * throws is reported, not fatal.
 * @module tests/first100/fixtures/loader/p6-03-proposal/review-driver
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { MemoryAccessContext, MemoryProposeRequest, MemoryRecordId, MemoryScope } from '@deepseek-ai/dsh-memory'
import { createUserPrincipal, type Principal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** Names one held proposal, as `forget` names a record. */
interface MemoryReviewRequest {
  readonly principal: Principal
  readonly scope: MemoryScope
  readonly id: MemoryRecordId
}

/** The review verbs P6-03's second slice adds to `ctx.memory`, as this driver calls them. */
interface MemoryReview {
  /** The proposals held for review that `accessContext` may see. */
  listPending(request: { readonly accessContext: MemoryAccessContext }): Promise<{ readonly records: readonly { readonly id: MemoryRecordId }[] }>
  /** Admit a held proposal to active memory. */
  approve(request: MemoryReviewRequest): Promise<void>
  /** Refuse a held proposal, which then never becomes active. */
  reject(request: MemoryReviewRequest): Promise<void>
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p6-03 review driver requires the overlay path')

const tenantId = TenantId('local')
const principal = createUserPrincipal(PrincipalId('p6-03-writer'), tenantId)
const scope: MemoryScope = { tenantId, workspace: { canonicalPath: '/projects/p6-03-review', identity: 'p6-03-review-volume:1:1' } }
const accessContext: MemoryAccessContext = { principal, purpose: 'p6-03 red first', scope, contextBudget: { maxRecords: 20 } }
const origin = { kind: 'user-asserted', assertedBy: 'p6-03-writer' } as const
const purpose = 'answer questions about this project'
const validUntil = new Date(Date.now() + 86_400_000).toISOString()

/**
 * The marker only one proposal's content carries.
 * @param name - the proposal's name.
 * @returns the marker.
 */
function marker(name: string): string {
  return `p6-03-review-${name}-marker`
}

/**
 * The code an error carries, or its text.
 * @param error - what a step threw.
 * @returns the code or the text.
 */
function failureOf(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : String(error)
}

/** Every proposal by name, in the order the driver submits them. */
const proposals = new Map<string, MemoryProposeRequest>([
  ['no-purpose', { principal, scope, origin, validUntil, sensitivity: 'normal', content: { note: marker('no-purpose') } }],
  ['no-ttl', { principal, scope, origin, purpose, sensitivity: 'normal', content: { note: marker('no-ttl') } }],
  // The request type this driver compiles against admits a timestamp or no value; `null` is the explicit "no expiry".
  ['open-ended', { principal, scope, origin, purpose, validUntil: null, sensitivity: 'normal', content: { note: marker('open-ended') } } as unknown as MemoryProposeRequest],
  ['accepted', { principal, scope, origin, purpose, validUntil, sensitivity: 'normal', content: { note: marker('accepted') } }],
  ['approved', { principal, scope, origin, purpose, validUntil, sensitivity: 'sensitive', content: { note: marker('approved') } }],
  ['rejected', { principal, scope, origin, purpose, validUntil, sensitivity: 'sensitive', content: { note: marker('rejected') } }],
])

const ctx = await bootProductionProfile({
  binName: 'p6-03-review',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const review = ctx.memory as unknown as MemoryReview
  const thrown: Record<string, string> = {}
  const ids = new Map<string, MemoryRecordId>()
  for (const [name, request] of proposals) {
    try {
      ids.set(name, (await ctx.memory.propose(request)).id)
    } catch (error: unknown) {
      thrown[`propose:${name}`] = failureOf(error)
    }
  }

  const listed = async (step: 'list-before' | 'list-after'): Promise<string[] | null> => {
    try {
      const { records } = await review.listPending({ accessContext })
      return [...ids].filter(([, id]) => records.some(record => record.id === id)).map(([name]) => name)
    } catch (error: unknown) {
      thrown[step] = failureOf(error)
      return null
    }
  }
  const decide = async (step: 'approve' | 'reject', name: string): Promise<void> => {
    const id = ids.get(name)
    if (id === undefined) {
      thrown[step] = `propose:${name} minted no id`
      return
    }
    try {
      await review[step]({ principal, scope, id })
    } catch (error: unknown) {
      thrown[step] = failureOf(error)
    }
  }

  const pendingBefore = await listed('list-before')
  await decide('approve', 'approved')
  await decide('reject', 'rejected')
  const pendingAfter = await listed('list-after')
  const active: Record<string, boolean> = {}
  for (const name of proposals.keys()) {
    const found = await ctx.memory.query({ accessContext, query: marker(name) })
    active[name] = found.records.length > 0
  }
  process.stdout.write(`P6-03-REVIEW ${JSON.stringify({ thrown, active, pendingBefore, pendingAfter })}\n`)
} finally {
  await ctx.fiber.dispose()
}

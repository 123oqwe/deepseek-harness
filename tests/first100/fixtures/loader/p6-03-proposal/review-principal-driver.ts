/**
 * Driver for P6-03's second slice on the shipped composition: only a person
 * decides a proposal held for review (must[2] 「高敏感默认人工。」). An agent
 * or service principal that approves or rejects is refused, and the proposal
 * stays pending.
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * the base layer's `memory` row enabled, and has a user principal propose four
 * complete `sensitive` proposals, which the policy holds for review. Then:
 * 1. an agent principal the user delegated to approves `agent-approve` and
 *    rejects `agent-reject`, and a service principal approves
 *    `service-approve` and rejects `service-reject`;
 * 2. the user lists the proposals pending review, and the default search is
 *    asked for every proposal's marker;
 * 3. the user approves `agent-approve` (the control), and the default search
 *    is asked for it again.
 * It prints one `P6-03-REVIEW-PRINCIPAL <json>` line.
 *
 * The review verbs are `ctx.memory.listPending`, `ctx.memory.approve` and
 * `ctx.memory.reject`, as `./review-driver.ts` calls them. The seam this
 * driver compiles against today has none of them, so they are reached through
 * {@link MemoryReview}; a step that throws is reported, not fatal.
 * @module tests/first100/fixtures/loader/p6-03-proposal/review-principal-driver
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { MemoryAccessContext, MemoryProposeRequest, MemoryRecordId, MemoryScope } from '@deepseek-ai/dsh-memory'
import { createAgentPrincipal, createServicePrincipal, createUserPrincipal, type Principal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
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

/** What one step threw: the error's `code` when it carries one, and its text. */
interface Failure {
  readonly code: string | null
  readonly text: string
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p6-03 review-principal driver requires the overlay path')

const tenantId = TenantId('local')
const user = createUserPrincipal(PrincipalId('p6-03-writer'), tenantId)
const agentPrincipal = createAgentPrincipal(PrincipalId('p6-03-agent'), tenantId, user.id)
const service = createServicePrincipal(PrincipalId('p6-03-service'), tenantId)
const scope: MemoryScope = { tenantId, workspace: { canonicalPath: '/projects/p6-03-review-principal', identity: 'p6-03-review-principal-volume:1:1' } }
const accessContext: MemoryAccessContext = { principal: user, purpose: 'p6-03 red first', scope, contextBudget: { maxRecords: 20 } }

/**
 * The marker only one proposal's content carries.
 * @param name - the proposal's name.
 * @returns the marker.
 */
function marker(name: string): string {
  return `p6-03-review-principal-${name}-marker`
}

/**
 * What a step threw.
 * @param error - the thrown value.
 * @returns its code, when it carries one, and its text.
 */
function failureOf(error: unknown): Failure {
  const code = error instanceof Error && 'code' in error ? String(error.code) : null
  return { code, text: String(error) }
}

/** The four held proposals, each decided by one non-person principal. */
const attempts = [
  { name: 'agent-approve', verb: 'approve', principal: agentPrincipal },
  { name: 'agent-reject', verb: 'reject', principal: agentPrincipal },
  { name: 'service-approve', verb: 'approve', principal: service },
  { name: 'service-reject', verb: 'reject', principal: service },
] as const

const ctx = await bootProductionProfile({
  binName: 'p6-03-review-principal',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const review = ctx.memory as unknown as MemoryReview
  const failures: Record<string, Failure> = {}
  const ids = new Map<string, MemoryRecordId>()
  for (const { name } of attempts) {
    const request: MemoryProposeRequest = {
      principal: user,
      scope,
      origin: { kind: 'user-asserted', assertedBy: 'p6-03-writer' },
      purpose: 'answer questions about this project',
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      sensitivity: 'sensitive',
      content: { note: marker(name) },
    }
    try {
      ids.set(name, (await ctx.memory.propose(request)).id)
    } catch (error: unknown) {
      failures[`propose:${name}`] = failureOf(error)
    }
  }

  const decide = async (step: string, verb: 'approve' | 'reject', principal: Principal, name: string): Promise<void> => {
    const id = ids.get(name)
    if (id === undefined) {
      failures[step] = { code: null, text: `propose:${name} minted no id` }
      return
    }
    try {
      await review[verb]({ principal, scope, id })
    } catch (error: unknown) {
      failures[step] = failureOf(error)
    }
  }
  const isActive = async (name: string): Promise<boolean> =>
    (await ctx.memory.query({ accessContext, query: marker(name) })).records.length > 0

  for (const { name, verb, principal } of attempts) await decide(name, verb, principal, name)
  let pending: string[] | null = null
  try {
    const { records } = await review.listPending({ accessContext })
    pending = [...ids].filter(([, id]) => records.some(record => record.id === id)).map(([name]) => name)
  } catch (error: unknown) {
    failures.list = failureOf(error)
  }
  const active: Record<string, boolean> = {}
  for (const { name } of attempts) active[name] = await isActive(name)
  await decide('user-approve', 'approve', user, 'agent-approve')
  const activeAfterUserApproval = await isActive('agent-approve')
  process.stdout.write(`P6-03-REVIEW-PRINCIPAL ${JSON.stringify({ failures, pending, active, activeAfterUserApproval })}\n`)
} finally {
  await ctx.fiber.dispose()
}

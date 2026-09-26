/**
 * The pure grant decisions for Epic P2-08's first slice: validating a draft
 * is scoped and finitely expiring (must[0], acceptance[0]), and matching an
 * action against grants by their predicates and limits alone, never by any
 * model-authored text the action carries (must[1]). Where two grants cover
 * the same action the stricter one decides, so an action outside any covering
 * grant's limits is allowed by none (acceptance[1]).
 *
 * Every function here is pure: no store, no clock, no ambient policy. The
 * store in `./store.ts` is the only stateful holder, and it decides through
 * {@link matchGrants}.
 *
 * @module @deepseek-ai/dsh-grant-store/match
 */

import type { Grant, GrantDecision, GrantRefusalCode, GrantValidation, GrantedAction } from './types.ts'

/** A draft missing an actor, capability or resource predicate, or covering every resource, is refused with this code. */
export const GRANT_UNSCOPED = 'GRANT_UNSCOPED' as const

/** A draft with no finite expiry is refused with this code, so no grant is permanent. */
export const GRANT_NO_EXPIRY = 'GRANT_NO_EXPIRY' as const

/** An error carrying the refusal code that stopped an issue, so an enforcement point can route it. */
export class GrantError extends Error {
  /** The validation code that refused the draft. */
  readonly code: GrantRefusalCode

  /**
   * @param code - the refusal code.
   */
  constructor(code: GrantRefusalCode) {
    super(`grant refused: ${code}`)
    this.name = 'GrantError'
    this.code = code
  }
}

/**
 * Whether a value is a plain object that can carry draft fields.
 * @param value - the value.
 * @returns whether it is a non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a value is a non-empty string, as every scope predicate must be.
 * @param value - the value.
 * @returns whether it is a string with length.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Whether a draft names an actor, a capability and a bounded resource: a
 * tenant and principal, an action, and a non-empty resource prefix. An empty
 * prefix covers every resource, so it is not scoped.
 * @param draft - the draft's fields.
 * @returns whether the draft is scoped.
 */
function isScoped(draft: Record<string, unknown>): boolean {
  const { actor, capability, resource } = draft
  return isRecord(actor) && isNonEmptyString(actor.tenantId) && isNonEmptyString(actor.principalId)
    && isRecord(capability) && isNonEmptyString(capability.action)
    && isRecord(resource) && isNonEmptyString(resource.prefix)
}

/**
 * Whether a draft has a finite numeric expiry. Absent, non-numeric and
 * infinite (or `NaN`) values all read as no expiry.
 * @param draft - the draft's fields.
 * @returns whether the expiry is finite.
 */
function hasFiniteExpiry(draft: Record<string, unknown>): boolean {
  return typeof draft.expiresAtMs === 'number' && Number.isFinite(draft.expiresAtMs)
}

/**
 * Validate a grant draft. Scope is checked before expiry, so an unscoped
 * draft that would also be permanent is reported as unscoped.
 * @param draft - the candidate draft, from any caller.
 * @returns valid, or refused with the code that names the first failure.
 */
export function validateGrantDraft(draft: unknown): GrantValidation {
  if (!isRecord(draft) || !isScoped(draft)) return { ok: false, code: GRANT_UNSCOPED }
  if (!hasFiniteExpiry(draft)) return { ok: false, code: GRANT_NO_EXPIRY }
  return { ok: true }
}

/**
 * Whether a grant covers an action: it is not revoked and its actor,
 * capability, resource-prefix and environment predicates all match. Coverage
 * is scope, not limits — an amount, window or expiry decides within
 * {@link withinLimits}.
 * @param grant - the grant.
 * @param action - the action.
 * @returns whether the grant is about this action.
 */
function covers(grant: Grant, action: GrantedAction): boolean {
  return grant.revokedAtMs === undefined
    && grant.actor.tenantId === action.tenantId
    && grant.actor.principalId === action.principalId
    && grant.capability.action === action.action
    && action.resource.startsWith(grant.resource.prefix)
    && grant.environment === action.environment
}

/**
 * Whether an action is inside a covering grant's limits: before its expiry,
 * not before its window, not over its amount, and not past its use count.
 * @param grant - the covering grant.
 * @param action - the action.
 * @returns whether the action is within the grant's limits.
 */
function withinLimits(grant: Grant, action: GrantedAction): boolean {
  if (action.atMs >= grant.expiresAtMs) return false
  const { limits } = grant
  if (limits === undefined) return true
  if (limits.notBeforeMs !== undefined && action.atMs < limits.notBeforeMs) return false
  if (limits.maxAmount !== undefined && action.amount !== undefined && action.amount > limits.maxAmount) return false
  if (limits.maxUses !== undefined && grant.uses >= limits.maxUses) return false
  return true
}

/**
 * Decide an action against grants by their predicates and limits alone. An
 * action covered by no grant, or outside any one covering grant's limits, is
 * allowed by none, so it goes back to approval or refusal. The action's
 * `justification` is never read.
 * @param grants - the grants to match against.
 * @param action - the action.
 * @returns the grant that allows it, or `no-grant`.
 */
export function matchGrants(grants: readonly Grant[], action: GrantedAction): GrantDecision {
  const covering = grants.filter(grant => covers(grant, action))
  const decider = covering[0]
  if (decider === undefined) return { kind: 'no-grant' }
  if (!covering.every(grant => withinLimits(grant, action))) return { kind: 'no-grant' }
  return { kind: 'allow', grantId: decider.id }
}

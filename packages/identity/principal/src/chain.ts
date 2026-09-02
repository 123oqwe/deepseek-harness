/**
 * Pure principal construction and delegation-chain construction/validation
 * logic. Every export here is a pure function: no wall-clock reads, no
 * mutable module state, no I/O — callers supply `delegatedAt` explicitly
 * (see {@link DelegationEntry.delegatedAt}), which keeps chain construction
 * deterministic and independently testable. Real attachment to live
 * session/agent-loop/SDK state is a later first100 stage's job (see
 * `./types.ts`'s top-of-file note).
 *
 * @module @deepseek-ai/dsh-principal/chain
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import {
  type AgentPrincipal,
  type AnonymousDevPrincipal,
  type DelegationChain,
  type DelegationEntry,
  ForgedPrincipalError,
  type Principal,
  type PrincipalId,
  type ServicePrincipal,
  TenantMismatchError,
  type TenantId,
  type UserPrincipal,
} from './types.ts'

/**
 * Construct an ordinary, non-admin user principal.
 * @param id - the principal's identity (already branded — never raw prompt/chat text).
 * @param tenantId - the tenant this principal belongs to.
 * @returns a {@link UserPrincipal} with `isAdmin: false`.
 */
export function createUserPrincipal(id: PrincipalId, tenantId: TenantId): UserPrincipal {
  return { kind: 'user', id, tenantId, isAdmin: false }
}

/**
 * Construct an admin user principal. Kept as a separate, distinctly-named
 * export (never an `isAdmin` parameter on {@link createUserPrincipal}) so a
 * static scan can forbid this specific import from tool-provider code
 * (registry P2-01 validation[2]).
 * @param id - the principal's identity (already branded — never raw prompt/chat text).
 * @param tenantId - the tenant this principal belongs to.
 * @returns a {@link UserPrincipal} with `isAdmin: true`.
 */
export function createAdminUserPrincipal(id: PrincipalId, tenantId: TenantId): UserPrincipal {
  return { kind: 'user', id, tenantId, isAdmin: true }
}

/**
 * Construct an ordinary, non-admin service principal.
 * @param id - the principal's identity (already branded — never raw prompt/chat text).
 * @param tenantId - the tenant this principal belongs to.
 * @returns a {@link ServicePrincipal} with `isAdmin: false`.
 */
export function createServicePrincipal(id: PrincipalId, tenantId: TenantId): ServicePrincipal {
  return { kind: 'service', id, tenantId, isAdmin: false }
}

/**
 * Construct an admin service principal. Kept as a separate, distinctly-named
 * export (never an `isAdmin` parameter on {@link createServicePrincipal}) so a
 * static scan can forbid this specific import from tool-provider code
 * (registry P2-01 validation[2]).
 * @param id - the principal's identity (already branded — never raw prompt/chat text).
 * @param tenantId - the tenant this principal belongs to.
 * @returns a {@link ServicePrincipal} with `isAdmin: true`.
 */
export function createAdminServicePrincipal(id: PrincipalId, tenantId: TenantId): ServicePrincipal {
  return { kind: 'service', id, tenantId, isAdmin: true }
}

/**
 * Construct a delegated agent principal. Carries no admin flag: an agent's
 * authority is never self-declared (see `./types.ts`'s {@link AgentPrincipal} doc).
 * @param id - the principal's identity (already branded — never raw prompt/chat text).
 * @param tenantId - the tenant this principal belongs to.
 * @param delegatedBy - the principal id that authorized this agent's delegation.
 * @returns an {@link AgentPrincipal}.
 */
export function createAgentPrincipal(id: PrincipalId, tenantId: TenantId, delegatedBy: PrincipalId): AgentPrincipal {
  return { kind: 'agent', id, tenantId, delegatedBy }
}

/**
 * Construct an anonymous development-mode principal. Structurally distinct
 * from every admin-capable kind (registry P2-01 acceptance[2]).
 * @param id - the principal's identity (already branded — never raw prompt/chat text).
 * @param tenantId - the tenant this principal belongs to.
 * @returns an {@link AnonymousDevPrincipal}.
 */
export function createAnonymousDevPrincipal(id: PrincipalId, tenantId: TenantId): AnonymousDevPrincipal {
  return { kind: 'anonymous-dev', id, tenantId }
}

/**
 * Start a new delegation chain rooted at `root`.
 * @param root - the root principal.
 * @param delegatedAt - Unix epoch milliseconds this chain was created.
 * @returns a chain with exactly one entry: `root`.
 */
export function createChain(root: Principal, delegatedAt: number): DelegationChain {
  const entry: DelegationEntry = { principal: root, delegatedAt }
  return { entries: [entry] }
}

/**
 * Extend a delegation chain by one hop, delegating to `next`. Rejects a hop
 * whose tenant differs from the chain's tenant (registry P2-01 acceptance[1],
 * type-validation layer) — a delegation chain never crosses a tenant
 * boundary.
 * @param chain - the chain to extend.
 * @param next - the principal being delegated to.
 * @param delegatedAt - Unix epoch milliseconds this hop was added.
 * @param reason - optional human-readable reason this hop was delegated.
 * @returns a new chain with `next` appended; `chain` is not mutated.
 * @throws {@link TenantMismatchError} when `next.tenantId` differs from the chain's tenant.
 */
export function extendChain(
  chain: DelegationChain,
  next: Principal,
  delegatedAt: number,
  reason?: string,
): DelegationChain {
  const chainTenantId = currentTenantId(chain)
  if (next.tenantId !== chainTenantId) {
    throw new TenantMismatchError(next.tenantId, chainTenantId)
  }
  const entry: DelegationEntry = reason === undefined
    ? { principal: next, delegatedAt }
    : { principal: next, delegatedAt, reason }
  return { entries: [...chain.entries, entry] }
}

/**
 * The chain's root principal.
 * @param chain - the delegation chain.
 * @returns `chain.entries[0].principal`.
 */
export function rootPrincipal(chain: DelegationChain): Principal {
  return chain.entries[0].principal
}

/**
 * The chain's currently-acting principal.
 * @param chain - the delegation chain.
 * @returns the principal of the chain's last entry.
 */
export function currentPrincipal(chain: DelegationChain): Principal {
  return lastEntry(chain).principal
}

/**
 * The chain's last entry. A private helper: `chain.entries` is typed as a
 * non-empty tuple, but a computed index into it still widens to
 * `DelegationEntry | undefined` under `noUncheckedIndexedAccess`; folding
 * with no initial value keeps the non-empty guarantee in the return type.
 * @param chain - the delegation chain.
 * @returns the last element of `chain.entries`.
 */
function lastEntry(chain: DelegationChain): DelegationEntry {
  return chain.entries.reduce((_, entry) => entry)
}

/**
 * The chain's root tenant — every hop in a valid chain shares this tenant.
 * @param chain - the delegation chain.
 * @returns `rootPrincipal(chain).tenantId`.
 */
export function rootTenantId(chain: DelegationChain): TenantId {
  return rootPrincipal(chain).tenantId
}

/**
 * The tenant the chain's currently-acting principal belongs to.
 * @param chain - the delegation chain.
 * @returns `currentPrincipal(chain).tenantId`.
 */
export function currentTenantId(chain: DelegationChain): TenantId {
  return currentPrincipal(chain).tenantId
}

/**
 * How many delegation hops separate the current principal from the root.
 * @param chain - the delegation chain.
 * @returns `0` when the current principal is the root, incrementing per hop.
 */
export function delegationDepth(chain: DelegationChain): number {
  return chain.entries.length - 1
}

/**
 * Whether a principal id appears anywhere in the chain.
 * @param chain - the delegation chain.
 * @param id - the principal id to look for.
 * @returns `true` when some entry's principal has this id.
 */
export function isInChain(chain: DelegationChain, id: PrincipalId): boolean {
  return chain.entries.some(entry => entry.principal.id === id)
}

/**
 * Assert that a claimed principal id appears in the chain that should have
 * produced it — the foundation a later stage's forged-agent-id check builds
 * on (registry P2-01 validation[0]).
 * @param chain - the delegation chain the id is claimed to belong to.
 * @param id - the claimed principal id.
 * @throws {@link ForgedPrincipalError} when `id` does not appear in `chain`.
 * @returns Nothing.
 */
export function assertInChain(chain: DelegationChain, id: PrincipalId): void {
  if (!isInChain(chain, id)) throw new ForgedPrincipalError(id)
}

/**
 * Validate one agent's delegation against the chain that should account for
 * it: the agent must be the chain's current principal, its tenant must match
 * the chain's tenant, and its claimed delegator must appear earlier in the
 * chain.
 * @param chain - the delegation chain the agent claims to be part of.
 * @param agent - the agent principal to validate.
 * @throws {@link ForgedPrincipalError} when `agent` is not the chain's current
 *   principal, or `agent.delegatedBy` does not appear in `chain`.
 * @throws {@link TenantMismatchError} when `agent.tenantId` differs from the chain's tenant.
 * @returns Nothing.
 */
export function assertAgentDelegationValid(chain: DelegationChain, agent: AgentPrincipal): void {
  const current = currentPrincipal(chain)
  if (current.id !== agent.id || current.kind !== 'agent') throw new ForgedPrincipalError(agent.id)
  const chainTenantId = currentTenantId(chain)
  if (agent.tenantId !== chainTenantId) throw new TenantMismatchError(agent.tenantId, chainTenantId)
  assertInChain(chain, agent.delegatedBy)
}

/**
 * Whether two principals belong to the same tenant.
 * @param a - the first principal.
 * @param b - the second principal.
 * @returns `true` when both share a `tenantId`.
 */
export function sameTenant(a: Principal, b: Principal): boolean {
  return a.tenantId === b.tenantId
}

/**
 * Assert that two tenant ids match.
 * @param attempted - the tenant id being checked.
 * @param actual - the tenant id it must match.
 * @throws {@link TenantMismatchError} when they differ.
 * @returns Nothing.
 */
export function assertSameTenantId(attempted: TenantId, actual: TenantId): void {
  if (attempted !== actual) throw new TenantMismatchError(attempted, actual)
}

/**
 * Whether a principal is anonymous-dev — always restricted, never admin
 * (registry P2-01 acceptance[2]).
 * @param principal - the principal to check.
 * @returns `true` when `principal.kind === 'anonymous-dev'`.
 */
export function isAnonymousDev(principal: Principal): boolean {
  return principal.kind === 'anonymous-dev'
}

/**
 * Whether a principal holds the explicit admin capability. Never derived by
 * negation (e.g. "not anonymous-dev") — only `user`/`service` principals can
 * carry `isAdmin`, and it must be literally `true` (registry P2-01 gate:
 * "Admin is explicit capability").
 * @param principal - the principal to check.
 * @returns `true` only for a `user`/`service` principal with `isAdmin: true`.
 */
export function isAdminPrincipal(principal: Principal): boolean {
  switch (principal.kind) {
    case 'user':
    case 'service':
      return principal.isAdmin
    case 'agent':
    case 'anonymous-dev':
      return false
    default:
      return assertNever(principal, 'isAdminPrincipal')
  }
}

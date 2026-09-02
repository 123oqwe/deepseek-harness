/**
 * Identity type contract for Principal / Tenant / Run / delegation context.
 *
 * A {@link Principal} is the one responsible actor behind any durable event,
 * tool execution, subagent delegation, or SDK request; a {@link TenantId}
 * bounds which tenant it may act within; a {@link RunId} identifies the
 * execution it acts inside; and a {@link DelegationChain} records the
 * unbroken hop-by-hop path from the root principal down to whichever
 * principal is currently acting, so any action can be traced back to its
 * root user/tenant (first100 registry P2-01 acceptance[0]).
 *
 * This module is the type contract only: it defines the vocabulary and the
 * errors {@link ../chain.ts} throws when validating a chain. It performs no
 * real attachment to session events, tool contexts, subagent requests, or SDK
 * requests — that wiring is a later first100 stage's job, tracked by
 * `packages/core/agent/src/runtime-types.ts`, `packages/core/session/src/types.ts`,
 * `packages/core/agent-loop/src/runtime-context.ts`, and
 * `packages/identity/principal/src/index.ts`.
 *
 * ## Never infer identity from prompt text (must[2])
 *
 * Every constructor below (`createUserPrincipal`, `createAdminUserPrincipal`,
 * `createServicePrincipal`, `createAdminServicePrincipal`,
 * `createAgentPrincipal`, `createAnonymousDevPrincipal` in `./chain.ts`)
 * accepts only already-branded {@link PrincipalId} and {@link TenantId}
 * values, never a raw `string`, `ContentBlock[]`, or other free-text shape a
 * user message or model output could carry. That pushes "is this string a
 * legitimate identity" to the single, greppable call site that mints the
 * brand ({@link PrincipalId} / {@link TenantId} below), not to the principal
 * constructors themselves.
 *
 * This is necessarily incomplete: TypeScript's structural typing cannot
 * distinguish, at the type level, a `string` that reached {@link PrincipalId}
 * from a verified auth token from one that reached it by copying text out of
 * a chat message, and nothing here stops a caller from writing a `Principal`
 * object literal directly (bypassing every constructor) or casting through
 * `as`. Closing that gap needs a runtime-boundary check — verifying that a
 * `PrincipalId`/`TenantId` brand was only ever minted from an authoritative
 * identity source (session auth, a verified token, an operator-issued
 * deployment principal) — which is out of a pure type contract's reach and is
 * a later stage's job, alongside the static scan implied by validation[2]
 * ("禁止 tool provider 自己创建管理员 principal") that this module's separate
 * `createAdminUserPrincipal`/`createAdminServicePrincipal` names exist to make
 * greppable.
 *
 * @module @deepseek-ai/dsh-principal/types
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** A tenant identifier. Two principals with different {@link TenantId} values never share authority. */
export type TenantId = Branded<'TenantId'>

/**
 * Brand a string as a {@link TenantId}.
 * @param id - the raw tenant id string, from an authoritative tenant source (never prompt/chat text).
 * @returns the same string with the tenant-id brand.
 */
export function TenantId(id: string): TenantId {
  return brandString<TenantId>(id)
}

/** An execution-run identifier: the invocation a principal is currently acting inside. */
export type RunId = Branded<'RunId'>

/**
 * Brand a string as a {@link RunId}.
 * @param id - the raw run id string.
 * @returns the same string with the run-id brand.
 */
export function RunId(id: string): RunId {
  return brandString<RunId>(id)
}

/** A principal identifier, shared across every {@link PrincipalKind}. */
export type PrincipalId = Branded<'PrincipalId'>

/**
 * Brand a string as a {@link PrincipalId}.
 * @param id - the raw principal id string, from an authoritative identity source (never prompt/chat text).
 * @returns the same string with the principal-id brand.
 */
export function PrincipalId(id: string): PrincipalId {
  return brandString<PrincipalId>(id)
}

/** Discriminant of {@link Principal}: which of the four identity kinds an actor is. */
export type PrincipalKind = 'user' | 'service' | 'agent' | 'anonymous-dev'

declare const ADMIN_GRANT: unique symbol

/**
 * Unforgeable proof that a principal was constructed through
 * {@link ../chain.ts}'s `createAdminUserPrincipal`/`createAdminServicePrincipal`.
 *
 * `ADMIN_GRANT` is a module-private, compile-time-only `unique symbol`
 * (mirrors {@link Branded}), so no plain object literal can satisfy this
 * type without an explicit `as` cast — closing the gap a plain
 * `isAdmin: boolean` field left open (a literal `isAdmin: true` needed no
 * cast at all). That alone is still compile-time-only and, like every brand
 * in this module, defeatable by a cast (see this module's top-of-file
 * note); the real enforcement is `./chain.ts`'s private `adminGrants`
 * `WeakSet`, which `isAdminPrincipal` checks by object identity — a check no
 * `as` cast and no JSON-deserialized object can pass, because membership
 * requires a reference `createAdminUserPrincipal`/`createAdminServicePrincipal`
 * itself minted and registered.
 */
export type AdminGrant = { readonly [ADMIN_GRANT]: true }

/** A real human user. Admin is an explicit, separately-constructed capability — see {@link ../chain.ts}'s `createAdminUserPrincipal`. */
export interface UserPrincipal {
  readonly kind: 'user'
  /** This principal's identity, unique within its tenant. */
  readonly id: PrincipalId
  /** The tenant this principal belongs to and may act within. */
  readonly tenantId: TenantId
  /**
   * Unforgeable proof of explicit administrative capability; absent for a
   * non-admin principal. Only {@link ../chain.ts}'s `createAdminUserPrincipal`
   * produces a value `isAdminPrincipal` accepts — see {@link AdminGrant}.
   */
  readonly adminGrant?: AdminGrant
}

/**
 * A non-human system account. Admin is an explicit, separately-constructed
 * capability — see {@link ../chain.ts}'s `createAdminServicePrincipal`.
 */
export interface ServicePrincipal {
  readonly kind: 'service'
  /** This principal's identity, unique within its tenant. */
  readonly id: PrincipalId
  /** The tenant this principal belongs to and may act within. */
  readonly tenantId: TenantId
  /**
   * Unforgeable proof of explicit administrative capability; absent for a
   * non-admin principal. Only {@link ../chain.ts}'s `createAdminServicePrincipal`
   * produces a value `isAdminPrincipal` accepts — see {@link AdminGrant}.
   */
  readonly adminGrant?: AdminGrant
}

/**
 * A delegated sub-agent. Carries no `isAdmin` field: an agent's authority is
 * never self-declared, only inherited through the {@link DelegationChain} it
 * appears in — see `assertAgentDelegationValid` in `./chain.ts`.
 */
export interface AgentPrincipal {
  readonly kind: 'agent'
  /** This principal's identity, unique within its tenant. */
  readonly id: PrincipalId
  /** The tenant this principal belongs to and may act within. */
  readonly tenantId: TenantId
  /**
   * The principal id that authorized this agent's delegation.
   * `assertAgentDelegationValid` (`./chain.ts`) only requires this id to
   * appear somewhere earlier in the delegation chain — not necessarily as
   * the immediate parent hop, and not necessarily the chain root.
   */
  readonly delegatedBy: PrincipalId
}

/**
 * An anonymous development-mode principal: restricted, and structurally
 * distinct from {@link UserPrincipal}/{@link ServicePrincipal} — it carries no
 * `isAdmin` field at all, so it can never be equivalent to an admin principal
 * (first100 registry P2-01 acceptance[2]).
 */
export interface AnonymousDevPrincipal {
  readonly kind: 'anonymous-dev'
  /** This principal's identity, unique within its tenant. */
  readonly id: PrincipalId
  /** The tenant this principal belongs to and may act within. */
  readonly tenantId: TenantId
}

/**
 * The closed union of every identity kind. Switch on `kind` and end with
 * `assertNever` (`@deepseek-ai/dsh-util-values`) — a fifth variant must fail
 * every switch that doesn't handle it.
 */
export type Principal = UserPrincipal | ServicePrincipal | AgentPrincipal | AnonymousDevPrincipal

/** One hop in a {@link DelegationChain}: which principal, and when it was added. */
export interface DelegationEntry {
  /** The principal that this hop delegates to (the chain's root, for the first entry). */
  readonly principal: Principal
  /** Unix epoch milliseconds when this hop was added, supplied by the caller (kept out of `./chain.ts` so its construction stays pure). */
  readonly delegatedAt: number
  /** Optional human-readable reason this hop was delegated. */
  readonly reason?: string
}

/**
 * The complete, ordered path from the root principal down to whichever
 * principal is currently acting. Typed as a non-empty tuple so "no root" is
 * unrepresentable: `entries[0]` is always the root, `entries.at(-1)` is
 * always current (first100 registry P2-01 acceptance[0]).
 */
export interface DelegationChain {
  readonly entries: readonly [DelegationEntry, ...DelegationEntry[]]
}

/**
 * The identity reference a durable record or live call carries: which
 * principal is acting, inside which run, with the full chain back to root.
 * This is the type surface `must[1]` asks every `SessionEvent` envelope,
 * `ToolExecutionContext`, `SubagentRequest`, and SDK request to carry;
 * attaching a real value to any of those is a later stage's job (see this
 * module's top-of-file note).
 */
export interface IdentityContext {
  /** The principal currently acting — equal to `chain.entries.at(-1).principal`. */
  readonly principal: Principal
  /** The execution run this identity is acting inside. */
  readonly runId: RunId
  /** The full delegation chain back to root. */
  readonly chain: DelegationChain
}

/**
 * Thrown when a delegation hop's tenant does not match the chain's tenant
 * (first100 registry P2-01 acceptance[1], type-validation layer).
 */
export class TenantMismatchError extends Error {
  /** The tenant the rejected hop attempted to act as. */
  readonly attemptedTenantId: TenantId
  /** The chain's actual tenant. */
  readonly actualTenantId: TenantId
  /**
   * @param attemptedTenantId - the tenant the rejected hop attempted to act as.
   * @param actualTenantId - the chain's actual tenant.
   */
  constructor(attemptedTenantId: TenantId, actualTenantId: TenantId) {
    super(`tenant mismatch: attempted '${attemptedTenantId}', chain tenant is '${actualTenantId}'`)
    this.name = 'TenantMismatchError'
    this.attemptedTenantId = attemptedTenantId
    this.actualTenantId = actualTenantId
  }
}

/**
 * Thrown when a claimed principal id does not appear in the delegation chain
 * that should have produced it (foundation for the registry's
 * forged-agent-id validation).
 */
export class ForgedPrincipalError extends Error {
  /** The principal id that was claimed but not found in the chain. */
  readonly claimedPrincipalId: PrincipalId
  /**
   * @param claimedPrincipalId - the principal id that was claimed but not found in the chain.
   */
  constructor(claimedPrincipalId: PrincipalId) {
    super(`forged principal: '${claimedPrincipalId}' does not appear in the delegation chain`)
    this.name = 'ForgedPrincipalError'
    this.claimedPrincipalId = claimedPrincipalId
  }
}

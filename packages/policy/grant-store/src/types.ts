/**
 * The grant vocabulary for Epic P2-08's first slice: what a scoped, expiring
 * grant is, the action a policy enforcement point asks about, the closed
 * decision matching returns, and the in-process store and worker view the
 * library exports. Types only; the runtime decisions live in
 * `./match.ts` and the store in `./store.ts`.
 *
 * @module @deepseek-ai/dsh-grant-store/types
 */

/** One grant draft: who, what, where, in which environment, within which limits, until when. */
export interface GrantDraft {
  /** The principal the grant is for. */
  readonly actor: { readonly tenantId: string; readonly principalId: string }
  /** The capability the grant covers. */
  readonly capability: { readonly action: string }
  /** The resources the grant covers: those whose name starts with `prefix`. An empty prefix covers every resource and is refused. */
  readonly resource: { readonly prefix: string }
  /** The environment the grant covers. */
  readonly environment: string
  /** The limits an action is measured against; an absent field is that limit unset. */
  readonly limits?: {
    /** Allowed actions counted against the grant before it allows nothing more. */
    readonly maxUses?: number
    /** The largest amount one action may carry. */
    readonly maxAmount?: number
    /** The window's start; the grant allows nothing before it. */
    readonly notBeforeMs?: number
  }
  /** The grant allows nothing at or after this instant; a non-finite value is refused, so no grant is permanent. */
  readonly expiresAtMs: number
}

/** A stored grant: a draft with the store's identity, issue time and use count, and a revocation time once revoked. */
export interface Grant extends GrantDraft {
  /** The store-minted identity a grant is listed and revoked by. */
  readonly id: string
  /** When the store issued the grant. */
  readonly issuedAtMs: number
  /** Allowed actions counted against this grant. */
  readonly uses: number
  /** Present once the grant is revoked. */
  readonly revokedAtMs?: number
}

/** One action a policy enforcement point asks a grant about. */
export interface GrantedAction {
  /** The acting principal's tenant. */
  readonly tenantId: string
  /** The acting principal. */
  readonly principalId: string
  /** The capability being exercised. */
  readonly action: string
  /** The resource being acted on. */
  readonly resource: string
  /** The environment the action runs in. */
  readonly environment: string
  /** The amount the action carries, measured against a grant's `maxAmount`. */
  readonly amount?: number
  /** When the action happens, measured against a grant's window and expiry. */
  readonly atMs: number
  /** Model-authored text carried with the action; matching never reads it. */
  readonly justification?: string
}

/** Allowed by one grant, or covered by none, which sends the action back to approval or refusal. */
export type GrantDecision = { readonly kind: 'allow'; readonly grantId: string } | { readonly kind: 'no-grant' }

/** Why a draft is refused: it is unscoped, or it has no finite expiry. */
export type GrantRefusalCode = 'GRANT_UNSCOPED' | 'GRANT_NO_EXPIRY'

/** The result of validating a draft: valid, or refused with a routable code. */
export type GrantValidation = { readonly ok: true } | { readonly ok: false; readonly code: GrantRefusalCode }

/** An in-process grant store: it issues, lists, revokes and authorizes over its own grants, advancing an epoch on every revocation. */
export interface GrantStore {
  /** Store a grant from a valid draft; throws an error carrying the draft's validation code otherwise. */
  issue(draft: GrantDraft, atMs: number): Grant
  /** Every grant, revoked ones included. */
  list(): readonly Grant[]
  /** Revoke a grant and advance the store's epoch; a missing id is a no-op. */
  revoke(id: string, atMs: number): void
  /** Decide an action and count one use on the grant that allows it. */
  authorize(action: GrantedAction): GrantDecision
  /** Advances on every revocation, so a worker view can tell when to re-read. */
  epoch(): number
}

/** The read side a worker view opens over: a store's current epoch and its grants. */
export interface GrantSource {
  /** The source's current epoch; the view re-reads its grants when this changes. */
  epoch(): number
  /** The source's current grants. */
  list(): readonly Grant[]
}

/** A worker's view of a store, as a second process holding a copy of its grants would have it. */
export interface GrantView {
  /** Decide an action after rechecking the source's epoch; `no-grant` when the source cannot be read. */
  authorize(action: GrantedAction): GrantDecision
}

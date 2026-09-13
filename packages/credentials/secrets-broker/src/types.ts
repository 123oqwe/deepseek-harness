/**
 * Secret-lease vocabulary for Epic P3-06's Contract stage.
 *
 * A {@link SecretLease} is what a {@link CredentialRef} resolves to: a
 * short-lived grant naming *who* may use a secret, *for which action*, *in
 * which world*, *for what purpose*, and *until when*. The five bindings are
 * must[0]'s literal list, and each names an existing subject rather than a new
 * one — `Principal` from `dsh-principal`, `ActionId` from `dsh-action-manifest`,
 * `WorldId` from `dsh-execution-world`. A second vocabulary for the same facts
 * would let two parts of the system disagree about which action a lease is for.
 *
 * **This module decides nothing about how a secret reaches a world.** must[1]'s
 * brokered injection needs an execution shape this repository has not chosen
 * (`WorldSecretsSpec.posture` is `'none' | 'broker-only' | 'inherited'`, and
 * `broker-only` is deliverable only by a separate address space — see
 * `execution-world/src/local-provider.ts`). The lease is the grant; the
 * transport is not modelled here.
 * @module @deepseek-ai/dsh-secrets-broker/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ActionId } from '@deepseek-ai/dsh-action-manifest'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { WorldId } from '@deepseek-ai/dsh-execution-world'
import type { Principal } from '@deepseek-ai/dsh-principal'

/** Opaque id of one issued lease, unique for the life of the broker. */
export type SecretLeaseId = Branded<'SecretLeaseId'>

/**
 * Why a lease was issued, in the requester's own terms.
 *
 * Free text rather than a closed list: the broker cannot enumerate every
 * legitimate reason a deployment has for reading a credential, and a closed
 * list would either grow without bound or push callers to misuse its nearest
 * member. It is recorded so an audit can ask *what was this for*, and is never
 * matched on when deciding whether a lease may be redeemed.
 */
export type SecretLeasePurpose = string

/**
 * The states one lease passes through.
 *
 * `issued` is the only usable state. The other three are terminal and differ
 * only in *why* the lease stopped being usable, which an audit needs and an
 * enforcement point does not: `redeemed` is must[2]'s automatic revocation
 * after use, `expired` is the clock overtaking `expiresAt`, and `revoked` is
 * an explicit withdrawal — including the cascade when the lease's world stops.
 */
export type SecretLeaseState = 'issued' | 'redeemed' | 'expired' | 'revoked'

/** A lease that is no longer usable, and the reason it is not. */
export type SecretLeaseTerminalState = Exclude<SecretLeaseState, 'issued'>

/**
 * One short-lived grant over one credential (must[0]).
 *
 * Every field is part of the binding. A lease that named the credential alone
 * would authorise any principal, any action and any world to read it, which is
 * the ambient authority the epic exists to remove.
 */
export interface SecretLease {
  /** This lease's own id, minted at issue. */
  readonly id: SecretLeaseId
  /** The stored credential this lease grants, by nominal address. */
  readonly credential: CredentialRef
  /** Who the lease was issued to, carrying its tenant and delegation chain. */
  readonly principal: Principal
  /** The single action this lease may be redeemed for. */
  readonly action: ActionId
  /** The world the redeeming action runs in; the lease dies with it. */
  readonly world: WorldId
  /** Why it was issued, recorded for audit and never matched on. */
  readonly purpose: SecretLeasePurpose
  /** Epoch milliseconds after which the lease is unusable, whatever its state. */
  readonly expiresAt: number
}

/**
 * A lease plus the state it is currently in.
 *
 * Separate from {@link SecretLease} because the grant's terms never change and
 * its state does: keeping them in one mutable object would make "the lease that
 * was issued" and "the lease as it stands" the same value, and an audit needs
 * to quote the first while an enforcement point reads the second.
 */
export interface SecretLeaseRecord {
  readonly lease: SecretLease
  readonly state: SecretLeaseState
}

/** Why a redemption was refused, as a closed list an enforcement point switches on. */
export type SecretLeaseRefusal =
  /** The clock is at or past `expiresAt`. Checked before state (acceptance[2]). */
  | 'expired'
  /** Already redeemed once; must[2] revokes on use. */
  | 'already-redeemed'
  /** Withdrawn explicitly, or by its world stopping. */
  | 'revoked'
  /** Presented for an action the lease does not name. */
  | 'action-mismatch'
  /** Presented by a principal the lease was not issued to. */
  | 'principal-mismatch'
  /** Presented in a world the lease does not name. */
  | 'world-mismatch'

/** The answer to "may this lease be redeemed now", as a discriminated union. */
export type SecretLeaseDecision =
  | { readonly ok: true; readonly credential: CredentialRef }
  | { readonly ok: false; readonly refusal: SecretLeaseRefusal }

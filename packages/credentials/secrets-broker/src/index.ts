/**
 * Secrets broker: short-lived, narrowly-bound, non-echoing credential grants.
 *
 * Epic P3-06's Contract stage — the lease vocabulary and its state machine.
 * What a secret's transport into a world looks like (must[1]) is deliberately
 * absent: `broker-only` is deliverable only by a separate address space, a
 * shape this repository has not chosen, and a grant model that guessed at it
 * would have to be rebuilt once it is.
 * @module @deepseek-ai/dsh-secrets-broker
 */

export {
  afterRedemption,
  decideRedemption,
  effectiveState,
  isExpired,
  isLegalLeaseTransition,
  revoke,
  revokeWorldLeases,
  type SecretLeasePresentation,
} from './lease.ts'
export type {
  SecretLease,
  SecretLeaseDecision,
  SecretLeaseId,
  SecretLeasePurpose,
  SecretLeaseRecord,
  SecretLeaseRefusal,
  SecretLeaseState,
  SecretLeaseTerminalState,
} from './types.ts'

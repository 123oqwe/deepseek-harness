/**
 * The durable approval queue's vocabulary (Epic P2-07): an approval's identity
 * and scope, its six states, the record a store keeps, and the store contract
 * every provider implements.
 *
 * The ids are the same brands their owning packages declare
 * (`@deepseek-ai/dsh-user-approval`, `@deepseek-ai/dsh-session`,
 * `@deepseek-ai/dsh-principal`), redeclared here so the contract depends on
 * none of them.
 * @module @deepseek-ai/dsh-approval-store/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** One approval request's id; the request `approval/asked` and `approval/bound` record carries the same id. */
export type ApprovalRequestId = Branded<'ApprovalRequestId'>
/** A session id, the brand `@deepseek-ai/dsh-session` declares. */
export type SessionId = Branded<'SessionId'>
/** A durable Run's id, the brand `@deepseek-ai/dsh-principal` declares. */
export type RunId = Branded<'RunId'>
/** A tenant id, the brand `@deepseek-ai/dsh-principal` declares. */
export type TenantId = Branded<'TenantId'>
/** A principal id, the brand `@deepseek-ai/dsh-principal` declares. */
export type PrincipalId = Branded<'PrincipalId'>

/**
 * An approval's state (must[0]). `requested` moves to `approved`, `denied`,
 * `expired` or `revoked`; `approved` moves to `consumed`, `expired` or
 * `revoked`; the other four are terminal (the transition table in `transitions.ts`).
 */
export type ApprovalState = 'requested' | 'approved' | 'denied' | 'expired' | 'revoked' | 'consumed'

/**
 * What an approval belongs to. A `turn` approval was asked inside one open
 * turn for one tool call; a crash that ends the turn revokes it, and a retry
 * asks again. A `run` approval was asked for a durable Run that waits in
 * `waiting_for_approval`; it survives a restart and wakes the Run when it is
 * approved (must[2], must[3]).
 */
export type ApprovalScope =
  | { readonly kind: 'turn'; readonly sessionId: SessionId; readonly callId?: string }
  | { readonly kind: 'run'; readonly runId: RunId; readonly sessionId: SessionId }

/** Who may read and decide an approval: the tenant it belongs to, and the principal acting. */
export interface ApprovalViewer {
  readonly tenant: TenantId
  readonly principal: PrincipalId
}

/** One approval as a store records it (must[1]). */
export interface ApprovalRecord {
  readonly id: ApprovalRequestId
  /** The tenant the approval belongs to; every read and decision from another tenant is refused. */
  readonly tenant: TenantId
  /** The principal whose action asked for approval. */
  readonly actor: PrincipalId
  readonly scope: ApprovalScope
  readonly toolName: string
  /** The digest of the bound request (`approval/bound`'s `digest`, Epic P2-06); a consumer re-checks the action against it. */
  readonly requestDigest: string
  /** The policy set version the request was evaluated under; absent when no policy engine was mounted. */
  readonly policyVersion?: string
  readonly requestedAtMs: number
  /** From this instant on, a `requested` or `approved` approval reads as `expired` and can no longer be decided or consumed. */
  readonly deadlineMs: number
  readonly state: ApprovalState
  /** Starts at 0 and grows by one on every transition; every write names the revision it read (compare-and-swap, must[4]). */
  readonly revision: number
  /** The principal that approved, denied or revoked it. */
  readonly decidedBy?: PrincipalId
  readonly decidedAtMs?: number
  readonly consumedAtMs?: number
}

/** What a caller supplies to record a new request; the store adds the state, the revision and the request time. */
export type ApprovalRequestInput = Omit<ApprovalRecord, 'state' | 'revision' | 'requestedAtMs' | 'decidedBy' | 'decidedAtMs' | 'consumedAtMs'>

/**
 * Why a write did not happen. `stale-revision`: another writer moved the
 * approval since the caller read it. `invalid-transition`: the approval's
 * state does not allow the move. `expired`: the deadline passed, so the
 * approval can only be read as expired. `other-tenant`: the viewer belongs to
 * another tenant. `not-found`: no such approval.
 */
export type ApprovalConflict = 'stale-revision' | 'invalid-transition' | 'expired' | 'other-tenant' | 'not-found'

/** One compare-and-swap write's result: the record after the write, or the conflict and, when readable, the current record. */
export type ApprovalWriteResult =
  | { readonly ok: true; readonly record: ApprovalRecord }
  | { readonly ok: false; readonly conflict: ApprovalConflict; readonly current?: ApprovalRecord }

/** A decision a principal makes on a requested approval. */
export type ApprovalDecision = 'approved' | 'denied'

/**
 * The store every provider implements and `ctx.approvalStore` publishes.
 * Every write is one compare-and-swap on the revision the caller read, so two
 * clients racing on one approval leave exactly one terminal state, and a
 * consumption happens at most once (acceptance[1]).
 */
export interface ApprovalStoreContract {
  /**
   * Record a new request in `requested`, revision 0.
   * @param input - the request.
   * @param nowMs - the request time.
   * @returns the recorded approval.
   */
  request(input: ApprovalRequestInput, nowMs: number): ApprovalRecord
  /**
   * Approve or deny a requested approval.
   * @param id - the approval.
   * @param expectedRevision - the revision the caller read.
   * @param decision - approve or deny.
   * @param viewer - the deciding principal and its tenant.
   * @param nowMs - the decision time.
   * @returns the decided approval, or the conflict.
   */
  decide(
    id: ApprovalRequestId,
    expectedRevision: number,
    decision: ApprovalDecision,
    viewer: ApprovalViewer,
    nowMs: number,
  ): ApprovalWriteResult
  /**
   * Revoke a requested or approved approval.
   * @param id - the approval.
   * @param expectedRevision - the revision the caller read.
   * @param viewer - the revoking principal and its tenant.
   * @param nowMs - the revocation time.
   * @returns the revoked approval, or the conflict.
   */
  revoke(id: ApprovalRequestId, expectedRevision: number, viewer: ApprovalViewer, nowMs: number): ApprovalWriteResult
  /**
   * Consume an approved approval before its deadline, at most once; the action it approved runs only on success.
   * @param id - the approval.
   * @param expectedRevision - the revision the caller read.
   * @param viewer - the consuming principal and its tenant.
   * @param nowMs - the consumption time.
   * @returns the consumed approval, or the conflict.
   */
  consume(id: ApprovalRequestId, expectedRevision: number, viewer: ApprovalViewer, nowMs: number): ApprovalWriteResult
  /**
   * One approval as the viewer may see it, read as expired past its deadline.
   * @param id - the approval.
   * @param viewer - the reading principal and its tenant.
   * @param nowMs - the instant to read the deadline against.
   * @returns the approval, or `undefined` when it does not exist or belongs to another tenant.
   */
  get(id: ApprovalRequestId, viewer: ApprovalViewer, nowMs: number): ApprovalRecord | undefined
  /**
   * The viewer's tenant's approvals still waiting for a decision or a consumption, oldest first.
   * @param viewer - the reading principal and its tenant.
   * @param nowMs - the instant to read deadlines against; a lapsed approval is not pending.
   * @returns the `requested` and `approved` approvals whose deadline has not passed.
   */
  listPending(viewer: ApprovalViewer, nowMs: number): readonly ApprovalRecord[]
}

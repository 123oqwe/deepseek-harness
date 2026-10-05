/**
 * The approval state machine as pure decisions (Epic P2-07): the moves each
 * state allows, how a deadline reads, which viewer may touch an approval, and
 * what one compare-and-swap write produces. Every store provider applies
 * these, so two providers cannot disagree about a transition.
 * @module @deepseek-ai/dsh-approval-store/transitions
 */

import type { ApprovalRecord, ApprovalRequestInput, ApprovalState, ApprovalViewer, ApprovalWriteResult } from './types.ts'

/** The moves each state allows (must[0]); a state with none is terminal. */
export const APPROVAL_TRANSITIONS: Readonly<Record<ApprovalState, readonly ApprovalState[]>> = {
  requested: ['approved', 'denied', 'expired', 'revoked'],
  approved: ['consumed', 'expired', 'revoked'],
  denied: [],
  expired: [],
  revoked: [],
  consumed: [],
}

/**
 * Whether no move leaves `state`.
 * @param state - an approval state.
 * @returns `true` for `denied`, `expired`, `revoked` and `consumed`.
 */
export function isTerminalApprovalState(state: ApprovalState): boolean {
  return APPROVAL_TRANSITIONS[state].length === 0
}

/**
 * The state an approval reads as at `nowMs`: a `requested` or `approved`
 * approval whose deadline has come reads as `expired`, so a lapsed approval
 * is never approved or executed (acceptance[2]); every other state reads as
 * recorded.
 * @param record - the approval.
 * @param nowMs - the instant to read the deadline against.
 * @returns the effective state.
 */
export function effectiveApprovalState(record: ApprovalRecord, nowMs: number): ApprovalState {
  return !isTerminalApprovalState(record.state) && nowMs >= record.deadlineMs ? 'expired' : record.state
}

/**
 * Whether an approval still waits for a decision or a consumption at `nowMs`.
 * @param record - the approval.
 * @param nowMs - the instant to read the deadline against.
 * @returns `true` when it reads as `requested` or `approved`.
 */
export function isPendingApproval(record: ApprovalRecord, nowMs: number): boolean {
  const state = effectiveApprovalState(record, nowMs)
  return state === 'requested' || state === 'approved'
}

/**
 * Whether `viewer` may read and decide `record`: only within its own tenant.
 * @param record - the approval.
 * @param viewer - the reading or deciding principal and its tenant.
 * @returns `true` when both belong to one tenant.
 */
export function viewerMayAccess(record: ApprovalRecord, viewer: ApprovalViewer): boolean {
  return record.tenant === viewer.tenant
}

/**
 * A newly requested approval: state `requested`, revision 0.
 * @param input - the request.
 * @param nowMs - the request time.
 * @returns the record a store writes.
 */
export function newApprovalRecord(input: ApprovalRequestInput, nowMs: number): ApprovalRecord {
  return { ...input, state: 'requested', revision: 0, requestedAtMs: nowMs }
}

/**
 * One compare-and-swap move, decided without storage: the record after moving
 * to `to` at `nowMs`, or why not. The checks run in a fixed order — tenant,
 * revision, deadline, then the transition table — so the conflict names the
 * first thing that was wrong. A lapsed approval may only move to `expired`.
 * A successful move adds one to the revision and records who decided and
 * when (`approved`, `denied`, `revoked`) or when it was consumed.
 * @param record - the approval as the store holds it.
 * @param expectedRevision - the revision the caller read.
 * @param to - the target state.
 * @param viewer - the acting principal and its tenant.
 * @param nowMs - the instant of the write.
 * @returns the moved record, or the conflict and, except for another tenant, the current record.
 */
export function applyApprovalTransition(
  record: ApprovalRecord,
  expectedRevision: number,
  to: ApprovalState,
  viewer: ApprovalViewer,
  nowMs: number,
): ApprovalWriteResult {
  if (!viewerMayAccess(record, viewer)) return { ok: false, conflict: 'other-tenant' }
  // MUTATION M-A519-1 (never merge): a move no longer checks the expected revision.
  if (record.revision !== expectedRevision && to.length < 0) return { ok: false, conflict: 'stale-revision', current: record }
  const lapsed = effectiveApprovalState(record, nowMs) === 'expired'
  if (lapsed && to !== 'expired') return { ok: false, conflict: 'expired', current: record }
  if (!APPROVAL_TRANSITIONS[record.state].includes(to)) return { ok: false, conflict: 'invalid-transition', current: record }
  const moved: ApprovalRecord = { ...record, state: to, revision: record.revision + 1 }
  if (to === 'consumed') return { ok: true, record: { ...moved, consumedAtMs: nowMs } }
  if (to === 'expired') return { ok: true, record: moved }
  return { ok: true, record: { ...moved, decidedBy: viewer.principal, decidedAtMs: nowMs } }
}

/**
 * The approval service's side of the durable approval queue (Epic P2-07 Use):
 * whom an approval in a session belongs to, recording an ask and its outcome
 * in `ctx.approvalStore`, consuming an approval before the action it approved
 * runs, and revoking the approvals a crashed turn left open.
 *
 * Every function takes the store as a value the caller read with
 * `ctx.get('approvalStore')`; a composition that mounts no store passes
 * `undefined` where that is allowed and keeps the behaviour it had before the
 * queue existed.
 * @module @deepseek-ai/dsh-user-approval/store-bridge
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { manifestAttribution } from '@deepseek-ai/dsh-action-manifest'
import { effectiveApprovalState } from '@deepseek-ai/dsh-approval-store'
import type {
  ApprovalConflict,
  ApprovalRecord,
  ApprovalRequestId,
  ApprovalStoreContract,
  ApprovalViewer,
  ApprovalWriteResult,
} from '@deepseek-ai/dsh-approval-store'
import { attachedIdentity, type Session } from '@deepseek-ai/dsh-session'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ApprovalOutcome } from './types.ts'

/**
 * Whom an approval in `session` belongs to and who acts on it: the tenant and
 * principal the session's action manifests are attributed to (its attached
 * identity's current principal, else the anonymous-dev principal of tenant
 * `local`). An approval asked in one tenant is neither read nor consumed by a
 * session of another.
 * @param session - the asking or dispatching session.
 * @returns the viewer every store call for this session uses.
 */
export function approvalViewerOf(session: Session): ApprovalViewer {
  const { actor } = manifestAttribution(attachedIdentity(session), session.id)
  return { tenant: actor.tenantId, principal: actor.id }
}

/**
 * The request digest of an ask that bound no action tuple: the digest of its
 * tool name and call id, so the approval is still recorded, listed and
 * consumed like any other.
 * @param toolName - the tool the ask is about.
 * @param callId - the tool call, when the ask names one.
 * @returns a `sha256:`-prefixed hex digest.
 */
export function unboundRequestDigest(toolName: string, callId: string | undefined): string {
  return `sha256:${createHash('sha256').update(`${toolName}\0${callId ?? ''}`).digest('hex')}`
}

/** What {@link recordApprovalRequest} records about one ask. */
export interface RecordedAsk {
  readonly id: ApprovalRequestId
  readonly session: Session
  readonly toolName: string
  readonly callId?: string
  readonly requestDigest: string
  readonly policyVersion?: string
  readonly deadlineMs: number
}

/**
 * Record a turn-scoped approval in `requested` before the ask is logged.
 * @param store - the mounted approval store.
 * @param ask - the ask.
 * @param nowMs - the ask time.
 * @returns the recorded approval, whose revision the ask's own move names.
 */
export function recordApprovalRequest(store: ApprovalStoreContract, ask: RecordedAsk, nowMs: number): ApprovalRecord {
  const viewer = approvalViewerOf(ask.session)
  return store.request({
    id: ask.id,
    tenant: viewer.tenant,
    actor: viewer.principal,
    scope: { kind: 'turn', sessionId: ask.session.id, ...ask.callId === undefined ? {} : { callId: ask.callId } },
    toolName: ask.toolName,
    requestDigest: ask.requestDigest,
    ...ask.policyVersion === undefined ? {} : { policyVersion: ask.policyVersion },
    deadlineMs: ask.deadlineMs,
  }, nowMs)
}

/**
 * Record an ask's outcome as a move of its approval, from the revision the ask
 * recorded, and return the outcome the store settled on. `allowed-once`
 * approves the approval, `rejected` denies it, and `cancelled` or
 * `unavailable` revokes it, since nobody granted it and a retry asks again.
 * When the store accepts the move the outcome stands. When it refuses (another
 * client moved the approval since, or it lapsed), the
 * approval as the store holds it decides, read against `nowMs`: approved is
 * `allowed-once`, denied is `rejected`, and anything else (revoked, lapsed,
 * consumed), or an approval the store does not hold, is `cancelled`.
 * @param store - the mounted approval store.
 * @param id - the approval.
 * @param expectedRevision - the revision the ask recorded.
 * @param outcome - the ask's outcome.
 * @param session - the asking session.
 * @param nowMs - the decision time.
 * @returns the outcome the ask settles on.
 */
export function recordApprovalOutcome(
  store: ApprovalStoreContract,
  id: ApprovalRequestId,
  expectedRevision: number,
  outcome: ApprovalOutcome,
  session: Session,
  nowMs: number,
): ApprovalOutcome {
  const result = outcomeMove(store, expectedRevision, id, outcome, approvalViewerOf(session), nowMs)
  if (result.ok) return outcome
  const state = result.current === undefined ? undefined : effectiveApprovalState(result.current, nowMs)
  if (state === 'approved') return 'allowed-once'
  return state === 'denied' ? 'rejected' : 'cancelled'
}

/**
 * The store move one outcome makes.
 * @param store - the mounted approval store.
 * @param revision - the revision read.
 * @param id - the approval.
 * @param outcome - the ask's outcome.
 * @param viewer - the asking session's viewer.
 * @param nowMs - the decision time.
 * @returns the store's answer to the move.
 */
function outcomeMove(
  store: ApprovalStoreContract,
  revision: number,
  id: ApprovalRequestId,
  outcome: ApprovalOutcome,
  viewer: ApprovalViewer,
  nowMs: number,
): ApprovalWriteResult {
  switch (outcome) {
    case 'allowed-once':
      return store.decide(id, revision, 'approved', viewer, nowMs)
    case 'rejected':
      return store.decide(id, revision, 'denied', viewer, nowMs)
    case 'cancelled':
    case 'unavailable':
      return store.revoke(id, revision, viewer, nowMs)
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(outcome, 'ApprovalOutcome')
  }
}

/**
 * Consume an approval before the action it approved runs (acceptance[1],
 * acceptance[2]): the action may run only when this returns `undefined`.
 * Without a mounted store there is nothing to consume and the action runs as
 * it did before the queue existed. With one, an approval the store does not
 * hold for this session's tenant is refused as `not-found` (fail closed), and
 * a consumed, revoked, denied or lapsed one, or one another writer moved
 * since it was read, is refused with the store's conflict.
 * @param store - the mounted approval store, or `undefined` when none is.
 * @param session - the dispatching session.
 * @param id - the approval the dispatch rests on.
 * @param nowMs - the dispatch time.
 * @returns the conflict that refuses the action, or `undefined` when it may run.
 */
export function consumeRecordedApproval(
  store: ApprovalStoreContract | undefined,
  session: Session,
  id: ApprovalRequestId,
  nowMs: number,
): ApprovalConflict | undefined {
  if (store === undefined) return undefined
  const viewer = approvalViewerOf(session)
  const row = store.get(id, viewer, nowMs)
  if (row === undefined) return 'not-found'
  const result = store.consume(id, row.revision, viewer, nowMs)
  return result.ok ? undefined : result.conflict
}

/**
 * Revoke every approval a session's turn left requested or approved: the turn
 * that asked is gone after a crash, so its approvals can no longer be used,
 * and a retry asks again.
 * @param store - the mounted approval store.
 * @param session - the resumed session.
 * @param nowMs - the resume time.
 * @returns how many approvals were revoked.
 */
export function revokeTurnApprovals(store: ApprovalStoreContract, session: Session, nowMs: number): number {
  const viewer = approvalViewerOf(session)
  return store.listPending(viewer, nowMs)
    .filter(row => row.scope.kind === 'turn' && row.scope.sessionId === session.id)
    .map(row => store.revoke(row.id, row.revision, viewer, nowMs))
    .filter(result => result.ok)
    .length
}

/**
 * {@link consumeRecordedApproval} against the store mounted in `ctx`, for the
 * dispatch paths that hold a context rather than a store.
 * @param ctx - the dispatching context.
 * @param session - the dispatching session.
 * @param id - the approval the dispatch rests on.
 * @param nowMs - the dispatch time.
 * @returns the conflict that refuses the action, or `undefined` when it may run.
 */
export function consumeApprovalAtDispatch(
  ctx: Context,
  session: Session,
  id: ApprovalRequestId,
  nowMs: number,
): ApprovalConflict | undefined {
  return consumeRecordedApproval(ctx.get('approvalStore'), session, id, nowMs)
}

/**
 * {@link revokeTurnApprovals} against the store mounted in `ctx`, for a
 * resume that holds a context: nothing to revoke without a store.
 * @param ctx - the resuming context.
 * @param session - the resumed session.
 * @param nowMs - the resume time.
 * @returns how many approvals were revoked.
 */
export function revokeTurnApprovalsAfterCrash(ctx: Context, session: Session, nowMs: number): number {
  const store = ctx.get('approvalStore')
  return store === undefined ? 0 : revokeTurnApprovals(store, session, nowMs)
}

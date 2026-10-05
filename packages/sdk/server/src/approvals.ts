/**
 * The SDK's approval requests (Epic P2-07 validation[2]): `approval/list` and
 * `approval/decide` answered from `ctx.approvalStore`, and the wire form of an
 * approval that `approval.changed` also carries.
 *
 * Every call reads and decides as the viewer the connection acts as. The
 * store refuses another tenant's approval as `other-tenant`; the wire answers
 * `not-found`, so a client cannot learn that another tenant's approval exists.
 * A composition that mounts no store holds no approvals: the list is empty and
 * every decision is `not-found`.
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/approvals
 */

import type { Context } from '@deepseek-ai/cordis'
import { effectiveApprovalState, type ApprovalRecord, type ApprovalRequestId, type ApprovalViewer } from '@deepseek-ai/dsh-approval-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  ApprovalDecideParams,
  ApprovalDecideResult,
  ApprovalListParams,
  ApprovalListResult,
  SdkApproval,
} from '@deepseek-ai/dsh-sdk-protocol'

/**
 * One approval in its wire form, its state read against `nowMs`.
 * @param record - the approval as the store holds it.
 * @param nowMs - the instant its deadline is read against.
 * @returns the approval as the SDK carries it.
 */
export function sdkApproval(record: ApprovalRecord, nowMs: number): SdkApproval {
  return {
    id: record.id,
    sessionId: record.scope.sessionId,
    ...record.scope.kind === 'run' ? { runId: record.scope.runId } : {},
    toolName: record.toolName,
    requestDigest: record.requestDigest,
    state: effectiveApprovalState(record, nowMs),
    revision: record.revision,
    deadlineMs: record.deadlineMs,
  }
}

/**
 * Answer `approval/list`: the viewer's tenant's pending approvals, oldest
 * first, of one session when the params name one.
 * @param ctx - the context whose store answers.
 * @param viewer - the tenant and principal the connection acts as.
 * @param params - the raw params from the wire.
 * @param nowMs - the instant deadlines are read against.
 * @returns the pending approvals.
 * @throws TypeError when `sessionId` is present and not a non-empty string.
 */
export function listApprovals(ctx: Context, viewer: ApprovalViewer, params: unknown, nowMs: number): ApprovalListResult {
  const { sessionId } = parseListParams(params)
  const pending = ctx.get('approvalStore')?.listPending(viewer, nowMs) ?? []
  return {
    approvals: pending
      .filter(record => sessionId === undefined || record.scope.sessionId === sessionId)
      .map(record => sdkApproval(record, nowMs)),
  }
}

/**
 * Answer `approval/decide`: approve or deny one approval from the revision
 * the client read, by the store's compare-and-swap.
 * @param ctx - the context whose store decides.
 * @param viewer - the tenant and principal the connection acts as.
 * @param params - the raw params from the wire.
 * @param nowMs - the decision time.
 * @returns the decided approval, or why the decision did not happen and the approval as it now stands.
 * @throws TypeError when the params are not an id, a revision and a decision.
 */
export function decideApproval(ctx: Context, viewer: ApprovalViewer, params: unknown, nowMs: number): ApprovalDecideResult {
  const { id, revision, decision } = parseDecideParams(params)
  const store = ctx.get('approvalStore')
  if (store === undefined) return { ok: false, conflict: 'not-found' }
  const result = store.decide(brandString<ApprovalRequestId>(id), revision, decision, viewer, nowMs)
  if (result.ok) return { ok: true, approval: sdkApproval(result.record, nowMs) }
  if (result.conflict === 'other-tenant') return { ok: false, conflict: 'not-found' }
  return { ok: false, conflict: result.conflict, ...result.current === undefined ? {} : { approval: sdkApproval(result.current, nowMs) } }
}

/**
 * Read `approval/list` params off the wire.
 * @param params - the raw params.
 * @returns the validated params.
 * @throws TypeError when the params are not an object, or `sessionId` is present and not a non-empty string.
 */
function parseListParams(params: unknown): ApprovalListParams {
  const record = paramsObject('approval/list', params)
  const sessionId = record.sessionId
  if (sessionId === undefined) return {}
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('approval/list sessionId must be a non-empty string')
  return { sessionId }
}

/**
 * Read `approval/decide` params off the wire.
 * @param params - the raw params.
 * @returns the validated params.
 * @throws TypeError when `id` is not a non-empty string, `revision` not a
 *   non-negative safe integer, or `decision` neither `approved` nor `denied`.
 */
function parseDecideParams(params: unknown): ApprovalDecideParams {
  const record = paramsObject('approval/decide', params)
  const { id, revision, decision } = record
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('approval/decide id must be a non-empty string')
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('approval/decide revision must be a non-negative safe integer')
  }
  if (decision !== 'approved' && decision !== 'denied') throw new TypeError('approval/decide decision must be "approved" or "denied"')
  return { id, revision, decision }
}

/**
 * The params object of one request; an absent params is an empty object.
 * @param method - the method, for the error.
 * @param params - the raw params.
 * @returns the params as a record.
 * @throws TypeError when the params are present and not a plain object.
 */
function paramsObject(method: string, params: unknown): Record<string, unknown> {
  if (params === undefined) return {}
  if (typeof params !== 'object' || params === null || Array.isArray(params)) throw new TypeError(`${method} params must be an object`)
  return params as Record<string, unknown>
}

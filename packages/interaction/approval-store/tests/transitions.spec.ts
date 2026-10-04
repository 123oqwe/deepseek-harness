/**
 * The approval state machine's decisions (Epic P2-07): the transition table
 * (must[0]), the compare-and-swap write that keeps a consumption to at most
 * once (acceptance[1]) and two racing clients to one terminal state, the
 * deadline that makes a lapsed approval unusable (acceptance[2]), and tenancy.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_TRANSITIONS,
  applyApprovalTransition,
  effectiveApprovalState,
  isPendingApproval,
  isTerminalApprovalState,
  newApprovalRecord,
  viewerMayAccess,
  type ApprovalRecord,
  type ApprovalRequestId,
  type ApprovalState,
  type ApprovalViewer,
  type PrincipalId,
  type SessionId,
  type TenantId,
} from '../src/index.ts'

const STATES: readonly ApprovalState[] = ['requested', 'approved', 'denied', 'expired', 'revoked', 'consumed']
const tenant = brandString<TenantId>('tenant-a')
const user: ApprovalViewer = { tenant, principal: brandString<PrincipalId>('user-1') }
const otherUser: ApprovalViewer = { tenant, principal: brandString<PrincipalId>('user-2') }
const otherTenant: ApprovalViewer = { tenant: brandString<TenantId>('tenant-b'), principal: brandString<PrincipalId>('user-3') }
const DEADLINE = 1_000

const requested: ApprovalRecord = newApprovalRecord({
  id: brandString<ApprovalRequestId>('approval-1'),
  tenant,
  actor: brandString<PrincipalId>('agent-1'),
  scope: { kind: 'turn', sessionId: brandString<SessionId>('session-1'), callId: 'call-1' },
  toolName: 'bash',
  requestDigest: 'sha256:request',
  policyVersion: 'policy-1',
  deadlineMs: DEADLINE,
}, 100)

/**
 * The record after one successful move, failing the case on a conflict.
 * @param record - the approval.
 * @param to - the target state.
 * @param viewer - the acting principal.
 * @param nowMs - the instant of the write.
 * @returns the moved record.
 */
function moved(record: ApprovalRecord, to: ApprovalState, viewer: ApprovalViewer, nowMs: number): ApprovalRecord {
  const result = applyApprovalTransition(record, record.revision, to, viewer, nowMs)
  if (!result.ok) throw new Error(`expected ${record.state} -> ${to} to succeed, got ${result.conflict}`)
  return result.record
}

describe('approval transitions (P2-07 must[0])', () => {
  it('records a new request as requested at revision 0, with its request time', () => {
    expect(requested).toMatchObject({ state: 'requested', revision: 0, requestedAtMs: 100, deadlineMs: DEADLINE })
    expect(isPendingApproval(requested, 100)).toBe(true)
  })

  it('allows exactly the moves of the transition table, from every state, and only those', () => {
    expect(Object.keys(APPROVAL_TRANSITIONS).sort()).toEqual([...STATES].sort())
    for (const from of STATES) {
      for (const to of STATES) {
        const result = applyApprovalTransition({ ...requested, state: from }, 0, to, user, 200)
        expect([from, to, result.ok]).toEqual([from, to, APPROVAL_TRANSITIONS[from].includes(to)])
        if (result.ok) expect(result.record).toMatchObject({ state: to, revision: 1 })
      }
    }
  })

  it('treats denied, expired, revoked and consumed as terminal, and only those', () => {
    expect(STATES.filter(isTerminalApprovalState)).toEqual(['denied', 'expired', 'revoked', 'consumed'])
  })

  it('records who decided and when, and when it was consumed', () => {
    const approved = moved(requested, 'approved', user, 200)
    expect(approved).toMatchObject({ decidedBy: user.principal, decidedAtMs: 200 })
    expect(moved(approved, 'consumed', otherUser, 300)).toMatchObject({ state: 'consumed', consumedAtMs: 300, decidedBy: user.principal })
    expect(moved(requested, 'revoked', otherUser, 250)).toMatchObject({ decidedBy: otherUser.principal, decidedAtMs: 250 })
    expect('decidedBy' in moved(requested, 'expired', user, DEADLINE)).toBe(false)
  })
})

describe('compare-and-swap writes (P2-07 must[4], acceptance[1])', () => {
  it('consumes an approval at most once: a second consumption from the same read is stale, and after it nothing moves', () => {
    const approved = moved(requested, 'approved', user, 200)
    const first = applyApprovalTransition(approved, approved.revision, 'consumed', user, 300)
    expect(first.ok).toBe(true)
    expect(applyApprovalTransition(first.ok ? first.record : approved, approved.revision, 'consumed', user, 301))
      .toMatchObject({ ok: false, conflict: 'stale-revision' })
    const consumed = first.ok ? first.record : approved
    expect(applyApprovalTransition(consumed, consumed.revision, 'consumed', user, 302)).toMatchObject({ ok: false, conflict: 'invalid-transition' })
  })

  it('leaves exactly one terminal state when two clients decide from the same read', () => {
    const winner = applyApprovalTransition(requested, 0, 'approved', user, 200)
    expect(winner.ok).toBe(true)
    const current = winner.ok ? winner.record : requested
    expect(applyApprovalTransition(current, 0, 'denied', otherUser, 201))
      .toEqual({ ok: false, conflict: 'stale-revision', current })
  })

  it('never lets a revoked approval be consumed', () => {
    const revoked = moved(moved(requested, 'approved', user, 200), 'revoked', otherUser, 250)
    expect(applyApprovalTransition(revoked, revoked.revision, 'consumed', user, 300)).toMatchObject({ ok: false, conflict: 'invalid-transition' })
  })
})

describe('deadlines (P2-07 acceptance[2])', () => {
  it('reads a requested or approved approval as expired from its deadline on, and a terminal one as recorded', () => {
    const approved = moved(requested, 'approved', user, 200)
    expect([effectiveApprovalState(requested, DEADLINE - 1), effectiveApprovalState(requested, DEADLINE)]).toEqual(['requested', 'expired'])
    expect([effectiveApprovalState(approved, DEADLINE - 1), effectiveApprovalState(approved, DEADLINE)]).toEqual(['approved', 'expired'])
    expect(effectiveApprovalState(moved(requested, 'denied', user, 200), DEADLINE + 1)).toBe('denied')
    expect([isPendingApproval(approved, DEADLINE - 1), isPendingApproval(approved, DEADLINE)]).toEqual([true, false])
  })

  it('refuses to approve or consume a lapsed approval, and lets it be marked expired', () => {
    const approved = moved(requested, 'approved', user, 200)
    expect(applyApprovalTransition(requested, 0, 'approved', user, DEADLINE)).toMatchObject({ ok: false, conflict: 'expired' })
    expect(applyApprovalTransition(approved, approved.revision, 'consumed', user, DEADLINE)).toMatchObject({ ok: false, conflict: 'expired' })
    expect(moved(approved, 'expired', user, DEADLINE)).toMatchObject({ state: 'expired', revision: approved.revision + 1 })
  })
})

describe('tenancy', () => {
  it('refuses another tenant without showing it the approval', () => {
    expect(viewerMayAccess(requested, otherTenant)).toBe(false)
    expect(viewerMayAccess(requested, otherUser)).toBe(true)
    expect(applyApprovalTransition(requested, 0, 'approved', otherTenant, 200)).toEqual({ ok: false, conflict: 'other-tenant' })
  })
})

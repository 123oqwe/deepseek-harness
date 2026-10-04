import { describe, expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import { approvalsForAction } from '../src/audit.ts'

/** One ask about `actionId`, as the approval service logs it: asked, bound, decided. */
function ask(first: number, id: string, actionId: string, outcome: 'allowed-once' | 'rejected'): SessionEvent[] {
  const approval = ApprovalRequestId(id)
  return [
    { type: 'approval/asked', seq: SessionSeq(first), time: first, data: { id: approval, toolName: 'bash' } },
    {
      type: 'approval/bound',
      seq: SessionSeq(first + 1),
      time: first + 1,
      data: { id: approval, action: 'bash', actionId, digest: `digest-${id}`, principal: 'user:host', preconditions: [], expiresAtMs: 300_000 },
    },
    { type: 'approval/decided', seq: SessionSeq(first + 2), time: first + 2, data: { id: approval, outcome } },
  ]
}

describe('approvalsForAction (dsh audit approval, P2-06 validation[2])', () => {
  it('finds the one approval an action was decided by, joined with its ask and decision', () => {
    expect(approvalsForAction(ask(0, 'approval-1', 'call-1', 'allowed-once'), 'call-1')).toEqual([{
      approvalId: 'approval-1',
      action: 'bash',
      actionId: 'call-1',
      digest: 'digest-approval-1',
      principal: 'user:host',
      preconditions: [],
      expiresAtMs: 300_000,
      boundSeq: 1,
      asked: { seq: 0, toolName: 'bash' },
      decided: { seq: 2, outcome: 'allowed-once' },
    }])
  })

  it('tells two calls to one tool apart by their action ids', () => {
    const log = [...ask(0, 'approval-1', 'call-1', 'allowed-once'), ...ask(3, 'approval-2', 'call-2', 'rejected')]

    expect(approvalsForAction(log, 'call-1').map(approval => approval.approvalId)).toEqual(['approval-1'])
    expect(approvalsForAction(log, 'call-2').map(approval => [approval.approvalId, approval.decided?.outcome]))
      .toEqual([['approval-2', 'rejected']])
    expect(approvalsForAction(log, 'call-3')).toEqual([])
  })

  it('lists every approval a log binds to one action id', () => {
    const log = [...ask(0, 'approval-1', 'call-1', 'rejected'), ...ask(3, 'approval-2', 'call-1', 'allowed-once')]

    expect(approvalsForAction(log, 'call-1').map(approval => approval.approvalId)).toEqual(['approval-1', 'approval-2'])
  })

  it('carries the bound capability token and policy version when the binding has them, and null for an ask or decision the log lacks', () => {
    const approval = ApprovalRequestId('approval-1')
    const log: SessionEvent[] = [{
      type: 'approval/bound',
      seq: SessionSeq(7),
      time: 7,
      data: {
        id: approval, action: 'bash', actionId: 'call-1', digest: 'd', principal: 'user:host', preconditions: ['file:/a'],
        capabilityToken: 'token-digest', policyVersion: 'policy-1', expiresAtMs: 1,
      },
    }]

    expect(approvalsForAction(log, 'call-1')).toEqual([{
      approvalId: 'approval-1', action: 'bash', actionId: 'call-1', digest: 'd', principal: 'user:host', preconditions: ['file:/a'],
      capabilityToken: 'token-digest', policyVersion: 'policy-1', expiresAtMs: 1, boundSeq: 7, asked: null, decided: null,
    }])
  })
})

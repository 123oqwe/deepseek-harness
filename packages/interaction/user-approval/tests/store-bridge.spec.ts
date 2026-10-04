/**
 * Epic P2-07 Use (U1a): the approval service goes through the durable queue.
 * With `ctx.approvalStore` mounted, every ask is recorded before it is logged,
 * its outcome becomes the approval's move, an unbound grant is consumed at
 * once, and an agent's publication revokes what its session's ended turns left
 * open. Without a store the service behaves as before (the rest of this
 * package's suites).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ApprovalRecord, ApprovalStoreContract, RunId } from '@deepseek-ai/dsh-approval-store'
import ApprovalStoreSqlitePlugin from '@deepseek-ai/dsh-approval-store/sqlite'
import type { PrincipalId } from '@deepseek-ai/dsh-principal/types'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ApprovalService, {
  ApprovalRequestId,
  approvalViewerOf,
  consumeRecordedApproval,
  recordApprovalOutcome,
  revokeTurnApprovals,
  unboundRequestDigest,
  type ApprovalOutcome,
} from '@deepseek-ai/dsh-user-approval'
import type { ApprovalBindingInputs } from '@deepseek-ai/dsh-user-approval/types'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * A service mounted beside the SQLite approval store, answered by `answer`.
 * @param answer - what the answerer returns, or `undefined` for no answerer.
 * @param approvalValidityMs - the service's validity setting.
 * @returns the context and its store.
 */
async function mounted(
  answer: ApprovalOutcome | undefined,
  approvalValidityMs = 300_000,
): Promise<{ ctx: Context; store: ApprovalStoreContract }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-approval-bridge-'))
  dirs.push(dir)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ApprovalStoreSqlitePlugin, { directory: dir, busyTimeoutMs: 1000 })
  await ctx.plugin(ApprovalService, { approvalValidityMs })
  if (answer !== undefined) ctx.on('approval/request', () => Promise.resolve(answer))
  const store = ctx.get('approvalStore')
  if (store === undefined) throw new Error('ctx.approvalStore is not published')
  return { ctx, store }
}

/**
 * A minimal agent whose session is inside an open turn and records what is appended.
 * @param id - the session id.
 * @returns the agent and the events it appended.
 */
function fakeAgent(id = 'session-1'): { agent: Agent; appended: { type: string; data: Record<string, unknown> }[] } {
  const appended: { type: string; data: Record<string, unknown> }[] = []
  const events: { type: string; data?: Record<string, unknown> }[] = [{ type: 'turn/start' }, { type: 'user/message' }]
  const session = {
    id: SessionId(id),
    get seq() { return events.length },
    eventAt: (seq: number) => events[seq],
    snapshotEvents: () => events,
    append: (type: string, data: Record<string, unknown>) => {
      const event = { type, data }
      events.push(event)
      appended.push(event)
      return event as unknown as SessionEvent
    },
  }
  return { agent: { session } as unknown as Agent, appended }
}

/**
 * The approval the session's `approval/asked` names, read from the store.
 * @param store - the store.
 * @param agent - the asking agent.
 * @param appended - what the session appended.
 * @returns the record.
 */
function rowOf(
  store: ApprovalStoreContract,
  agent: Agent,
  appended: { type: string; data: Record<string, unknown> }[],
): ApprovalRecord | undefined {
  const asked = appended.find(event => event.type === 'approval/asked')
  return store.get(ApprovalRequestId(String(asked?.data.id)), approvalViewerOf(agent.session), Date.now())
}

/** The tuple a bound ask carries. */
function inputs(): ApprovalBindingInputs {
  return { action: 'fs.write', args: { path: 'a.ts' }, principal: brandString<PrincipalId>('user-alice'), preconditions: [], policyVersion: 'policy-v1' }
}

describe('P2-07 U1a: every ask goes through the durable queue', () => {
  it('records a bound ask before it is logged, and an allowed-once grant approves it without consuming it', async () => {
    const { ctx, store } = await mounted('allowed-once')
    const { agent, appended } = fakeAgent()
    expect(await ctx.approval.request({ agent, toolName: 'fs.write', callId: 'call-1', binding: { inputs: inputs(), askedAtMs: Date.now() } }))
      .toBe('allowed-once')
    const bound = appended.find(event => event.type === 'approval/bound')
    expect(rowOf(store, agent, appended)).toMatchObject({
      state: 'approved',
      revision: 1,
      toolName: 'fs.write',
      requestDigest: bound?.data.digest,
      policyVersion: 'policy-v1',
      scope: { kind: 'turn', sessionId: 'session-1', callId: 'call-1' },
      tenant: 'local',
      actor: 'anonymous:session-1',
    })
  })

  it('records a rejection as denied, and a cancelled or unavailable outcome as revoked', async () => {
    for (const [answer, state] of [['rejected', 'denied'], ['cancelled', 'revoked'], [undefined, 'revoked']] as const) {
      const { ctx, store } = await mounted(answer)
      const { agent, appended } = fakeAgent()
      await ctx.approval.request({ agent, toolName: 'fs.write', binding: { inputs: inputs(), askedAtMs: Date.now() } })
      expect([answer, rowOf(store, agent, appended)?.state]).toEqual([answer, state])
    }
  })

  it('consumes an unbound grant at once, under the digest of its tool and call', async () => {
    const { ctx, store } = await mounted('allowed-once')
    const { agent, appended } = fakeAgent()
    expect(await ctx.approval.request({ agent, toolName: 'workspace-trust', callId: 'call-2' })).toBe('allowed-once')
    expect(rowOf(store, agent, appended)).toMatchObject({ state: 'consumed', requestDigest: unboundRequestDigest('workspace-trust', 'call-2') })
    expect(appended.find(event => event.type === 'approval/decided')?.data).toMatchObject({ outcome: 'allowed-once' })
  })

  it('turns an unbound grant that lapsed before it was answered into cancelled, which is what the session logs', async () => {
    const { ctx, store } = await mounted('allowed-once', 0)
    const { agent, appended } = fakeAgent()
    expect(await ctx.approval.request({ agent, toolName: 'workspace-trust' })).toBe('cancelled')
    expect(appended.find(event => event.type === 'approval/decided')?.data).toMatchObject({ outcome: 'cancelled' })
    expect(rowOf(store, agent, appended)).toMatchObject({ state: 'expired' })
  })

  it('revokes, when an agent is published, the turn approvals its session left open, and only those', async () => {
    const { ctx, store } = await mounted(undefined)
    const { agent } = fakeAgent()
    const viewer = approvalViewerOf(agent.session)
    const base = { tenant: viewer.tenant, actor: viewer.principal, toolName: 'fs.write', requestDigest: 'sha256:x', deadlineMs: Date.now() + 60_000 }
    store.request({ ...base, id: ApprovalRequestId('open-turn'), scope: { kind: 'turn', sessionId: agent.session.id } }, Date.now())
    store.request({ ...base, id: ApprovalRequestId('approved-turn'), scope: { kind: 'turn', sessionId: agent.session.id } }, Date.now())
    store.decide(ApprovalRequestId('approved-turn'), 0, 'approved', viewer, Date.now())
    store.request({ ...base, id: ApprovalRequestId('run'), scope: { kind: 'run', runId: brandString<RunId>('run-1'), sessionId: agent.session.id } }, Date.now())
    store.request({ ...base, id: ApprovalRequestId('other-session'), scope: { kind: 'turn', sessionId: SessionId('session-2') } }, Date.now())
    ctx.emit('agent/created', { agent })
    expect(store.listPending(viewer, Date.now()).map(row => row.id).sort()).toEqual(['other-session', 'run'])
    expect(store.get(ApprovalRequestId('approved-turn'), viewer, Date.now())?.state).toBe('revoked')
  })
})

describe('P2-07 U1a: the bridge functions', () => {
  it('consumes once, refuses a second consumption, and refuses an approval the store does not hold', async () => {
    const { store } = await mounted(undefined)
    const { agent } = fakeAgent()
    const session: Session = agent.session
    const viewer = approvalViewerOf(session)
    store.request({
      id: ApprovalRequestId('a-1'), tenant: viewer.tenant, actor: viewer.principal, scope: { kind: 'turn', sessionId: session.id },
      toolName: 'fs.write', requestDigest: 'sha256:x', deadlineMs: Date.now() + 60_000,
    }, Date.now())
    recordApprovalOutcome(store, ApprovalRequestId('a-1'), 'allowed-once', session, Date.now())
    expect(consumeRecordedApproval(store, session, ApprovalRequestId('a-1'), Date.now())).toBeUndefined()
    expect(consumeRecordedApproval(store, session, ApprovalRequestId('a-1'), Date.now())).toBe('invalid-transition')
    expect(consumeRecordedApproval(store, session, ApprovalRequestId('missing'), Date.now())).toBe('not-found')
    expect(consumeRecordedApproval(undefined, session, ApprovalRequestId('a-1'), Date.now())).toBeUndefined()
  })

  it('leaves an outcome for an approval the store does not hold, and counts only the revocations it made', async () => {
    const { store } = await mounted(undefined)
    const { agent } = fakeAgent()
    recordApprovalOutcome(store, ApprovalRequestId('missing'), 'rejected', agent.session, Date.now())
    expect(store.listPending(approvalViewerOf(agent.session), Date.now())).toEqual([])
    expect(revokeTurnApprovals(store, agent.session, Date.now())).toBe(0)
  })
})

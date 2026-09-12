/**
 * P2-06 Provider: where a binding is MADE, and what the log carries about it.
 *
 * The Contract stage's binder and verifier are pure functions over values. This
 * file is about the mounted service: that a binding is minted at the ASK rather
 * than at the decision, that the durable record carries every bound field a
 * re-verification must compare and the arguments only as a digest, and that an
 * ask with no tuple behind it records no binding rather than an empty one.
 *
 * The clock is the ASKER's throughout. The service owns none, for the reason
 * `dsh-lease-contract` states one layer over: a decision function that reads the
 * wall clock cannot be tested for expiry without waiting for it.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PrincipalId } from '@deepseek-ai/dsh-principal/types'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ApprovalService, { verifyApprovalBinding } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalBindingInputs, ApprovalRequest } from '@deepseek-ai/dsh-user-approval/types'

const ALICE = brandString<PrincipalId>('user-alice')
const BOB = brandString<PrincipalId>('user-bob')
const ASKED_AT = 1_700_000_000_000

/** One mounted service; `validityMs` is a row's configuration, not a constant. */
async function mounted(approvalValidityMs?: number): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ApprovalService, approvalValidityMs === undefined ? {} : { approvalValidityMs })
  return ctx
}

/** A minimal Agent whose session records what was appended, seeded inside an open turn. */
function fakeAgent(): { agent: Agent; appended: { type: string; data: Record<string, unknown> }[] } {
  const appended: { type: string; data: Record<string, unknown> }[] = []
  const events: { type: string; data?: Record<string, unknown> }[] = [{ type: 'turn/start' }, { type: 'user/message' }]
  const agent = {
    session: {
      get seq() { return events.length },
      eventAt: (seq: number) => events[seq],
      append: (type: string, data: Record<string, unknown>) => {
        const event = { type, data }
        events.push(event)
        appended.push(event)
        return event as unknown as SessionEvent
      },
    },
  } as unknown as Agent
  return { agent, appended }
}

/** The tuple an asker supplies; each case varies one field away from it. */
function inputs(over: Partial<ApprovalBindingInputs> = {}): ApprovalBindingInputs {
  return {
    action: 'fs.write',
    args: { path: 'workspace/a.ts', contents: 'one' },
    principal: ALICE,
    preconditions: ['workspace is trusted'],
    capabilityToken: 'token-digest-1',
    policyVersion: 'policy-v1',
    ...over,
  }
}

function requestOf(agent: Agent, over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return { agent, toolName: 'fs.write', ...over }
}

/** The one `approval/bound` record in a log, or undefined. */
function boundRecord(appended: { type: string; data: Record<string, unknown> }[]): Record<string, unknown> | undefined {
  const found = appended.filter(event => event.type === 'approval/bound')
  expect(found.length).toBeLessThanOrEqual(1)
  return found[0]?.data
}

describe('P2-06 must[1]: the service binds at the ASK, from the asker\'s clock', () => {
  it('records a binding when the asker supplies a tuple', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    await ctx.approval.request(requestOf(agent, { binding: { inputs: inputs(), askedAtMs: ASKED_AT } }))
    expect(boundRecord(appended)).toMatchObject({ action: 'fs.write', principal: ALICE })
  })

  it('records NOTHING when the asker supplies none, rather than an empty binding', async () => {
    // A workspace-trust question decides about a directory and has no canonical
    // arguments; an empty binding would claim it was bound to nothing, which a
    // later reader cannot tell from "bound to the empty tuple".
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    await ctx.approval.request(requestOf(agent, { toolName: 'workspace-trust' }))
    expect(boundRecord(appended)).toBeUndefined()
  })

  it('appends the binding between the ask and the decision', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    await ctx.approval.request(requestOf(agent, { binding: { inputs: inputs(), askedAtMs: ASKED_AT } }))
    expect(appended.map(event => event.type)).toEqual(['approval/asked', 'approval/bound', 'approval/decided'])
  })

  it('records the tuple as it stood at the ASK, even when the world moves while a human reads', async () => {
    // The case the ordering assertion above cannot make. Event order alone does
    // not distinguish "bound at the ask" from "bound after the answerer
    // returned": both land between `asked` and `decided`. What distinguishes
    // them is WHEN the values are read, so an answerer changes the caller's
    // tuple mid-decision and the record must still show the original.
    //
    // Measured the hard way: a first version asserted only the order, a
    // mutation moving the bind past the decision left all twelve cases green,
    // and the prose claimed it closed acceptance[0]'s window.
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    const live = inputs()
    ctx.on('approval/request', () => {
      // A human takes time; the account switches underneath while they read.
      Object.assign(live, { principal: BOB })
      return Promise.resolve<'rejected'>('rejected')
    })
    await ctx.approval.request(requestOf(agent, { binding: { inputs: live, askedAtMs: ASKED_AT } }))
    expect(boundRecord(appended)?.principal).toBe(ALICE)
  })

  it('expires from the ASKER\'s clock plus the configured duration, not from the service\'s', async () => {
    const ctx = await mounted(60_000)
    const { agent, appended } = fakeAgent()
    await ctx.approval.request(requestOf(agent, { binding: { inputs: inputs(), askedAtMs: ASKED_AT } }))
    expect(boundRecord(appended)?.expiresAtMs).toBe(ASKED_AT + 60_000)
  })

  it('takes the duration from the row\'s configuration, so two deployments differ', async () => {
    const strict = await mounted(1_000)
    const relaxed = await mounted(3_600_000)
    const a = fakeAgent()
    const b = fakeAgent()
    await strict.approval.request(requestOf(a.agent, { binding: { inputs: inputs(), askedAtMs: ASKED_AT } }))
    await relaxed.approval.request(requestOf(b.agent, { binding: { inputs: inputs(), askedAtMs: ASKED_AT } }))
    expect(boundRecord(a.appended)?.expiresAtMs).toBe(ASKED_AT + 1_000)
    expect(boundRecord(b.appended)?.expiresAtMs).toBe(ASKED_AT + 3_600_000)
  })
})

describe('P2-06 acceptance[1]: the record carries the digest, never the arguments', () => {
  it('puts no argument value in the durable record', async () => {
    // The record is replayed by later readers; the arguments are what a
    // redacted display exists to keep out of sight, so writing them here would
    // put the secret in the log the redaction protects.
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    await ctx.approval.request(requestOf(agent, {
      binding: { inputs: inputs({ args: { token: 'secret-alpha' } }), askedAtMs: ASKED_AT },
    }))
    expect(JSON.stringify(boundRecord(appended))).not.toContain('secret-alpha')
  })

  it('still distinguishes two different argument values through the digest', async () => {
    // The control for the case above: dropping the arguments must not drop the
    // ability to tell them apart, or the record could not support a
    // re-verification at all.
    const ctx = await mounted()
    const one = fakeAgent()
    const two = fakeAgent()
    await ctx.approval.request(requestOf(one.agent, {
      binding: { inputs: inputs({ args: { token: 'secret-alpha' } }), askedAtMs: ASKED_AT },
    }))
    await ctx.approval.request(requestOf(two.agent, {
      binding: { inputs: inputs({ args: { token: 'secret-beta' } }), askedAtMs: ASKED_AT },
    }))
    expect(boundRecord(one.appended)?.digest).not.toBe(boundRecord(two.appended)?.digest)
  })

  it('carries every OTHER bound field whole, so a refusal can name which one moved', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    await ctx.approval.request(requestOf(agent, { binding: { inputs: inputs(), askedAtMs: ASKED_AT } }))
    expect(boundRecord(appended)).toMatchObject({
      action: 'fs.write',
      principal: ALICE,
      preconditions: ['workspace is trusted'],
      capabilityToken: 'token-digest-1',
      policyVersion: 'policy-v1',
    })
  })

  it('omits an absent token and an absent policy version rather than writing a placeholder', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    await ctx.approval.request(requestOf(agent, {
      binding: { inputs: { ...inputs(), capabilityToken: undefined, policyVersion: undefined }, askedAtMs: ASKED_AT },
    }))
    const record = boundRecord(appended)
    expect(record).not.toHaveProperty('capabilityToken')
    expect(record).not.toHaveProperty('policyVersion')
  })
})

describe('P2-06 acceptance[2]: the record is the one-to-one reference', () => {
  it('names the approval and the action in one record, exactly one per bound ask', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    await ctx.approval.request(requestOf(agent, { binding: { inputs: inputs(), askedAtMs: ASKED_AT } }))
    const asked = appended.find(event => event.type === 'approval/asked')?.data
    const decided = appended.find(event => event.type === 'approval/decided')?.data
    const bound = boundRecord(appended)
    // One id across all three, so the action reaches its approval and the
    // approval reaches its outcome without scanning.
    expect(bound?.id).toBe(asked?.id)
    expect(bound?.id).toBe(decided?.id)
    expect(bound?.action).toBe('fs.write')
  })

  it('gives two asks two ids, so one action\'s two approvals stay distinguishable', async () => {
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    await ctx.approval.request(requestOf(agent, { binding: { inputs: inputs(), askedAtMs: ASKED_AT } }))
    await ctx.approval.request(requestOf(agent, { binding: { inputs: inputs(), askedAtMs: ASKED_AT } }))
    const ids = appended.filter(event => event.type === 'approval/bound').map(event => event.data.id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})

describe('P2-06 acceptance[0]: what the record supports is a real re-verification', () => {
  it('refuses the substituted account when the recorded fields are read back from the log', async () => {
    // The end-to-end shape of the clause, through the service rather than
    // through the pure function: bind at the ask, change the world, verify.
    const ctx = await mounted()
    const { agent, appended } = fakeAgent()
    await ctx.approval.request(requestOf(agent, { binding: { inputs: inputs(), askedAtMs: ASKED_AT } }))
    const record = boundRecord(appended)

    const recovered = {
      inputs: {
        action: record?.action as string,
        args: inputs().args,
        principal: record?.principal as ApprovalBindingInputs['principal'],
        preconditions: record?.preconditions as readonly string[],
        capabilityToken: record?.capabilityToken as string,
        policyVersion: record?.policyVersion as string,
      },
      digest: record?.digest as never,
      expiresAtMs: record?.expiresAtMs as number,
    }
    expect(verifyApprovalBinding(recovered, inputs({ principal: BOB }), ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'principal' })
    // And the control: the unchanged tuple still verifies against the same
    // recovered binding, so the refusal above is about the substitution.
    expect(verifyApprovalBinding(recovered, inputs(), ASKED_AT + 1)).toEqual({ valid: true })
  })
})

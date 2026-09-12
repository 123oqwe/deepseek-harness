/**
 * P2-06 Usage: the dispatch path supplies a binding when it asks, and refuses
 * before running when the recorded decision no longer covers the call.
 *
 * The recorded side always comes from the SESSION and the present side from the
 * dispatch. A path that rebuilt the recorded tuple from the values it is about
 * to run would compare a value against itself, admit every substitution, and
 * pass any case written against it — so no case here derives both sides from
 * one object.
 *
 * What is NOT here: which gate asks. That the risk gate is the one that binds is
 * a decision recorded in `preflight-P2-06-U.md`, measured over 94 recorded
 * fixtures in which no subject is ever asked twice.
 */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PrincipalId } from '@deepseek-ai/dsh-principal/types'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import type { RiskClass } from '@deepseek-ai/dsh-risk-taxonomy'
import { gateActionRisk, verifyRecordedApproval } from '../src/external-effect.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { PreToolDecision } from '../src/index.ts'
import ToolRegistry, { defineTool } from '../src/index.ts'
import type { ApprovalBindingInputs } from '@deepseek-ai/dsh-user-approval/types'

const ALICE = brandString<PrincipalId>('user-alice')
const BOB = brandString<PrincipalId>('user-bob')
const ASKED_AT = 1_700_000_000_000
const EXPIRES_AT = ASKED_AT + 60_000

/** The tuple the decider saw, as the dispatch path built it. */
function decided(over: Partial<ApprovalBindingInputs> = {}): ApprovalBindingInputs {
  return {
    action: 'fs.write',
    args: { path: 'workspace/a.ts', contents: 'one' },
    principal: ALICE,
    preconditions: [],
    ...over,
  }
}

/**
 * An agent whose session holds the records given, read the way the verifier
 * reads a real one.
 * @param records - the `approval/bound` payloads already in the log, in order.
 * @returns the agent.
 */
function agentWith(records: Record<string, unknown>[]): Agent {
  const events = records.map(data => ({ type: 'approval/bound', data }))
  return {
    session: {
      get seq() { return events.length },
      eventAt: (seq: number) => events[seq] as unknown as SessionEvent,
    },
  } as unknown as Agent
}

/** The record the service would have written for `inputs`, digested the same way. */
function recordFor(inputs: ApprovalBindingInputs, digest: string, expiresAtMs = EXPIRES_AT): Record<string, unknown> {
  return {
    id: 'approval-1',
    action: inputs.action,
    digest,
    principal: inputs.principal,
    preconditions: inputs.preconditions,
    expiresAtMs,
  }
}

/** The digest the service computes for a tuple, taken from the real binder. */
async function digestOf(inputs: ApprovalBindingInputs): Promise<string> {
  const { approvalBindingDigest } = await import('@deepseek-ai/dsh-user-approval/canonical')
  return approvalBindingDigest(inputs)
}

describe('P2-06 must[1]: the dispatch re-verifies what the session recorded', () => {
  it('admits the call when the recorded binding still covers it — the control', async () => {
    const inputs = decided()
    const agent = agentWith([recordFor(inputs, await digestOf(inputs))])
    expect(verifyRecordedApproval(agent, inputs, ASKED_AT + 1)).toBeUndefined()
  })

  it('admits when the session recorded NO binding, because an unbound ask is not a refused one', () => {
    // The registry's own ask carries no tuple (no manifest at that layer), and
    // a session with no record must dispatch exactly as it did before this
    // epic rather than refusing everything.
    expect(verifyRecordedApproval(agentWith([]), decided(), ASKED_AT + 1)).toBeUndefined()
  })

  it('refuses substituted arguments, naming the field', async () => {
    // Recorded from one tuple, dispatched with another: the digest in the log
    // does not move with the substitution, which is the whole mechanism.
    const inputs = decided()
    const agent = agentWith([recordFor(inputs, await digestOf(inputs))])
    const substituted = decided({ args: { path: 'workspace/a.ts', contents: 'two' } })
    expect(verifyRecordedApproval(agent, substituted, ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'arguments' })
  })

  it('refuses a switched account', async () => {
    const inputs = decided()
    const agent = agentWith([recordFor(inputs, await digestOf(inputs))])
    expect(verifyRecordedApproval(agent, decided({ principal: BOB }), ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'principal' })
  })

  it('refuses after the validity period, naming both instants', async () => {
    const inputs = decided()
    const agent = agentWith([recordFor(inputs, await digestOf(inputs))])
    expect(verifyRecordedApproval(agent, inputs, EXPIRES_AT))
      .toEqual({ valid: false, reason: 'expired', expiresAtMs: EXPIRES_AT, now: EXPIRES_AT })
  })

  it('ignores a binding for a DIFFERENT action, so one call is not gated by another\'s decision', async () => {
    const other = decided({ action: 'fs.delete' })
    const agent = agentWith([recordFor(other, await digestOf(other))])
    expect(verifyRecordedApproval(agent, decided(), ASKED_AT + 1)).toBeUndefined()
  })

  it('reads the LATEST binding for the action, because a re-ask supersedes the one before it', async () => {
    // A refused call that is asked again records a second binding; the decision
    // in force is the newer one, and reading the first would enforce a decision
    // the operator has already replaced.
    const stale = decided({ args: { path: 'workspace/a.ts', contents: 'one' } })
    const fresh = decided({ args: { path: 'workspace/a.ts', contents: 'two' } })
    const agent = agentWith([
      recordFor(stale, await digestOf(stale)),
      recordFor(fresh, await digestOf(fresh)),
    ])
    expect(verifyRecordedApproval(agent, fresh, ASKED_AT + 1)).toBeUndefined()
    expect(verifyRecordedApproval(agent, stale, ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'arguments' })
  })
})

describe('P2-06 acceptance[2]: one dispatch records exactly ONE binding', () => {
  /** The real gate over a real approval service, so the count is of production appends. */
  async function composed(approvalThreshold: RiskClass = 'read'): Promise<{ ctx: Context; agent: Agent; bound: () => number }> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(ToolRegistry, {})
    ctx.provide('shell', {
      sandboxMode: 'workspace-write',
      resolve() { throw new Error('binding tests do not execute bash') },
      run() { throw new Error('binding tests do not execute bash') },
      start() { throw new Error('binding tests do not execute bash') },
    })
    // The REAL approval service, with an answerer composed the way a surface
    // composes one. Providing a fake service instead would mean the binding
    // under test was written by the stand-in rather than by production code.
    await ctx.plugin(ApprovalService, {})
    ctx.on('approval/request', () => Promise.resolve<'allowed-once'>('allowed-once'))
    await ctx.plugin(PermissionPresetService, {
      riskRules: [{ domainTag: 'shell-execute', riskClass: 'internal-write' }],
      presets: { 'workspace-write': { sandbox: 'workspace-write', approval: 'ask', approvalThreshold } },
      defaultPreset: 'workspace-write',
    })
    const session = ctx.sessions.create(SessionId('approval-binding'))
    session.append('turn/start', { turn: 1 })
    const agent = { id: session.id, session } as unknown as Agent
    const bound = (): number => {
      let count = 0
      for (let index = 0; index < session.seq; index += 1) {
        if (session.eventAt(SessionSeq(index))?.type === 'approval/bound') count += 1
      }
      return count
    }
    return { ctx, agent, bound }
  }

  it('records ONE binding for one gated dispatch — counted, not merely present', async () => {
    // Counting is the assertion acceptance[2] needs. "A binding exists" stays
    // true when two gates each record one, and two bindings for one action make
    // the one-to-one reference unanswerable: nothing distinguishes them.
    const { ctx, agent, bound } = await composed()
    await gateActionRisk(ctx, agent, 'bash', ['shell-execute'], undefined, {
      inputs: decided({ action: 'bash' }),
      askedAtMs: ASKED_AT,
    })
    expect(bound()).toBe(1)
  })

  it('records ONE even when BOTH gates ask about the same dispatch', async () => {
    // The count that makes the claim about ACTIONS rather than about one gate.
    // The registry's own `serviceAsk` fires when a `tools/pre-execute` listener
    // returns `ask`; the risk gate fires on the preset's threshold. A dispatch
    // that trips both must still record ONE binding, because two bindings for
    // one action make acceptance[2]'s one-to-one reference unanswerable —
    // nothing in the log distinguishes them.
    //
    // Measured the hard way: a first version of this block drove only
    // `gateActionRisk`, so the mutation that makes the registry gate bind too
    // left it green. A case that cannot see the second gate cannot be the case
    // that counts them.
    const { ctx, agent, bound } = await composed()
    ctx.tools.register(defineTool({
      name: 'bash',
      description: 'a tool both gates ask about',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: () => Promise.resolve('ok'),
    }))
    ctx.on('tools/pre-execute', () => Promise.resolve<PreToolDecision>({ kind: 'ask', reason: 'the hook asks' }))
    await gateActionRisk(ctx, agent, 'bash', ['shell-execute'], undefined, {
      inputs: decided({ action: 'bash' }),
      askedAtMs: ASKED_AT,
    })
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('c1'),
      name: 'bash',
      arguments: {},
      agent,
    })
    expect(bound()).toBe(1)
  })

  it('records NONE when the gate does not ask, so a binding never outlives its question', async () => {
    // The control for the count above: an action below the threshold is not
    // asked about, and an unasked action must record no decision at all.
    // The same gate, the same binding, a preset whose threshold this action
    // does not reach — so no question is asked and no decision exists to record.
    const { ctx, agent, bound } = await composed('safety-critical')
    await gateActionRisk(ctx, agent, 'bash', ['shell-execute'], undefined, {
      inputs: decided({ action: 'bash' }),
      askedAtMs: ASKED_AT,
    })
    expect(bound()).toBe(0)
  })
})

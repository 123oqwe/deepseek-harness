/**
 * P2-06 F: the fault matrix at the binding layer, plus the one-to-one
 * reference acceptance[2] names (Epic P2-06, F stage).
 *
 * The file carries the stage's registry name. Its subject is what a
 * SUBSTITUTION changes — a matrix organised around a list of attacks leaves a
 * dimension of the bound tuple that no case ever moves, which is the defect this
 * stage exists to prevent.
 *
 * What is NOT here: the dispatch paths. Whether the native and code-mode
 * dispatches reach this layer at all is proved where those paths run, because a
 * case that calls the verifier directly proves the verifier and says nothing
 * about who calls it.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import ApprovalService, { bindApproval, verifyApprovalBinding } from '../src/index.ts'
import type { ApprovalBindingInputs } from '../src/types.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PrincipalId } from '@deepseek-ai/dsh-principal/types'

const ASKED_AT = 1_700_000_000_000
const EXPIRES_AT = ASKED_AT + 60_000

/** The tuple a decider saw, as a dispatch path builds it. */
function decided(over: Partial<ApprovalBindingInputs> = {}): ApprovalBindingInputs {
  return { action: 'fs.write', args: { path: 'a.ts' }, principal: brandString<PrincipalId>('user-alice'), preconditions: [], ...over }
}

/** Whether an approval bound to `left` still authorizes a dispatch of `right`. */
function admits(left: ApprovalBindingInputs, right: ApprovalBindingInputs): boolean {
  return verifyApprovalBinding(bindApproval(left, EXPIRES_AT), right, ASKED_AT + 1).valid
}

describe('P2-06 validation[1]: a Unicode confusable is two values, not one', () => {
  it('refuses a DECOMPOSED spelling of the approved name, because the canonical form preserves the form it was given', () => {
    // The row passes BECAUSE P2-03's canonical form does not normalize. It once
    // did: NFC folding meant precomposed and decomposed spellings of one
    // character produced a single hash, so an approval bound to that hash for
    // one file authorized a write to the other (corrected 2026-09-06). This
    // case is a regression guard on that correction as much as on this epic.
    const composed = decided({ args: { path: 'résumé.txt' } as JsonValue })
    const decomposed = decided({ args: { path: 'résumé.txt' } as JsonValue })
    expect(composed.args).not.toEqual(decomposed.args)
    expect(admits(composed, decomposed)).toBe(false)
  })

  it('refuses a HOMOGLYPH substitution, where the rendered name is the one a human read', () => {
    // A Cyrillic `а` for a Latin `a`: the decider read `data.txt` and the
    // dispatch names a different file that renders identically.
    const latin = decided({ args: { path: 'data.txt' } as JsonValue })
    const cyrillic = decided({ args: { path: 'dаta.txt' } as JsonValue })
    expect(admits(latin, cyrillic)).toBe(false)
  })

  it('ADMITS the identical spelling, so the two refusals above are about the characters and not about refusing everything', () => {
    const one = decided({ args: { path: 'résumé.txt' } as JsonValue })
    expect(admits(one, decided({ args: { path: 'résumé.txt' } as JsonValue }))).toBe(true)
  })
})

describe('P2-06 validation[1]: batch mutation — one decision does not travel to a sibling call', () => {
  it('refuses the SECOND call of a batch when it was approved for the first', () => {
    // One assistant message, two calls to the same tool with different
    // arguments. The tool NAME is equal, which is what makes this harder than
    // the case separating two different tools.
    const first = decided({ args: { path: 'a.ts' } })
    const second = decided({ args: { path: 'b.ts' } as JsonValue })
    expect(admits(first, second)).toBe(false)
    // And the first is still admitted by its own decision: a batch case that
    // only asserts "a refusal happened" passes when the path refuses both.
    expect(admits(first, first)).toBe(true)
  })
})

describe('P2-06 acceptance[2]/validation[3]: an action names its approval', () => {
  /** A session with the real service mounted, so the record is production's. */
  async function composed(): Promise<{ ctx: Context; agent: Agent }> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(ApprovalService, {})
    ctx.on('approval/request', () => Promise.resolve<'allowed-once'>('allowed-once'))
    const session = ctx.sessions.create(SessionId('approval-reference'))
    session.append('turn/start', { turn: 1 })
    return { ctx, agent: { id: session.id, session } as unknown as Agent }
  }

  it('records the dispatch\'s ActionId on the binding, so an audit query has a field to travel on', async () => {
    // Without this the record carries the tool NAME, and two `fs.write` calls
    // in one session are indistinguishable in the log. Counting one binding per
    // dispatch — which the Usage stage proved — makes a one-to-one reference
    // POSSIBLE; it does not make one exist.
    const { ctx, agent } = await composed()
    await ctx.approval.request({
      agent,
      toolName: 'fs.write',
      binding: { inputs: decided(), askedAtMs: ASKED_AT, actionId: 'call-7' },
    })

    const bound = agent.session.snapshotEvents().filter(event => event.type === 'approval/bound')
    expect(bound).toHaveLength(1)
    expect((bound[0]!.data as { actionId?: string }).actionId).toBe('call-7')
  })

  it('gives two calls of ONE tool two distinguishable records, which is the whole point of the field', async () => {
    const { ctx, agent } = await composed()
    await ctx.approval.request({ agent, toolName: 'fs.write', binding: { inputs: decided({ args: { path: 'a.ts' } }), askedAtMs: ASKED_AT, actionId: 'call-1' } })
    await ctx.approval.request({ agent, toolName: 'fs.write', binding: { inputs: decided({ args: { path: 'b.ts' } as JsonValue }), askedAtMs: ASKED_AT, actionId: 'call-2' } })

    const ids = agent.session.snapshotEvents()
      .filter(event => event.type === 'approval/bound')
      .map(event => (event.data as { actionId?: string }).actionId)
    expect(ids).toEqual(['call-1', 'call-2'])
    // The reverse query acceptance[2] names: from an action, exactly one approval.
    const forCall2 = agent.session.snapshotEvents()
      .filter(event => event.type === 'approval/bound' && (event.data as { actionId?: string }).actionId === 'call-2')
    expect(forCall2).toHaveLength(1)
  })

  it('records NO actionId when the asker supplies none, so an ask with no dispatch behind it is not given a fake identity', async () => {
    // `workspace-trust` decides about a directory and has no ActionId. Filling
    // one in would put a value in the audit log that names no action.
    const { ctx, agent } = await composed()
    await ctx.approval.request({ agent, toolName: 'workspace-trust', binding: { inputs: decided({ action: 'workspace-trust' }), askedAtMs: ASKED_AT } })

    const bound = agent.session.snapshotEvents().filter(event => event.type === 'approval/bound')
    expect(bound).toHaveLength(1)
    expect((bound[0]!.data as { actionId?: string }).actionId).toBeUndefined()
  })
})

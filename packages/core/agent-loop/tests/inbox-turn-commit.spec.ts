/**
 * P4-06 must[2]'s agent-inbox half (the ACCEPTANCE LOCK's clause (a),
 * BLOCKED-088): a message a turn claimed is consumed when that turn ends, not
 * when it is claimed. A claim whose turn never ran — a goal driver's stale
 * reservation, restored into the inbox by `restoreOtherClaimed` — leaves the
 * message deliverable, and only a consumed `(source, id, epoch)` is refused.
 *
 * Mounted the way `arrival-dedup.spec.ts` mounts it: one session store, one
 * projection registry, one `ReactLoopInbox`. A turn's bounds are the session's
 * own `turn/start` and `turn/end` events, as the agent loop records them. The
 * keyed message is a subagent settlement, the one source that carries an
 * arrival key today; the control message carries none, as a goal driver's own
 * messages do.
 */
import { Context } from '@deepseek-ai/cordis'
import { DuplicateArrivalError, type AgentEventDispatch } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import { ReactLoopInbox } from '../src/inbox.ts'

// ReactLoopInbox only publishes through `emit`; these cases observe durable
// state, so live notifications go nowhere.
const SILENT = { emit: () => {} } as unknown as AgentEventDispatch

/**
 * A fresh session store and projection registry holding one inbox.
 * @param rawId - the session id.
 * @returns the session and its inbox.
 */
async function mountInbox(rawId: string): Promise<{ session: Session; inbox: ReactLoopInbox }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const session = ctx.sessions.create(SessionId(rawId))
  return { session, inbox: new ReactLoopInbox(ctx.sessionProjections, session, SILENT) }
}

/**
 * One settlement notice as `dsh-subagent`'s manager builds it, keyed by the child and its epoch.
 * @param child - the settling child's session id.
 * @param epoch - the child's activation.
 * @returns the message.
 */
function settlement(child: string, epoch: number) {
  return createUserMessage({
    content: [{ type: 'text', text: 'the child settled' }],
    source: {
      kind: 'subagent-settled' as const,
      form: 'notice' as const,
      summary: 'the child settled',
      senderSessionId: SessionId(child),
      senderEpoch: epoch,
    },
  })
}

describe('P4-06 must[2] (agent inbox): a claimed message is consumed when its turn ends, not when it is claimed', () => {
  it('control: a message with no arrival key, claimed by a turn that never ran, is restored as a goal driver restores it', async () => {
    const { session, inbox } = await mountInbox('agent')
    session.append('turn/start', { turn: 1 })
    const message = createUserMessage({ content: [{ type: 'text', text: 'goal step context' }], source: { kind: 'user' } })
    inbox.append('next-step', message)
    const [claimed] = inbox.claim('next-step', 1)
    if (claimed === undefined) throw new Error('the claim returned nothing')
    inbox.prepend('next-step', claimed)
    expect(inbox.nextStep.map(pending => pending.id)).toEqual([claimed.id])
  })

  it('a subagent settlement claimed by a turn that never ran is restored and stays deliverable', async () => {
    const { session, inbox } = await mountInbox('agent')
    session.append('turn/start', { turn: 1 })
    inbox.append('next-step', settlement('child-a', 3))
    const [claimed] = inbox.claim('next-step', 1)
    if (claimed === undefined) throw new Error('the claim returned nothing')
    expect(() => { inbox.prepend('next-step', claimed) }).not.toThrow()
    expect(inbox.nextStep.map(pending => pending.id)).toEqual([claimed.id])
  })

  it('control: once the claiming turn has ended, the same settlement redelivered is refused', async () => {
    const { session, inbox } = await mountInbox('agent')
    session.append('turn/start', { turn: 1 })
    inbox.append('next-step', settlement('child-a', 3))
    expect(inbox.claim('next-step', 1)).toHaveLength(1)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(() => { inbox.append('next-step', settlement('child-a', 3)) }).toThrow(DuplicateArrivalError)
  })
})

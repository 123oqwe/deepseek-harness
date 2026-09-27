/**
 * At-least-once delivery into an agent inbox, made effective-once by the
 * consumer (Epic P4-06 must[2], acceptance[0]).
 *
 * **The transport does not promise exactly-once and this does not pretend it
 * does.** A settlement notice can be delivered twice — the manager retries, a
 * crash replays, a watcher fires again — and the rule that makes the second
 * one harmless is the consumer's: key the arrival `(source, id, epoch)` and
 * refuse a key already consumed.
 *
 * Two thirds of the triple are distinguished here. `id` is the sender's own
 * stable identity rather than the message's — a fresh message id per delivery
 * would key a redelivery differently from the delivery it repeats and refuse
 * nothing — and `epoch` separates a redelivery from a genuine second
 * settlement of the same child. The `source` third is NOT distinguished at
 * this consumer, measured rather than assumed: replacing it with a constant
 * reddens no case here, because every sender that reaches this inbox with an
 * epoch is a `subagent-settled` notice today. Its own coverage lives in
 * `packages/collaboration/intake-dedup`, where two sources exist.
 */
import { Context } from '@deepseek-ai/cordis'
import { DuplicateArrivalError, type AgentEventDispatch } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { interruptedTurnClosers, SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import { ReactLoopInbox } from '../src/inbox.ts'

// ReactLoopInbox only publishes through `emit`; these cases observe durable
// state, so live notifications go nowhere.
const SILENT = { emit: () => {} } as unknown as AgentEventDispatch

/** A fresh session store and projection registry holding one inbox. */
async function mountInbox(rawId: string): Promise<{ ctx: Context; session: Session; inbox: ReactLoopInbox }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const session = ctx.sessions.create(SessionId(rawId))
  return { ctx, session, inbox: new ReactLoopInbox(ctx.sessionProjections, session, SILENT) }
}

/** One settlement notice as `dsh-subagent`'s manager builds it. */
function settlement(child: string, epoch: number | undefined, text = 'the child settled') {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'subagent-settled' as const,
      form: 'notice' as const,
      summary: text,
      senderSessionId: SessionId(child),
      ...epoch === undefined ? {} : { senderEpoch: epoch },
    },
  })
}

describe('P5-10 must[1]: a claimed batch leaves the queue by control priority', () => {
  /** One ordinary message, as `steer`/`inject`/`followup` each carry. */
  const input = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

  it('promotes a CANCEL over everything and leaves the rest in arrival order (§12.37)', async () => {
    // The dequeue point is where every producer converges — a user steering, a
    // team injecting, a driver continuing — and each inserted through a
    // different call. A router only ever orders what was routed through it,
    // which is why §12.25-1 put this here.
    //
    // Only the cancel moves. An earlier version of this case ranked all five
    // kinds and expected `steer` ahead of an `inject` that had already
    // arrived; that is a claim about CONTENT order rather than about a
    // conflict between decisions, and it reversed two real cases in
    // `dsh-experimental-agent-team` whose reading — context first, then the
    // follow-up that wakes on it — is the correct one.
    const { inbox } = await mountInbox('agent')
    inbox.append('next-step', input('injected'), 'inject')
    inbox.append('next-step', input('steered'), 'steer')
    inbox.append('next-step', input('cancelling'), 'cancel')

    expect(inbox.claim('next-step', 1).map(message => message.content[0]))
      .toEqual([
        { type: 'text', text: 'cancelling' },
        { type: 'text', text: 'injected' },
        { type: 'text', text: 'steered' },
      ])
  })

  it('keeps ARRIVAL order within one kind, so the table decides between kinds and nothing else', async () => {
    const { inbox } = await mountInbox('agent')
    inbox.append('next-step', input('first steer'), 'steer')
    inbox.append('next-step', input('second steer'), 'steer')

    expect(inbox.claim('next-step', 1).map(message => message.content[0]))
      .toEqual([{ type: 'text', text: 'first steer' }, { type: 'text', text: 'second steer' }])
  })

  it('keeps a message with NO control kind in arrival order beside the control messages (§12.37)', async () => {
    // Ordinary input is not a control message, and it is not demoted either:
    // a prompt that arrived before a steer is still the earlier message, and
    // moving it after would change what the model reads without any decision
    // having been made. Only a cancel is promoted.
    const { inbox } = await mountInbox('agent')
    inbox.append('next-step', input('plain one'))
    inbox.append('next-step', input('steered'), 'steer')
    inbox.append('next-step', input('plain two'))

    expect(inbox.claim('next-step', 1).map(message => message.content[0]))
      .toEqual([
        { type: 'text', text: 'plain one' },
        { type: 'text', text: 'steered' },
        { type: 'text', text: 'plain two' },
      ])
  })

  it('promotes a cancel PAST ordinary input too, so a stop is never queued behind a prompt', async () => {
    // The half that says "arrival order for everything else" is not the same
    // as "no ordering at all".
    const { inbox } = await mountInbox('agent')
    inbox.append('next-step', input('plain one'))
    inbox.append('next-step', input('cancelling'), 'cancel')

    expect(inbox.claim('next-step', 1).map(message => message.content[0]))
      .toEqual([
        { type: 'text', text: 'cancelling' },
        { type: 'text', text: 'plain one' },
      ])
  })
})

describe('P4-06 must[2]: an inbox consumes one (source, id, epoch) once', () => {
  it('REFUSES a settlement redelivered after the parent already ran it', async () => {
    // acceptance[0]'s consumer half. The first notice is claimed — run — and
    // the second arrival of the same activation must not reach the model
    // again. Pending-identity rejection cannot cover this: by the time the
    // redelivery arrives the first is no longer pending.
    const { session, inbox } = await mountInbox('parent')
    session.append('turn/start', { turn: 1 })
    inbox.append('next-step', settlement('child-a', 3))
    expect(inbox.claim('next-step', 1)).toHaveLength(1)
    // The key is consumed when the claiming turn ENDS (B-619), not at the claim.
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    expect(() => { inbox.append('next-step', settlement('child-a', 3)) })
      .toThrow(DuplicateArrivalError)
    expect(inbox.hasPending).toBe(false)
  })

  it('ADMITS a settlement from the same child in a LATER epoch, so a second activation is not suppressed', async () => {
    // The positive control the refusal needs, and the reason the epoch is in
    // the key at all: one child session can be activated more than once, and
    // "this child settled again" must not look like "this notice again".
    const { session, inbox } = await mountInbox('parent')
    session.append('turn/start', { turn: 1 })
    inbox.append('next-step', settlement('child-a', 3))
    inbox.claim('next-step', 1)
    // The key is consumed when the claiming turn ENDS (B-619), not at the claim,
    // so end it before the later-epoch settlement — otherwise the first key is
    // only claimed and the epoch never has to tell the second from a redelivery.
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    inbox.append('next-step', settlement('child-a', 4))
    expect(inbox.nextStep).toHaveLength(1)
  })

  it('ADMITS a settlement from a DIFFERENT child in the same epoch, so one child cannot suppress another', async () => {
    // BLOCKED-140's shape, one level up: two children activated the same
    // number of times must not share a key, or the second child's settlement
    // vanishes as a duplicate of the first's.
    //
    // This varies the `id`, NOT the `source` — measured: replacing the source
    // component with a constant reddens nothing here, because every sender
    // reaching this inbox with an epoch is a `subagent-settled` notice today.
    // The source third of the triple therefore has no distinguishing case at
    // this consumer, and saying so is better than a case that reads as if it
    // did. `packages/collaboration/intake-dedup` covers the component itself,
    // where two sources exist.
    const { session, inbox } = await mountInbox('parent')
    session.append('turn/start', { turn: 1 })
    inbox.append('next-step', settlement('child-a', 3))
    inbox.claim('next-step', 1)
    // Consumed at turn end (B-619), so the second child's settlement is admitted
    // against a really-consumed first key rather than a merely-claimed one.
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    inbox.append('next-step', settlement('child-b', 3))
    expect(inbox.nextStep).toHaveLength(1)
  })

  it('does NOT consume a key for a message that was CANCELLED rather than run', async () => {
    // A cancellation removes messages too, and those never happened. Keying
    // them would refuse a legitimate resend of work the parent never did —
    // the opposite failure from the one this rule exists to prevent.
    const { inbox } = await mountInbox('parent')
    inbox.append('next-step', settlement('child-a', 3))
    inbox.clear()

    inbox.append('next-step', settlement('child-a', 3))
    expect(inbox.nextStep).toHaveLength(1)
  })

  it('SURVIVES a restart, which is the only reason the rule means anything', async () => {
    // A seen-set assembled in memory is empty after the event it exists to
    // survive. The second inbox is a cold projection of the same durable log
    // in a fresh store and registry — the restart — and it must still refuse
    // the redelivery.
    const { session, inbox: live } = await mountInbox('parent')
    session.append('turn/start', { turn: 1 })
    live.append('next-step', settlement('child-a', 3))
    live.claim('next-step', 1)
    // The claim is consumed at its turn's end (B-619); the restart must replay
    // the turn boundary too, or the cold fold sees an unconsumed claim.
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const restarted = new Context()
    await restarted.plugin(SessionStore)
    const replayed = restarted.sessions.create(SessionId('parent'))
    for (const event of session.snapshotEvents()) {
      if (event.type === 'agent/inbox/spliced') replayed.append('agent/inbox/spliced', event.data)
      else if (event.type === 'turn/start') replayed.append('turn/start', event.data)
      else if (event.type === 'turn/end') replayed.append('turn/end', event.data)
    }
    await restarted.plugin(SessionProjectionRegistry)
    const restored = new ReactLoopInbox(restarted.sessionProjections, replayed, SILENT)
    expect(() => { restored.append('next-step', settlement('child-a', 3)) })
      .toThrow(DuplicateArrivalError)
  })

  it('leaves a source with NO epoch undeduplicated, rather than inventing a generation for it', async () => {
    // Ordinary user input has no sender generation, and keying it on a made-up
    // one would make every later message from that source collide with an
    // earlier one and be dropped. A sender that wants effective-once delivery
    // states its epoch; this is the documented fall-through, asserted so it
    // cannot become accidental.
    const { inbox } = await mountInbox('parent')
    inbox.append('next-step', settlement('child-a', undefined))
    inbox.claim('next-step', 1)

    inbox.append('next-step', settlement('child-a', undefined))
    expect(inbox.nextStep).toHaveLength(1)
  })

  it('consumes a key when a forked child claims a settlement it inherited as pending', async () => {
    // The fold covers the fork-inherited prefix, so the child's claim removes
    // the inherited entry at its real position rather than from an empty list.
    // The claim runs inside a turn, as the agent loop runs one: a key is
    // consumed when the turn that claimed it ends (BLOCKED-088).
    const { ctx, session: parent, inbox } = await mountInbox('parent')
    inbox.append('next-step', settlement('child-a', 3))
    const child = ctx.sessions.fork(parent, undefined, SessionId('forked'))
    const forked = new ReactLoopInbox(ctx.sessionProjections, child, SILENT)
    child.append('turn/start', { turn: 1 })
    expect(forked.claim('next-step', 1)).toHaveLength(1)
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    expect(() => { forked.append('next-step', settlement('child-a', 3)) })
      .toThrow(DuplicateArrivalError)
  })

  it('refuses in a forked child a settlement its parent already ran', async () => {
    // The child inherits the parent's history, including the run of this
    // notice, so a redelivery into the child repeats an effect its own log
    // already records. The parent ran it in a turn that ended before the fork.
    const { ctx, session: parent, inbox } = await mountInbox('parent')
    inbox.append('next-step', settlement('child-a', 3))
    parent.append('turn/start', { turn: 1 })
    inbox.claim('next-step', 1)
    parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const child = ctx.sessions.fork(parent, undefined, SessionId('forked'))
    const forked = new ReactLoopInbox(ctx.sessionProjections, child, SILENT)

    expect(() => { forked.append('next-step', settlement('child-a', 3)) })
      .toThrow(DuplicateArrivalError)
  })

  it('consumes the claim of a turn its process stopped in, through the turn end a resume appends', async () => {
    // A process that stops mid-turn leaves its claim with no `turn/end`, and
    // that turn may have run the settlement. A resume closes the turn with the
    // closers `interruptedTurnClosers` returns, and that `turn/end` consumes
    // the claim, so a redelivery after the restart is refused.
    const { session, inbox: live } = await mountInbox('parent')
    session.append('turn/start', { turn: 1 })
    live.append('next-step', settlement('child-a', 3))
    live.claim('next-step', 1)

    const persisted = session.snapshotEvents()
    const restarted = new Context()
    await restarted.plugin(SessionStore)
    const replayed = restarted.sessions.create(SessionId('parent'))
    for (const event of [...persisted, ...interruptedTurnClosers(persisted)]) {
      if (event.type === 'turn/start') replayed.append('turn/start', event.data)
      if (event.type === 'turn/end') replayed.append('turn/end', event.data)
      if (event.type === 'agent/inbox/spliced') replayed.append('agent/inbox/spliced', event.data)
    }
    await restarted.plugin(SessionProjectionRegistry)
    const restored = new ReactLoopInbox(restarted.sessionProjections, replayed, SILENT)

    expect(() => { restored.append('next-step', settlement('child-a', 3)) })
      .toThrow(DuplicateArrivalError)
  })
})

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
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { DuplicateArrivalError, Inbox } from '@deepseek-ai/dsh-agent'

const SILENT = { inserted: () => {}, discarded: () => {}, claimed: () => {} }

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

describe('P4-06 must[2]: an inbox consumes one (source, id, epoch) once', () => {
  it('REFUSES a settlement redelivered after the parent already ran it', () => {
    // acceptance[0]'s consumer half. The first notice is claimed — run — and
    // the second arrival of the same activation must not reach the model
    // again. Pending-identity rejection cannot cover this: by the time the
    // redelivery arrives the first is no longer pending.
    const session = Session.create(SessionId('parent'))
    const inbox = new Inbox(session, SILENT)
    inbox.append('next-step', settlement('child-a', 3))
    expect(inbox.claim('next-step', 1)).toHaveLength(1)

    expect(() => { inbox.append('next-step', settlement('child-a', 3)) })
      .toThrow(DuplicateArrivalError)
    expect(inbox.hasPending).toBe(false)
  })

  it('ADMITS a settlement from the same child in a LATER epoch, so a second activation is not suppressed', () => {
    // The positive control the refusal needs, and the reason the epoch is in
    // the key at all: one child session can be activated more than once, and
    // "this child settled again" must not look like "this notice again".
    const session = Session.create(SessionId('parent'))
    const inbox = new Inbox(session, SILENT)
    inbox.append('next-step', settlement('child-a', 3))
    inbox.claim('next-step', 1)

    inbox.append('next-step', settlement('child-a', 4))
    expect(inbox.nextStep).toHaveLength(1)
  })

  it('ADMITS a settlement from a DIFFERENT child in the same epoch, so one child cannot suppress another', () => {
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
    const session = Session.create(SessionId('parent'))
    const inbox = new Inbox(session, SILENT)
    inbox.append('next-step', settlement('child-a', 3))
    inbox.claim('next-step', 1)

    inbox.append('next-step', settlement('child-b', 3))
    expect(inbox.nextStep).toHaveLength(1)
  })

  it('does NOT consume a key for a message that was CANCELLED rather than run', () => {
    // A cancellation removes messages too, and those never happened. Keying
    // them would refuse a legitimate resend of work the parent never did —
    // the opposite failure from the one this rule exists to prevent.
    const session = Session.create(SessionId('parent'))
    const inbox = new Inbox(session, SILENT)
    inbox.append('next-step', settlement('child-a', 3))
    inbox.clear()

    inbox.append('next-step', settlement('child-a', 3))
    expect(inbox.nextStep).toHaveLength(1)
  })

  it('SURVIVES a restart, which is the only reason the rule means anything', () => {
    // A seen-set assembled in memory is empty after the event it exists to
    // survive. The second Inbox is a cold projection of the same durable log —
    // the restart — and it must still refuse the redelivery.
    const session = Session.create(SessionId('parent'))
    const live = new Inbox(session, SILENT)
    live.append('next-step', settlement('child-a', 3))
    live.claim('next-step', 1)

    const restored = new Inbox(session, SILENT)
    expect(() => { restored.append('next-step', settlement('child-a', 3)) })
      .toThrow(DuplicateArrivalError)
  })

  it('leaves a source with NO epoch undeduplicated, rather than inventing a generation for it', () => {
    // Ordinary user input has no sender generation, and keying it on a made-up
    // one would make every later message from that source collide with an
    // earlier one and be dropped. A sender that wants effective-once delivery
    // states its epoch; this is the documented fall-through, asserted so it
    // cannot become accidental.
    const session = Session.create(SessionId('parent'))
    const inbox = new Inbox(session, SILENT)
    inbox.append('next-step', settlement('child-a', undefined))
    inbox.claim('next-step', 1)

    inbox.append('next-step', settlement('child-a', undefined))
    expect(inbox.nextStep).toHaveLength(1)
  })
})

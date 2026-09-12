/**
 * P4-12 Contract: the ledger's reservation decisions.
 *
 * The two standards this epic OWNS are named in the case titles on purpose.
 * P4-06 is the record of the alternative: it was the assigned owner of the
 * CloudEvents shape with no frozen case naming an attribute, and the standard
 * it owned contained the answer to the question its clause got wrong — two
 * senders colliding on one dedup key (BLOCKED-140). A standard nobody cites is
 * a standard nobody read.
 */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ArgumentsHash, IdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import { decideReservation, idempotencyHeader } from '../src/index.ts'
import type { LedgerEntry, LedgerEpoch, ReceiptDigest } from '../src/types.ts'

const SCOPE = brandString<PrincipalId>('agent-1')
const OTHER_SCOPE = brandString<PrincipalId>('agent-2')
const KEY = brandString<IdempotencyKey>('effect-1')
const ARGS = brandString<ArgumentsHash>('sha256-aaa')
const OTHER_ARGS = brandString<ArgumentsHash>('sha256-bbb')
const epoch = (n: number) => n as LedgerEpoch

const entry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  scope: SCOPE, key: KEY, argumentsHash: ARGS, state: 'prepared', epoch: epoch(1), ...overrides,
})

describe('P4-12 must[0]/must[2]: a reservation is what authorizes an external send', () => {
  it('reserves an unseen key, which is the only decision that authorizes sending', () => {
    const decision = decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, undefined)
    // `fenced: true` because the caller presented a lease generation. The flag
    // is asserted here rather than only where it is false: a decision that said
    // `fenced` for everything would carry no information.
    expect(decision).toEqual({ action: 'reserved', fenced: true, entry: entry() })
  })

  it('reserves again for a PREPARED entry at a HIGHER generation, because nothing left the harness yet', () => {
    // The state that separates "we might have sent it" from "we did not". A
    // prepared entry is a crash before the request went out, and refusing the
    // retry there would strand an effect that never happened.
    //
    // The generation in the title is load-bearing: the retry is admitted
    // because epoch 2 fenced epoch 1 out, not merely because the entry is
    // unsent. The same request at epoch 1 is a live peer and is refused — the
    // `held-at-same-epoch` cases below.
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(2) }, entry()).action).toBe('reserved')
  })

  it('reports SENT as a duplicate, so a crash after the request does not send it twice', () => {
    // The crash window the epic exists for: the request left, the result was
    // never persisted, and the log cannot say whether the outside world acted.
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, entry({ state: 'sent' })))
      .toEqual({ action: 'duplicate', state: 'sent' })
  })

  it('reports CONFIRMED and COMPENSATED as duplicates too, so a settled key is never re-sent', () => {
    const digest = brandString<ReceiptDigest>('sha256-receipt')
    for (const state of ['confirmed', 'compensated'] as const) {
      const settled = entry({ state, receiptDigest: digest })
      const decision = decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, settled)
      expect(decision.action, state).toBe('duplicate')
    }
  })
})

describe('P4-12 acceptance[2]: the same key, different parameters is refused (Stripe rule)', () => {
  it('refuses the same key presented with different parameters, naming the first arguments', () => {
    // Stripe's rule, adopted as prior art rather than as a dependency: a key
    // identifies one logical attempt, so reusing it for a DIFFERENT request is
    // a caller defect. Serving the first response instead would silently
    // answer a question nobody asked.
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: OTHER_ARGS, epoch: epoch(1) }, entry()))
      .toEqual({ action: 'refused', reason: 'arguments-differ', firstArgumentsHash: ARGS })
  })

  it('refuses on arguments BEFORE reporting a duplicate, so a changed request is never answered by the old one', () => {
    // Check order, not preference: with the state check first, a second and
    // DIFFERENT request under a sent key would come back `duplicate` — telling
    // the caller its new request had already been carried out.
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: OTHER_ARGS, epoch: epoch(1) }, entry({ state: 'sent' })))
      .toMatchObject({ action: 'refused', reason: 'arguments-differ' })
  })
})

describe('P4-12 must[3]: a stale epoch is fenced out', () => {
  it('refuses a caller whose epoch is older than the holder, and names the current one', () => {
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, entry({ epoch: epoch(5) })))
      .toEqual({ action: 'refused', reason: 'stale-epoch', currentEpoch: epoch(5) })
  })

  it('admits a HIGHER epoch, so fencing refuses only what is genuinely behind', () => {
    // The control. Without it, a fence that refused everything would satisfy
    // the case above.
    //
    // This control used to present the SAME epoch and assert `reserved`
    // (BLOCKED-221). It acted on a `prepared` entry — the helper's default
    // state — so what it actually froze was "a peer at the holder's own
    // generation may take the reservation", which is what must[2] forbids. The
    // control it was written to be needs a generation the fence has genuinely
    // passed, and that is a higher one.
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(6) }, entry({ epoch: epoch(5) })).action)
      .toBe('reserved')
  })

  it('fences BEFORE reporting an outcome, so a superseded generation learns nothing about work it lost', () => {
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, entry({ state: 'sent', epoch: epoch(5) })))
      .toMatchObject({ reason: 'stale-epoch' })
  })
})

describe('P4-12 must[2]: a peer at the holder\'s own generation may not take the reservation (BLOCKED-221)', () => {
  it('refuses the SAME generation against a PREPARED entry, naming the generation that holds it', () => {
    // Two callers at one generation are peers, not a succession: neither fence
    // has passed, so admitting the second puts two holders on one reservation
    // — the state must[2] forbids. Before BLOCKED-221 this returned `reserved`.
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(5) }, entry({ epoch: epoch(5) })))
      .toEqual({ action: 'refused', reason: 'held-at-same-epoch', heldEpoch: epoch(5) })
  })

  it('distinguishes held-at-same-epoch from stale-epoch, because one says wait and the other says stop', () => {
    // A caller refused by a peer may retry once the peer settles; a caller
    // fenced out by a successor must never send this effect at all. One reason
    // covering both would leave a caller unable to tell those apart.
    const peer = decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(5) }, entry({ epoch: epoch(5) }))
    const fenced = decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(4) }, entry({ epoch: epoch(5) }))
    expect([peer, fenced].map(decision => 'reason' in decision ? decision.reason : decision.action))
      .toEqual(['held-at-same-epoch', 'stale-epoch'])
  })

  it('reports a SENT entry at the same generation as a duplicate, which is a different fact from a held reservation', () => {
    // `duplicate` asserts the effect happened. The refusal above must not say
    // it, because nothing was sent there: claiming a send that may never occur
    // would let a caller abandon an effect nobody performed.
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(5) }, entry({ state: 'sent', epoch: epoch(5) })))
      .toEqual({ action: 'duplicate', state: 'sent' })
  })
})

describe('P4-12 must[2]: an UNFENCED caller keeps at-least-once and is told exclusivity does not apply (BLOCKED-221)', () => {
  it('re-takes a PREPARED entry whose holder was also unfenced, and marks the reservation unfenced', () => {
    // Without generations nothing can prove the previous holder gone, so
    // refusing here would strand the key forever and lose at-least-once. The
    // reservation is granted and `fenced: false` says must[2] does not cover
    // it — the promise is narrowed explicitly rather than quietly broken.
    expect(decideReservation(
      { scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: 'unfenced' },
      entry({ epoch: 'unfenced' }),
    )).toEqual({ action: 'reserved', fenced: false, entry: entry({ epoch: 'unfenced' }) })
  })

  it('treats an unfenced caller as outside the generation ordering, not as generation zero', () => {
    // The defect BLOCKED-221 found: `?? 0` at the call site made every
    // lease-less run generation zero, so the ledger compared absences as
    // numbers. A zero would be refused as stale against the holder's epoch 5;
    // an absent generation is not behind anything, and is admitted.
    const unfenced = decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: 'unfenced' }, entry({ epoch: epoch(5) }))
    const zero = decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(0) }, entry({ epoch: epoch(5) }))
    expect(unfenced.action).toBe('reserved')
    expect(zero).toMatchObject({ action: 'refused', reason: 'stale-epoch' })
  })

  it('calls a takeover of an unfenced holder UNFENCED however well fenced the new caller is', () => {
    // Fencing is a property of the pair, not of the caller. The previous holder
    // had no generation to be fenced out of, so it can still send; a decision
    // claiming `fenced: true` here would promise an exclusivity nothing
    // enforces.
    expect(decideReservation(
      { scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(5) },
      entry({ epoch: 'unfenced' }),
    )).toMatchObject({ action: 'reserved', fenced: false })
  })

  it('still reports a SENT entry as a duplicate for an unfenced caller, so at-least-once never becomes at-least-twice', () => {
    // The limit of the degraded rule: it re-takes `prepared`, which is unsent,
    // and nothing else. A `sent` entry is a duplicate whether or not the caller
    // holds a lease.
    expect(decideReservation(
      { scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: 'unfenced' },
      entry({ state: 'sent', epoch: 'unfenced' }),
    )).toEqual({ action: 'duplicate', state: 'sent' })
  })
})

describe('P4-12 acceptance[1]: an ambiguous outcome goes to reconciliation, not to a retry', () => {
  it('refuses a retry of an AMBIGUOUS entry rather than sending again', () => {
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, entry({ state: 'ambiguous' })))
      .toEqual({ action: 'refused', reason: 'ambiguous-needs-reconciliation' })
  })

  it('distinguishes ambiguous from duplicate, because they need different handling', () => {
    // A duplicate is answered by the first attempt's outcome. An ambiguous
    // entry has no outcome to be answered by, and collapsing the two would
    // send a caller looking for a receipt that may not exist.
    const ambiguous = decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, entry({ state: 'ambiguous' }))
    const duplicate = decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, entry({ state: 'confirmed' }))
    expect(ambiguous.action).not.toBe(duplicate.action)
  })
})

describe('P4-12 must[1]: a provider with native support gets the Idempotency-Key header', () => {
  it('passes the key through as the Idempotency-Key request header (draft-ietf-httpapi-idempotency-key-header-07)', () => {
    // The draft defines the header spelling; naming it here is what makes the
    // ownership claim checkable, and a provider adapter that spells it
    // differently is not passing the key through at all.
    expect(idempotencyHeader({ kind: 'native', headerName: 'Idempotency-Key' }, 'effect-1'))
      .toEqual({ name: 'Idempotency-Key', value: 'effect-1' })
  })

  it('sends no Idempotency-Key header for a local-fencing provider, whose dedup is this ledger', () => {
    expect(idempotencyHeader({ kind: 'local-fencing' }, 'effect-1')).toBeUndefined()
  })
})

describe('P4-12 must[2]: an idempotency key is unique PER CLIENT, never globally', () => {
  it('carries the requesting principal into the reservation, which is what the store persists', () => {
    // The property this pure function really has, and the one the store then
    // depends on: it writes the entry the decision produced, so a decision that
    // dropped or fixed the scope would write rows under the wrong principal.
    //
    // A first version of this case asserted that two principals presenting one
    // key both get `reserved` — with `existing: undefined` passed twice, which
    // is `reserved` whatever the scope is. No mutation of this function could
    // redden it; the reddening in its own proof came from the STORE's suite.
    // A case whose evidence lives in another suite is ceremony here.
    // Only the first-arrival branch is asserted here. A second case, that a
    // RE-reservation keeps the stored principal, was written and then deleted:
    // the store looks an entry up BY `(scope, key)`, so an existing entry's
    // scope always equals the request's, and the mutation that would break it
    // (adopting the caller's scope on retry) reddens nothing. Making it fail
    // would need an input the lookup cannot produce.
    const mine = decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, undefined)
    const theirs = decideReservation({ scope: OTHER_SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, undefined)
    expect(mine).toMatchObject({ action: 'reserved', entry: { scope: SCOPE, key: KEY } })
    expect(theirs).toMatchObject({ action: 'reserved', entry: { scope: OTHER_SCOPE, key: KEY } })
  })

  it('still refuses a second reservation WITHIN one principal, so scoping did not disable dedup', () => {
    // The control: without it, a ledger that scoped everything apart — or
    // ignored the entry entirely — would satisfy the cases above.
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, entry({ state: 'sent' })).action)
      .toBe('duplicate')
  })
})

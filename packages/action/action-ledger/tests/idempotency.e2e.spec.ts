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
    expect(decision).toEqual({ action: 'reserved', entry: entry() })
  })

  it('reserves again for a PREPARED entry, because nothing left the harness yet', () => {
    // The state that separates "we might have sent it" from "we did not". A
    // prepared entry is a crash before the request went out, and refusing the
    // retry there would strand an effect that never happened.
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

  it('admits the SAME epoch, so fencing refuses only what is genuinely behind', () => {
    // The control. Without it, a fence that refused everything would satisfy
    // the case above.
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(5) }, entry({ epoch: epoch(5) })).action)
      .toBe('reserved')
  })

  it('fences BEFORE reporting an outcome, so a superseded generation learns nothing about work it lost', () => {
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, entry({ state: 'sent', epoch: epoch(5) })))
      .toMatchObject({ reason: 'stale-epoch' })
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
  it('gives two principals presenting the SAME key two independent reservations', () => {
    // draft-ietf-httpapi-idempotency-key-header-07 defines the key as unique
    // per client, and its security considerations give the reason: a server
    // that does not scope by client lets one client learn another's key state.
    // Stripe scopes per account for the same reason. Two agents deriving a key
    // from an arguments hash or a counter collide easily, and the second must
    // not be answered with the first's outcome.
    const mine = decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, undefined)
    expect(mine.action).toBe('reserved')
    const theirs = decideReservation({ scope: OTHER_SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, undefined)
    expect(theirs.action).toBe('reserved')
  })

  it('still refuses a second reservation WITHIN one principal, so scoping did not disable dedup', () => {
    // The control: without it, a ledger that scoped everything apart — or
    // ignored the entry entirely — would satisfy the case above.
    expect(decideReservation({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) }, entry({ state: 'sent' })).action)
      .toBe('duplicate')
  })
})

/**
 * P3-06 C: what a secret lease grants, and when it stops granting it.
 *
 * The Contract stage's whole subject is the GRANT, not the transport. must[1]'s
 * brokered injection is absent here on purpose: `broker-only` is deliverable
 * only by a separate address space (`execution-world/src/local-provider.ts`
 * refuses any `secrets` posture but `inherited`), and a contract written around
 * a transport nobody has chosen would have to be rebuilt when one is.
 *
 * Every case supplies its own `now`. Nothing here reads a clock, so a case that
 * passes does so because of the rule it names and not because of when it ran.
 */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ActionId } from '@deepseek-ai/dsh-action-manifest'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { WorldId } from '@deepseek-ai/dsh-execution-world'
import type { Principal } from '@deepseek-ai/dsh-principal'
import {
  afterRedemption, decideRedemption, effectiveState, isExpired, isLegalLeaseTransition,
  revoke, revokeWorldLeases,
  type SecretLease, type SecretLeasePresentation, type SecretLeaseRecord, type SecretLeaseState,
} from '../src/index.ts'

const EXPIRES_AT = 1_000

/** The principal a lease is issued to, and the one presenting it. */
function principal(id: string): Principal {
  return { kind: 'user', id: brandString(id), tenantId: brandString('tenant-1') } as unknown as Principal
}

function lease(over: Partial<SecretLease> = {}): SecretLease {
  return {
    id: brandString('lease-1'),
    credential: brandString<CredentialRef>('llm/deepseek'),
    principal: principal('user-1'),
    action: brandString<ActionId>('action-1'),
    world: brandString<WorldId>('world-1'),
    purpose: 'call the model for this turn',
    expiresAt: EXPIRES_AT,
    ...over,
  }
}

function record(state: SecretLeaseState = 'issued', over: Partial<SecretLease> = {}): SecretLeaseRecord {
  return { lease: lease(over), state }
}

/** A presentation that matches the default lease on all three bindings. */
function presented(over: Partial<SecretLeasePresentation> = {}): SecretLeasePresentation {
  return {
    principal: principal('user-1'),
    action: brandString<ActionId>('action-1'),
    world: brandString<WorldId>('world-1'),
    ...over,
  }
}

describe('P3-06 C must[0]: a lease binds a credential to one principal, action and world', () => {
  it('redeems and yields the credential when principal, action and world all match', () => {
    // The control. Without it every refusal case below is satisfied by a broker
    // that refuses everything, which is the over-broad mutant this program has
    // measured before: a filter that denies all passes most negative cases.
    const decision = decideRedemption(record(), presented(), 0)

    expect(decision).toStrictEqual({ ok: true, credential: brandString<CredentialRef>('llm/deepseek') })
  })

  it('refuses a principal the lease was not issued to, so a lease is not bearer authority', () => {
    const decision = decideRedemption(record(), presented({ principal: principal('user-2') }), 0)

    expect(decision).toStrictEqual({ ok: false, refusal: 'principal-mismatch' })
  })

  it('refuses an action the lease does not name, so one grant does not cover a whole run', () => {
    const decision = decideRedemption(record(), presented({ action: brandString<ActionId>('action-2') }), 0)

    expect(decision).toStrictEqual({ ok: false, refusal: 'action-mismatch' })
  })

  it('refuses a world the lease does not name, so a grant does not follow a secret across confinements', () => {
    const decision = decideRedemption(record(), presented({ world: brandString<WorldId>('world-2') }), 0)

    expect(decision).toStrictEqual({ ok: false, refusal: 'world-mismatch' })
  })
})

describe('P3-06 C acceptance[2]: an expired lease cannot be replayed', () => {
  it('refuses at exactly expiresAt, so the recorded time is the first unusable instant and not the last usable one', () => {
    // The boundary is the whole content of an expiry rule: an off-by-one here
    // makes the same timestamp mean two different things in two readers.
    expect(isExpired(lease(), EXPIRES_AT)).toBe(true)
    expect(decideRedemption(record(), presented(), EXPIRES_AT)).toStrictEqual({ ok: false, refusal: 'expired' })
  })

  it('is still usable one millisecond before, so expiry refuses by time and not by default', () => {
    expect(isExpired(lease(), EXPIRES_AT - 1)).toBe(false)
    expect(decideRedemption(record(), presented(), EXPIRES_AT - 1).ok).toBe(true)
  })

  it('reads as expired with NO sweeper having run, so a replay against an unswept store still refuses', () => {
    // The record is stored `issued` and nothing ever updated it. If expiry were
    // an event someone has to remember to write, acceptance[2] would hold only
    // where a sweeper ran — and a replay is precisely the path where one has not.
    expect(effectiveState(record('issued'), EXPIRES_AT + 60_000)).toBe('expired')
  })

  it('refuses an expired lease BEFORE testing its bindings, so a refusal leaks nothing about the grant', () => {
    // Presented with a wrong principal AND past expiry: the answer must be
    // `expired`. Reporting `principal-mismatch` would tell a caller their
    // principal was checked and found wanting — i.e. that some other principal
    // would have matched — which is a fact about a grant they no longer hold.
    const decision = decideRedemption(record(), presented({ principal: principal('user-2') }), EXPIRES_AT)

    expect(decision).toStrictEqual({ ok: false, refusal: 'expired' })
  })
})

describe('P3-06 C must[2]: use revokes', () => {
  it('moves a redeemed lease out of `issued`, so the same lease does not serve a second action', () => {
    const after = afterRedemption(record())

    expect(after.state).toBe('redeemed')
    expect(decideRedemption(after, presented(), 0)).toStrictEqual({ ok: false, refusal: 'already-redeemed' })
  })

  it('leaves the grant itself untouched, so an audit can still quote what was issued', () => {
    const before = record()

    expect(afterRedemption(before).lease).toStrictEqual(before.lease)
  })
})

describe('P3-06 C: revocation, and the cascade when a world stops', () => {
  it('revokes every lease bound to the stopped world, and only those', () => {
    const inWorld = record('issued')
    const elsewhere = record('issued', { id: brandString('lease-2'), world: brandString<WorldId>('world-2') })

    const after = revokeWorldLeases([inWorld, elsewhere], brandString<WorldId>('world-1'))

    expect(after[0]?.state).toBe('revoked')
    // The control that scopes the cascade: a cascade revoking everything would
    // satisfy the first assertion while being a constant.
    expect(after[1]?.state).toBe('issued')
  })

  it('revokes a lease whose own expiry has not passed, because the world ending ends the grant', () => {
    const after = revokeWorldLeases([record('issued')], brandString<WorldId>('world-1'))

    expect(effectiveState(after[0] as SecretLeaseRecord, 0)).toBe('revoked')
  })

  it('does not rewrite a terminal state, so the first reason a lease stopped working stays the recorded one', () => {
    // An already-redeemed lease caught by a later cascade must still read
    // `redeemed`: overwriting it would change an audit's answer to "why did
    // this stop working" after the fact.
    expect(revoke({ lease: lease(), state: 'redeemed' }, 'revoked').state).toBe('redeemed')
  })
})

describe('P3-06 C: the state machine admits exactly the moves it names', () => {
  it('allows `issued` to reach each terminal state', () => {
    expect(isLegalLeaseTransition('issued', 'redeemed')).toBe(true)
    expect(isLegalLeaseTransition('issued', 'expired')).toBe(true)
    expect(isLegalLeaseTransition('issued', 'revoked')).toBe(true)
  })

  it('makes every terminal state final, so no lease returns to usable', () => {
    for (const from of ['redeemed', 'expired', 'revoked'] as const) {
      for (const to of ['issued', 'redeemed', 'expired', 'revoked'] as const) {
        expect(isLegalLeaseTransition(from, to)).toBe(false)
      }
    }
  })
})

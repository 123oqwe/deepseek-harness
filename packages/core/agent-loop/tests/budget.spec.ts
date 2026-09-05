/**
 * P9-07 Contract — the loop's hard budget decision.
 *
 * The rule most likely to be got wrong is must[3]: a limit of `0` means
 * UNLIMITED, not "no turns permitted". Every limit is therefore pinned from
 * both sides — the value that still admits, and the first value that refuses.
 */
import { describe, expect, it } from 'vitest'

import { decideTurnAdmission, isBudgetEnforced } from '../src/budget.ts'

const FRESH = { turnsUsed: 0, spentUsd: 0 }

describe('P9-07 Contract — hard loop budget', () => {
  it('must[3]: an ABSENT maxTurns is unlimited, so a long run is never stopped by a field nobody set', () => {
    expect(decideTurnAdmission({ turnsUsed: 10_000, spentUsd: 0 }, {})).toStrictEqual({ admitted: true })
  })

  it('must[3]: a ZERO maxTurns is unlimited too, NOT a run that may take no turns', () => {
    expect(decideTurnAdmission({ turnsUsed: 500, spentUsd: 0 }, { maxTurns: 0 })).toStrictEqual({ admitted: true })
  })

  it('must[3]: a ZERO maxSpendUsd is unlimited, on the same rule', () => {
    expect(decideTurnAdmission({ turnsUsed: 0, spentUsd: 99 }, { maxSpendUsd: 0 })).toStrictEqual({ admitted: true })
  })

  it('must[0]: the turn BEFORE the limit is admitted', () => {
    expect(decideTurnAdmission({ turnsUsed: 2, spentUsd: 0 }, { maxTurns: 3 })).toStrictEqual({ admitted: true })
  })

  it('must[0]: the turn AT the limit is refused, so maxTurns=3 permits exactly three turns', () => {
    const decision = decideTurnAdmission({ turnsUsed: 3, spentUsd: 0 }, { maxTurns: 3 })
    expect(decision).toStrictEqual({
      admitted: false,
      reason: 'max-turns-reached',
      limit: 3,
      observed: 3,
    })
  })

  it('must[0]: a run already past its limit stays refused rather than wrapping to admitted', () => {
    const decision = decideTurnAdmission({ turnsUsed: 9, spentUsd: 0 }, { maxTurns: 3 })
    expect(decision.admitted).toBe(false)
  })

  it('must[0]: spend below the cap is admitted', () => {
    expect(decideTurnAdmission({ turnsUsed: 0, spentUsd: 1.99 }, { maxSpendUsd: 2 })).toStrictEqual({ admitted: true })
  })

  it('must[0]: spend exactly AT the cap is refused, so the cap is a ceiling and not a target', () => {
    expect(decideTurnAdmission({ turnsUsed: 0, spentUsd: 2 }, { maxSpendUsd: 2 })).toStrictEqual({
      admitted: false,
      reason: 'spend-cap-reached',
      limit: 2,
      observed: 2,
    })
  })

  it('reports the turn limit when BOTH are exhausted, since that needs no pricing data to act on', () => {
    const decision = decideTurnAdmission({ turnsUsed: 5, spentUsd: 5 }, { maxTurns: 5, maxSpendUsd: 5 })
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.reason).toBe('max-turns-reached')
  })

  it('reports the spend cap when only spend is exhausted, even with a turn limit configured', () => {
    const decision = decideTurnAdmission({ turnsUsed: 1, spentUsd: 5 }, { maxTurns: 5, maxSpendUsd: 5 })
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.reason).toBe('spend-cap-reached')
  })

  it('carries the limit and the observation, so a refusal is actionable without re-reading config', () => {
    const decision = decideTurnAdmission({ turnsUsed: 0, spentUsd: 7.5 }, { maxSpendUsd: 2.5 })
    expect(decision).toStrictEqual({
      admitted: false,
      reason: 'spend-cap-reached',
      limit: 2.5,
      observed: 7.5,
    })
  })

  it('admits a fresh run under any configured budget', () => {
    expect(decideTurnAdmission(FRESH, { maxTurns: 1, maxSpendUsd: 0.01 })).toStrictEqual({ admitted: true })
  })

  it('must[3]: a maxTurns of 1 permits exactly one turn, the smallest budget that bounds anything', () => {
    expect(decideTurnAdmission(FRESH, { maxTurns: 1 })).toStrictEqual({ admitted: true })
    expect(decideTurnAdmission({ turnsUsed: 1, spentUsd: 0 }, { maxTurns: 1 }).admitted).toBe(false)
  })
})

describe('isBudgetEnforced', () => {
  it('an empty budget enforces nothing', () => {
    expect(isBudgetEnforced({})).toBe(false)
  })

  it('zeros enforce nothing, matching the admission rule rather than restating it differently', () => {
    expect(isBudgetEnforced({ maxTurns: 0, maxSpendUsd: 0 })).toBe(false)
  })

  it('either limit alone counts as enforced', () => {
    expect(isBudgetEnforced({ maxTurns: 3 })).toBe(true)
    expect(isBudgetEnforced({ maxSpendUsd: 0.5 })).toBe(true)
  })
})

/**
 * P9-09 Contract — the champion–challenger promotion gate.
 *
 * The registry names this file's three negatives directly: a worse variant must
 * be refused, an insignificant difference must be refused, and a tampered
 * report must be detected. They are the three ways a prompt change gets adopted
 * on evidence that does not support it, and the third is the only one that is
 * anybody's fault.
 */
import { describe, expect, it } from 'vitest'

import {
  admitGuidelineChange,
  decidePromotion,
  decidePromotionFromReport,
} from '../../benchmarks/ab/promotion.ts'

/** A champion that clearly wins: enough trials for the interval to be narrow. */
const CHAMPION = { variant: 'champion', passed: 80, total: 100 }

describe('P9-09 Contract — promotion requires a difference the sample supports', () => {
  it('acceptance[2]: a WORSE challenger is refused, and the denial says it was worse', () => {
    const decision = decidePromotion(CHAMPION, { variant: 'worse', passed: 50, total: 100 })
    expect(decision.promoted).toBe(false)
    expect(!decision.promoted ? decision.denial.reason : undefined).toBe('not-better')
  })

  it('acceptance[2]: an EQUAL challenger is refused — a tie is not evidence to change', () => {
    const decision = decidePromotion(CHAMPION, { variant: 'tie', passed: 80, total: 100 })
    expect(!decision.promoted ? decision.denial.reason : undefined).toBe('not-better')
  })

  it('must[2]: a better-but-insignificant challenger is refused, so noise cannot promote itself', () => {
    // 8/10 versus 80/100: the same rate at a tenth of the evidence, and one
    // extra success would move it. Promoting here would adopt a coin flip.
    const decision = decidePromotion(CHAMPION, { variant: 'small-sample', passed: 9, total: 10 })
    expect(decision.promoted).toBe(false)
    expect(!decision.promoted ? decision.denial.reason : undefined).toBe('not-significant')
  })

  it('must[2]: a challenger whose interval clears the champion\'s is promoted', () => {
    const decision = decidePromotion({ variant: 'champion', passed: 40, total: 100 }, { variant: 'better', passed: 90, total: 100 })
    expect(decision.promoted).toBe(true)
    expect(decision.promoted ? decision.variant : undefined).toBe('better')
  })

  it('an arm that ran NOTHING is reported as such, not as "not better"', () => {
    // A variant that never ran and one that ran and lost are different facts,
    // and only the second is evidence about the prompt.
    const decision = decidePromotion(CHAMPION, { variant: 'never-ran', passed: 0, total: 0 })
    expect(!decision.promoted ? decision.denial.reason : undefined).toBe('no-trials')
  })

  it('the decision carries BOTH intervals, so the record shows what it rested on', () => {
    const decision = decidePromotion({ variant: 'champion', passed: 40, total: 100 }, { variant: 'better', passed: 90, total: 100 })
    expect(decision.promoted ? decision.championInterval.upper : undefined).toBeLessThan(
      decision.promoted ? decision.challengerInterval.lower : 0,
    )
  })
})

describe('P9-09 Contract — a tampered report cannot promote anything', () => {
  it('acceptance[2]: a digest mismatch is refused ahead of the comparison', () => {
    // The challenger here WINS on the numbers. A gate that compared first would
    // promote it and record a decision about numbers nobody produced.
    const decision = decidePromotionFromReport(
      'recorded', 'observed',
      { variant: 'champion', passed: 40, total: 100 },
      { variant: 'challenger', passed: 90, total: 100 },
    )
    expect(decision.promoted).toBe(false)
    expect(!decision.promoted ? decision.denial.reason : undefined).toBe('report-tampered')
  })

  it('a matching digest scores the comparison normally', () => {
    const decision = decidePromotionFromReport(
      'same', 'same',
      { variant: 'champion', passed: 40, total: 100 },
      { variant: 'challenger', passed: 90, total: 100 },
    )
    expect(decision.promoted).toBe(true)
  })
})

describe('P9-09 Contract — must[4]: a guideline change faces the benchmark', () => {
  it('a significant drop refuses the change', () => {
    const verdict = admitGuidelineChange({ variant: 'before', passed: 90, total: 100 }, { variant: 'after', passed: 40, total: 100 })
    expect(verdict.admitted).toBe(false)
    expect(!verdict.admitted ? verdict.drop : 0).toBeCloseTo(0.5)
  })

  it('an ordinary wobble does NOT refuse the change', () => {
    // The asymmetry is deliberate: significance is required to CHANGE the
    // champion and also required to BLOCK a change, so run-to-run noise does
    // neither.
    expect(admitGuidelineChange({ variant: 'before', passed: 80, total: 100 }, { variant: 'after', passed: 77, total: 100 }))
      .toStrictEqual({ admitted: true })
  })

  it('an improvement is admitted', () => {
    expect(admitGuidelineChange({ variant: 'before', passed: 40, total: 100 }, { variant: 'after', passed: 90, total: 100 }).admitted).toBe(true)
  })

  it('a benchmark that ran no trials admits nothing, rather than admitting everything', () => {
    expect(admitGuidelineChange({ variant: 'before', passed: 0, total: 0 }, { variant: 'after', passed: 0, total: 0 }).admitted).toBe(false)
  })
})

/**
 * P9-05 Contract — the calibration half, and only that half.
 *
 * BLOCKED-107 established that two of P9-05's four clauses are reachable today
 * and two are not: exact counting and the p95-against-corpora threshold both
 * need a tokenizer nobody has chosen a source for. This file is must[1] and
 * must[3]. It does not approach the other two, and the last case here exists to
 * keep that boundary honest — calibration narrows an estimate, it never makes
 * one exact, and a reader must not mistake a converging factor for a tokenizer.
 */
import { describe, expect, it } from 'vitest'

import {
  applyCalibration,
  calibrate,
  relativeError,
  UNCALIBRATED,
  type UsageObservation,
} from '../src/usage-calibration.ts'

/** Fold a whole session's observations in order. */
function session(observations: readonly UsageObservation[]): ReturnType<typeof calibrate> {
  return observations.reduce(calibrate, UNCALIBRATED)
}

describe('P9-05 Contract — must[1]: each response narrows the estimate', () => {
  it('an uncalibrated session changes nothing, so the first request is priced exactly as before', () => {
    expect(UNCALIBRATED).toStrictEqual({ factor: 1, samples: 0 })
    expect(applyCalibration(UNCALIBRATED, 400)).toBe(400)
  })

  it('acceptance[2]: three real responses narrow the error MONOTONICALLY', () => {
    // The clause's own shape: a session carrying three responses ends closer
    // than it started, and never moves away in between. Content the estimator
    // under-counts by 25% throughout — a plausible density error for prose the
    // four-chars-per-token rule prices badly.
    const truth = 1.25
    let state = UNCALIBRATED
    const errors: number[] = []
    for (let round = 0; round < 3; round++) {
      const raw = 1_000
      const corrected = applyCalibration(state, raw)
      const reported = Math.round(raw * truth)
      errors.push(relativeError({ estimatedTokens: corrected, reportedTokens: reported }) ?? Number.NaN)
      state = calibrate(state, { estimatedTokens: raw, reportedTokens: reported })
    }
    // Non-increasing throughout, and strictly better at the end than at the
    // start. Not "strictly better every round": on constant-density content the
    // factor can reach the truth in two, and demanding a further improvement
    // would be demanding it get better than exact.
    expect(errors[0]).toBeGreaterThan(0.1)
    expect(errors[1]).toBeLessThanOrEqual(errors[0]!)
    expect(errors[2]).toBeLessThanOrEqual(errors[1]!)
    expect(errors[2]).toBeLessThan(errors[0]!)
    expect(state.samples).toBe(3)
  })

  it('the factor converges toward the real density rather than overshooting past it', () => {
    const truth = 1.25
    let state = UNCALIBRATED
    for (let round = 0; round < 12; round++) {
      state = calibrate(state, { estimatedTokens: 1_000, reportedTokens: Math.round(1_000 * truth) })
    }
    expect(state.factor).toBeGreaterThan(1.2)
    expect(state.factor).toBeLessThan(1.3)
  })

  it('one outlier cannot swing the next estimate by its whole error', () => {
    // A truncated response, or a provider counting a cached prefix
    // differently. Without a step bound the factor would follow it straight
    // down and mis-price every later request in the session.
    const settled = session(Array.from({ length: 8 }, () => ({ estimatedTokens: 1_000, reportedTokens: 1_250 })))
    const afterOutlier = calibrate(settled, { estimatedTokens: 1_000, reportedTokens: 5 })
    expect(afterOutlier.factor).toBeGreaterThan(settled.factor * 0.75 - 1e-9)
  })

  it('no sequence of observations can invert the estimator', () => {
    const collapsing = session(Array.from({ length: 40 }, () => ({ estimatedTokens: 1_000, reportedTokens: 1 })))
    expect(collapsing.factor).toBeGreaterThanOrEqual(0.25)
    const exploding = session(Array.from({ length: 40 }, () => ({ estimatedTokens: 1, reportedTokens: 100_000 })))
    expect(exploding.factor).toBeLessThanOrEqual(4)
  })

  it('an observation it can learn nothing from is IGNORED, not folded', () => {
    // A zero reported count would otherwise drive the factor to its floor on a
    // response the provider did not charge for.
    const settled = session([{ estimatedTokens: 1_000, reportedTokens: 1_250 }])
    for (const useless of [
      { estimatedTokens: 0, reportedTokens: 500 },
      { estimatedTokens: 500, reportedTokens: 0 },
      { estimatedTokens: -10, reportedTokens: 500 },
      { estimatedTokens: Number.NaN, reportedTokens: 500 },
      { estimatedTokens: 500, reportedTokens: Number.POSITIVE_INFINITY },
    ]) {
      expect(calibrate(settled, useless)).toStrictEqual(settled)
    }
  })
})

describe('P9-05 Contract — must[3]: the estimate path stays synchronous and pure', () => {
  it('calibrating returns a NEW state and leaves the previous one untouched', () => {
    const before = session([{ estimatedTokens: 1_000, reportedTokens: 1_250 }])
    const snapshot = { ...before }
    calibrate(before, { estimatedTokens: 1_000, reportedTokens: 1_100 })
    expect(before).toStrictEqual(snapshot)
  })

  it('neither function returns a promise, because both run while a request is being assembled', () => {
    // must[3] is a property to PRESERVE here rather than to build; asserting it
    // is what stops a later slice from making the estimate path awaitable.
    expect(applyCalibration(UNCALIBRATED, 10)).not.toBeInstanceOf(Promise)
    expect(calibrate(UNCALIBRATED, { estimatedTokens: 1, reportedTokens: 1 })).not.toBeInstanceOf(Promise)
  })

  it('a corrected estimate is a whole number of tokens', () => {
    const state = session([{ estimatedTokens: 1_000, reportedTokens: 1_133 }])
    expect(Number.isInteger(applyCalibration(state, 337))).toBe(true)
  })
})

describe('P9-05 Contract — what calibration is NOT (BLOCKED-107)', () => {
  it('one scalar factor cannot be right for content whose density VARIES', () => {
    // The boundary this epic must not blur, and the honest form of it. On
    // constant-density content a converged factor really can land exactly —
    // the first version of this case asserted it never could, and that was
    // simply false. What calibration cannot do is be right for a session that
    // mixes densities: one number is fitted to their average and is wrong for
    // each. That is what must[0]'s tokenizer is for, and no sequence of
    // observations substitutes for it.
    // Alternating dense and sparse content, as a real session mixes code and
    // prose. Measured rather than assumed: the factor does not settle between
    // the two densities, it OSCILLATES, tracking whichever content came last.
    let state = UNCALIBRATED
    const errorsOnNext: number[] = []
    for (let round = 0; round < 20; round++) {
      const truth = round % 2 === 0 ? 1.6 : 0.8
      const nextTruth = round % 2 === 0 ? 0.8 : 1.6
      state = calibrate(state, { estimatedTokens: 1_000, reportedTokens: Math.round(1_000 * truth) })
      // What this factor will cost on the content that actually comes next.
      errorsOnNext.push(Math.abs(applyCalibration(state, 1_000) - 1_000 * nextTruth) / (1_000 * nextTruth))
    }
    // Still badly wrong on the next request after twenty observations, and no
    // better at the end than in the middle: a single scalar has nothing left to
    // learn about a mixture. That is what must[0]'s tokenizer is for.
    expect(errorsOnNext.at(-1)!).toBeGreaterThan(0.2)
    // Compared two rounds apart, not one: the factor alternates, so consecutive
    // rounds differ by construction while the same phase two rounds back is the
    // like-for-like comparison. Equal there means twenty observations bought
    // nothing that the first two did not.
    expect(errorsOnNext.at(-1)!).toBeCloseTo(errorsOnNext.at(-3)!, 5)
  })
})

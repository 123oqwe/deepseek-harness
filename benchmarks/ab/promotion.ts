/**
 * When a challenger prompt may replace the champion (Epic P9-09, Contract stage).
 *
 * A prompt change that "looks better" is the failure mode this gate exists for:
 * benchmark scores move on their own, and a run-to-run difference read as an
 * improvement promotes noise and then compounds it, because the next comparison
 * is against the promoted noise.
 *
 * So promotion needs a difference the sample actually supports. The rule is
 * deliberately conservative and stated once here: the challenger's Wilson lower
 * bound must exceed the champion's upper bound — non-overlapping intervals at
 * ~95%. A rule that promoted on overlapping intervals would promote a coin
 * flip roughly as often as an improvement.
 *
 * The same comparison, in the other direction, is must[4]'s regression gate:
 * a guideline change may not land if its score drops significantly.
 *
 * Contract stage: pure decisions over already-scored arms. Nothing here runs a
 * benchmark, reads a report file, or edits a prompt.
 *
 * @module benchmarks/ab/promotion
 */

import { wilsonInterval } from '../harness-capability/report.ts'
import type { ConfidenceInterval } from '../harness-capability/report.ts'

/** One arm of a comparison: a champion or a challenger, already run. */
export interface Arm {
  /** Which variant this is, for the record the decision is written into. */
  readonly variant: string
  readonly passed: number
  readonly total: number
}

/** Why a challenger was not promoted. */
export type PromotionDenial =
  /** The challenger scored no better; the gate never promotes a regression. */
  | { readonly reason: 'not-better'; readonly champion: number; readonly challenger: number }
  /** The difference is real-looking but the sample does not support it. */
  | { readonly reason: 'not-significant'; readonly championInterval: ConfidenceInterval; readonly challengerInterval: ConfidenceInterval }
  /** An arm ran nothing, so it has no score to compare. */
  | { readonly reason: 'no-trials'; readonly variant: string }
  /** The report's recorded digest does not match the report being read. */
  | { readonly reason: 'report-tampered'; readonly detail: string }

/** The gate's decision, with the evidence it rests on (must[3]). */
export type PromotionDecision =
  | {
    readonly promoted: true
    readonly variant: string
    readonly championInterval: ConfidenceInterval
    readonly challengerInterval: ConfidenceInterval
  }
  | { readonly promoted: false; readonly denial: PromotionDenial }

/**
 * Decide whether `challenger` may replace `champion` (must[2]).
 *
 * Order matters and is part of the contract: an arm with no trials is reported
 * as such rather than as "not better", because a variant that never ran and a
 * variant that ran and lost are different facts, and only one of them is
 * evidence about the prompt.
 * @param champion - the incumbent's results.
 * @param challenger - the candidate's results.
 * @returns whether to promote, and the intervals either way.
 */
export function decidePromotion(champion: Arm, challenger: Arm): PromotionDecision {
  for (const arm of [champion, challenger]) {
    if (arm.total === 0) return { promoted: false, denial: { reason: 'no-trials', variant: arm.variant } }
  }
  const championRate = champion.passed / champion.total
  const challengerRate = challenger.passed / challenger.total
  const championInterval = wilsonInterval(champion.passed, champion.total)
  const challengerInterval = wilsonInterval(challenger.passed, challenger.total)
  if (challengerRate <= championRate) {
    return { promoted: false, denial: { reason: 'not-better', champion: championRate, challenger: challengerRate } }
  }
  if (challengerInterval.lower <= championInterval.upper) {
    return { promoted: false, denial: { reason: 'not-significant', championInterval, challengerInterval } }
  }
  return { promoted: true, variant: challenger.variant, championInterval, challengerInterval }
}

/**
 * Decide promotion over a report whose integrity is in question (must[3]).
 *
 * The evidence and the decision travel together into the Evidence Package, so a
 * report edited between running and reading would make the recorded decision
 * describe numbers nobody produced. Checked before the comparison, since a
 * tampered report usually says the challenger won.
 * @param recordedDigest - digest written when the report was produced.
 * @param observedDigest - digest of the report being read now.
 * @param champion - the incumbent's results, as read from that report.
 * @param challenger - the candidate's results, as read from that report.
 * @returns the decision, with tampering reported ahead of any comparison.
 */
export function decidePromotionFromReport(
  recordedDigest: string,
  observedDigest: string,
  champion: Arm,
  challenger: Arm,
): PromotionDecision {
  if (recordedDigest !== observedDigest) {
    return {
      promoted: false,
      denial: {
        reason: 'report-tampered',
        detail: `A/B report digest does not match what was recorded (recorded ${recordedDigest}, observed ${observedDigest})`,
      },
    }
  }
  return decidePromotion(champion, challenger)
}

/** Whether a guideline change may land, given its effect on the benchmark. */
export type RegressionVerdict =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly drop: number; readonly detail: string }

/**
 * Admit a guideline change only if the benchmark did not significantly drop
 * (must[4]).
 *
 * The mirror of {@link decidePromotion}, and deliberately NOT symmetric with
 * it: promotion demands significance to CHANGE something, while this demands
 * significance to BLOCK something. An ordinary run-to-run wobble must neither
 * promote a challenger nor block a change, so both directions require the
 * sample to support the claim before it acts.
 * @param before - the benchmark before the change.
 * @param after - the benchmark after it.
 * @returns whether the change may land.
 */
export function admitGuidelineChange(before: Arm, after: Arm): RegressionVerdict {
  if (before.total === 0 || after.total === 0) {
    return { admitted: false, drop: 0, detail: 'a change cannot be admitted against a benchmark that ran no trials' }
  }
  const beforeInterval = wilsonInterval(before.passed, before.total)
  const afterInterval = wilsonInterval(after.passed, after.total)
  if (afterInterval.upper < beforeInterval.lower) {
    return {
      admitted: false,
      drop: before.passed / before.total - after.passed / after.total,
      detail: 'the benchmark dropped significantly; the guideline change is refused (must[4])',
    }
  }
  return { admitted: true }
}

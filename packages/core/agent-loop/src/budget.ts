/**
 * Hard budgets for the agent loop (Epic P9-07, Contract stage).
 *
 * A budget expressed to the model as prompt text is a request. This module
 * defines it as a decision the loop makes for itself, before each turn, from
 * numbers the caller supplies — so a model that ignores or never sees the
 * instruction is bounded exactly the same.
 *
 * Contract stage only: these are pure functions over caller-supplied state. The
 * loop does not consult them yet, and doing so requires a `budget-exceeded`
 * session event, which reaches both SDKs and the recorded snapshots and so
 * belongs to the Usage stage rather than here.
 *
 * @module dsh-agent-loop/budget
 */

/**
 * What a run may spend before it must stop.
 *
 * **Zero and `undefined` both mean UNLIMITED**, and that is a deliberate,
 * documented choice rather than a fallback (must[3]). A limit of `0` read as
 * "no turns permitted" would make an explicitly-unlimited configuration halt a
 * run before its first turn — the most confusing possible reading of a field
 * whose whole purpose is to bound work. Callers that want a run to do nothing
 * do not start it.
 */
export interface LoopBudget {
  /** Maximum turns the loop may take; 0 or absent means unlimited. */
  readonly maxTurns?: number
  /** Maximum cost in USD across the run; 0 or absent means unlimited. */
  readonly maxSpendUsd?: number
}

/** What a run has consumed so far. */
export interface BudgetUsage {
  /** Turns already completed. The next turn would be number `turnsUsed + 1`. */
  readonly turnsUsed: number
  /**
   * Cost already incurred, in USD.
   *
   * Derived from `dsh-token-meter`'s accounting by the caller. While that meter
   * estimates at four characters per token, this figure is approximate; P9-05
   * replaces the estimator and this contract does not change when it does,
   * because the number's MEANING is unchanged.
   */
  readonly spentUsd: number
}

/** Why a run may not take another turn. */
export type BudgetDenialReason = 'max-turns-reached' | 'spend-cap-reached'

/** Whether another turn may begin. */
export type BudgetDecision =
  | { readonly admitted: true }
  | {
    readonly admitted: false
    readonly reason: BudgetDenialReason
    /** The configured limit that stopped the run. */
    readonly limit: number
    /** What had been consumed when the limit was reached. */
    readonly observed: number
  }

/** Whether a configured limit bounds anything at all. */
function isUnlimited(limit: number | undefined): boolean {
  return limit === undefined || limit === 0
}

/**
 * Decide whether the loop may begin another turn (must[0]).
 *
 * Checked BEFORE the turn rather than after it, which is what makes must[1]
 * satisfiable: a run refused here has completed every turn it started, so its
 * recorded state is a whole number of turns and a later `--resume` continues
 * from a boundary rather than from the middle of one. Deciding afterwards would
 * mean the turn that broke the budget had already run, and stopping would
 * either discard its work or record a half-turn.
 *
 * Turns are checked before spend so that a run at both limits reports the one a
 * caller can act on without pricing data.
 * @param usage - what the run has consumed.
 * @param budget - the configured limits.
 * @returns whether another turn may begin, and if not, which limit stopped it.
 */
export function decideTurnAdmission(usage: BudgetUsage, budget: LoopBudget): BudgetDecision {
  if (!isUnlimited(budget.maxTurns)) {
    const limit = budget.maxTurns as number
    if (usage.turnsUsed >= limit) {
      return { admitted: false, reason: 'max-turns-reached', limit, observed: usage.turnsUsed }
    }
  }
  if (!isUnlimited(budget.maxSpendUsd)) {
    const limit = budget.maxSpendUsd as number
    if (usage.spentUsd >= limit) {
      return { admitted: false, reason: 'spend-cap-reached', limit, observed: usage.spentUsd }
    }
  }
  return { admitted: true }
}

/**
 * Whether a budget constrains anything.
 *
 * Exported so a caller can tell "no budget configured" from "a budget that
 * happens not to bind yet" without re-deriving the zero-means-unlimited rule,
 * which is the rule most likely to be reimplemented differently elsewhere.
 * @param budget - the configured limits.
 * @returns whether any limit is in force.
 */
export function isBudgetEnforced(budget: LoopBudget): boolean {
  return !isUnlimited(budget.maxTurns) || !isUnlimited(budget.maxSpendUsd)
}

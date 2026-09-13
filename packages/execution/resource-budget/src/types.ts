/**
 * What a resource budget is (Epic P3-10, Contract stage): the scopes a budget
 * belongs to, the eight dimensions must[0] names, and the admission decision a
 * caller acts on.
 *
 * The world dimensions are P3-01's own words, taken from `dsh-execution-world`
 * rather than restated: a budget that named CPU, memory, disk, processes and
 * wall time differently from the world that enforces them would be a second
 * vocabulary for one fact. The three run-level counts (network bytes, tool
 * calls, agents) have no world counterpart and are declared here.
 *
 * This module holds metering and hard-limit primitives only (must[3]).
 * Scheduling fairness is P4-10's and consumes these from above (must[4]), so
 * nothing here orders, weights or prioritises one account against another.
 * @module @deepseek-ai/dsh-resource-budget/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorldLifetimeSpec, WorldProcessSpec, WorldResourcesSpec } from '@deepseek-ai/dsh-execution-world'

/**
 * The granularity a budget is held at, widest first (must[0]).
 *
 * An account's parent is always at a strictly wider scope. That ordering is
 * what makes acceptance[1] hold: work spread across subagents reserves against
 * the run it belongs to, never against a sibling it could open for itself.
 */
export type BudgetScope = 'tenant' | 'run' | 'action'

/** Scopes from widest to narrowest; an account's parent comes earlier in this list. */
export const BUDGET_SCOPES: readonly BudgetScope[] = ['tenant', 'run', 'action']

/** Opaque id of one budget account, chosen by the caller that opens it. */
export type BudgetAccountId = Branded<'BudgetAccountId'>

/**
 * The limits one budget sets. Each is optional, and **zero and `undefined` both
 * mean unlimited**, the same choice P9-07's `LoopBudget` makes and for the same
 * reason: an explicit `0` read as "nothing allowed" would stop work before it
 * starts, which callers that want no work get by not starting it.
 *
 * `cpuMillicores`, `memoryBytes`, `diskBytes`, `maxProcesses` and
 * `maxWallClockMs` carry P3-01's `WorldSpec` field types unchanged.
 */
export interface BudgetLimits {
  /** CPU ceiling, as `WorldResourcesSpec.cpuMillicores`. Held while reserved. */
  readonly cpuMillicores?: WorldResourcesSpec['cpuMillicores']
  /** Memory ceiling in bytes, as `WorldResourcesSpec.memoryBytes`. Held while reserved. */
  readonly memoryBytes?: WorldResourcesSpec['memoryBytes']
  /** Disk ceiling in bytes, as `WorldResourcesSpec.diskBytes`. Held while reserved. */
  readonly diskBytes?: WorldResourcesSpec['diskBytes']
  /** Live descendant processes, as `WorldProcessSpec.maxProcesses`. Held while reserved. */
  readonly maxProcesses?: WorldProcessSpec['maxProcesses']
  /**
   * Wall-clock ceiling, as `WorldLifetimeSpec.maxWallClockMs`. Not additive:
   * parallel work does not sum elapsed time, so a reservation is checked
   * against this value directly rather than against a running total.
   */
  readonly maxWallClockMs?: WorldLifetimeSpec['maxWallClockMs']
  /** Network bytes transferred. Consumed cumulatively. */
  readonly maxNetworkBytes?: number
  /** Tool calls made. Consumed cumulatively. */
  readonly maxToolCalls?: number
  /** Agents started. Consumed cumulatively. */
  readonly maxAgents?: number
}

/** A budget: the scope it is held at and the limits it sets (must[0]). */
export interface BudgetSpec {
  readonly scope: BudgetScope
  readonly limits: BudgetLimits
}

/**
 * An amount asked for or used, one number per dimension; an absent dimension
 * is zero.
 *
 * Named after the dimension rather than after its limit field
 * (`processes`, not `maxProcesses`), because an amount is not a maximum.
 */
export interface BudgetAmounts {
  readonly cpuMillicores?: number
  readonly memoryBytes?: number
  readonly diskBytes?: number
  readonly processes?: number
  readonly wallClockMs?: number
  readonly networkBytes?: number
  readonly toolCalls?: number
  readonly agents?: number
}

/** One of the eight dimensions, named as in {@link BudgetAmounts}. */
export type BudgetDimension = keyof BudgetAmounts

/** The eight dimensions must[0] names, in its order. */
export const BUDGET_DIMENSIONS: readonly BudgetDimension[] = [
  'wallClockMs',
  'cpuMillicores',
  'memoryBytes',
  'diskBytes',
  'processes',
  'networkBytes',
  'toolCalls',
  'agents',
]

/**
 * Dimensions a reservation HOLDS and returns on release: a ceiling on what is
 * in use at once. A memory reservation released is memory free again.
 */
export const HELD_DIMENSIONS: readonly BudgetDimension[] = ['cpuMillicores', 'memoryBytes', 'diskBytes', 'processes']

/**
 * Dimensions a reservation CONSUMES and never returns: a total across the
 * account's lifetime. A tool call released is still a tool call made.
 */
export const CONSUMED_DIMENSIONS: readonly BudgetDimension[] = ['networkBytes', 'toolCalls', 'agents']

/** Why a reservation was refused, naming the dimension whose limit it would pass. */
export type BudgetDenialReason =
  | 'cpu-limit-reached'
  | 'memory-limit-reached'
  | 'disk-limit-reached'
  | 'process-limit-reached'
  | 'wall-clock-limit-reached'
  | 'network-bytes-limit-reached'
  | 'tool-call-limit-reached'
  | 'agent-limit-reached'

/**
 * Whether a reservation is admitted.
 *
 * The same four fields as P9-07's `BudgetDecision` (delegate ruling, addendum
 * 366): a caller that already handles a loop budget refusal handles this one
 * the same way. The typed `resource_exhausted` outcome is P3-03's and is mapped
 * from this decision at the Provider stage, once that outcome exists.
 */
export type BudgetDecision =
  | { readonly admitted: true }
  | {
    readonly admitted: false
    readonly reason: BudgetDenialReason
    /** The configured limit that refused the reservation. */
    readonly limit: number
    /** What would have been in use or consumed, had the reservation been admitted. */
    readonly observed: number
  }

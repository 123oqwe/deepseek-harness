/**
 * Reservation and hierarchical accounting over resource budgets (Epic P3-10,
 * Contract stage).
 *
 * Every reservation is checked against its own account AND every enclosing
 * account, and applied to all of them or to none. That is acceptance[1]:
 * a cumulative budget cannot be bypassed by splitting work across subagents,
 * because subagents of one run reserve against that run's account, and a child
 * account opened under it spends from the same total.
 *
 * Contract stage only: this records what was reserved and consumed. It samples
 * nothing and enforces nothing; measuring real usage and enforcing a limit on
 * a running process are the Provider stage's, through the adapt backends on the
 * make-vs-use card.
 * @module @deepseek-ai/dsh-resource-budget/accounting
 */

import {
  BUDGET_SCOPES,
  CONSUMED_DIMENSIONS,
  HELD_DIMENSIONS,
  type BudgetAccountId,
  type BudgetAmounts,
  type BudgetDecision,
  type BudgetDenialReason,
  type BudgetDimension,
  type BudgetLimits,
  type BudgetSpec,
} from './types.ts'

/** Which limit field bounds each dimension, and the reason a refusal on it carries. */
const LIMIT_OF: Readonly<Record<BudgetDimension, { readonly field: keyof BudgetLimits; readonly reason: BudgetDenialReason }>> = {
  wallClockMs: { field: 'maxWallClockMs', reason: 'wall-clock-limit-reached' },
  cpuMillicores: { field: 'cpuMillicores', reason: 'cpu-limit-reached' },
  memoryBytes: { field: 'memoryBytes', reason: 'memory-limit-reached' },
  diskBytes: { field: 'diskBytes', reason: 'disk-limit-reached' },
  processes: { field: 'maxProcesses', reason: 'process-limit-reached' },
  networkBytes: { field: 'maxNetworkBytes', reason: 'network-bytes-limit-reached' },
  toolCalls: { field: 'maxToolCalls', reason: 'tool-call-limit-reached' },
  agents: { field: 'maxAgents', reason: 'agent-limit-reached' },
}

/**
 * The largest relative error a Provider stage's metering may show on each
 * dimension, declared before anything is measured (acceptance[2]).
 *
 * A bound stated after the measurement cannot be wrong, so it proves nothing.
 * The counted dimensions are exact because they are counted, not sampled. The
 * sampled ones allow 10% of the limit: a Provider stage that cannot measure
 * within it reports the dimension as partially enforced rather than widening
 * the number. Wall clock is exact against the monotonic clock that arms it.
 */
export const METERING_ERROR_BOUND: Readonly<Record<BudgetDimension, number>> = {
  wallClockMs: 0,
  cpuMillicores: 0.1,
  memoryBytes: 0.1,
  diskBytes: 0.1,
  processes: 0,
  networkBytes: 0.1,
  toolCalls: 0,
  agents: 0,
}

/**
 * The OTel `process.*` semantic-convention metric each dimension reconciles
 * against (must[1] telemetry reconciliation), copied as literals.
 *
 * Copied rather than imported: in `@opentelemetry/semantic-conventions` 1.43.0
 * these names exist only in the `incubating` entry point, whose own README asks
 * instrumentation not to import it at runtime and to copy the definitions
 * instead. A frozen case compares these literals with that package's constants
 * at the pinned version.
 *
 * Four dimensions have no `process.*` metric and are left out on purpose:
 * `process.thread.count` counts threads, not descendant processes,
 * `process.uptime` is a process's age rather than an action's wall time, and
 * tool calls and agents are not process measurements at all.
 */
export const PROCESS_SEMCONV_METRICS = {
  cpuMillicores: 'process.cpu.time',
  memoryBytes: 'process.memory.usage',
  diskBytes: 'process.disk.io',
  networkBytes: 'process.network.io',
} as const satisfies Partial<Record<BudgetDimension, string>>

/** A reservation that was admitted, to be passed back to {@link BudgetLedger.release}. */
export interface BudgetReservation {
  readonly account: BudgetAccountId
  readonly amounts: BudgetAmounts
}

/** The result of asking for a reservation. */
export type ReservationResult =
  | { readonly decision: { readonly admitted: true }; readonly reservation: BudgetReservation }
  | { readonly decision: Exclude<BudgetDecision, { readonly admitted: true }> }

/** What an account has in use and has consumed, per dimension. */
export interface BudgetUsage {
  readonly held: Readonly<Record<BudgetDimension, number>>
  readonly consumed: Readonly<Record<BudgetDimension, number>>
}

interface Account {
  readonly id: BudgetAccountId
  readonly spec: BudgetSpec
  readonly parent: Account | undefined
  readonly held: Record<BudgetDimension, number>
  readonly consumed: Record<BudgetDimension, number>
}

/** Thrown when an account is opened or addressed in a way the scope order forbids. */
export class BudgetAccountError extends Error {}

/** A zero for every dimension. */
function zeroes(): Record<BudgetDimension, number> {
  return {
    wallClockMs: 0,
    cpuMillicores: 0,
    memoryBytes: 0,
    diskBytes: 0,
    processes: 0,
    networkBytes: 0,
    toolCalls: 0,
    agents: 0,
  }
}

/**
 * Whether a configured limit bounds anything at all.
 * @param limit - the configured limit, possibly absent.
 * @returns true when it is absent or zero.
 */
function isUnlimited(limit: number | undefined): boolean {
  return limit === undefined || limit === 0
}

/**
 * Which limit a reservation of `amount` on `dimension` would pass in `account`,
 * or undefined when it passes none.
 * @param account - the account to check.
 * @param dimension - the dimension asked for.
 * @param amount - how much is asked for.
 * @returns the refusal, or undefined when this account admits it.
 */
function refusalIn(account: Account, dimension: BudgetDimension, amount: number): BudgetDecision | undefined {
  if (amount === 0) return undefined
  const { field, reason } = LIMIT_OF[dimension]
  const limit = account.spec.limits[field]
  if (isUnlimited(limit)) return undefined
  const bound = limit as number
  // Wall clock is a ceiling per reservation, never a running total: two
  // parallel actions of a run do not add their elapsed time.
  const observed = dimension === 'wallClockMs'
    ? amount
    : (HELD_DIMENSIONS.includes(dimension) ? account.held[dimension] : account.consumed[dimension]) + amount
  return observed > bound ? { admitted: false, reason, limit: bound, observed } : undefined
}

/**
 * Accounts, their tree, and what each has reserved and consumed.
 *
 * One ledger per enforcement domain. An account is keyed by the tenant, run or
 * action it bounds, never by the agent instance doing the work.
 */
export class BudgetLedger {
  private readonly accounts = new Map<BudgetAccountId, Account>()

  /**
   * Open an account under an optional parent at a strictly wider scope.
   * @param id - the account's id; must be new.
   * @param spec - the budget it holds.
   * @param parent - the enclosing account, or undefined for a root.
   * @throws {BudgetAccountError} when the id exists, the parent is unknown, or the parent's scope is not strictly wider.
   */
  open(id: BudgetAccountId, spec: BudgetSpec, parent?: BudgetAccountId): void {
    if (this.accounts.has(id)) throw new BudgetAccountError(`budget account ${String(id)} is already open`)
    const parentAccount = parent === undefined ? undefined : this.accounts.get(parent)
    if (parent !== undefined && parentAccount === undefined) {
      throw new BudgetAccountError(`budget account ${String(id)} names unknown parent ${String(parent)}`)
    }
    if (parentAccount !== undefined && BUDGET_SCOPES.indexOf(parentAccount.spec.scope) >= BUDGET_SCOPES.indexOf(spec.scope)) {
      // The rule acceptance[1] rests on: a child at the same scope as its parent
      // would be a sibling budget in disguise, spending from its own total.
      throw new BudgetAccountError(`a ${spec.scope} account cannot open under a ${parentAccount.spec.scope} account`)
    }
    this.accounts.set(id, { id, spec, parent: parentAccount, held: zeroes(), consumed: zeroes() })
  }

  /**
   * Reserve amounts against an account and every enclosing account, all or none.
   * @param id - the account the work belongs to.
   * @param amounts - what the work asks for.
   * @returns the admitted reservation, or the first refusal found from the account outward.
   * @throws {BudgetAccountError} when the account is unknown.
   */
  reserve(id: BudgetAccountId, amounts: BudgetAmounts): ReservationResult {
    const account = this.require(id)
    for (let current: Account | undefined = account; current !== undefined; current = current.parent) {
      for (const dimension of Object.keys(LIMIT_OF) as BudgetDimension[]) {
        const refusal = refusalIn(current, dimension, amounts[dimension] ?? 0)
        if (refusal !== undefined && !refusal.admitted) return { decision: refusal }
      }
    }
    for (let current: Account | undefined = account; current !== undefined; current = current.parent) {
      for (const dimension of HELD_DIMENSIONS) current.held[dimension] += amounts[dimension] ?? 0
      for (const dimension of CONSUMED_DIMENSIONS) current.consumed[dimension] += amounts[dimension] ?? 0
    }
    return { decision: { admitted: true }, reservation: { account: id, amounts } }
  }

  /**
   * Return a reservation's held dimensions to the account and every enclosing
   * account. Consumed dimensions stay consumed.
   * @param reservation - a reservation this ledger admitted.
   * @throws {BudgetAccountError} when its account is unknown.
   */
  release(reservation: BudgetReservation): void {
    for (let current: Account | undefined = this.require(reservation.account); current !== undefined; current = current.parent) {
      for (const dimension of HELD_DIMENSIONS) current.held[dimension] -= reservation.amounts[dimension] ?? 0
    }
  }

  /**
   * What an account has in use and has consumed, including all work beneath it.
   * @param id - the account.
   * @returns a snapshot of its usage.
   * @throws {BudgetAccountError} when the account is unknown.
   */
  usage(id: BudgetAccountId): BudgetUsage {
    const account = this.require(id)
    return { held: { ...account.held }, consumed: { ...account.consumed } }
  }

  /**
   * The account for an id.
   * @param id - the account id.
   * @returns the account.
   * @throws {BudgetAccountError} when the account is unknown.
   */
  private require(id: BudgetAccountId): Account {
    const account = this.accounts.get(id)
    if (account === undefined) throw new BudgetAccountError(`budget account ${String(id)} is not open`)
    return account
  }
}

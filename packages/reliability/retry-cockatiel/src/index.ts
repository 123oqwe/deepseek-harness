/**
 * The circuit-breaker provider: one `cockatiel` policy per destination, behind
 * `@deepseek-ai/dsh-retry`'s Service Definition (Epic P4-11, must[2]).
 *
 * `cockatiel` owns consecutive-failure counting, the open period and half-open
 * probing. This module owns only what the harness decides: which destinations
 * are separate, and which failures count against an endpoint's health.
 *
 * @module @deepseek-ai/dsh-retry-cockatiel
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  BreakerOpenError,
  classifyFailure,
  type BreakerDestination,
  type CircuitBreakerContract,
  type FailureFacts,
} from '@deepseek-ai/dsh-retry'
import {
  BrokenCircuitError,
  ConsecutiveBreaker,
  circuitBreaker,
  handleWhen,
  type CircuitBreakerPolicy,
} from 'cockatiel'

/** Deployment-varying breaker settings. */
export interface Config {
  /** Consecutive counted failures that open a destination. */
  readonly consecutiveFailures: number
  /** Milliseconds a destination stays open before a half-open probe. */
  readonly openMs: number
}

/**
 * Both fields vary by deployment: a shared endpoint under many tenants wants a
 * higher threshold than a dedicated one, and the open period trades recovery
 * latency against probe load on an endpoint that is already failing.
 */
export const Config: z<Config> = z.object({
  consecutiveFailures: z.natural().default(5),
  openMs: z.natural().default(30_000),
})

/**
 * The key one breaker's state is kept under.
 *
 * All three fields participate: two models at one base URL fail
 * independently — a decommissioned model returns errors from a healthy
 * endpoint — and the provider name distinguishes two deployments that share a
 * URL through different credentials.
 */
function destinationKey(destination: BreakerDestination): string {
  return `${destination.provider} ${destination.baseUrl} ${destination.model}`
}

/**
 * The error a counted failure is rethrown as, so `cockatiel`'s predicate can
 * recognize it without inspecting the caller's error type.
 *
 * The original is carried and rethrown to the caller unchanged: a caller
 * awaiting an `LlmError` must not receive a breaker-internal type instead.
 */
class CountedFailure extends Error {
  constructor(readonly original: unknown) {
    super('counted endpoint failure')
    this.name = 'CountedFailure'
  }
}

/**
 * Mounts `ctx.circuitBreaker` with one `cockatiel` policy per destination.
 *
 * Policies are created on first use rather than declared, because the set of
 * destinations is not known at mount: a base URL and model arrive with a call
 * config, and a deployment that adds a model would otherwise need its breaker
 * configuration edited to keep protecting it.
 */
export default class CockatielCircuitBreaker extends Service implements CircuitBreakerContract {
  static readonly inject = []
  static readonly Config = Config

  private readonly policies = new Map<string, CircuitBreakerPolicy>()

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'circuitBreaker')
  }

  /**
   * The policy for one destination, created on first use.
   *
   * `handleWhen` counts only {@link CountedFailure}, so a failure the
   * classifier called permanent — a policy denial, a malformed request —
   * passes through without moving the breaker.
   */
  private policyFor(destination: BreakerDestination): CircuitBreakerPolicy {
    const key = destinationKey(destination)
    const existing = this.policies.get(key)
    if (existing !== undefined) return existing
    const policy = circuitBreaker(handleWhen(error => error instanceof CountedFailure), {
      halfOpenAfter: this.config.openMs,
      breaker: new ConsecutiveBreaker(this.config.consecutiveFailures),
    })
    this.policies.set(key, policy)
    return policy
  }

  /**
   * Run `operation` unless its destination is open (must[2]).
   * @param destination - the endpoint the operation addresses.
   * @param operation - the work to attempt.
   * @param classify - reads the thrown value into facts the classifier decides on.
   * @returns the operation's own result.
   * @throws {BreakerOpenError} when the destination is open, without running
   *   `operation`.
   */
  async execute<T>(
    destination: BreakerDestination,
    operation: () => Promise<T>,
    classify: (error: unknown) => FailureFacts,
  ): Promise<T> {
    try {
      return await this.policyFor(destination).execute(async () => {
        try {
          return await operation()
        } catch (error) {
          throw classifyFailure(classify(error)).retryable ? new CountedFailure(error) : error
        }
      })
    } catch (error) {
      if (error instanceof BrokenCircuitError) throw new BreakerOpenError(destination)
      if (error instanceof CountedFailure) throw error.original
      throw error
    }
  }
}

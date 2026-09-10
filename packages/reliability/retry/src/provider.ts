/**
 * The circuit-breaker Service Definition: what a breaker means to a caller,
 * independent of the library that implements one (Epic P4-11, must[2]).
 *
 * Declared here rather than in a provider so the service name means the
 * contract and not an implementation — the same reason
 * `@deepseek-ai/dsh-lease-contract` declares `leaseStore`. This package gains
 * no runtime dependency: `cockatiel` is confined to
 * `@deepseek-ai/dsh-retry-cockatiel`.
 */

import type { FailureFacts } from './classify.ts'

/**
 * The endpoint a breaker's state is kept for.
 *
 * Keyed per DESTINATION rather than per provider name because one provider can
 * front more than one endpoint — `llm-deepseek` resolves a base URL per call
 * config — and a sick endpoint must not open the breaker for a healthy one.
 * Narrowing this to a provider later leaves the contract unchanged; widening
 * it would not.
 */
export interface BreakerDestination {
  /** The provider whose endpoint this is, for reporting and grouping. */
  readonly provider: string
  /** The resolved endpoint URL the attempt is sent to. */
  readonly baseUrl: string
  /** The model addressed at that endpoint. */
  readonly model: string
}

/**
 * Thrown INSTEAD of running an operation whose destination is open.
 *
 * A refusal is thrown rather than returned so a caller cannot proceed by
 * ignoring a value: an open breaker means the operation must not be attempted,
 * and a returned flag would let a caller consult it or not.
 */
export class BreakerOpenError extends Error {
  constructor(readonly destination: BreakerDestination) {
    super(`circuit breaker open for ${destination.provider} ${destination.model}`)
    this.name = 'BreakerOpenError'
  }
}

/**
 * The mounted circuit breaker, published by whichever provider a profile
 * mounts.
 *
 * One operation, not a consult-then-record pair: a contract that reported
 * state separately would leave the consultation to every caller, and a caller
 * that forgot would still compile and still pass its own tests.
 */
export interface CircuitBreakerContract {
  /**
   * Run `operation` unless its destination's breaker is open, counting the
   * outcome toward that destination's health.
   *
   * `classify` is required rather than inferred because what counts as
   * endpoint ill-health is {@link classifyFailure}'s decision applied to facts
   * only the caller can read: a policy denial is permanent but says nothing
   * about the endpoint, and counting it would open a breaker on a working
   * destination. The breaker never inspects a raw error itself.
   * @param destination - the endpoint the operation addresses.
   * @param operation - the work to attempt.
   * @param classify - reads the thrown value into facts this package decides on.
   * @returns the operation's own result.
   * @throws {BreakerOpenError} when the destination is open, WITHOUT running
   *   `operation`.
   */
  execute<T>(
    destination: BreakerDestination,
    operation: () => Promise<T>,
    classify: (error: unknown) => FailureFacts,
  ): Promise<T>
}

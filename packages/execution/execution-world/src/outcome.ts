/**
 * The typed outcome of an execution that did not succeed (Epic P3-03
 * must[0]): a closed vocabulary named by `kind`, each with typed detail, so
 * a retry policy, the session log, the SDK and the UI read one classification
 * rather than each re-deriving it from text.
 *
 * An outcome is decided from control-channel facts only, an error's
 * structured name and code or a provider's failure code, and never from
 * output a program or a model wrote (must[1]); `./errors.ts` holds those
 * mappings.
 * @module @deepseek-ai/dsh-execution-world/outcome
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Which gate refused an execution before it ran. */
export type DenialSource = 'policy' | 'risk' | 'approval' | 'ledger' | 'dispatch' | 'sandbox'

/** The ceiling or budget an execution exceeded. */
export type ExhaustedLimit = 'memory' | 'cpu' | 'tasks' | 'budget' | 'ceiling'

/** What stopped an execution at its deadline: the tool-call guard, the executor, or the model provider. */
export type TimeoutSource = 'tool-guard' | 'executor' | 'provider'

/**
 * What cancelled an execution: an abort signal, an interrupt of the turn, or
 * a fence (the run held its work item and another holder took it over, so
 * the work is already being done elsewhere).
 */
export type CancelSource = 'abort' | 'interrupt' | 'fenced'

/**
 * Why the world an execution needed is gone or was never granted: contact
 * with it was lost, its provider failed, or the run was refused the lease on
 * its work item (another holder owns it).
 */
export type WorldLossReason = 'lost-contact' | 'provider-failed' | 'lease-refused'

/** How an execution ended other than with success. */
export type ExecutionOutcome =
  | { readonly kind: 'policy_denied'; readonly source: DenialSource; readonly name: string }
  | { readonly kind: 'resource_exhausted'; readonly limit: ExhaustedLimit }
  | { readonly kind: 'timeout'; readonly by: TimeoutSource; readonly deadlineMs?: number }
  | { readonly kind: 'cancelled'; readonly by: CancelSource }
  | { readonly kind: 'tool_failed'; readonly exitCode?: number; readonly signal?: string; readonly code?: string }
  | { readonly kind: 'world_lost'; readonly reason: WorldLossReason; readonly provider?: string }

/**
 * Whether trying an execution again can change its outcome: `permanent` when
 * it cannot as asked, `transient` when a later attempt may succeed, `by-tool`
 * when only the tool or provider that failed can say.
 */
export type RetryClass = 'permanent' | 'transient' | 'by-tool'

/**
 * The retry class an outcome implies (acceptance[2]). A refusal, an exhausted
 * budget and a cancellation do not change by repeating the same request; a
 * deadline and a lost world may; a tool's own failure is the tool's to judge.
 * @param outcome - the outcome.
 * @returns its retry class.
 */
export function retryClassOf(outcome: ExecutionOutcome): RetryClass {
  switch (outcome.kind) {
    case 'policy_denied':
    case 'resource_exhausted':
    case 'cancelled':
      return 'permanent'
    case 'timeout':
    case 'world_lost':
      return 'transient'
    case 'tool_failed':
      return 'by-tool'
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(outcome, 'ExecutionOutcome')
  }
}

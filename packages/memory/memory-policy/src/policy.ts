/**
 * The proposal-policy provider: mounts `ctx.memoryProposalPolicy`, which
 * `@deepseek-ai/dsh-memory`'s `propose` consults to decide whether a candidate
 * write is auto-accepted, sent to review, or rejected (P6-03 `must[1]`,
 * `must[2]`). `propose` reaches it through `ctx.get('memoryProposalPolicy')`, so
 * a deployment that omits this plugin keeps the pre-P6-03 behaviour — every
 * traceable write is auto-accepted — and mounting it is what turns the policy
 * on for a `dsh` a user starts.
 *
 * @module @deepseek-ai/dsh-memory-policy
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { MemoryProposeRequest } from '@deepseek-ai/dsh-memory'
import { decideProposal, type MemoryProposalDecision } from './proposal.ts'

/** Deployment-varying proposal-policy settings. */
export interface Config {
  /**
   * A `derived` claim whose writer confidence is below this goes to review
   * rather than active memory. Varies by deployment: a shared store wants a
   * higher bar than a personal one.
   */
  readonly reviewBelowConfidence: number
}

/** Confidence is a probability in [0, 1]; the review bar sits inside it. */
export const Config: z<Config> = z.object({
  reviewBelowConfidence: z.number().min(0).max(1).default(0.5),
})

/**
 * Mounts `ctx.memoryProposalPolicy`. The service is stateless: it applies the
 * pure {@link decideProposal} to each request with this deployment's thresholds.
 */
export default class MemoryProposalPolicyService extends Service {
  static readonly inject = []
  static readonly Config = Config

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'memoryProposalPolicy')
  }

  /**
   * Decide a proposal's disposition.
   * @param request - the candidate write, already traceable.
   * @returns the disposition and its reason.
   */
  decide(request: MemoryProposeRequest): MemoryProposalDecision {
    return decideProposal(request, { reviewBelowConfidence: this.config.reviewBelowConfidence })
  }
}

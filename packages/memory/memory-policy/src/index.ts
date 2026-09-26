/**
 * P6-03 proposal policy (`@deepseek-ai/dsh-memory-policy`): the provider that
 * decides whether a candidate memory write is auto-accepted, sent to human
 * review, or rejected, and the pure decision it applies. `@deepseek-ai/dsh-memory`
 * consults the mounted `memoryProposalPolicy` service from its `propose` path.
 *
 * The service is declared here, in the package entry, rather than re-exported
 * from another module, so the config-catalog generator finds the default
 * export's declared `Config` and lists this package's one settable field.
 * @module @deepseek-ai/dsh-memory-policy
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { MemoryProposeRequest } from '@deepseek-ai/dsh-memory'
import { decideProposal } from './proposal.ts'
import type { MemoryProposalDecision } from './proposal.ts'

export { decideProposal }
export type { MemoryProposalDecision }
export type {
  MemoryProposalDisposition,
  MemoryProposalThresholds,
} from './proposal.ts'

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

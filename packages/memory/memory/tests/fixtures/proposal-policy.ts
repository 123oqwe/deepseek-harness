/**
 * A proposal-policy double for this package's own cases.
 *
 * `@deepseek-ai/dsh-memory-policy` depends on this package, so these cases
 * cannot mount it. The double decides the requests they make as that policy
 * does: a proposal that states `normal` sensitivity is accepted, and one that
 * states another sensitivity or none waits for review (P6-03 must[1], must[2]).
 * The policy's own tests pin its full rule.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MemoryProposeRequest } from '@deepseek-ai/dsh-memory'

/**
 * Provide `memoryProposalPolicy` on a context, where `propose` reads it.
 * @param ctx - the context the memory runtime is mounted on.
 */
export function provideProposalPolicy(ctx: Context): void {
  ctx.provide('memoryProposalPolicy', {
    decide: (request: MemoryProposeRequest) => request.sensitivity === 'normal'
      ? { disposition: 'auto-accept', reason: 'normal sensitivity' }
      : { disposition: 'review', reason: 'a sensitivity other than normal, or none, waits for review' },
  })
}

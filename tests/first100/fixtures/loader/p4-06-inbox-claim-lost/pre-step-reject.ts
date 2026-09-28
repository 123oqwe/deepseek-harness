/**
 * Test-only plugin for P4-06 lock (a)'s claim-before-record measurement
 * (BLOCKED-088, blind review F2): reject the FIRST `agent/pre-step` whose
 * claimed messages carry the marker, then delegate every later step. The reject
 * happens after the loop has claimed the marked message out of the inbox
 * (agent.ts:272) and before it would be written to the conversation record
 * (agent.ts:433), so it stands for a turn that aborts, is refused by a pre-step
 * hook, or errors in that window. It is a waterfall listener: returning without
 * calling `next()` short-circuits the chain.
 * @module tests/first100/fixtures/loader/p4-06-inbox-claim-lost/pre-step-reject
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'

/** The marker a delivered message carries to be rejected once after it is claimed. */
export const REJECT_MARKER = 'P4-06-REJECT-ME'

/** Plugin name. */
export const name = 'p4-06-inbox-claim-lost-pre-step-reject'

/**
 * Register the one-shot pre-step rejecter.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let rejectedOnce = false
  ctx.on('agent/pre-step', ({ messages }, next): Promise<PreStepDecision> => {
    const carriesMarker = messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes(REJECT_MARKER)))
    if (!rejectedOnce && carriesMarker) {
      rejectedOnce = true
      return Promise.resolve<PreStepDecision>({ kind: 'reject' })
    }
    return next()
  })
}

/**
 * Shared suite helper: keep this package's stand-in parent out of a scripted
 * model corpus.
 * @module park-parent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * Reject every step of the stand-in parent. Each child settlement wakes its
 * parent, and these suites size their scripts for child turns only; the tests
 * assert on delivery rather than on the parent's own turn. Each refusal drops
 * what the step claimed on purpose, so the refused messages do not collect in
 * the parent's inbox.
 * @param ctx - the booted test context.
 * @param parent - the stand-in parent whose turns must not reach the model.
 */
export function parkParent(ctx: Context, parent: { id: SessionId }): void {
  ctx.on('agent/pre-step', async ({ agent: subject, messages }, next) => {
    if (subject.id !== parent.id) return next()
    return { kind: 'reject' as const, dropped: [{ messageIds: messages.map(message => message.id), by: 'test-park-parent', reason: 'the parked parent runs no turn' }] }
  })
}

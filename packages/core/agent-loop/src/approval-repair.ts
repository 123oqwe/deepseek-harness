/**
 * Crash repair for approvals: an interrupted final turn's unanswered asks are
 * decided `cancelled` inside that turn (Epic P2-07 acceptance[0]).
 *
 * A turn the host died in may hold an `approval/asked` with no
 * `approval/decided`: the question was put to the operator and the process
 * ended before an answer. Nothing in a later lifecycle answers it — the
 * answerer, the waiting call and the signal belonged to the dead process — and
 * the call it gated is closed by `interruptedTurnClosers` as not started
 * or of unknown outcome. The ask is therefore recorded as withdrawn, the
 * outcome an aborted request settles as, so the log holds a definite state
 * for every approval after the restart. The decision goes inside the turn,
 * before its synthesized step and turn ends, because an approval pair is only
 * valid inside an open turn.
 * @module @deepseek-ai/dsh-agent-loop/approval-repair
 */

import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'

/**
 * Add a `cancelled` decision for each ask the interrupted final turn left
 * unanswered to that turn's crash-repair closers.
 * @param persisted - the stored log being resumed.
 * @param closers - what `interruptedTurnClosers` returned for `persisted`.
 * @returns `closers` itself when the log is balanced or the final turn left no
 *   ask unanswered; otherwise the closers with one decision per such ask, in
 *   ask order, before the step and turn ends, whose seqs move up to stay
 *   contiguous.
 */
export function closeUnansweredApprovals(
  persisted: readonly SessionEvent[],
  closers: readonly SessionEvent[],
): readonly SessionEvent[] {
  const end = closers.find(event => event.type === 'step/end' || event.type === 'turn/end')
  if (end === undefined) return closers
  // Only the final turn's asks: each turn start begins a new set, and a
  // balanced earlier turn decided every ask it made.
  const unanswered = new Set<ApprovalRequestId>()
  for (const event of persisted) {
    switch (event.type) {
      case 'turn/start':
        unanswered.clear()
        break
      case 'approval/asked':
        unanswered.add(event.data.id)
        break
      case 'approval/decided':
        unanswered.delete(event.data.id)
        break
      // No other event opens or answers an ask.
      default:
        break
    }
  }
  if (unanswered.size === 0) return closers
  const endAt = closers.indexOf(end)
  let next: number = end.seq
  const decisions = [...unanswered].map((id): SessionEvent => ({
    type: 'approval/decided',
    seq: SessionSeq(next++),
    time: end.time,
    data: { id, outcome: 'cancelled' },
  }))
  const ends = closers.slice(endAt).map((event): SessionEvent => ({ ...event, seq: SessionSeq(next++) }))
  return [...closers.slice(0, endAt), ...decisions, ...ends]
}

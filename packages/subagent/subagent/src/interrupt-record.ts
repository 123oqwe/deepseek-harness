/**
 * A human parent's interrupt of one continuable child, committed to the
 * durable bus before the cancel signal is issued (Epic P5-10 must[2],
 * acceptance[0]; BLOCKED-343).
 *
 * **The bus, because the commit is synchronous.** `interruptByParent`
 * returns synchronously, and a host can die before any later turn runs. The
 * bus commits inside one `BEGIN IMMEDIATE` on a `DatabaseSync`, so the record
 * is in `bus.sqlite` when the call returns. The child's session log is not an
 * option: live events are buffered and written asynchronously, so a record
 * appended there is lost when the process is killed right after the call.
 *
 * **The key is the settlement outbox's triple.** `source` names the record
 * kind, `id` is the child session, and `epoch` is the lease epoch of the
 * residency that was interrupted. An interrupt carries no caller-minted
 * request id; what makes two interrupts the same is that they stop the same
 * residency, and the lease store, not a caller, issued that epoch. A repeat
 * in the same residency therefore finds its record already consumed and
 * commits nothing.
 *
 * @module @deepseek-ai/dsh-subagent/interrupt-record
 */

import type MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** The interrupt record's source name, the first part of its bus key. */
const INTERRUPT_SOURCE = 'subagent-interrupted'

/**
 * Commit that a child's direct parent interrupted one residency of it.
 * @param bus - the mounted durable bus.
 * @param interrupt - the child, its direct parent, and the lease epoch of the interrupted residency.
 * @returns whether a new record was stored; `false` when this residency's interrupt was already recorded.
 */
export function commitInterrupt(
  bus: MessageBusPlugin,
  interrupt: {
    readonly childId: SessionId
    readonly parentSessionId: SessionId
    readonly epoch: number
  },
): boolean {
  const { childId, parentSessionId, epoch } = interrupt
  if (bus.inboxRow(INTERRUPT_SOURCE, childId, epoch)?.state === 'consumed') return false
  bus.commitIntake({
    message: {
      id: childId,
      epoch,
      source: INTERRUPT_SOURCE,
      type: 'subagent/interrupt',
      time: new Date().toISOString(),
      subject: parentSessionId,
      // The control message the interrupt is, in `control-convergence`'s vocabulary.
      data: { kind: 'cancel' },
    },
    claimedByTurn: 0,
    outbox: [],
  })
  return true
}

/**
 * Whether the bus holds an interrupt of any residency of this child, committed in this process or an earlier one.
 * @param bus - the mounted durable bus.
 * @param childId - the child to look up.
 * @returns whether an interrupt of the child is recorded.
 */
export function interruptRecorded(bus: MessageBusPlugin, childId: SessionId): boolean {
  return bus.domainEvents().some(event => event.source === INTERRUPT_SOURCE && event.id === childId)
}

/**
 * Which control messages a child has already had applied, rebuilt from a
 * durable log (Epic P5-10 must[2]).
 *
 * **must[2] says durable, and an in-memory set is not that.** `SubagentRuntime`
 * kept `appliedEpochs` in a `Map` that lives as long as the process, which
 * refuses a redelivery within one run and forgets every one across a restart —
 * and a restart is exactly when a client that never saw its acknowledgement
 * retries.
 *
 * **The log it is rebuilt from is the CHILD's, and that is a correction to
 * §12.26's premise rather than a preference.** The ruling assumed control
 * dispatch already lands in the PARENT's session log; measured on this tree, it
 * does not — `SubagentRuntime` emits Cordis events for lifecycle and appends
 * nothing to the parent for a prompt or an interrupt. What IS durable is the
 * delivered message itself: it lands in the child's inbox carrying
 * `source.rpcId`, the request id the epoch is derived from, and a child's
 * SESSION outlives the child's Agent. So the reconstruction has a real source
 * without the new event §12.26 excluded.
 *
 * @module @deepseek-ai/dsh-subagent/control-ledger
 */

import type { Session } from '@deepseek-ai/dsh-session'

/** Reads the control epochs already applied to one child. */
export interface ControlLedger {
  /**
   * Whether this control epoch was already applied to this child.
   * @param controlEpoch - the epoch a message carries.
   * @returns whether it has been applied.
   */
  has(controlEpoch: number): boolean
  /**
   * Record an applied epoch for the rest of this process's life.
   *
   * The durable record is the delivered message; this is the same fact held
   * for the window between delivering and the next reconstruction, so a
   * redelivery arriving in that window is refused without a log read.
   * @param controlEpoch - the epoch just applied.
   */
  add(controlEpoch: number): void
}

/**
 * Build a ledger over one child's durable session.
 *
 * The session is resolved lazily, because a child's session exists before its
 * Agent does and outlives it: resolving once at construction would bind the
 * ledger to whichever of those moments it happened to be built in.
 * @param sessionOf - resolves the child's session, absent when it has none yet.
 * @param epochOf - derives the control epoch from a delivered message's request id.
 * @returns the ledger.
 */
export function openControlLedger(
  sessionOf: () => Session | undefined,
  epochOf: (requestId: string) => number,
): ControlLedger {
  const applied = new Set<number>()
  return {
    has(controlEpoch) {
      if (applied.has(controlEpoch)) return true
      const session = sessionOf()
      if (session === undefined) return false
      // Read at ASK time rather than cached at construction: a child whose
      // session gained messages since is exactly the case a redelivery arrives
      // in, and a snapshot taken earlier would answer about a past log.
      for (const event of session.snapshotEvents()) {
        if (event.type !== 'user/message') continue
        const source = event.data.source as { rpcId?: unknown }
        if (typeof source.rpcId !== 'string') continue
        if (epochOf(source.rpcId) === controlEpoch) return true
      }
      return false
    },
    add(controlEpoch) {
      applied.add(controlEpoch)
    },
  }
}

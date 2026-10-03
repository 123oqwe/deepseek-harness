/**
 * Names and the report the A-600 ledger-replay-crash driver and the spec beside
 * it share.
 * @module tests/first100/fixtures/loader/p4-12-replay-crash/shared
 */

/** The line prefix the spec parses the orchestrated JSON report from. */
export const REPORT_PREFIX = 'P4-12-REPLAY-CRASH'

/**
 * The tool call id the scripted model gives the external-effect call, both in the
 * first (crashed) turn and in the replay after the restart. The idempotency key
 * is derived from (session, actionId, argumentsHash) and `actionId` IS this call
 * id (external-effect.ts:151), so re-issuing it under the resumed session with the
 * same arguments presents the SAME key — the replay a crash-and-retry produces.
 */
export const CALL_ID = 'p4-12-charge-call'

/** The external-effect fixture tool the model calls. */
export const CHARGE_TOOL = 'p4_12_charge'

/** What the `before` phase recorded just before the SIGKILL, and what `after` observed after the restart. */
export interface ReplayReport {
  /** The pre-crash phase: the reserved-then-stuck entry and where the kill landed. */
  readonly before: {
    readonly status: number | null
    readonly signal: string | null
    readonly reading: {
      readonly sessionId: string
      /** The ledger scope and key the call reserved under, read from the appended manifest. */
      readonly scope: string | null
      readonly key: string | null
      /** The entry's state the instant the tool's body was reached — `sent` once reserve+markSent ran before execute. */
      readonly entryStateBeforeKill: string | null
      /** Whether the tool's body actually ran before the kill (its marker is on disk). */
      readonly toolReached: boolean
    }
  }
  /** The post-restart phase: the replay of the same call under the resumed session. */
  readonly after: {
    readonly status: number | null
    readonly signal: string | null
    readonly reading: {
      /** The entry's state after the resumed session replayed the same call id. */
      readonly entryStateAfterReplay: string | null
      /** Whether the entry's key is in the ledger's ambiguous list for its scope. */
      readonly inAmbiguousList: boolean
      /** The tool result text the model received for the replayed call. */
      readonly replayResultText: string
      /** How many times the tool's body ran across the whole run (1 = only the pre-crash run; the replay did not re-execute). */
      readonly toolRuns: number
      /** The synthetic result crash repair gave the unresolved call on resume — background, not asserted. */
      readonly syntheticResult: string | null
    }
  }
}

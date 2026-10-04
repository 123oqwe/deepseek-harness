/**
 * Names and report shapes the A-610 duplicate-side-effect driver and the spec
 * beside it share. A-610 is the red-first for B-726 (P4-12 acceptance[0] "zero
 * duplicate external effects" and acceptance[1] "an ambiguous entry is not
 * blindly retried; it enters reconciliation"), reusing the A-600 crash harness.
 * @module tests/first100/fixtures/loader/a-610-duplicate-sideeffect/shared
 */

/** The line prefix the spec parses the orchestrated JSON report from. */
export const REPORT_PREFIX = 'P4-12-DUP'

/** The external-effect fixture tool the model calls. */
export const CHARGE_TOOL = 'p4_12_charge'

/** The call id of the FIRST (crashed) charge, whose reservation is left `sent`. */
export const ORIGINAL_CALL_ID = 'p4-12-dup-original'

/**
 * The call id the resumed session re-sends the SAME action under. A DIFFERENT id
 * from {@link ORIGINAL_CALL_ID}, so the idempotency key — (session, actionId =
 * call id, argumentsHash), external-effect.ts:151 — DIFFERS: this is a crash
 * followed by the model re-issuing the same action as a fresh call, the duplicate
 * side-effect P4-12 acceptance[0] forbids.
 */
export const RESEND_CALL_ID = 'p4-12-dup-resend'

/** The call id of the unrelated, different-arguments control call (no crash). */
export const CONTROL_CALL_ID = 'p4-12-dup-control'

/** How one phase process exited, and what it reported. */
export interface PhaseResult<R> {
  readonly status: number | null
  readonly signal: string | null
  readonly reading: R
}

/** What the `before` phase recorded just before the SIGKILL (shared by both crash modes). */
export interface BeforeReading {
  readonly sessionId: string
  /** The ledger scope and key the call reserved under, read from the appended manifest. */
  readonly scope: string | null
  readonly key: string | null
  /** The entry's state the instant the tool's body was reached — `sent` once reserve+markSent ran before execute. */
  readonly entryStateBeforeKill: string | null
  /** Whether the tool's body ran before the kill (its run line is on disk). */
  readonly toolReached: boolean
}

/** The `resend-newid` mode's post-restart reading (cases ① and ②). */
export interface ResendAfterReading {
  /** Whether the stuck entry's key is in the host `/resolve-effect` waiting list AFTER resume, BEFORE any re-send (②). */
  readonly ambiguousBeforeResend: boolean
  /** The raw `/resolve-effect` (no-args) listing text, read as the host user — background. */
  readonly resolveListText: string
  /** The tool result the model received for the new-id re-send (① — `unknown`/`reconcil…` when the duplicate is held). */
  readonly resendResultText: string
  /** The reservation key the re-send produced, if any — a new id yields a new key, background. */
  readonly resendKey: string | null
  /** How many times the tool body ran across the whole run (1 = the re-send did NOT execute a second effect). */
  readonly toolRuns: number
}

/** The `settle` mode's post-restart reading (the `/resolve-effect` settle plus ③-a). */
export interface SettleAfterReading {
  /** The `/resolve-effect <key> confirmed` result kind (`success` once the entry is ambiguous and the host approves). */
  readonly settleResultKind: string
  /** That command's text, background. */
  readonly settleResultText: string
  /** Whether the key is still waiting in `/resolve-effect` after the settle (false once settled). */
  readonly ambiguousAfterSettle: boolean
  /** How many times the tool body ran after a same-content call was re-issued post-settle (the settled action is done again as a NEW action). */
  readonly postSettleToolRuns: number
  /** That re-issued call's result text, background. */
  readonly postSettleResultText: string
}

/** The `different-params` control reading (③-b, no crash). */
export interface ControlReading {
  /** How many times the tool body ran — 1 when an unrelated, different-arguments call executes normally. */
  readonly toolRuns: number
  /** The call's result text. */
  readonly resultText: string
}

/** The `resend-newid` mode report (cases ① + ②). */
export interface ResendReport {
  readonly mode: 'resend-newid'
  readonly before: PhaseResult<BeforeReading>
  readonly after: PhaseResult<ResendAfterReading>
}

/** The `settle` mode report (settle + ③-a). */
export interface SettleReport {
  readonly mode: 'settle'
  readonly before: PhaseResult<BeforeReading>
  readonly after: PhaseResult<SettleAfterReading>
}

/** The `different-params` control report (③-b). */
export interface ControlReport {
  readonly mode: 'different-params'
  readonly single: PhaseResult<ControlReading>
}

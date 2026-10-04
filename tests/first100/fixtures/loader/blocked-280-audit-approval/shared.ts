/**
 * Names and report fields the BLOCKED-280 audit-approval driver and spec share
 * (P2-06 acceptance[2], validation[2]): one real session on the shipped
 * headless profile asks twice about the same tool under two action ids, and
 * `dsh audit approval` is asked about each id and about an id no call has.
 *
 * The report fields follow the blind evidence contract
 * (`artifacts/delegate/blind-280-audit-evidence-redfirst.md`); the spec reads
 * only the verb's public output, never its implementation.
 * @module tests/first100/fixtures/loader/blocked-280-audit-approval/shared
 */

/** The line prefix the driver prints its report with. */
export const REPORT_TAG = 'BLOCKED-280-AUDIT'

/** The probe tool both calls name: it declares no risk domain tags, so the risk gate asks about every call. */
export const PROBE_TOOL = 'blocked_280_probe'

/** The two calls' tool call ids, which are their action ids. */
export const ACTION_ID_1 = 'b280-call-1'
export const ACTION_ID_2 = 'b280-call-2'

/** One line of `dsh audit ... approval` stdout, as its public interface states it. */
export interface AuditApprovalOutput {
  readonly sessionId: string
  readonly actionId: string
  /** Every approval whose `approval/bound` names the action id, in log order. */
  readonly approvals: readonly { readonly approvalId: string; readonly action: string; readonly actionId: string }[]
}

/** One `dsh audit` run, as the driver observed it. */
export interface AuditQueryResult {
  readonly label: 'id1' | 'id2' | 'absent'
  readonly actionIdQueried: string
  /** The exit code; `-1` when the process ended on a signal or did not start. */
  readonly exitCode: number
  /** The stdout line parsed as JSON, or `null` when stdout is not one JSON object. */
  readonly json: AuditApprovalOutput | null
  readonly stdoutRaw: string
  readonly stderr: string
}

/** One `approval/bound` event of the driver's own session. */
export interface BoundApproval {
  readonly approvalId: string
  readonly action: string
  readonly actionId: string
}

/** What the driver prints after `REPORT_TAG`. */
export interface Report {
  readonly sessionId: string
  /** The tool both calls named. */
  readonly toolName: string
  readonly actionId1: string
  readonly actionId2: string
  readonly absentActionId: string
  /** Every `approval/bound` of the session, read from the session the driver ran. */
  readonly boundApprovals: readonly BoundApproval[]
  /** The three `dsh audit` runs, in the order id1, id2, absent. */
  readonly queries: readonly AuditQueryResult[]
}

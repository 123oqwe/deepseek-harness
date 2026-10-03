/**
 * Names and the report the A-601 run_code-disclosure driver and the spec beside
 * it share.
 * @module tests/first100/fixtures/loader/a-601-run-code-disclosure/shared
 */

/** The line prefix the spec parses the driver's JSON report from. */
export const REPORT_PREFIX = 'A-601-RUN-CODE-DISCLOSURE'

/** The tool call id the scripted model gives its one `run_code` call. */
export const RUN_CODE_CALL_ID = 'a601-run-code'

/**
 * What the driver observed of the one `run_code` call's approval request, as the
 * operator would have seen it.
 */
export interface RunCodeDisclosureReport {
  /** The stub emitted the `run_code` call. */
  readonly calledRunCode: boolean
  /** An approval was requested for `run_code` (its `approval/request` fired). */
  readonly askedRunCode: boolean
  /** That approval carried a display (the fields must[0] names). */
  readonly hasDisplay: boolean
  /**
   * The whole approval display serialized — every field `approvalDisplayFor`
   * produces today plus any the fix adds — so the match sees a disclosure
   * wherever it lands. Null when the request carried no display.
   */
  readonly displayJson: string | null
  /** The asker's human-readable reason, null when none. */
  readonly reason: string | null
}

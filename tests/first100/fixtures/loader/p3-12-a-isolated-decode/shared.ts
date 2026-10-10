/**
 * Names and the report shape the P3-12 must[2] isolated-decode driver and the
 * spec beside it share. The driver admits untrusted images on the shipped
 * headless profile while it watches its own descendant processes.
 * @module tests/first100/fixtures/loader/p3-12-a-isolated-decode/shared
 */

/** The line prefix the spec parses the driver's JSON report from. */
export const REPORT_PREFIX = 'P3-12-A-DECODE'

/** What one admission showed. */
export interface AdmissionReading {
  /** Every descendant process of the host seen while the admission ran. */
  readonly seen: readonly number[]
  /** The descendants killed with SIGKILL while it ran (only in the crash admission). */
  readonly killed: readonly number[]
  /** `admitted`, `refused: <message>`, or the settle deadline's message. */
  readonly outcome: string
}

/** What the single run observed. */
export interface DecodeReport {
  /** The host process: the driver, which boots the profile in-process. */
  readonly hostPid: number
  /** The host's descendants after boot, before any admission. */
  readonly before: readonly number[]
  /** A benign image admitted while the host only watched its descendants. */
  readonly watched: AdmissionReading
  /** A second image admitted while every descendant seen was killed as soon as it appeared. */
  readonly crashed: AdmissionReading
}

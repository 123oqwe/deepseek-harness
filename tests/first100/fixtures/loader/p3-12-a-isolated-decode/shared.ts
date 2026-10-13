/**
 * Names and the report shape the P3-12 must[2] isolated-decode driver and the
 * spec beside it share. The driver admits untrusted images on the shipped
 * headless profile while it watches its own descendant processes and which of
 * them map the image decoder library.
 * @module tests/first100/fixtures/loader/p3-12-a-isolated-decode/shared
 */

/** The line prefix the spec parses the driver's JSON report from. */
export const REPORT_PREFIX = 'P3-12-A-DECODE'

/** One descendant process of the host, as one `ps` listing showed it. */
export interface Descendant {
  /** Its process id. */
  readonly pid: number
  /** The command name `ps` reports for it. */
  readonly comm: string
}

/** What one admission showed. */
export interface AdmissionReading {
  /** Every descendant process of the host seen while the admission ran, the decoder or not. */
  readonly seen: readonly Descendant[]
  /** The descendants seen with the image decoder library (libvips) mapped while the admission ran. */
  readonly decoders: readonly number[]
  /** The decoders killed with SIGKILL while it ran (only in the crash admission). */
  readonly killed: readonly number[]
  /** `admitted`, `refused: <message>`, or the settle deadline's message. */
  readonly outcome: string
}

/** What the single run observed. */
export interface DecodeReport {
  /** The host process: the driver, which boots the profile in-process. */
  readonly hostPid: number
  /** Whether the host itself maps the decoder library after the first admission; proves the probe can see it. */
  readonly hostMapsDecoder: boolean
  /** The host's descendants after boot, before any admission. */
  readonly before: readonly Descendant[]
  /** A benign image admitted while the host only watched its descendants. */
  readonly watched: AdmissionReading
  /** A second image admitted while every decoder seen was killed as soon as it appeared. */
  readonly crashed: AdmissionReading
}

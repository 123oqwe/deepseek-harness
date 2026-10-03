/**
 * Names and report fields the P0-02 desktop-host driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p0-02-desktop-host/shared
 */

/**
 * The three desktop projects the driver starts the shipped Desktop Host on:
 * an ordinary project with no opt-in, an ordinary project with
 * `DSH_TRUST_KERNEL_INSECURE` set, and a project that declares
 * `dsh.profile.development` with the same opt-in set.
 */
export const DESKTOP_PROJECTS = ['production', 'insecure-production', 'insecure-development'] as const

/** One desktop project. */
export type DesktopProject = typeof DESKTOP_PROJECTS[number]

/** The probe: it declares `filesystem-read`, which the shipped risk rules classify `read`, so no approval is asked. */
export const PROBE_TOOL = 'b696_probe'

/** The call id of the probe call a plugin makes on behalf of the root agent, presenting the session's token when one was issued. */
export const PROBE_CALL_ID = 'b696-direct-agent'

/** The line prefix the driver prints its report after. */
export const REPORT_PREFIX = 'P0-02-DESKTOP'

/** What the driver prints for one start of the Desktop Host. */
export interface DesktopHostReport {
  readonly project: DesktopProject
  /** The message `runDesktopHost` rejected with; absent when the host started. */
  readonly refused?: string
  /** Whether the started host's root context holds a Trust Kernel; absent when it was refused. */
  readonly kernel?: boolean
  /** The call id of every run of the probe's body. */
  readonly runs: readonly string[]
  /** What the probe call returned, or the message it threw; absent when the host was refused. */
  readonly call?: { readonly isError?: boolean; readonly text?: string; readonly thrown?: string }
}

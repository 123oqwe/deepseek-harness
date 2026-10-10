/**
 * Names P1-06 slice-4 m3 (crash → effects undone) shares between its driver and
 * its witness spec. One self-contained THIRD-PARTY bundle layer is staged into
 * the profile's own node_modules (so layer.packageDir !== packageDirFromAnchor
 * (INSTALL_ANCHOR, name) — the third-party test at app-boot/profile.ts), and is
 * admitted (it declares its one tool and requests no wildcard destination), so
 * composeProfile's fail-safe routes it out-of-process.
 * @module tests/first100/fixtures/loader/p1-06-slice4-crash-undo/shared
 */

/** The report line the driver prints to stdout; the spec extracts the JSON after it. */
export const REPORT_TOKEN = 'P1-06-SLICE4-M3'

/**
 * A third-party layer whose manifest declares executionMode: 'process'. Being
 * third-party it routes out-of-process regardless; the explicit declaration is
 * the ordinary out-of-process case. Its single tool is the kill-and-undo
 * subject.
 */
export const CRASH_LAYER = 'dsh-p1-06s4-thirdparty-crash'

/** The layer declares (in its manifest) and registers (in its entry) exactly this one tool: `probe--<layerName>`. */
export function probeToolName(layerName: string): string {
  return `probe--${layerName}`
}

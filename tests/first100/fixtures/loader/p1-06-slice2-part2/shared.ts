/**
 * Names P1-06 slice-2 "part 2" (out-of-process routing of third-party plugin
 * layers) shares between its driver and the three red-first specs. Two
 * self-contained THIRD-PARTY bundle layers are staged into the profile's own
 * node_modules (so each layer.packageDir is NOT packageDirFromAnchor(INSTALL_ANCHOR,
 * name) — the third-party test at app-boot/profile.ts). Both are admitted (they
 * declare their one tool and request no wildcard destination), so part 2's
 * routing re-routes an already-admitted layer.
 * @module tests/first100/fixtures/loader/p1-06-slice2-part2/shared
 */

/** The report line the driver prints to stdout; specs extract the JSON after it. */
export const REPORT_TOKEN = 'P1-06-SLICE2-PART2'

/**
 * A third-party layer whose manifest DECLARES executionMode: 'process'. Being
 * third-party it must route out-of-process regardless; the explicit declaration
 * is the ordinary out-of-process case (RF1 / RF2 read this one).
 */
export const DECLARED_LAYER = 'dsh-p1-06s2-thirdparty-declared'

/**
 * A third-party layer whose manifest explicitly declares `executionMode: 'in-process'`
 * (schema-valid, so it is admitted). The FAIL-SAFE rule must STILL route it
 * out-of-process: the host does not honor an untrusted third-party layer's
 * in-process self-claim (RF3 reads this one).
 *
 * NB: `executionMode` is a REQUIRED manifest-v2 field — plugin-manifest
 * `validate.ts` calls `validateEnum(value.executionMode, …, EXECUTION_MODES)`
 * unconditionally, so a manifest that OMITS executionMode is invalid and is
 * denied at admission (it never reaches routing). "No executionMode" is
 * therefore a false fail-safe witness; the real fail-safe witness is an
 * in-process CLAIM that routing overrides.
 */
export const INPROCESS_CLAIM_LAYER = 'dsh-p1-06s2-thirdparty-inproc-claim'

/** Each layer declares (in its manifest) and registers (in its entry) exactly this one tool: `probe--<layerName>`. */
export function probeToolName(layerName: string): string {
  return `probe--${layerName}`
}

/** The forbidden host services RF2 asserts are unreachable from the plugin's runtime context. `tools` (the RPC channel) is intentionally NOT here. */
export const FORBIDDEN_SERVICES = ['fs', 'subprocess', 'credentials', 'trustKernel', 'codeRuntime', 'shell'] as const

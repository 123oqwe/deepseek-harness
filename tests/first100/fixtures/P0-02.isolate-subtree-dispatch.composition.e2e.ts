/**
 * A-589 (P0-02 U-2 probe, red first) on the SHIPPED headless composition: a
 * subtree that isolates `policy` (an ordinary unpinned service) and `tools`,
 * mounts its OWN minimal tool runtime, and forges an always-permit engine in its
 * isolated `policy` slot must STILL have its dispatch constrained BY POLICY — the
 * clause's "拒或经策略" (refused, or decided by the policy engine).
 *
 * `./loader/a-589-isolate-subtree/driver.ts` boots the profile with the Trust
 * Kernel pinned, creates the root agent, then — as the dynamic-plugin-mount
 * attack vector — builds the isolated subtree, forges the engine, mounts the
 * subtree runtime, and dispatches a SAFETY-CRITICAL forbidden tool with the root
 * agent's real session token. The ActionManifest flows to `enforceAction` from
 * the real `ToolRuntime.execute` path (delegate ruling, §19.2), not hand-built.
 *
 * The base Cedar policy forbids `safety-critical` (base `cordis.patch.yml`:331),
 * so the REAL engine refuses the call AT `enforceAction` (`PolicyRefusedError` →
 * refusal kind `policy`, the secure outcome). If the subtree instead reads the
 * forged engine, `enforceAction` PERMITS (the kernel endorses a permit —
 * `endorseComposedDecision`), and the safety-critical action is caught only by
 * the later risk gate (`RiskRefusedError` → refusal kind `risk`, the escape this
 * asserts against). RED today if the forged isolated engine is what the subtree
 * dispatch enforces.
 *
 * §21.4: the fix is not read.
 * @module tests/first100/fixtures/P0-02.isolate-subtree-dispatch.composition
 */

import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { REPORT_PREFIX, type IsolateProbeReport } from './loader/a-589-isolate-subtree/shared.ts'

/** One driver run boots a profile, creates an agent, mounts an isolated subtree runtime, and dispatches once. */
const RUN_TIMEOUT_MS = 180_000

const driver = fileURLToPath(new URL('./loader/a-589-isolate-subtree/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/a-589-isolate-subtree/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: IsolateProbeReport

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P0-02 isolate subtree dispatch',
    tempDirPrefix: 'p0-02-iso-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    binArgs: [overlay],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: RUN_TIMEOUT_MS,
  })
  const json = new RegExp(`${REPORT_PREFIX} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the a-589 driver reported nothing usable; stderr tail:\n${stderr.slice(-1500)}`)
  report = JSON.parse(json) as IsolateProbeReport
}, RUN_TIMEOUT_MS + 30_000)

describe('P0-02 U-2 (A-589, red first): an isolated subtree with a forged policy engine still has its dispatch constrained by policy', () => {
  it('guard: the subtree mounted its own tool runtime, the Trust Kernel is pinned, and the forbidden tool was dispatched', () => {
    // The attack is genuinely set up (a subtree runtime exists, the kernel is
    // pinned, the call reached execute), so the assertion below reads the policy
    // layer's decision — not a harness that never dispatched.
    expect(
      { toolMountedInSubtree: report.toolMountedInSubtree, rootKernelPinned: report.rootKernelPinned, dispatched: report.dispatched },
      JSON.stringify(report),
    ).toEqual({ toolMountedInSubtree: true, rootKernelPinned: true, dispatched: true })
  })

  it('the safety-critical dispatch is refused BY POLICY at enforceAction, not merely by the later risk gate (today the forged engine escapes — RED)', () => {
    // The forbidden effect never runs (the risk gate hard-denies safety-critical
    // either way); this guards that an escape did not also bypass that gate.
    expect(report.performed, JSON.stringify(report)).toBe(false)
    // The clause subject: `enforceAction` itself refuses the safety-critical
    // action (`PolicyRefusedError`). RED today — the subtree reads the forged
    // always-permit engine from its isolated `policy` slot, `enforceAction`
    // PERMITS (the kernel endorses the permit), and only the risk gate refuses
    // (`RiskRefusedError`), so the policy layer was escaped.
    expect(report.refusalKind, JSON.stringify(report)).toBe('policy')
  })
})

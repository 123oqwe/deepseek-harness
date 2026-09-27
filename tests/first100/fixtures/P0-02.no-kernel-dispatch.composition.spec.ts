/**
 * B-672, the P0-02 red first for BLOCKED-306 condition [2] (C19 §2): with no
 * Trust Kernel pinned and no insecure opt-in, a tool dispatch is refused.
 *
 * `./loader/p0-02-no-kernel-dispatch/driver.ts` boots the SHIPPED headless
 * profile in-process, deletes `DSH_TRUST_KERNEL_INSECURE`, and pins a kernel
 * only in the `pinned` state. The real launcher is not used: it always pins a
 * kernel and refuses to start when it cannot, so the refusal observed here is
 * the dispatch paths' own, the one an embedder that calls `boot()` directly
 * relies on. The probe declares `filesystem-read`, which the shipped rules
 * classify `read`, so no approval is asked.
 *
 * Red today on the three no-kernel cases: without a pinned kernel the native
 * path (`packages/core/agent-loop/src/tool-calls.ts:755`) and the code-mode path
 * (`packages/core/tools/src/ptc.ts:277-279`) never reach `enforceAction`, and a
 * plugin's direct call through `ToolRuntime.execute` is not decided at all
 * (`packages/core/tools/src/index.ts:2075`, B-675), so the probe runs. The
 * controls are green today and after the fix.
 * @module tests/first100/fixtures/P0-02.no-kernel-dispatch.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'
import {
  DIRECT_AGENT_CALL_ID,
  DIRECT_PLAIN_CALL_ID,
  type DispatchMode,
  type KernelState,
  NATIVE_CALL_ID,
  type NoKernelReport,
} from './loader/p0-02-no-kernel-dispatch/shared.ts'

const driver = fileURLToPath(new URL('./loader/p0-02-no-kernel-dispatch/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/**
 * Run the driver once.
 * @param mode - the dispatch path.
 * @param kernel - whether the driver pins a kernel.
 * @returns the driver's report.
 */
async function run(mode: DispatchMode, kernel: KernelState): Promise<NoKernelReport> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `P0-02 no-kernel dispatch: ${mode}, kernel ${kernel}`,
    tempDirPrefix: `p0-02-no-kernel-${mode}-${kernel}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay, mode, kernel],
    tsconfigPath: repoTsconfig,
  })
  const json = /P0-02-NO-KERNEL (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the ${mode} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  return JSON.parse(json) as NoKernelReport
}

describe('P0-02 on the shipped headless composition booted in-process: with no Trust Kernel pinned and no opt-in, dispatch is refused (B-672)', () => {
  it('acceptance[2] (native): a tool call is refused and its body never runs', async () => {
    const report = await run('native', 'absent')
    expect(report.runs, JSON.stringify(report)).toEqual([])
    expect(report.results.find(result => result.callId === NATIVE_CALL_ID)?.isError, JSON.stringify(report)).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('acceptance[2] (code-mode): a tool called from a run_code program never runs', async () => {
    const report = await run('code-mode', 'absent')
    // Whether the `run_code` call itself or the sub-call is refused, the probe must not run.
    expect(report.runs, JSON.stringify(report)).toEqual([])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('control (native): with the kernel pinned, the same tool call runs once', async () => {
    const report = await run('native', 'pinned')
    expect(report.runs, JSON.stringify(report)).toEqual([NATIVE_CALL_ID])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('control (code-mode): with the kernel pinned, the same program runs the tool once', async () => {
    const report = await run('code-mode', 'pinned')
    expect(report.runs, JSON.stringify(report)).toHaveLength(1)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('acceptance[2] (direct call, B-675): a plugin calling ToolRuntime.execute, on behalf of the root agent or with no agent, is refused and the tool body never runs', async () => {
    const report = await run('direct', 'absent')
    expect(report.runs, JSON.stringify(report)).toEqual([])
    // Refused either way: an error result, or a throw.
    for (const callId of [DIRECT_AGENT_CALL_ID, DIRECT_PLAIN_CALL_ID]) {
      const outcome = report.direct.find(entry => entry.callId === callId)
      expect(outcome?.isError === true || outcome?.thrown !== undefined, JSON.stringify(report)).toBe(true)
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('control (direct call, B-675): with the kernel pinned, the call on behalf of the root agent presenting its session token runs the tool once', async () => {
    const report = await run('direct', 'pinned')
    expect(report.runs, JSON.stringify(report)).toEqual([DIRECT_AGENT_CALL_ID])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

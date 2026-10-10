/**
 * P1-06 slice-4 m3 — crash → effects undone. A booted real profile routes a
 * THIRD-PARTY plugin layer out-of-process (the slice-2 part-2 admission path),
 * so the plugin's one tool is registered in the host `ctx.tools` as a proxy
 * whose disposer the plugin session holds. This witnesses ONLY the crash→undo
 * half: SIGKILL the plugin child, and the host must remove that proxy tool from
 * `ctx.tools` — no zombie registration survives the dead process. "Restartable"
 * is a separate capability and is NOT exercised here.
 *
 * Observed through the shipped `ctx.tools.schemas()` registry (as the slice-1 /
 * slice-2 drivers observe) via `runLoaderSmoke` + the loader driver-bin / JSON
 * report convention. The child pid is read from the probe tool's description
 * (the slice-2 RF1 pid-capture pattern) and killed from the host process.
 *
 * GREEN at d6f82b704c: before the kill the proxy tool is present (control) and
 * its reported pid differs from the host pid (it really is out-of-process);
 * after SIGKILL the host observes the child exit and the proxy tool is gone.
 *
 * RED when `packages/plugin/plugin-host-process/src/host-process.ts:95`
 * (`void handle.done.finally(disposeHost).catch(() => {})`) is deleted: a dead
 * child no longer disposes the host, so the proxy tool LINGERS as a zombie in
 * `ctx.tools` after the child is gone and the crash→undo assertion fails
 * (presentAfterKill stays true). The control assertion stays green.
 * @module tests/first100/fixtures/P1-06.slice4-crash-undo.m3-effects-undone
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { REPORT_TOKEN } from './loader/p1-06-slice4-crash-undo/shared.ts'

const driver = fileURLToPath(new URL('./loader/p1-06-slice4-crash-undo/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface Report {
  readonly bootSucceeded: boolean
  readonly bootError: string | null
  readonly hostPid: number
  /** The pid the plugin's probe reported from inside its process (the kill target). */
  readonly childPid: number | null
  /** The proxy tool was registered in ctx.tools before the kill (control). */
  readonly presentBeforeKill: boolean
  /** The proxy tool was still in ctx.tools after the child exit was observed (zombie indicator). */
  readonly presentAfterKill: boolean
  /** The kill was issued against childPid without throwing. */
  readonly killIssued: boolean
  readonly killError: string | null
}

let report: Report
let stderr: string

beforeAll(async () => {
  const smoke = await runLoaderSmoke({
    label: 'P1-06 slice-4 m3 (crash → effects undone)',
    tempDirPrefix: 'p1-06s4-crash-undo-',
    binScript: driver,
    libBinScript: driver,
    configPath: driver,
    tsconfigPath,
  })
  stderr = smoke.stderr
  const json = new RegExp(`${REPORT_TOKEN} (?<json>.+)`, 'u').exec(smoke.stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${smoke.stderr.slice(-1200)}`)
  report = JSON.parse(json) as Report
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

describe('P1-06 slice-4 m3: an out-of-process plugin crash undoes its tool registration', () => {
  it('control: the plugin\'s proxy tool is registered in ctx.tools before the crash, and runs out-of-process', () => {
    expect(report.bootSucceeded, `boot failed: ${report.bootError ?? 'unknown'}`).toBe(true)
    // The proxy tool crossed the RPC and is live in the host registry.
    expect(report.presentBeforeKill, `no proxy registration observed before kill; stderr tail:\n${stderr.slice(-800)}`).toBe(true)
    // It really is a separate process (so the kill below targets the plugin, not the host).
    expect({ childPid: report.childPid, hostPid: report.hostPid, sameProcess: report.childPid === report.hostPid }, JSON.stringify(report))
      .toMatchObject({ sameProcess: false })
    expect(report.killIssued, `kill was not issued: ${report.killError ?? 'unknown'}`).toBe(true)
  })

  it('crash → undo: after the plugin child is SIGKILLed and the host observes the exit, the proxy tool is removed from ctx.tools (no zombie)', () => {
    expect({ presentAfterKill: report.presentAfterKill }, JSON.stringify(report))
      .toMatchObject({ presentAfterKill: false })
  })
})

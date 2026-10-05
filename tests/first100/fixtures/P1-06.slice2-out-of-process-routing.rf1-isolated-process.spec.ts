/**
 * RF1 — isolated process (acceptance: out-of-process execution). A booted real
 * profile admits a THIRD-PARTY plugin layer; after part 2 the plugin's code runs
 * in a child process whose pid differs from the host process pid. Read through
 * the shipped runProfile → composeProfile admission path via `runLoaderSmoke`.
 *
 * RED at 21108689: part 2 does not exist, so the third-party layer mounts
 * in-process (its entry is in ctx.loader.entries()); apply(ctx) runs IN the host
 * process, so the registered probe reports pid === hostPid.
 * GREEN after part 2: the layer's patches are excluded from the in-process tree
 * and the plugin is spawned via spawnPluginHost; apply runs in the child, so the
 * probe (bridged back over the RPC) reports pid !== hostPid.
 * @module tests/first100/fixtures/P1-06.slice2-out-of-process-routing.rf1
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { REPORT_TOKEN } from './loader/p1-06-slice2-part2/shared.ts'

const driver = fileURLToPath(new URL('./loader/p1-06-slice2-part2/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface Probe { readonly found: boolean; readonly pid?: number; readonly reachableForbiddenServices?: readonly string[]; readonly dshEnvKeys?: readonly string[] }
interface Report { readonly bootSucceeded: boolean; readonly bootError: string | null; readonly hostPid: number; readonly declaredEntryInTree: boolean; readonly declared: Probe }

let report: Report
let stderr: string

beforeAll(async () => {
  const smoke = await runLoaderSmoke({
    label: 'P1-06 slice-2 part 2 (out-of-process routing)',
    tempDirPrefix: 'p1-06s2-part2-',
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

describe('P1-06 slice-2 part 2 RF1: a third-party plugin runs in an isolated child process', () => {
  it('the admitted third-party plugin runs out-of-process: its reported pid differs from the host pid', () => {
    expect(report.bootSucceeded, `boot failed: ${report.bootError ?? 'unknown'}`).toBe(true)
    // Control: the plugin's code ran and reported (today in-process, after part 2 in the child).
    expect(report.declared.found, `no probe registration observed; stderr tail:\n${stderr.slice(-800)}`).toBe(true)
    // The assertion: the plugin's code did not execute inside the host process.
    expect({ pid: report.declared.pid, hostPid: report.hostPid, sameProcess: report.declared.pid === report.hostPid }, JSON.stringify(report))
      .toMatchObject({ sameProcess: false })
  })
})

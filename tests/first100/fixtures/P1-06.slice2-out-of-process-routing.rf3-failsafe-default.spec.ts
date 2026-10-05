/**
 * RF3 — fail-safe default. A third-party layer that explicitly CLAIMS
 * `executionMode: 'in-process'` STILL routes out-of-process: the host does not
 * honor an untrusted layer's in-process self-claim (same observable as RF1:
 * child pid != host pid).
 *
 * (`executionMode` is a required manifest-v2 field, so a layer that omits it is
 * invalid and denied at admission — it never reaches routing. The in-process
 * CLAIM is the schema-valid fail-safe witness; the host overrides it because the
 * layer is third-party.)
 *
 * RED at 21108689: no routing exists, so the admitted in-process-claim third-party
 * layer mounts in-process and its probe reports pid === hostPid.
 * GREEN after part 2: being third-party, it routes out-of-process despite the
 * in-process claim, so its probe reports pid != hostPid.
 * @module tests/first100/fixtures/P1-06.slice2-out-of-process-routing.rf3
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { REPORT_TOKEN } from './loader/p1-06-slice2-part2/shared.ts'

const driver = fileURLToPath(new URL('./loader/p1-06-slice2-part2/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface Probe { readonly found: boolean; readonly pid?: number }
interface Report { readonly bootSucceeded: boolean; readonly bootError: string | null; readonly hostPid: number; readonly inprocClaimEntryInTree: boolean; readonly inprocClaim: Probe }

let report: Report
let stderr: string

beforeAll(async () => {
  const smoke = await runLoaderSmoke({
    label: 'P1-06 slice-2 part 2 (fail-safe default)',
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

describe('P1-06 slice-2 part 2 RF3: a third-party layer claiming executionMode "in-process" still routes out-of-process', () => {
  it('fail-safe: the untrusted in-process self-claim is overridden — the third-party plugin runs out-of-process (pid != host pid)', () => {
    expect(report.bootSucceeded, `boot failed: ${report.bootError ?? 'unknown'}`).toBe(true)
    expect(report.inprocClaim.found, `no probe registration observed; stderr tail:\n${stderr.slice(-800)}`).toBe(true)
    expect({ pid: report.inprocClaim.pid, hostPid: report.hostPid, sameProcess: report.inprocClaim.pid === report.hostPid }, JSON.stringify(report))
      .toMatchObject({ sameProcess: false })
  })
})

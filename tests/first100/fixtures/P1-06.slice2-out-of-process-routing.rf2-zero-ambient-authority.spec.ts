/**
 * RF2 — zero ambient authority. Inside the third-party plugin's runtime context,
 * NO real host service beyond the tools-RPC is reachable (fs / shell / subprocess
 * / credential / trust-kernel / code-runtime), and no host credentials/DSH_* leak
 * into its environment — the only channel is the RPC.
 *
 * RED at 21108689: mounted in-process, apply(ctx) shares the host Context, so
 * ctx.get('fs'|'subprocess'|'credentials'|'trustKernel'|'codeRuntime'|'shell')
 * all resolve and the probe reports a non-empty reachableForbiddenServices (and
 * the host's DSH_* env is visible).
 * GREEN after part 2: run out-of-process with only the tools-RPC bridged, those
 * ctx.get(...) calls resolve to nothing and the scrubbed child environment
 * carries no DSH_* — reachableForbiddenServices is empty and dshEnvKeys is empty.
 * @module tests/first100/fixtures/P1-06.slice2-out-of-process-routing.rf2
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { REPORT_TOKEN } from './loader/p1-06-slice2-part2/shared.ts'

const driver = fileURLToPath(new URL('./loader/p1-06-slice2-part2/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface Probe { readonly found: boolean; readonly pid?: number; readonly reachableForbiddenServices?: readonly string[]; readonly dshEnvKeys?: readonly string[] }
interface Report { readonly bootSucceeded: boolean; readonly bootError: string | null; readonly hostPid: number; readonly declared: Probe }

let report: Report
let stderr: string

beforeAll(async () => {
  const smoke = await runLoaderSmoke({
    label: 'P1-06 slice-2 part 2 (zero ambient authority)',
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

describe('P1-06 slice-2 part 2 RF2: the plugin reaches no host authority beyond the tools-RPC', () => {
  it('no forbidden host service is reachable from the plugin context and no host DSH_* env leaks into it', () => {
    expect(report.bootSucceeded, `boot failed: ${report.bootError ?? 'unknown'}`).toBe(true)
    expect(report.declared.found, `no probe registration observed; stderr tail:\n${stderr.slice(-800)}`).toBe(true)
    expect({
      reachableForbiddenServices: report.declared.reachableForbiddenServices,
      dshEnvKeys: report.declared.dshEnvKeys,
    }, JSON.stringify(report)).toEqual({ reachableForbiddenServices: [], dshEnvKeys: [] })
  })
})

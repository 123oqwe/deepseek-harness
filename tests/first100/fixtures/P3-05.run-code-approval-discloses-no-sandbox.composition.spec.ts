/**
 * A-601 (第34题, for B-721): the host's approval request for a `run_code` call
 * must state that the approved code does NOT run in the OS sandbox and can read
 * and write any file the account can, including under `$DSH_HOME` — the isolation
 * fact P3-05 owns, carried on the approval display P2-06 must[0] standardises.
 *
 * `./loader/a-601-run-code-disclosure/driver.ts` boots the SHIPPED headless
 * profile with `DSH_TOOLS_MODE=ptc` (the deployer opt-in that offers `run_code`),
 * drives one turn whose model calls `run_code`, and records the call's approval
 * request as the operator saw it — the six fields `approvalDisplayFor` produces
 * (tools/src/external-effect.ts:1134-1154) and the asker's reason — then refuses
 * it so the code never runs. `run_code` declares no `riskDomainTags`, so under the
 * default `workspace-write` preset the risk gate asks (A-190); the display is
 * built for every asked native call at agent-loop/src/tool-calls.ts:328-338.
 *
 * Red first for B-721 (§21.4: the fix is not read). The guard is that an approval
 * WAS requested for `run_code`, with a display, so a missing disclosure is the gap
 * and not a run that never asked. Today the display carries no not-OS-sandboxed
 * disclosure — RED; B-721 adds it to the display — GREEN.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { REPORT_PREFIX, type RunCodeDisclosureReport } from './loader/a-601-run-code-disclosure/shared.ts'

const driver = fileURLToPath(new URL('./loader/a-601-run-code-disclosure/driver.ts', import.meta.url))
// The shipped-headless "driver creates its own root agent" overlay P2-06 reuses:
// it mounts no task-running row and keeps the session log uncompressed.
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/**
 * Run the driver once.
 * @returns the driver's report of the run_code approval request.
 */
async function run(): Promise<RunCodeDisclosureReport> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'A-601 run_code approval disclosure',
    tempDirPrefix: 'a-601-run-code-disclosure-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay],
    tsconfigPath: repoTsconfig,
  })
  const json = new RegExp(`${REPORT_PREFIX} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-1200)}`)
  return JSON.parse(json) as RunCodeDisclosureReport
}

describe('A-601 (第34题, for B-721): run_code\'s approval request must disclose it is not OS-sandboxed (red first)', () => {
  it('the run_code approval display states it is not in the OS sandbox and can read or write outside the workspace', async () => {
    const report = await run()
    // Guard: an approval WAS requested for run_code, carrying a display — so a
    // missing disclosure is the gap, not a run that never asked.
    expect(report.calledRunCode, 'the stub did not call run_code').toBe(true)
    expect(report.askedRunCode, 'run_code was not asked about under workspace-write').toBe(true)
    expect(report.hasDisplay, 'the run_code approval request carried no display').toBe(true)
    // The whole display plus the asker's reason, so the disclosure is found
    // wherever the fix puts it (an existing field or a new one).
    const text = `${report.displayJson ?? ''}\n${report.reason ?? ''}`
    // Loose match: the fix's exact wording is B-721's; what must be present is a
    // statement that it is NOT in the sandbox AND that it can write outside the
    // workspace / under $DSH_HOME.
    const saysNotSandboxed = /not[\s\S]*sandbox/iu.test(text)
    const saysWritesOutside = /outside the workspace|\$DSH_HOME|any file/iu.test(text)
    expect(saysNotSandboxed && saysWritesOutside,
      `run_code approval display today:\n${report.displayJson ?? '(none)'}\nreason: ${report.reason ?? '(none)'}`,
    ).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

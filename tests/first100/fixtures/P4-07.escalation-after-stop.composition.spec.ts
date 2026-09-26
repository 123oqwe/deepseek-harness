/**
 * A-489 under P4-07 / BLOCKED-334 site 4: on the SHIPPED headless profile at
 * its default preset, a sandbox escalation approved after an emergency stop
 * must not run the wider-sandbox write.
 *
 * `./loader/p4-07-escalation-after-stop/driver.ts` has the model escalate a
 * `write` to a path outside the workspace (sandbox_permissions =
 * danger-full-access) twice: a control turn the operator approves with no stop,
 * and a site-4 turn where the operator raises an emergency stop inside the
 * escalation approval and then approves. The fs write fence is in-process, so
 * this runs on any platform.
 * @module tests/first100/fixtures/P4-07.escalation-after-stop.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p4-07-escalation-after-stop/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver reported. */
interface Report {
  readonly asks: readonly { readonly phase: string; readonly reason: string; readonly outcome: string }[]
  readonly stopDecision: string | null
  readonly control: { readonly written: boolean; readonly text: string }
  readonly site4: { readonly written: boolean; readonly text: string }
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P4-07 escalation after stop',
    tempDirPrefix: 'p4-07-escalation-after-stop-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P4-07-ESCALATION (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as Report
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): Report {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

describe('P4-07 / BLOCKED-334 site 4: an escalation approved after an emergency stop must not run the wider-sandbox write', () => {
  it('control: with no stop, the approved escalation writes the file outside the workspace', () => {
    expect(reported().control.written, JSON.stringify(reported())).toBe(true)
  })

  it('the emergency stop was raised inside the site-4 escalation approval', () => {
    expect(reported().stopDecision !== null, JSON.stringify(reported())).toBe(true)
  })

  it('after the stop, the approved escalation does not write the file outside the workspace', () => {
    expect(reported().site4.written, JSON.stringify(reported())).toBe(false)
  })
})

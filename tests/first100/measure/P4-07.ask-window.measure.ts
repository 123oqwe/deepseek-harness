/**
 * A-385's measurement on the shipped headless composition: once an operator
 * approves a tool call the risk gate asked about, does the call run if, while
 * the operator was being asked, the Run's lease was taken over by another
 * worker, or an emergency stop was raised. A measurement, not an acceptance
 * case: the only assertions are that the measurement happened; the readings
 * go into `task.meta.p407askWindow`, which the JSON reporter carries.
 *
 * `../fixtures/loader/p4-07-ask-window/driver.ts` runs one turn per case in
 * which the model calls one tool the risk gate asks about; the case's variant
 * decides what happens before the operator approves.
 * @module tests/first100/measure/P4-07.ask-window
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('../fixtures/loader/p4-07-ask-window/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('../fixtures/loader/p4-07-ask-window/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver reported, as far as this file reads it. */
interface Report {
  readonly mode: string
  readonly atApproval: readonly unknown[]
}

describe('A-385 measurement: an approved call whose Run was fenced or stopped while the operator was asked, on the shipped headless profile', () => {
  for (const mode of ['control', 'fence', 'stop']) {
    it(`records the ${mode} variant`, async ({ task }) => {
      const { stdout, stderr } = await runLoaderSmoke({
        label: `A-385 ask-window measurement: ${mode}`,
        tempDirPrefix: `p4-07-ask-window-${mode}-`,
        binScript: driver,
        libBinScript: driver,
        configPath: overlay,
        // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
        binArgs: [overlay, mode],
        tsconfigPath: repoTsconfig,
      })
      const json = /P4-07-ASK (?<json>.+)/u.exec(stdout)?.groups?.json
      if (json === undefined) throw new Error(`the ${mode} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
      const report = JSON.parse(json) as Report
      const gateWarnings = stderr.split('\n').filter(line => line.includes('risk gate for')).slice(0, 5)
      Object.assign(task.meta, { p407askWindow: { ...report, gateWarnings } })
      expect(report.mode).toBe(mode)
      expect(report.atApproval).toHaveLength(1)
    }, LOADER_SMOKE_TEST_TIMEOUT_MS)
  }
})

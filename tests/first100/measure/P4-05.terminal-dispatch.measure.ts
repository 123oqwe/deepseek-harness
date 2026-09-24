/**
 * A-379's measurement on the shipped headless composition: once a live
 * agent's Run is advanced to `failed` through the shipped advance path, does
 * the model get another step, and do tool calls still dispatch. A measurement,
 * not an acceptance case: the only assertions are that the measurement
 * happened; the readings go into `task.meta.p405terminal`, which the JSON
 * reporter carries.
 *
 * `../fixtures/loader/p4-05-terminal/driver.ts` runs three turns: a probe
 * alone, then a step that fails the Run and calls the probe, then the probe
 * again.
 * @module tests/first100/measure/P4-05.terminal-dispatch
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('../fixtures/loader/p4-05-terminal/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('../fixtures/loader/p4-05-terminal/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver reported. */
interface Report {
  readonly runService: boolean
  readonly turns: readonly Readonly<Record<string, unknown>>[]
}

describe('A-379 measurement: a live agent whose Run was advanced to failed, on the shipped headless profile', () => {
  it('records three turns around the advance', async ({ task }) => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'A-379 terminal-dispatch measurement',
      tempDirPrefix: 'p4-05-terminal-',
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      tsconfigPath: repoTsconfig,
    })
    const json = /P4-05-TERMINAL (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    const report = JSON.parse(json) as Report
    Object.assign(task.meta, { p405terminal: report })
    expect(report.runService).toBe(true)
    expect(report.turns).toHaveLength(3)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

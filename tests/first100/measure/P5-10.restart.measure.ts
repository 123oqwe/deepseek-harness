/**
 * P5-10 question 13's measurement on the shipped headless composition: after
 * a host restart, does a continuable child that was being cancelled resume on
 * its own. A measurement, not an acceptance case: the only assertions are that
 * both phases reported; the readings go into `task.meta.p510restart`, which
 * the JSON reporter carries.
 *
 * `../fixtures/loader/p5-10-restart/driver.ts` runs one restart per case, as
 * two processes over one working directory and one `DSH_HOME`: a graceful
 * restart after the cancel has settled; a graceful shutdown while the cancel
 * is still settling, alone and with a parent whose model continues the child
 * when told it was stopped; and a crash.
 * @module tests/first100/measure/P5-10.restart
 */

import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('../fixtures/loader/p5-10-restart/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('../fixtures/loader/p5-10-restart/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Deadline for one restart: two phase processes, and the crash variant's wait past the Run lease. */
const RESTART_TIMEOUT_MS = 300_000

/** What the driver reported. */
interface Report {
  readonly variant: string
  readonly before: { readonly reading: Readonly<Record<string, unknown>> }
  readonly after: { readonly reading: Readonly<Record<string, unknown>> }
}

describe('P5-10 question 13 measurement: a child cancelled before a host restart, on the shipped headless profile', () => {
  for (const variant of ['graceful', 'shutdown-while-cancelling', 'shutdown-while-cancelling-parent-continues', 'crash']) {
    it(`records the ${variant} restart`, async ({ task }) => {
      const { stdout, stderr } = await runLoaderSmoke({
        label: `P5-10 restart measurement: ${variant}`,
        tempDirPrefix: `p5-10-restart-${variant}-`,
        binScript: driver,
        libBinScript: driver,
        configPath: overlay,
        // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
        binArgs: [overlay, 'orchestrate', variant],
        tsconfigPath: repoTsconfig,
        processTimeoutMs: RESTART_TIMEOUT_MS,
      })
      const json = /P5-10-RESTART (?<json>.+)/u.exec(stdout)?.groups?.json
      if (json === undefined) throw new Error(`the ${variant} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
      const report = JSON.parse(json) as Report
      Object.assign(task.meta, { p510restart: report })
      expect(report.variant).toBe(variant)
      expect(report.before.reading).toBeTypeOf('object')
      expect(report.after.reading).toBeTypeOf('object')
    }, RESTART_TIMEOUT_MS + 15_000)
  }
})

/**
 * BLOCKED-331's measurement on the shipped headless composition: once a
 * session's capability token expires, are its calls refused as expired, is a
 * new token issued, and does the session end. A measurement, not an
 * acceptance case: the only assertions are that the measurement happened; the
 * readings go into `task.meta.p202ttl`, which the JSON reporter carries.
 *
 * `../fixtures/loader/p2-02-token-ttl/driver.ts` runs four turns on the shipped
 * headless profile with a 1.5-second session-token TTL: one before the first
 * token expires, two after it, and one after the registry grew.
 * @module tests/first100/measure/P2-02.token-ttl
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('../fixtures/loader/p2-02-token-ttl/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('../fixtures/loader/p2-02-token-ttl/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver reported. */
interface Report {
  readonly tokenServiceMounted: boolean
  readonly turns: readonly Readonly<Record<string, unknown>>[]
}

describe('BLOCKED-331 measurement: a session after its capability token expires, on the shipped headless profile', () => {
  it('records four turns across the expiry and a registry growth', async ({ task }) => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'BLOCKED-331 token-ttl measurement',
      tempDirPrefix: 'p2-02-token-ttl-',
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      tsconfigPath: repoTsconfig,
    })
    const json = /P2-02-TTL (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    const report = JSON.parse(json) as Report
    Object.assign(task.meta, { p202ttl: report })
    expect(report.tokenServiceMounted).toBe(true)
    expect(report.turns).toHaveLength(4)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

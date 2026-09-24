/**
 * BLOCKED-330 on the shipped headless composition: a tool call that the
 * capability-token check will refuse must not be put to an operator first.
 *
 * `./loader/p4-05-waiting/driver.ts` runs in `expired` mode: it boots the
 * SHIPPED headless profile under `workspace-write` with the P4-05 overlay and
 * `./loader/p4-05-waiting/token-expired.patch.yml`, which leaves the shipped
 * `capability-tokens` row as it is except that a session token expires one
 * millisecond after it is issued. The session re-issues its token only when
 * it has none or its tools have grown, so every call presents the expired
 * token. The model calls one third-party tool that declares no risk domain
 * tags, which the base layer's risk gate asks an operator about; the driver,
 * answering as that operator, allows it after a second.
 * @module tests/first100/fixtures/P2-02.token-refusal-before-ask.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p4-05-waiting/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-05-waiting/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The model-facing wording of an `expired` capability refusal. */
const EXPIRED = 'the presented capability token has expired'

/** What the driver reported, as far as these cases read it. */
interface Report {
  readonly permissionMode: string | null
  readonly trustKernel: boolean
  readonly asks: readonly { readonly toolName: string }[]
  readonly otherQuestions: readonly string[]
  readonly toolRunStates: readonly (string | null)[]
  readonly toolResults: readonly string[]
}

describe('BLOCKED-330: a call an expired session token will refuse', () => {
  let report: Report
  beforeAll(async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'BLOCKED-330 expired-token observation',
      tempDirPrefix: 'p2-02-token-refusal-',
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
      binArgs: [overlay, 'expired'],
      tsconfigPath: repoTsconfig,
    })
    const json = /P4-05-WAIT (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    report = JSON.parse(json) as Report
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  /** The observation is of the shipped gates on the fixture's composition. */
  function expectShippedGates(): void {
    expect(report.permissionMode).toBe('workspace-write')
    expect(report.trustKernel).toBe(true)
    // Any other question is the workspace-trust one, which the driver declines at once.
    expect(report.otherQuestions.filter(name => name !== 'workspace-trust')).toEqual([])
  }

  it('is not put to the operator', () => {
    expectShippedGates()
    expect(report.asks.map(ask => ask.toolName)).toEqual([])
  })

  it('is refused as an expired capability token and its body does not run', () => {
    expectShippedGates()
    expect(report.toolResults.some(result => result.includes(EXPIRED)), `the tool results: ${JSON.stringify(report.toolResults)}`).toBe(true)
    expect(report.toolRunStates).toEqual([])
  })
})

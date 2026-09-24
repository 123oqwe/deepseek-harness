/**
 * BLOCKED-332 (P4-05 acceptance[0]) on the shipped headless composition,
 * closing conditions 1 and 2: once a live agent's Run is terminal, no further
 * tool call of the batch starts, and a turn stopped for that reason records
 * the state and the reason.
 *
 * `./loader/p4-05-terminal/driver.ts` boots the SHIPPED headless profile
 * with the Trust Kernel pinned and runs three turns: a probe alone; one step
 * whose first call advances the agent's Run to `failed` through the shipped
 * `runs.advance` and whose second call is the probe; and the probe again.
 * Condition 3, what a client of a real host receives, is a separate case.
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p4-05-terminal/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-05-terminal/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The reason the driver's fail-run tool gives for the transition. */
const FAIL_REASON = 'A-379: the run is advanced to failed from inside a tool call'

/** What the driver read after one turn, as far as these cases read it. */
interface Turn {
  readonly probeRan: boolean
  readonly stepStarts: number
  readonly turnEndReasons: readonly string[]
  readonly turnEnds: readonly unknown[]
  readonly toolResults: readonly { readonly text: string; readonly isError: boolean }[]
  readonly lifecycleState: string | null
}

/** What the driver reported. */
interface Report {
  readonly runService: boolean
  readonly turns: readonly Turn[]
}

describe('BLOCKED-332: a live agent whose Run was advanced to failed from inside a tool call, on the shipped headless profile', () => {
  let turns: readonly Turn[] = []
  beforeAll(async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'BLOCKED-332 terminal dispatch',
      tempDirPrefix: 'p4-05-terminal-',
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      tsconfigPath: repoTsconfig,
    })
    const json = /P4-05-TERMINAL (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    const report = JSON.parse(json) as Report
    expect(report.runService).toBe(true)
    turns = report.turns
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('control: the probe runs in a live Run, and the fail-run call advances the Run to failed', () => {
    expect(turns[0]?.probeRan).toBe(true)
    expect(turns[0]?.turnEndReasons).toEqual(['completed'])
    expect(turns[1]?.toolResults[0]?.text).toBe('advance: advanced')
    expect(turns[1]?.lifecycleState).toBe('failed')
  })

  it('control: a turn after the Run is failed starts no step', () => {
    expect(turns[2]?.stepStarts).toBe(0)
    expect(turns[2]?.probeRan).toBe(false)
  })

  it('condition 1: once the Run is terminal, the later call of the same batch does not start', () => {
    expect(turns[1]?.probeRan).toBe(false)
  })

  it('condition 1: the call that did not start gets its own error result, named apart from fenced and lease-refused', () => {
    const results = turns[1]?.toolResults ?? []
    expect(results).toHaveLength(2)
    expect(results[1]?.isError, `the second result: ${JSON.stringify(results[1])}`).toBe(true)
    expect(results[1]?.text).not.toContain('another host took it over')
    expect(results[1]?.text).not.toContain('never held its work item')
  })

  it('condition 2: a turn stopped because the Run is terminal records the state it reached and the reason given for it', () => {
    for (const turn of [turns[1], turns[2]]) {
      const recorded = JSON.stringify(turn?.turnEnds ?? [])
      expect(recorded, recorded).toContain('failed')
      expect(recorded, recorded).toContain(FAIL_REASON)
    }
  })
})

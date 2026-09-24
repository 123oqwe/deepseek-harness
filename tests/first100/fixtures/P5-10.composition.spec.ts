/**
 * P5-10 acceptance[0], the simultaneous half, on the shipped composition
 * (S3): a prompt admitted just before an interrupt does not wake the
 * interrupted child.
 *
 * `./loader/p5-10-control/driver.ts` boots the SHIPPED headless profile through
 * `runLoaderSmoke` with `./loader/p5-10-control/base.patch.yml`, which adds a
 * keyless model and mounts no subagent row. The driver starts one continuable
 * child through the shipped `subagents` service, lets its first turn end, and
 * sends it one plain-text prompt. The race case interrupts the child
 * synchronously after `prompt` is called and before its promise is awaited;
 * the control sends the same prompt without the interrupt, which shows the
 * harness sees a child being woken.
 * @module tests/first100/fixtures/P5-10.composition
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p5-10-control/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p5-10-control/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The request id the driver's prompt carries. */
const REQUEST_ID = 'p5-10-k1b'
/** The driver process's deadline: boot, one parent turn, the child's first turn, the prompt and the settle wait. */
const PROCESS_TIMEOUT_MS = 90_000
/** Case deadline, above the process deadline. */
const CASE_TIMEOUT_MS = 120_000

/** What the driver reported. */
interface Report {
  readonly mounted: { readonly subagents: boolean; readonly spawn: boolean }
  readonly firstTurn?: boolean
  readonly interrupt?: { readonly accepted?: boolean; readonly error?: string }
  readonly outcome?: { readonly delivered?: string; readonly refused?: string }
  readonly statusesAfterPrompt?: readonly string[]
  readonly childRpcIds?: readonly string[]
}

/**
 * Run the driver once and return its report.
 * @param mode - `race` interrupts right after the prompt is admitted; `control` does not interrupt.
 * @returns the driver's report.
 */
async function run(mode: 'race' | 'control'): Promise<Report> {
  const { stdout } = await runLoaderSmoke({
    label: `p5-10 k1b: ${mode}`,
    tempDirPrefix: 'p5-10-k1b-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay, mode],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: PROCESS_TIMEOUT_MS,
  })
  const json = /P5-10-K1B (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`driver reported nothing usable:\n${stdout}`)
  return JSON.parse(json) as Report
}

/**
 * The observation is of the shipped subagent rows, on a child whose first turn ended.
 * @param report - the driver's report.
 */
function expectShippedChild(report: Report): void {
  expect(report.mounted).toEqual({ subagents: true, spawn: true })
  const overlayIds = [...readFileSync(overlay, 'utf8').matchAll(/^\s*-?\s*id:\s*(\S+)/gmu)].map(match => match[1] ?? '')
  expect(overlayIds.filter(id => id.includes('subagent'))).toEqual([])
  expect(report.firstTurn).toBe(true)
}

describe('P5-10 acceptance[0]: a prompt racing an interrupt on the shipped base profile', () => {
  it('does not wake an interrupted child with a prompt admitted just before the interrupt on the shipped base profile', async () => {
    const report = await run('race')
    expectShippedChild(report)
    expect(report.interrupt).toMatchObject({ accepted: true })
    expect(report.outcome).toEqual({ refused: 'subagent/not-resumable' })
    expect(report.statusesAfterPrompt).not.toContain('running')
    expect(report.childRpcIds).not.toContain(REQUEST_ID)
  }, CASE_TIMEOUT_MS)

  it('without the interrupt, the same prompt wakes the child and it takes a turn on the shipped base profile', async () => {
    const report = await run('control')
    expectShippedChild(report)
    expect(report.interrupt).toBeUndefined()
    expect(report.outcome?.delivered).toEqual(expect.any(String))
    expect(report.statusesAfterPrompt).toContain('running')
    expect(report.childRpcIds).toContain(REQUEST_ID)
  }, CASE_TIMEOUT_MS)
})

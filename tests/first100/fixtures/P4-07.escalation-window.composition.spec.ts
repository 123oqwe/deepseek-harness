/**
 * BLOCKED-334's fourth site (P4-07 acceptance[0], P2-12 must[2]) on the
 * shipped headless composition: a sandbox escalation the operator was asked
 * about inside the bash tool's body must not run once approved if, while the
 * operator was asked, the Run was fenced or an emergency stop was raised, and
 * the call's result must say which.
 *
 * `./loader/sandbox-escalation-window/driver.ts` boots the SHIPPED headless
 * profile with the Trust Kernel pinned and runs one turn in which the model
 * calls `bash` twice: a confined `echo`, whose result records whether the
 * platform's sandbox runner works, then a command that writes a marker file
 * and asks to escalate to `danger-full-access`. Before approving the
 * escalation the operator does nothing (`control`), lets another worker take
 * the Run's lease over after it expires (`fence`), or raises
 * `pause-new-actions` (`stop`).
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/sandbox-escalation-window/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/sandbox-escalation-window/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the operator read and did at the escalation, as far as these cases read it. */
interface Approval {
  readonly action: { readonly acquired?: unknown }
  readonly after: { readonly mayWrite?: unknown; readonly stopGate?: unknown }
}

/** What the driver reported, as far as these cases read it. */
interface Report {
  readonly confinedResult: string | null
  readonly escalatedResult: string | null
  readonly atEscalation: readonly Approval[]
  readonly markerWritten: boolean
}

/**
 * Run the driver once.
 * @param mode - what the operator does before approving the escalation.
 * @returns the driver's report.
 */
async function observe(mode: 'control' | 'fence' | 'stop'): Promise<Report> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `BLOCKED-334 fourth site: ${mode}`,
    tempDirPrefix: `sandbox-escalation-window-${mode}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay, mode],
    tsconfigPath: repoTsconfig,
  })
  const json = /A392-ESC (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the ${mode} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  return JSON.parse(json) as Report
}

describe('BLOCKED-334 fourth site: an approved sandbox escalation whose Run was fenced or stopped while the operator was asked', () => {
  const reports = new Map<string, Report>()
  beforeAll(async () => {
    for (const mode of ['control', 'fence', 'stop'] as const) reports.set(mode, await observe(mode))
  }, 3 * LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('control: with nothing happening during the ask the escalated command runs, and the fence and the stop take hold before the operator answers', ({ task }) => {
    // Whether the platform's sandbox runner works, recorded for the reading; the escalated path does not use it.
    Object.assign(task.meta, { a392: { confinedResult: reports.get('control')?.confinedResult ?? null } })
    expect(reports.get('control')?.atEscalation).toHaveLength(1)
    expect(reports.get('control')?.markerWritten).toBe(true)
    expect(reports.get('fence')?.atEscalation[0]?.action.acquired).toBe(true)
    expect(reports.get('fence')?.atEscalation[0]?.after.mayWrite).toBe(false)
    expect(reports.get('stop')?.atEscalation[0]?.after.stopGate).toBe('stopped')
  })

  it('fence: once the operator approves, the escalated command does not run', () => {
    expect(reports.get('fence')?.markerWritten).toBe(false)
  })

  it('fence: the result of the call says the Run was fenced', () => {
    const result = reports.get('fence')?.escalatedResult ?? ''
    expect(/fenced|another host took it over/iu.test(result), result).toBe(true)
  })

  it('stop: once the operator approves, the escalated command does not run', () => {
    expect(reports.get('stop')?.markerWritten).toBe(false)
  })

  it('stop: the result of the call says an emergency stop is in force', () => {
    const result = reports.get('stop')?.escalatedResult ?? ''
    expect(/stopped|emergency stop/iu.test(result), result).toBe(true)
  })
})

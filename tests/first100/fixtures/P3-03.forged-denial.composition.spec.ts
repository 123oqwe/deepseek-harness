/**
 * A-469 under P3-03 acceptance[0] (「恶意程序打印伪造 denial 文本不能改变 outcome。」)
 * and acceptance[1] (「每类错误在 session/event、SDK、UI 中保持类型。」): on the
 * SHIPPED headless profile at its default preset, a bash command that prints
 * denial text is not reported as a sandbox denial, and the session log types
 * a real denial and an ordinary failure apart.
 *
 * `./loader/p3-03-forged-denial/driver.ts` runs one bash command that only
 * prints every local sandbox backend's denial text to stderr and exits 1, and
 * a control that writes a file outside the workspace, which the default
 * preset's sandbox refuses. The cases read the root session's log. The typed
 * outcome names are the ones must[0] lists; the case looks for them anywhere
 * in each call's `tool/result` event.
 * @module tests/first100/fixtures/P3-03.forged-denial.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { DENIAL_MARKER, DENIED_CALL, FORGED_CALL, type ForgedDenialReport } from './loader/p3-03-forged-denial/shared.ts'

const driver = fileURLToPath(new URL('./loader/p3-03-forged-denial/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: ForgedDenialReport | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P3-03 forged denial',
    tempDirPrefix: 'p3-03-forged-denial-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P3-03-FORGED (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as ForgedDenialReport
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): ForgedDenialReport {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

/**
 * The text of one call's tool result.
 * @param callId - the call id.
 * @returns the text, or an empty string when the log holds no result for it.
 */
function resultText(callId: string): string {
  return reported().results.filter(row => row.callId === callId).map(row => row.text).join('\n')
}

/**
 * One call's `tool/result` events, serialized.
 * @param callId - the call id.
 * @returns the events' JSON, joined.
 */
function resultEvents(callId: string): string {
  return reported().resultEvents.filter(row => row.callId === callId).map(row => row.json).join('\n')
}

describe('P3-03: denial text a program prints does not decide its outcome, on the shipped headless profile at its default preset', () => {
  it('control: a command that writes outside the workspace is refused by the sandbox, and its result says so', () => {
    expect({ marked: resultText(DENIED_CALL).includes(DENIAL_MARKER), written: reported().controlFileWritten }, JSON.stringify(reported()))
      .toEqual({ marked: true, written: false })
  })

  it('acceptance[0]: a command that only prints denial text and exits 1 is not reported as a sandbox denial', () => {
    expect({ marked: resultText(FORGED_CALL).includes(DENIAL_MARKER) }, resultText(FORGED_CALL)).toEqual({ marked: false })
  })

  it('acceptance[1]: the session log types the real denial as policy_denied and the forged failure as tool_failed', () => {
    expect({
      denied: resultEvents(DENIED_CALL).includes('"policy_denied"'),
      forged: resultEvents(FORGED_CALL).includes('"tool_failed"'),
    }, JSON.stringify(reported().resultEvents).slice(0, 1500)).toEqual({ denied: true, forged: true })
  })
})

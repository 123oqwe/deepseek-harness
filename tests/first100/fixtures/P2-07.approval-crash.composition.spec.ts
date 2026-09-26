/**
 * A-474 under P2-07 acceptance[0] (「进程在请求后、批准后、消费前任意崩溃，重启后状态正确。」):
 * on the SHIPPED headless profile at its default preset, an approval request
 * whose host is killed before anyone answers it has a definite state after the
 * restart: it is decided on the record, or asked again.
 *
 * `./loader/p2-07-approval-crash/driver.ts` has the model call a probe the
 * risk gate cannot classify, so an approval request reaches the operator; the
 * process is killed while the request waits. After the Run lease lapses, the
 * same working directory boots again and the root session is resumed; the
 * cases read the resumed session's approval events and what the new process's
 * operator was asked.
 * @module tests/first100/fixtures/P2-07.approval-crash.composition
 */

import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p2-07-approval-crash/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Deadline for the restart: two phase processes of at most two minutes each, and the wait past the Run lease. */
const RESTART_TIMEOUT_MS = 300_000

/** The probe the driver registers. */
const PROBE_TOOL = 'a474_approval_probe'

/** What the two phases reported, as far as these cases read it. */
interface Report {
  readonly before: { readonly signal: string | null; readonly reading: { readonly asked?: string } }
  readonly after: {
    readonly reading: {
      readonly asked: readonly string[]
      readonly probeRuns: number
      readonly approvalsAsked: readonly { readonly id: string; readonly toolName: string }[]
      readonly approvalsDecided: readonly { readonly id: string; readonly outcome: string }[]
      readonly turnEnds: readonly string[]
    }
  }
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P2-07 approval crash',
    tempDirPrefix: 'p2-07-approval-crash-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay, 'orchestrate'],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: RESTART_TIMEOUT_MS,
  })
  const json = /P2-07-RESTART (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as Report
}, RESTART_TIMEOUT_MS + 15_000)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): Report {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

describe('P2-07 acceptance[0]: an approval whose host crashed before it was answered has a definite state after the restart', () => {
  it('control: before the crash the probe\'s call reached an approval request, and the log read after the restart holds it', () => {
    const { before, after } = reported()
    expect({
      askedBeforeCrash: before.reading.asked,
      killed: before.signal,
      inLog: after.reading.approvalsAsked.some(row => row.toolName === PROBE_TOOL),
    }, JSON.stringify(reported())).toEqual({ askedBeforeCrash: PROBE_TOOL, killed: 'SIGKILL', inLog: true })
  })

  it('after the restart the pending approval is decided on the record or asked again', () => {
    const { approvalsAsked, approvalsDecided, asked } = reported().after.reading
    const pending = approvalsAsked.filter(row => row.toolName === PROBE_TOOL).map(row => row.id)
    const decided = pending.some(id => approvalsDecided.some(row => row.id === id))
    const askedAgain = asked.includes(PROBE_TOOL)
    expect({ definite: decided || askedAgain }, JSON.stringify({ decided, askedAgain, after: reported().after })).toEqual({ definite: true })
  })
})

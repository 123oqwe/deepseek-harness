/**
 * A-519 under P2-07 acceptance[1] (「审批至多消费一次,跨崩溃重放」): on the shipped
 * headless profile, a detached workflow run that waits for an approval, has it
 * approved, and — in the process that resumes it — CONSUMES the approval but crashes
 * before its completion is journaled, is NOT replayed to completion by the next
 * process that scans it. Replaying a consumed approval IS the observable consequence
 * of a double consume, so acceptance[1] holds iff the second process does not replay.
 *
 * `./loader/p2-07-at-most-once/driver.ts` orchestrates three phases over one shared
 * working directory:
 * - `wait`    launches the detached run, which settles `waiting_for_approval`, then ends.
 * - `resume1` monkey-patches `ctx.get('sessions').flush` to reject the run's session,
 *   decides the approval `approved`, and lets the engine wake the run: it consumes the
 *   approval (durable in the sqlite store) and runs past it, but the completion flush is
 *   rejected — the run is consumed on the record, yet its journal still reads waiting. It
 *   reports how many times that rejection fired (`flushRejects`), so a masked seam shows.
 * - `resume2` boots with a `workflow/end` listener installed before the engine's scan at
 *   mount, and reports whether the run was replayed to completion.
 *
 * Red on M-519-1 (resume's CAS-consume neutralized): `resume2` re-consumes and replays the
 * run to completion, so `replayed` is true. §21.4: derived from acceptance[1], not copied
 * from lane B's evidence, and the driver hooks only the public approval store, the public
 * session flush, and the `workflow/end` event — never the consume fix. The driver
 * self-reports `flushRejects` so the first dispatch diagnoses a masked seam (count 0).
 * @module tests/first100/fixtures/P2-07.at-most-once.composition
 */

import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p2-07-at-most-once/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Two restarts of phase processes of at most two minutes each, plus the Run leases between them. */
const DEADLINE_MS = 360_000

/** What the three phases reported, as far as this case reads it. */
interface Report {
  /** `resume1`: the approval it decided, and how many times the run-session flush was rejected (the crash seam). */
  readonly resume1: { readonly approvalId: string | null; readonly flushRejects: number }
  /** `resume2`: read after the crash. */
  readonly resume2: {
    /** Whether the scan replayed the consumed run to completion. */
    readonly replayed: boolean
    /** The approval's state read from the store after resume2 settled. */
    readonly approvalState: string | null
  }
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P2-07 at-most-once',
    tempDirPrefix: 'p2-07-at-most-once-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    binArgs: [overlay, 'orchestrate'],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: DEADLINE_MS,
  })
  const json = /P2-07-AT-MOST-ONCE (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as Report
}, DEADLINE_MS + 15_000)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): Report {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

describe('P2-07 acceptance[1]: an approval consumed before a crash is not replayed', () => {
  it('control: the resuming process decided the approval and its completion flush was rejected — the crash seam fired', () => {
    const { resume1 } = reported()
    expect({ decided: resume1.approvalId !== null, seamFired: resume1.flushRejects > 0 }, JSON.stringify(reported()))
      .toEqual({ decided: true, seamFired: true })
  })

  it('does not replay the consumed run to completion, and the approval stays consumed', () => {
    // GREEN on 4844d9919b: resume2 sees the approval `consumed` and does not replay the run.
    // RED on M-519-1: resume2 re-consumes and replays the run to completion.
    const { resume2 } = reported()
    expect({ replayed: resume2.replayed, approvalState: resume2.approvalState }, JSON.stringify(reported()))
      .toEqual({ replayed: false, approvalState: 'consumed' })
  })
})

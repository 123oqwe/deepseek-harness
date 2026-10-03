/**
 * A-600 (第33题, for B-720) under P4-12 acceptance[1] («ambiguous 状态不盲目重试，
 * 进入 reconciliation»): on the SHIPPED headless composition, an external effect
 * that the native dispatch reserved and marked `sent` but had not confirmed when
 * the host was killed must, on a replay by the resumed session, become `ambiguous`
 * and enter reconciliation — the ledger lists it in its ambiguous set and the
 * model is told the outcome is unknown. Today the stuck `sent` entry is answered
 * as a plain duplicate ("already sent"), so the replay is treated as a completed
 * send rather than an unknown one — RED.
 *
 * `./loader/p4-12-replay-crash/driver.ts` boots the profile, drives one turn whose
 * model calls an external-effect fixture tool, kills the process while the tool
 * body hangs (after reserve + markSent, before confirm), then boots again over the
 * same `DSH_HOME`, resumes the session, and prompts it so the model re-issues the
 * SAME call id — the same idempotency key, the replay a crash-and-retry presents.
 *
 * Red first for B-720 (§21.4: the fix is not read). Guards keep the observation
 * honest: before the crash the entry is `sent` (the kill landed after markSent and
 * before confirm), and the replay does not re-run the tool body (the duplicate/
 * ambiguous refusal happens before execution, so the effect is never performed a
 * second time).
 * @module tests/first100/fixtures/P4-12.replay-crash.composition
 */

import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { REPORT_PREFIX, type ReplayReport } from './loader/p4-12-replay-crash/shared.ts'

/** The orchestration runs two product processes with a Run-lease wait between them. */
const RESTART_TIMEOUT_MS = 180_000

const driver = fileURLToPath(new URL('./loader/p4-12-replay-crash/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-12-replay-crash/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: ReplayReport

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P4-12 replay crash',
    tempDirPrefix: 'p4-12-replay-crash-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay, 'orchestrate'],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: RESTART_TIMEOUT_MS,
  })
  const json = new RegExp(`${REPORT_PREFIX} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-1200)}`)
  report = JSON.parse(json) as ReplayReport
}, RESTART_TIMEOUT_MS + 30_000)

describe('P4-12 acceptance[1]: a sent-but-unconfirmed effect replayed after a crash is ambiguous, not a plain duplicate', () => {
  it('guard: the crash left the reservation stuck `sent`, and the replay did not re-run the tool body', () => {
    expect({
      killed: report.before.signal,
      toolReached: report.before.reading.toolReached,
      entryStateBeforeKill: report.before.reading.entryStateBeforeKill,
      toolRuns: report.after.reading.toolRuns,
    }, JSON.stringify(report)).toEqual({ killed: 'SIGKILL', toolReached: true, entryStateBeforeKill: 'sent', toolRuns: 1 })
  })

  it('the replay turns the entry ambiguous and routes it to reconciliation (today it is answered as a duplicate — RED)', () => {
    // The stuck `sent` entry, replayed under the resumed session, must become
    // `ambiguous` and be listed for reconciliation. Today it stays `sent` and the
    // model is told it is a duplicate, so all three read the pre-fix values.
    expect(report.after.reading.entryStateAfterReplay, JSON.stringify(report)).toBe('ambiguous')
    expect(report.after.reading.inAmbiguousList, JSON.stringify(report)).toBe(true)
    expect(report.after.reading.replayResultText, JSON.stringify(report)).toMatch(/unknown|reconcil/iu)
  })
})

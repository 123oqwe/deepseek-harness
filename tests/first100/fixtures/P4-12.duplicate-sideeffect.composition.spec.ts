/**
 * A-610 (B-726 red-first) under P4-12 acceptance[0] ("10,000 次随机 crash campaign
 * 中 duplicate external effect 为 0") and acceptance[1] ("ambiguous 状态不盲目重试，
 * 进入 reconciliation"): on the SHIPPED headless composition, an external effect
 * the native dispatch reserved and marked `sent` but had not confirmed when the
 * host was killed must, after a restart, be waiting for reconciliation — and when
 * the model re-issues the SAME action under a NEW call id (a new idempotency key),
 * that duplicate must NOT execute a second effect. Today the stuck entry stays
 * `sent`, nothing is listed for reconciliation, and a new-id re-send runs the body
 * again — a duplicate external effect — so the secure assertions RED.
 *
 * `./loader/a-610-duplicate-sideeffect/driver.ts` reuses the A-600 crash harness
 * and runs three modes, each launched here in its OWN temp `DSH_HOME` so one red
 * does not mask another:
 *  - `resend-newid` (cases ① + ②): after the crash, the host user reads the
 *    `/resolve-effect` waiting list (not the ledger's private getter), then the
 *    model re-issues the same action under a new id.
 *  - `settle` (the `/resolve-effect` settle + ③-a): after the crash, the host
 *    settles the ambiguous entry as `confirmed` through `/resolve-effect`, then the
 *    same action is re-issued and — being reconciled — runs as a new action.
 *  - `different-params` (③-b, no crash): an unrelated, different-arguments call
 *    executes normally. A liveness control, green always.
 *
 * Red first for B-726 (§21.4: the fix is not read). The guards keep each
 * observation honest: the kill landed on a `sent` entry (reserve + markSent ran,
 * confirm did not) and the tool body ran exactly once before it.
 * @module tests/first100/fixtures/P4-12.duplicate-sideeffect.composition
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { REPORT_PREFIX, type ControlReport, type ErroredReport, type ResendReport, type SettleReport } from './loader/a-610-duplicate-sideeffect/shared.ts'

/** The orchestration runs up to two product processes with a Run-lease wait between them. */
const RESTART_TIMEOUT_MS = 180_000
/** The vitest case deadline, kept ABOVE the launcher timeout so a hang is reported with an exit code and stderr, not as a bare case timeout (the A-588c lesson). */
const CASE_TIMEOUT_MS = RESTART_TIMEOUT_MS + 60_000

const driver = fileURLToPath(new URL('./loader/a-610-duplicate-sideeffect/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-12-replay-crash/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/**
 * Run one driver mode in its own temp `DSH_HOME` and return the parsed report.
 * @param mode - the driver mode to orchestrate.
 * @returns the report JSON the driver printed.
 */
async function runMode<R>(mode: string): Promise<R> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `P4-12 duplicate ${mode}`,
    tempDirPrefix: `p4-12-dup-${mode}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    binArgs: [overlay, 'orchestrate', mode],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: RESTART_TIMEOUT_MS,
  })
  const json = new RegExp(`${REPORT_PREFIX} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the ${mode} driver reported nothing usable; stderr tail:\n${stderr.slice(-1200)}`)
  return JSON.parse(json) as R
}

describe('P4-12 acceptance[0]/[1] (A-610, B-726 red first): a crashed sent-but-unconfirmed effect does not duplicate on a new-id re-send, and waits for reconciliation', () => {
  it('resend-newid (①+②): the stuck effect waits for reconciliation, and a new-id re-send of the same action runs no second effect', async () => {
    const report = await runMode<ResendReport>('resend-newid')
    const detail = JSON.stringify(report)
    // Guard: the kill landed on a `sent` entry and the body ran once before it.
    expect({
      killed: report.before.signal,
      toolReached: report.before.reading.toolReached,
      entryStateBeforeKill: report.before.reading.entryStateBeforeKill,
    }, detail).toEqual({ killed: 'SIGKILL', toolReached: true, entryStateBeforeKill: 'sent' })
    // ② the stuck key is waiting for reconciliation, read through the host
    // `/resolve-effect` list. RED today: the entry stays `sent`, so nothing waits.
    expect(report.after.reading.ambiguousBeforeResend, detail).toBe(true)
    // ① the new-id re-send runs no second external effect (acceptance[0]). RED
    // today: a new key is not matched to the pending one, so the body runs again.
    expect(report.after.reading.toolRuns, detail).toBe(1)
    // ① the model is told the outcome is unknown / to reconcile, not "charged".
    expect(report.after.reading.resendResultText, detail).toMatch(/unknown|reconcil/iu)
  }, CASE_TIMEOUT_MS)

  it('settle + ③-a: /resolve-effect settles the ambiguous entry, after which the same action re-executes as a new action', async () => {
    const report = await runMode<SettleReport>('settle')
    const detail = JSON.stringify(report)
    expect({
      killed: report.before.signal,
      toolReached: report.before.reading.toolReached,
      entryStateBeforeKill: report.before.reading.entryStateBeforeKill,
    }, detail).toEqual({ killed: 'SIGKILL', toolReached: true, entryStateBeforeKill: 'sent' })
    // The host settles the ambiguous entry through `/resolve-effect`. RED today:
    // the entry is `sent`, not `ambiguous`, so the command refuses it.
    expect(report.after.reading.settleResultKind, detail).toBe('success')
    expect(report.after.reading.ambiguousAfterSettle, detail).toBe(false)
    // ③-a: a settled (reconciled) action does not block a fresh same-content call —
    // it runs as a new action. Green on both bases (the fix only clears the block).
    expect(report.after.reading.postSettleToolRuns, detail).toBe(2)
  }, CASE_TIMEOUT_MS)

  it('different-params (③-b): an unrelated, different-arguments call executes normally', async () => {
    const report = await runMode<ControlReport>('different-params')
    const detail = JSON.stringify(report)
    // A liveness control: the ledger does not over-block unrelated calls. Green
    // on both bases.
    expect(report.single.reading.toolRuns, detail).toBe(1)
    expect(report.single.reading.resultText, detail).toBe('charged')
  }, CASE_TIMEOUT_MS)

  it('errored-retry (B-726 cause-distinction): a tool ERROR does not block a new-id retry of the same action', async () => {
    const report = await runMode<ErroredReport>('errored-retry')
    const detail = JSON.stringify(report)
    // Guard: the first call errored (not crashed), so there is an errored cause to
    // distinguish from an ambiguous crash.
    expect(report.single.reading.originalErrored, detail).toBe(true)
    // The new-id retry of the same action still executes — a plain error is
    // retryable, unlike a crash-ambiguous effect. Green on both bases: the fix
    // distinguishes by cause and must not regress to blocking ordinary failures.
    expect(report.single.reading.toolRuns, detail).toBe(2)
  }, CASE_TIMEOUT_MS)
})

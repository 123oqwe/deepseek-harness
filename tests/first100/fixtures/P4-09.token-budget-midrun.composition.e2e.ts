/**
 * A-608 (B-714 red first) under P4-09 acceptance[3] on the SHIPPED headless
 * composition: a RUNNING in-process nested child that overspends its tree's
 * token allowance must be aborted mid-run with `token-budget-exhausted`.
 *
 * `./loader/a-608-token-budget-midrun/driver.ts` boots the profile with the
 * Trust Kernel pinned and the workflow engine's `maxNestedTokens` shrunk below a
 * single model response's usage, then has the root agent call the `workflow`
 * tool with a script that nests one `agent()` child. The child runs in-process
 * (its tokens are metered) and calls a low-risk burn tool across two steps; the
 * script returns the child's outcome as the tool result.
 *
 * Today the host checks the budget only at child START (host.ts:520) and debits
 * it only POST-settle (host.ts:667), so the overspending child runs to
 * completion: the workflow result is `{ ok: true }` and the burn tool ran both
 * steps (RED — no mid-run abort). After B-714 the child is aborted the step it
 * overspends: the result carries `token-budget-exhausted` and the burn tool ran
 * once. §21.4: the fix is not read.
 * @module tests/first100/fixtures/P4-09.token-budget-midrun.composition
 */

import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { REPORT_PREFIX, type TokenBudgetReport } from './loader/a-608-token-budget-midrun/shared.ts'

/** One driver run boots a profile, runs a real nested workflow on a worker thread, and burns tokens. */
const RUN_TIMEOUT_MS = 180_000

const driver = fileURLToPath(new URL('./loader/a-608-token-budget-midrun/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/a-608-token-budget-midrun/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: TokenBudgetReport

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P4-09 token budget mid-run',
    tempDirPrefix: 'p4-09-tokbud-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    binArgs: [overlay],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: RUN_TIMEOUT_MS,
  })
  const json = new RegExp(`${REPORT_PREFIX} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the a-608 driver reported nothing usable; stderr tail:\n${stderr.slice(-1500)}`)
  report = JSON.parse(json) as TokenBudgetReport
}, RUN_TIMEOUT_MS + 30_000)

describe('P4-09 acceptance[3] (A-608, B-714 red first): a running nested child that overspends the tree token budget is aborted mid-run', () => {
  it('guard: the workflow tool was dispatched and the burning child ran at least one step', () => {
    // The run actually started and reached the child, so the assertion below
    // reads the budget outcome, not a harness that never dispatched.
    expect({ workflowDispatched: report.workflowDispatched, ranAStep: report.burnRuns >= 1 }, JSON.stringify(report))
      .toEqual({ workflowDispatched: true, ranAStep: true })
  })

  it('the overspending child is aborted mid-run with token-budget-exhausted, not run to completion (today it completes — RED)', () => {
    // The clause subject: a running in-process child that overspends its tree's
    // allowance is aborted with token-budget-exhausted, so the script's `agent()`
    // ends in the aborted outcome rather than the child's completion. RED today —
    // the budget is checked only at child start (host.ts:520) and debited only
    // post-settle (host.ts:667), so the child runs to completion and the result
    // is `{ ok: true, out: 'child finished burning' }`, carrying no such abort.
    // (`burnRuns` is recorded as a diagnostic rather than asserted: today it is 2
    // — both steps ran; the exact step the fix aborts on is not read, §21.4.)
    expect(report.childTokenBudgetExhausted, JSON.stringify(report)).toBe(true)
  })
})

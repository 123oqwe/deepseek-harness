/**
 * BLOCKED-366 red first (lane B; the fix is lane A's): P4-09 acceptance[3]'s
 * running nested child that overspends its tree's token allowance is aborted
 * "with token-budget-exhausted", and that reason is what the model reads and
 * what the child's log records.
 *
 * Today the host aborts the children's signal with the reason
 * (packages/workflow/workflow-worker-thread/src/host.ts:782), the in-process
 * driver cancels the child as `{ kind: 'parent' }`
 * (packages/subagent/subagent-in-process-driver/src/index.ts:253), and the
 * script's `agent()` returns null (workflow-worker-thread runtime.ts:521-528), so
 * the `workflow` tool result reads "completed" and nothing records the reason —
 * RED.
 *
 * The run is A-608's driver (`./loader/a-608-token-budget-midrun/`) on the
 * shipped headless composition: one in-process child, a tree allowance of 5
 * tokens, 15 tokens per scripted response. The cases require the reason token
 * and no particular field or wording around it. §21.4: written before the fix.
 * @module tests/first100/fixtures/BLOCKED-366.budget-abort-reason.composition
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
    label: 'BLOCKED-366 budget abort reason',
    tempDirPrefix: 'blocked-366-',
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

describe('BLOCKED-366: the reason a nested child is aborted for overspending its tree token budget reaches the model and the child log', () => {
  it('guard: the workflow ran, and the child was served a response and then ended without completing', () => {
    // The child reached the overspend and was stopped, so the cases below read
    // how that stop is reported, not a run that never got there.
    expect({
      workflowDispatched: report.workflowDispatched,
      served: report.childResponses >= 1,
      ended: report.childTurnEnds.length >= 1,
      completed: report.childTurnEnds.some(reason => reason.kind === 'completed'),
    }, JSON.stringify(report)).toEqual({ workflowDispatched: true, served: true, ended: true, completed: false })
  })

  it('the workflow result the model reads names token-budget-exhausted (today it reads completed, with a null agent result — RED)', () => {
    expect(report.workflowResultText, JSON.stringify(report)).toMatch(/token-budget-exhausted/u)
  })

  it('the child log records token-budget-exhausted as why its turn ended (today the cause is { kind: parent } — RED)', () => {
    expect(JSON.stringify(report.childTurnEnds), JSON.stringify(report)).toMatch(/token-budget-exhausted/u)
  })
})

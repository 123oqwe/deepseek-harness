/**
 * A-608 under P4-09 acceptance[3] on the SHIPPED headless composition: a
 * RUNNING in-process nested child that overspends its tree's token allowance is
 * aborted mid-run with `token-budget-exhausted`.
 *
 * `./loader/a-608-token-budget-midrun/driver.ts` boots the profile with the
 * Trust Kernel pinned and the workflow engine's `maxNestedTokens` shrunk below a
 * single model response's usage, then has the root agent call the `workflow`
 * tool with a script that nests one `agent()` child. The child runs in-process
 * (its tokens are metered) and calls a low-risk burn tool across two steps; the
 * script returns the child's outcome as the tool result.
 *
 * The cases assert the overspend bound the engine documents — a tree overshoots
 * its limit by at most one response per running child (`debitTokens`,
 * packages/workflow/workflow-worker-thread/src/host.ts) — and the abort with its
 * reason. The allowance (5) is below one response's usage (15), so the first
 * response already overspends and the child is served no second; which step the
 * abort lands on is not asserted. The reason reaches the workflow result only
 * with BLOCKED-366's fix.
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

describe('P4-09 acceptance[3] (A-608): a running nested child that overspends the tree token budget is aborted mid-run with token-budget-exhausted', () => {
  it('guard: the workflow tool was dispatched and the child was served a response', () => {
    // The run reached the child, so the cases below read the budget outcome, not
    // a harness that never dispatched.
    expect({ workflowDispatched: report.workflowDispatched, served: report.childResponses >= 1 }, JSON.stringify(report))
      .toEqual({ workflowDispatched: true, served: true })
  })

  it('at most one response overspends: the child, whose first response already exceeds the allowance, is served no second', () => {
    expect(report.childResponses, JSON.stringify(report)).toBeLessThanOrEqual(1)
  })

  it('the child is aborted rather than completed, and the workflow result the model reads names token-budget-exhausted', () => {
    expect({
      completed: report.childTurnEnds.some(reason => reason.kind === 'completed'),
      reasonInResult: report.childTokenBudgetExhausted,
    }, JSON.stringify(report)).toEqual({ completed: false, reasonInResult: true })
  })
})

/**
 * P4-09 acceptance[3] ("total budget is bounded") on the Web app (blind review
 * U-2). The Web app runs the workflow engine inside each preset's
 * `isolate: { workflowEngine, savedWorkflows }` delegation group, while
 * token-meter stays on the host plane. The engine meters a child by reading
 * token-meter's `tokenUsage` projection; when it cannot, it warns once and
 * meters nothing, so the tree's token allowance would not be in effect.
 *
 * `./loader/p4-09-web-token-budget/driver.ts` boots the shipped `web` profile in
 * process, composes one agent from the shipped `standard` preset, and has it run
 * a workflow that starts two in-process children in sequence. Each child's one
 * response reports more input tokens than the engine's shipped default tree
 * allowance, so a metered tree refuses the second start `token-budget-exhausted`.
 * @module tests/first100/fixtures/P4-09.web-preset-token-budget.composition
 */

import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { REPORT_PREFIX, type WebTokenBudgetReport } from './loader/p4-09-web-token-budget/shared.ts'

/** One driver run boots the Web profile and runs one workflow with two children on a worker thread. */
const RUN_TIMEOUT_MS = 180_000

const driver = fileURLToPath(new URL('./loader/p4-09-web-token-budget/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-09-web-token-budget/web.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: WebTokenBudgetReport

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P4-09 Web preset token budget',
    tempDirPrefix: 'p4-09-web-tokbud-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    binArgs: [overlay],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: RUN_TIMEOUT_MS,
  })
  const json = new RegExp(`${REPORT_PREFIX} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the p4-09-web-token-budget driver reported nothing usable; stderr tail:\n${stderr.slice(-1500)}`)
  report = JSON.parse(json) as WebTokenBudgetReport
}, RUN_TIMEOUT_MS + 30_000)

describe('P4-09 acceptance[3] on the Web app (blind U-2): the standard preset engine meters its children against the tree token allowance', () => {
  it('guard: the agent was composed from the shipped standard preset, ran the workflow on the preset group\'s engine, and the first child was served', () => {
    // The case below reads a metering outcome of a run that reached a child on
    // the preset engine, not a harness that never dispatched or ran elsewhere.
    expect({
      presetComposed: report.presetComposed,
      workflowToolOffered: report.workflowToolOffered,
      rootEngineAbsent: report.rootEngineAbsent,
      workflowDispatched: report.workflowDispatched,
      firstServed: report.firstServed >= 1,
    }, JSON.stringify(report)).toEqual({
      presetComposed: true,
      workflowToolOffered: true,
      rootEngineAbsent: true,
      workflowDispatched: true,
      firstServed: true,
    })
  })

  it('a first child whose usage spends the tree allowance leaves none for the second: the second start is refused token-budget-exhausted and never served', () => {
    expect({
      budgetNamed: report.resultText.includes('token-budget-exhausted'),
      secondServed: report.secondServed,
    }, JSON.stringify(report)).toEqual({ budgetNamed: true, secondServed: 0 })
  })
})

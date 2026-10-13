/**
 * P4-09 acceptance[1] (a parent's cancellation propagates) and acceptance[2] (a
 * child failure is handled by the declared policy) on the SHIPPED headless
 * composition, through the `workflow` tool the model calls and signed saved
 * definitions the base layer's workflow-filesystem registers. Blind review 1-2
 * found these clauses observed only on hand-built contexts (BLOCKED-312 [1][2]);
 * acceptance standard S3 asks for the shipped composition.
 *
 * `./loader/p4-09-nested-shipped/driver.ts` boots the profile with the Trust
 * Kernel pinned, runs one `workflow` call per turn, and cancels the root agent
 * the way a user stops a turn. One in-flight case holds the engine's own
 * `startNested` until the agent is cancelled, so the cancel lands while the
 * nested start is in flight (B-709's window) on the shipped path.
 * @module tests/first100/fixtures/P4-09.nested-cancel-and-failure.composition
 */

import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import {
  BOOM_MESSAGE, BOOM_NAME, INFLIGHT_VALUE, PARENT_CONTINUED, REPORT_PREFIX, type NestedShippedReport,
} from './loader/p4-09-nested-shipped/shared.ts'

/** One driver run boots a profile and runs five workflow turns, each with a nested run on a worker thread. */
const RUN_TIMEOUT_MS = 240_000

const driver = fileURLToPath(new URL('./loader/p4-09-nested-shipped/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-09-nested-shipped/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: NestedShippedReport

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P4-09 nested runs on the shipped composition',
    tempDirPrefix: 'p4-09-nested-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    binArgs: [overlay],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: RUN_TIMEOUT_MS,
  })
  const json = new RegExp(`${REPORT_PREFIX} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the p4-09-nested-shipped driver reported nothing usable; stderr tail:\n${stderr.slice(-1500)}`)
  report = JSON.parse(json) as NestedShippedReport
}, RUN_TIMEOUT_MS + 30_000)

describe('P4-09 on the shipped composition: nested-run cancellation and the declared failure strategy', () => {
  it('guard: each workflow call ran, the gate held the engine\'s nested start, and the live nested run and its agent started', () => {
    // The cases below read outcomes of runs that started, not a harness that never reached the engine.
    expect({
      failDefault: report.failDefault.dispatched,
      continueParent: report.continueParent.dispatched,
      inflightControl: report.inflightControl.dispatched,
      controlParked: report.inflightControl.parked,
      cancelParked: report.inflightCancelled.parked,
      liveStarted: report.liveCancelled.nestedStarted,
      liveAgentStarted: report.liveCancelled.nestedAgentStarted,
    }, JSON.stringify(report)).toEqual({
      failDefault: true,
      continueParent: true,
      inflightControl: true,
      controlParked: true,
      cancelParked: true,
      liveStarted: true,
      liveAgentStarted: true,
    })
  })

  it('acceptance[2] ①: a nested run that fails with no declared strategy fails the parent, and the result the model reads names the child', () => {
    const text = report.failDefault.resultText
    expect({
      parentFailed: text.includes('workflow run failed'),
      namesChild: text.includes(BOOM_NAME),
      carriesChildError: text.includes(BOOM_MESSAGE),
    }, JSON.stringify(report.failDefault)).toEqual({ parentFailed: true, namesChild: true, carriesChildError: true })
  })

  it('acceptance[2] ②: with continue-parent declared on the call, the parent completes, and the child\'s failure is still recorded', () => {
    expect({
      parentCompleted: report.continueParent.resultText.includes(PARENT_CONTINUED),
      failureRecorded: report.continueParent.parentLogs.some(line => line.includes(BOOM_NAME) && line.includes('continue-parent')),
    }, JSON.stringify(report.continueParent)).toEqual({ parentCompleted: true, failureRecorded: true })
  })

  it('acceptance[1] control: a nested start held in flight and released with no cancel runs its body and returns its value', () => {
    expect({
      childServed: report.inflightControl.childServed >= 1,
      returned: report.inflightControl.resultText.includes(INFLIGHT_VALUE),
    }, JSON.stringify(report.inflightControl)).toEqual({ childServed: true, returned: true })
  })

  it('acceptance[1]: when the agent is cancelled while a nested start is in flight, the parent ends cancelled and the nested body never starts its agent', () => {
    const { childServed, nestedAgentStarts, parentEnd } = report.inflightCancelled
    expect({ childServed, nestedAgentStarts, parentEnd }, JSON.stringify(report.inflightCancelled))
      .toEqual({ childServed: 0, nestedAgentStarts: 0, parentEnd: 'cancelled' })
  })

  it('acceptance[1]: when the agent is cancelled while a nested run is live, the nested run settles cancelled and the agent it started is ended, not stranded', () => {
    const { nestedSettled, agentStarts, agentEnds, parentEnd } = report.liveCancelled
    expect({ nestedSettled, agentsEnded: agentEnds === agentStarts, parentEnd }, JSON.stringify(report.liveCancelled))
      .toEqual({ nestedSettled: 'cancelled', agentsEnded: true, parentEnd: 'cancelled' })
  })
})

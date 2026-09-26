/**
 * A-442 under P2-03 acceptance[2] (「无法分类副作用的动作默认高风险并要求审批。」):
 * on the SHIPPED headless profile at its shipped default preset, a tool call
 * the risk gate cannot classify reaches an approval request before it runs and
 * is refused when the operator rejects it, while a classified control reaches
 * none and runs.
 *
 * `./loader/p2-03-gate-approval/driver.ts` registers two probe tools that
 * differ only in whether they declare `riskDomainTags`, calls each through the
 * model in its own turn, and answers every approval request `rejected`. The
 * cases read the root session's log and the probes' own run counters.
 * @module tests/first100/fixtures/P2-03.gate-approval.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CLASSIFIED_CALL,
  CLASSIFIED_TOOL,
  type GateApprovalReport,
  PROBE_RAN,
  UNCLASSIFIED_CALL,
  UNCLASSIFIED_TOOL,
} from './loader/p2-03-gate-approval/shared.ts'

const driver = fileURLToPath(new URL('./loader/p2-03-gate-approval/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: GateApprovalReport | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P2-03 gate approval',
    tempDirPrefix: 'p2-03-gate-approval-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P2-03-GATE (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as GateApprovalReport
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): GateApprovalReport {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

describe('P2-03 acceptance[2] through the risk gate on the shipped headless profile at its default preset', () => {
  it('control: a probe declaring filesystem-read is allowed by the preset without an approval request, and runs', () => {
    const { riskGated, asked, runs, results } = reported()
    const context = JSON.stringify(reported())
    expect(riskGated.filter(row => row.actionId === CLASSIFIED_TOOL).map(row => [row.riskClass, row.preset, row.decision]), context)
      .toEqual([['read', 'workspace-write', 'allowed-by-preset']])
    expect(asked.filter(row => row.toolName === CLASSIFIED_TOOL), context).toEqual([])
    expect(runs.classified, context).toBe(1)
    expect(results.filter(row => row.callId === CLASSIFIED_CALL).map(row => [row.isError, row.text.includes(PROBE_RAN)]), context)
      .toEqual([[false, true]])
  })

  it('a probe declaring no risk domain tags reaches an approval request, and is refused without running when the operator rejects it', () => {
    const { riskGated, asked, runs, results, operatorAsked } = reported()
    const context = JSON.stringify(reported())
    expect(asked.filter(row => row.toolName === UNCLASSIFIED_TOOL).map(row => row.outcome), context).toEqual(['rejected'])
    expect(operatorAsked.filter(name => name === UNCLASSIFIED_TOOL), context).toHaveLength(1)
    expect(riskGated.filter(row => row.actionId === UNCLASSIFIED_TOOL).map(row => [row.riskClass, row.preset, row.decision]), context)
      .toEqual([['security-sensitive', 'workspace-write', 'refused']])
    expect(runs.unclassified, context).toBe(0)
    expect(results.filter(row => row.callId === UNCLASSIFIED_CALL).map(row => [row.isError, row.text.includes('declares no risk domain tags')]), context)
      .toEqual([[true, true]])
  })
})

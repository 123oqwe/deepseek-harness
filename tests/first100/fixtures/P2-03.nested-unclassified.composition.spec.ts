/**
 * A-471 under P2-03 acceptance[2] (「无法分类副作用的动作默认高风险并要求审批。」)
 * and BLOCKED-294: on the SHIPPED headless profile at its default preset, a
 * tool call the risk gate cannot classify reaches an approval request before
 * it runs when a plugin tool nests it through `ToolRuntime.execute`, as it
 * does when the model makes it.
 *
 * `./loader/p2-03-nested-unclassified/driver.ts` registers a writer that
 * declares no risk domain tags and a probe that calls it through the tool
 * runtime under the token it was admitted with; the operator rejects every
 * approval request. One turn has the model call the writer, the control; a
 * second has it call the probe.
 * @module tests/first100/fixtures/P2-03.nested-unclassified.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NestedUnclassifiedReport, type Phase, WRITER_TOOL } from './loader/p2-03-nested-unclassified/shared.ts'

const driver = fileURLToPath(new URL('./loader/p2-03-nested-unclassified/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: NestedUnclassifiedReport | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P2-03 nested unclassified',
    tempDirPrefix: 'p2-03-nested-unclassified-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P2-03-NESTED-UNCLASSIFIED (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as NestedUnclassifiedReport
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): NestedUnclassifiedReport {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

/**
 * In one turn, whether the operator was asked about the writer and how many times the writer ran.
 * @param phase - the turn.
 * @returns both facts.
 */
function writerIn(phase: Phase): { readonly asked: boolean; readonly ran: number } {
  const { operatorAsked, runs } = reported()
  return {
    asked: operatorAsked.some(row => row.phase === phase && row.toolName === WRITER_TOOL),
    ran: runs.filter(row => row.phase === phase).length,
  }
}

describe('P2-03 acceptance[2] × BLOCKED-294: an unclassifiable call nested through ToolRuntime.execute reaches an approval request', () => {
  it('control: the model\'s own call to the unclassifiable writer reaches an approval request and, rejected, does not run', () => {
    expect(writerIn('direct'), JSON.stringify(reported())).toEqual({ asked: true, ran: 0 })
  })

  it('a plugin tool\'s nested call to the unclassifiable writer reaches an approval request before it runs and, rejected, does not run', () => {
    expect(writerIn('nested'), JSON.stringify(reported())).toEqual({ asked: true, ran: 0 })
  })
})

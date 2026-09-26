/**
 * P2-05 acceptance[0] (「同一 ActionManifest 无论从工具、workflow、SDK、插件、子 Agent
 * 发起都经过同一 PEP。」), the code-mode half: on the SHIPPED headless profile in
 * code mode, an action a `run_code` program originates appends its own
 * manifest and is decided by the same audited enforcement point as the
 * model's own call, before it runs.
 *
 * `./loader/p2-05-code-mode/driver.ts` pins the Trust Kernel with an audit
 * sink and runs one turn whose model calls `run_code` with a program that
 * reads one file. The control is the `run_code` call itself, which the native
 * path manifests and decides; it shows this probe reads a manifest and a
 * decision when they exist.
 * @module tests/first100/fixtures/P2-05.code-mode-originator.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { type CodeModeReport, PROGRAM_CALL, READ_LINE } from './loader/p2-05-code-mode/shared.ts'

const driver = fileURLToPath(new URL('./loader/p2-05-code-mode/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: CodeModeReport | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P2-05 code-mode originator',
    tempDirPrefix: 'p2-05-code-mode-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P2-05-CODE-MODE (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as CodeModeReport
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): CodeModeReport {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

/**
 * The effects the kernel audited for one action id, in order.
 * @param actionId - the action id.
 * @returns the effects.
 */
function decisionsFor(actionId: string): readonly unknown[] {
  return reported().decisions.filter(decision => decision.actionId === actionId).map(decision => decision.effect)
}

describe('P2-05 acceptance[0]: an action a code-mode program originates passes the one enforcement point', () => {
  it('control: the model\'s own run_code call appends one native manifest and is decided once', () => {
    const context = JSON.stringify(reported())
    const own = reported().manifests.filter(manifest => manifest.actionId === PROGRAM_CALL)
    expect(own.map(manifest => [manifest.origin, manifest.capability]), context).toEqual([['native-tool-call', 'run_code']])
    expect(decisionsFor(PROGRAM_CALL), context).toEqual(['permit'])
  })

  it('the program\'s read appends one code-mode manifest and the same audited enforcement point decides it once before it runs', () => {
    const context = JSON.stringify(reported())
    const embedded = reported().manifests.filter(manifest => manifest.origin === 'code-mode-embedded' && manifest.capability === 'read')
    expect(embedded, context).toHaveLength(1)
    expect(decisionsFor(embedded[0]?.actionId ?? ''), context).toEqual(['permit'])
    expect(reported().programResult.includes(READ_LINE), context).toBe(true)
  })
})

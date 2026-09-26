/**
 * A-462 under P2-03 acceptance[0] (「任何外部写操作在事件日志中都存在先于执行的 ActionManifest。」)
 * and BLOCKED-294: on the SHIPPED headless profile at its shipped default
 * preset, a plugin tool that writes a file through `ToolRuntime.execute` from
 * inside its own body, under the Capability Token it was admitted with, is
 * refused or has its manifest appended before the file is written.
 *
 * `./loader/p2-03-nested-token/driver.ts` has the model write one file itself
 * (the control) and then call the probe, which nests the second write. Each
 * `write` reports the file written with `fs/observed`; the driver records at
 * that moment whether any session log holds a manifest for that call id. The
 * operator allows every approval request, so a refusal can only come from the
 * runtime.
 * @module tests/first100/fixtures/P2-03.nested-inherited-token.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { NATIVE_CALL, NESTED_CALL, type NestedTokenReport } from './loader/p2-03-nested-token/shared.ts'

const driver = fileURLToPath(new URL('./loader/p2-03-nested-token/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: NestedTokenReport | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P2-03 nested inherited token',
    tempDirPrefix: 'p2-03-nested-token-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P2-03-NESTED (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as NestedTokenReport
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): NestedTokenReport {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

/**
 * For one `write` call id, whether a manifest was in a session log at each moment its file was written.
 * @param callId - the call id.
 * @returns one entry per observed write, in order.
 */
function manifestBeforeEachWrite(callId: string): boolean[] {
  return reported().observed.filter(row => row.callId === callId).map(row => row.manifestBefore)
}

describe('P2-03 acceptance[0] × BLOCKED-294: a plugin tool nests a write through ToolRuntime.execute under its inherited capability token', () => {
  it('control: the model\'s own write has its manifest appended before the file is written', () => {
    const context = JSON.stringify(reported())
    expect({ manifestBefore: manifestBeforeEachWrite(NATIVE_CALL), file: reported().files.native }, context)
      .toEqual({ manifestBefore: [true], file: true })
  })

  it('the probe\'s body ran once and held the capability token it was admitted with', () => {
    expect(reported().probe, JSON.stringify(reported())).toEqual({ runs: 1, tokenPresented: true })
  })

  it('the nested write is refused, or its manifest is appended before the file is written', () => {
    expect(['refused', 'manifested before the write'], JSON.stringify(reported())).toContain(nestedOutcome())
  })
})

/**
 * What happened to the nested write, in words.
 * @returns `refused` when it returned an error and wrote nothing; otherwise whether its one write had a manifest before it.
 */
function nestedOutcome(): string {
  const { nested, files } = reported()
  const writes = manifestBeforeEachWrite(NESTED_CALL)
  if (nested?.isError === true && !files.nested && writes.length === 0) return 'refused'
  if (writes.length !== 1) return `unexpected: ${String(writes.length)} observed writes`
  return writes[0] === true ? 'manifested before the write' : 'written with no manifest'
}

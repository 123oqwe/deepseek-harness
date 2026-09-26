/**
 * A-472 under P4-07 and BLOCKED-334: on the SHIPPED headless profile at its
 * default preset, once an emergency stop is in force, a `write` a plugin tool
 * that was already executing nests through `ToolRuntime.execute` is refused
 * and writes nothing, as the model's own next `write` is.
 *
 * `./loader/p4-07-nested-after-stop/driver.ts` has the model call a probe tool
 * that asks the shipped control plane for `pause-new-actions` inside its body
 * and then nests the `write`; after the probe's result, the model calls
 * `write` itself. The cases read the root session's log, the nested call's
 * return and the working directory.
 * @module tests/first100/fixtures/P4-07.nested-after-stop.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { NATIVE_CALL, type NestedAfterStopReport, STOP_REFUSAL } from './loader/p4-07-nested-after-stop/shared.ts'

const driver = fileURLToPath(new URL('./loader/p4-07-nested-after-stop/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: NestedAfterStopReport | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P4-07 nested after stop',
    tempDirPrefix: 'p4-07-nested-after-stop-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P4-07-NESTED-AFTER-STOP (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as NestedAfterStopReport
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): NestedAfterStopReport {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

describe('P4-07 × BLOCKED-334: after an emergency stop, a write a running plugin tool nests through ToolRuntime.execute is refused', () => {
  it('control: after the stop, the model\'s own next write is refused, or never dispatched, and writes nothing', () => {
    // A loop that ends the turn under the stop never dispatches the write; that is a refusal too.
    const native = reported().results.filter(row => row.callId === NATIVE_CALL)
    const refused = native.every(row => row.text.includes(STOP_REFUSAL))
    expect({ refused, written: reported().files.native, gate: reported().stopGate }, JSON.stringify(reported()))
      .toEqual({ refused: true, written: false, gate: 'stopped' })
  })

  it('after the stop, the write the plugin tool nests is refused and writes nothing', () => {
    const { nested, files } = reported()
    expect({ refused: nested?.isError === true || nested?.thrown !== undefined, written: files.nested }, JSON.stringify(reported()))
      .toEqual({ refused: true, written: false })
  })
})

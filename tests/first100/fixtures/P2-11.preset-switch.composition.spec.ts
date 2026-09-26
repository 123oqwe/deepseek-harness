/**
 * A-476 under P2-11 acceptance[2] (「运行中降权立即生效」) and acceptance[3]
 * (「升权需审批。」): on the SHIPPED headless profile, a running session that
 * raises its permission preset reaches an approval request first and, refused,
 * keeps its preset; one that lowers it is held to the lower preset at once.
 *
 * `./loader/p2-11-preset-switch/driver.ts` runs `/permission danger-full-access`
 * and then `/permission read-only` through `ctx.commands.execute`, the entry a
 * Web client uses, with an operator that rejects every approval request, and
 * then has the model call `write`.
 * @module tests/first100/fixtures/P2-11.preset-switch.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p2-11-preset-switch/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** One `/permission` run, as the driver reports it. */
interface Switch {
  readonly result: { readonly kind?: string; readonly text?: string } | null
  readonly presetAfter: string
}

/** The driver's report. */
interface Report {
  readonly presetBefore: string
  readonly raise: Switch
  readonly askedDuringRaise: readonly string[]
  readonly lower: Switch
  readonly write: { readonly results: readonly { readonly isError: boolean; readonly text: string }[]; readonly written: boolean }
  readonly operatorAsked: readonly string[]
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P2-11 preset switch',
    tempDirPrefix: 'p2-11-preset-switch-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P2-11-PRESET (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as Report
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): Report {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

describe('P2-11: raising the permission preset of a running session needs approval, and lowering it holds at once', () => {
  it('control: both /permission commands are recognized and settle', () => {
    const { raise, lower } = reported()
    expect({ raise: raise.result === null ? null : 'settled', lower: lower.result === null ? null : 'settled' }, JSON.stringify(reported()))
      .toEqual({ raise: 'settled', lower: 'settled' })
  })

  it('acceptance[3]: raising the preset reaches an approval request first and, refused, leaves the preset where it was', () => {
    const { presetBefore, raise, askedDuringRaise } = reported()
    expect({ asked: askedDuringRaise.length > 0, presetAfter: raise.presetAfter }, JSON.stringify(reported()))
      .toEqual({ asked: true, presetAfter: presetBefore })
  })

  it('acceptance[2]: after lowering the preset to read-only, the next write is refused and writes nothing', () => {
    const { lower, write } = reported()
    expect({ preset: lower.presetAfter, refused: write.results.length > 0 && write.results.every(row => row.isError), written: write.written }, JSON.stringify(reported()))
      .toEqual({ preset: 'read-only', refused: true, written: false })
  })
})

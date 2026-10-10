/**
 * P3-12 must[2] slice A red first (lane B; the isolated decode is lane A's):
 * 「未信任附件只在隔离 world 解析」 — an untrusted image admitted on the shipped
 * headless profile is decoded in another process, so a crash of the decoder
 * cannot take the host down (the process boundary the delegate's minimal-slice
 * ruling names; a worker thread shares the host's memory and does not count).
 *
 * `./loader/p3-12-a-isolated-decode/driver.ts` boots the profile in-process and
 * admits two generated PNGs through `ctx.attachments.admitPromptContent` while
 * polling its own descendant processes; during the second admission it kills
 * every descendant it sees. The observation is the process tree, not a marker
 * in the decoding code. Today `attachment-local` decodes with sharp in the host
 * (packages/attachment/attachment-local/src/image.ts:116), so no descendant
 * exists while an admission runs — RED. §21.4: written before the fix.
 * @module tests/first100/fixtures/P3-12.must2-isolated-decode.composition
 */

import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { REPORT_PREFIX, type DecodeReport } from './loader/p3-12-a-isolated-decode/shared.ts'

/** One driver run boots a profile and admits two images. */
const RUN_TIMEOUT_MS = 180_000

const driver = fileURLToPath(new URL('./loader/p3-12-a-isolated-decode/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p3-12-a-isolated-decode/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: DecodeReport | undefined
let runError: string | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P3-12 must[2] isolated decode',
    tempDirPrefix: 'p3-12-a-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    binArgs: [overlay],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: RUN_TIMEOUT_MS,
  })
  const json = new RegExp(`${REPORT_PREFIX} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
  // No report line means the host did not reach the end of the run: it died or hung.
  if (json === undefined) runError = `the host printed no report; stderr tail:\n${stderr.slice(-1500)}`
  else report = JSON.parse(json) as DecodeReport
}, RUN_TIMEOUT_MS + 30_000)

/** The run's report, or the reason there is none. */
function reportOf(): DecodeReport {
  if (report === undefined) throw new Error(runError ?? 'no report')
  return report
}

describe('P3-12 must[2] (lane B red first, slice A): an untrusted image is decoded in another process, and its crash leaves the host alive', () => {
  it('guard: the shipped profile admits a benign image', () => {
    const result = reportOf()
    expect(result.watched.outcome, JSON.stringify(result)).toBe('admitted')
  })

  it('the decode runs outside the host: a descendant process exists while the admission runs (today none — RED)', () => {
    const result = reportOf()
    expect(result.watched.seen.length, JSON.stringify(result)).toBeGreaterThanOrEqual(1)
  })

  it('a decoder killed mid-admission leaves the host alive and the admission settled (today there is nothing to kill — RED)', () => {
    const result = reportOf()
    expect({
      killedADescendant: result.crashed.killed.length >= 1,
      settled: !result.crashed.outcome.startsWith('refused: admission did not settle'),
    }, JSON.stringify(result)).toEqual({ killedADescendant: true, settled: true })
  })
})

/**
 * A-474 under P3-12 acceptance[1] (「zip bomb、polyglot、伪 MIME、恶意文档不进入模型或宿主 parser。」):
 * on the SHIPPED headless profile, the shipped attachment store refuses an
 * image whose declared type is not its bytes, and refuses a PNG that is also a
 * ZIP, or keeps the archive out of both what it stores and what it would send a
 * model.
 *
 * `./loader/p3-12-image-polyglot/driver.ts` admits a clean 1×1 PNG (the
 * control, which shows a clean image passes through byte for byte), the same
 * PNG declared `image/jpeg`, and the PNG followed by an empty ZIP's
 * end-of-central-directory record.
 * @module tests/first100/fixtures/P3-12.image-polyglot.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p3-12-image-polyglot/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the store did with one image, as the driver reports it. */
interface Outcome {
  readonly admitted: boolean
  readonly code: string | null
  readonly storedSameAsInput: boolean | null
  readonly storedCarriesZip: boolean | null
  readonly requestSameAsInput: boolean | null
  readonly requestCarriesZip: boolean | null
}

/** The driver's report. */
interface Report {
  readonly plain: Outcome
  readonly mislabelled: Outcome
  readonly polyglot: Outcome
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P3-12 image polyglot',
    tempDirPrefix: 'p3-12-image-polyglot-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P3-12-POLYGLOT (?<json>.+)/u.exec(stdout)?.groups?.json
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

describe('P3-12 acceptance[1]: a polyglot or mislabelled image does not reach the model through the shipped attachment store', () => {
  it('control: a clean PNG is admitted and both its stored and its request bytes are the bytes submitted', () => {
    const { plain } = reported()
    expect({ admitted: plain.admitted, stored: plain.storedSameAsInput, request: plain.requestSameAsInput }, JSON.stringify(plain))
      .toEqual({ admitted: true, stored: true, request: true })
  })

  it('a PNG declared image/jpeg is refused', () => {
    const { mislabelled } = reported()
    expect({ admitted: mislabelled.admitted, code: mislabelled.code }, JSON.stringify(mislabelled)).toEqual({ admitted: false, code: 'IMAGE_TYPE_MISMATCH' })
  })

  it('a PNG that is also a ZIP is refused, or neither its stored nor its request bytes carry the archive', () => {
    const { polyglot } = reported()
    const kept = polyglot.admitted && (polyglot.storedCarriesZip === true || polyglot.requestCarriesZip === true)
    expect({ archiveKept: kept }, JSON.stringify(polyglot)).toEqual({ archiveKept: false })
  })
})

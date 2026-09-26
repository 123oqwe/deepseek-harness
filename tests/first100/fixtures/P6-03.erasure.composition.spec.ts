/**
 * P6-03's right-to-erasure on the shipped composition: must[3] 「支持 merge、
 * supersede、forget、export、right-to-erasure，并传播到索引。」.
 *
 * `./loader/p6-03-proposal/erasure-driver.ts` boots the SHIPPED headless
 * profile with the base layer's `memory` row enabled over a durable file
 * directory, proposes records about the subject to erase in two sessions and
 * two workspaces of the requester's tenant, one about another subject, and one
 * about the same subject in a tenant the requester may not process. A user of
 * the requester's tenant then asks to erase the subject.
 *
 * The erasure verb is `ctx.memory.erase({ principal, tenantId, subject })`:
 * every record about `subject` in `tenantId`, whatever its session or
 * workspace, is forgotten as `forget` forgets one, and leaves a tombstone in
 * the third slice's export. Today the seam has no erasure verb.
 * @module tests/first100/fixtures/P6-03.erasure.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p6-03-proposal/erasure-driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p6-03-proposal/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver read for one record after the erasure. */
interface Read {
  /** Whether the default search of its tenant and workspace returned it. */
  readonly active: boolean
  /** Whether the export of its tenant and workspace returned it. */
  readonly exported: boolean
  /** The tombstone that export listed for it, or `null` when it listed none. */
  readonly tombstone: { readonly carriesContent: boolean } | null
  /** Whether some file of the memory store holds its content. */
  readonly inStore: boolean
}

/** What the driver saw, as its `P6-03-ERASURE` line reports it. */
interface Report {
  /** What each step threw, keyed by step. */
  readonly thrown: Readonly<Record<string, string>>
  /** Every record by name; `null` when its proposal minted no id. */
  readonly records: Readonly<Record<string, Read | null>>
}

/** The records about the subject that the erasure must reach. */
const ERASED = ['erased-a', 'erased-b', 'erased-second'] as const

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P6-03 erasure',
    tempDirPrefix: 'p6-03-erasure-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P6-03-ERASURE (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as Report
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reading(): Report {
  if (report === undefined) throw new Error('the driver left no report')
  return report
}

describe('P6-03 on the shipped headless profile: must[3] right-to-erasure forgets a subject in every scope the requester may process', () => {
  it('right-to-erasure: erasing a subject leaves a tombstone for each of its records in every session and workspace of the requester\'s tenant, none carrying the record\'s content', () => {
    const { thrown, records } = reading()
    expect(thrown.erase).toBeUndefined()
    for (const name of ERASED) {
      expect(records[name]?.tombstone, name).toEqual({ carriesContent: false })
    }
  })

  it('right-to-erasure: once the erasure resolves, neither the default search nor export returns any of the subject\'s records in the requester\'s tenant, and no file of the memory store holds their content', () => {
    const { records } = reading()
    // The scan does find content that was not erased, so finding nothing is a reading.
    expect(records['kept-subject']?.inStore).toBe(true)
    for (const name of ERASED) {
      expect(records[name], name).toMatchObject({ active: false, exported: false, inStore: false })
    }
  })

  it('control: a record about another subject in the same scopes stays in the default search and in export, with no tombstone', () => {
    const { records } = reading()
    expect(records['kept-subject']).toEqual({ active: true, exported: true, tombstone: null, inStore: true })
  })

  it('control: a record about the same subject in a tenant the requester may not process stays in the default search and in export, with no tombstone', () => {
    const { records } = reading()
    expect(records['kept-tenant']).toEqual({ active: true, exported: true, tombstone: null, inStore: true })
  })
})

/**
 * P6-03's third slice on the shipped composition: acceptance[1] 「forget 后主存、
 * 索引、cache、projection 在 SLA 内清除并留下合规 tombstone。」, acceptance[2]
 * 「导出包含来源和冲突状态。」 and must[3]'s merge and supersede 「支持 merge、
 * supersede、forget、export、right-to-erasure，并传播到索引。」.
 *
 * `./loader/p6-03-proposal/lifecycle-driver.ts` boots the SHIPPED headless
 * profile with the base layer's `memory` row enabled over a durable file
 * directory and its `memory-context` row enabled, so a session recalls memory
 * into its model requests. Every acceptance[1] check of the store, the default
 * search and a second reader of the same store runs as soon as `forget`
 * resolves, which meets any SLA. The projection is the model-visible history of
 * a session that recalled the record before it was forgotten: its next model
 * request must not carry the content.
 *
 * The third slice's verbs are `ctx.memory.supersede` and `ctx.memory.merge`;
 * `ctx.memory.export` adds each record's `provenance`, `status` and
 * `relations`, and the `tombstones` of forgotten records. A cross-scope merge
 * needs an authorization naming both scopes (P6-02 acceptance[2]), and its
 * refusal carries the code `MEMORY_MERGE_NOT_AUTHORIZED`. Today `forget`
 * deletes the record and leaves nothing behind, a recall already in a
 * session's history is sent again, export returns neither source nor status,
 * and the seam has no supersede or merge.
 * @module tests/first100/fixtures/P6-03.lifecycle.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p6-03-proposal/lifecycle-driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p6-03-proposal/base.patch.yml', import.meta.url))
const recallOverlay = fileURLToPath(new URL('./loader/p6-03-proposal/recall.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What a reader of the store returned for one record. */
interface Seen {
  readonly get: boolean
  readonly search: boolean
  readonly export: boolean
}

/** One record as the final export returned it; `null` fields were absent. */
interface Exported {
  readonly provenance: unknown
  readonly status: string | null
  readonly relations: readonly { readonly kind: string; readonly target: string }[] | null
}

/** What the driver saw, as its `P6-03-LIFECYCLE` line reports it. */
interface Report {
  /** What each step threw, keyed by step. */
  readonly thrown: Readonly<Record<string, string>>
  /** acceptance[1], read as soon as `forget` resolved. */
  readonly forget: {
    /** The tombstone export listed for `forgotten`, or `null` when it listed none. */
    readonly tombstone: { readonly forgottenAt: string | null; readonly forgottenBy: string; readonly carriesContent: boolean } | null
    /** Whether some file of the store holds a record that was not forgotten. */
    readonly storeReadable: boolean
    /** Whether some file of the store holds the forgotten record's content. */
    readonly storeHoldsForgotten: boolean
    readonly getFound: boolean
    readonly searchFound: boolean
    readonly exportFound: boolean
    /** What the second reader returned before and after the forget; `null` when propose failed. */
    readonly readerBefore: Seen | null
    readonly readerAfter: Seen | null
  }
  /** Whether the session's model requests carried the recalled content, before and after the forget. */
  readonly projection: { readonly before: boolean; readonly after: boolean; readonly requestsAfter: number }
  /** The cross-session merge without an authorization: what it threw, and whether both records stayed active. */
  readonly unauthorizedMerge: { readonly code: string | null; readonly fromActive: boolean; readonly intoActive: boolean }
  /** Every record as the final export returned it, by name; `null` when the export did not return it. */
  readonly exported: Readonly<Record<string, Exported | null>>
  /** Whether the default search returned each record at the end, by name. */
  readonly active: Readonly<Record<string, boolean>>
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P6-03 lifecycle',
    tempDirPrefix: 'p6-03-lifecycle-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the base overlay stays first.
    binArgs: [overlay, recallOverlay],
    tsconfigPath: repoTsconfig,
  })
  const json = /P6-03-LIFECYCLE (?<json>.+)/u.exec(stdout)?.groups?.json
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

describe('P6-03 third slice on the shipped headless profile: acceptance[1] forget clears the store, the index, a second reader and the projection, and leaves a compliant tombstone', () => {
  it('tombstone: export lists one for the forgotten record, naming when it was forgotten and who forgot it, and carrying none of its content', () => {
    const { thrown, forget } = reading()
    expect(thrown['forget:forgotten']).toBeUndefined()
    expect(forget.tombstone, JSON.stringify(thrown)).not.toBeNull()
    expect(Number.isNaN(Date.parse(forget.tombstone?.forgottenAt ?? ''))).toBe(false)
    expect(forget.tombstone?.forgottenBy).toContain('p6-03-writer')
    expect(forget.tombstone?.carriesContent).toBe(false)
  })

  it('primary store: once forget resolves no file of the memory store holds the forgotten content, and get finds nothing', () => {
    const { thrown, forget } = reading()
    expect(thrown['forget:forgotten']).toBeUndefined()
    // The scan does find content that was not forgotten, so finding nothing here is a reading.
    expect(forget.storeReadable).toBe(true)
    expect(forget.storeHoldsForgotten).toBe(false)
    expect(forget.getFound).toBe(false)
  })

  it('index: once forget resolves neither the default search nor export returns the forgotten record', () => {
    const { thrown, forget } = reading()
    expect(thrown['forget:forgotten']).toBeUndefined()
    expect(forget.searchFound).toBe(false)
    expect(forget.exportFound).toBe(false)
  })

  it('cache: a second reader of the same store that read the record before forget does not return it once forget resolves', () => {
    const { forget } = reading()
    expect(forget.readerBefore).toEqual({ get: true, search: true, export: true })
    expect(forget.readerAfter).toEqual({ get: false, search: false, export: false })
  })

  it('control: the session recalled the record before forget, so its content reached a model request', () => {
    const { thrown, projection } = reading()
    expect(thrown['turn-before-forget']).toBeUndefined()
    expect(projection.before).toBe(true)
  })

  it('projection: after forget, the model requests of the session that recalled the record no longer carry its content', () => {
    const { thrown, projection } = reading()
    expect(thrown['forget:recalled']).toBeUndefined()
    expect(thrown['turn-after-forget']).toBeUndefined()
    expect(projection.requestsAfter).toBeGreaterThan(0)
    expect(projection.after).toBe(false)
  })
})

describe('P6-03 third slice on the shipped headless profile: acceptance[2] export carries each record\'s source and conflict status', () => {
  it('source: export names who asserted a user-asserted record and the source events of a derived one', () => {
    const { thrown, exported } = reading()
    expect(thrown['export-final']).toBeUndefined()
    expect(exported.asserted?.provenance).toMatchObject({ kind: 'user-asserted', assertedBy: 'p6-03-writer' })
    expect(exported.derived?.provenance).toMatchObject({ kind: 'derived', sourceEvents: ['p6-03-source-event'] })
  })

  it('conflict status: export gives a superseded record status superseded, the record that superseded it the supersedes relation, and an unconflicted record status active with no relations', () => {
    const { thrown, exported } = reading()
    expect(thrown['export-final']).toBeUndefined()
    expect(exported.older?.status).toBe('superseded')
    expect(exported.newer?.relations).toContainEqual({ kind: 'supersedes', target: 'older' })
    expect(exported.asserted?.status).toBe('active')
    expect(exported.asserted?.relations).toEqual([])
  })
})

describe('P6-03 third slice on the shipped headless profile: must[3] supersede and merge, propagated to the default search', () => {
  it('supersede: the default search returns the newer record and not the one it superseded, and export keeps both', () => {
    const { thrown, active, exported } = reading()
    expect(thrown.supersede).toBeUndefined()
    expect(active.newer).toBe(true)
    expect(active.older).toBe(false)
    expect(exported.older).not.toBeNull()
    expect(exported.newer).not.toBeNull()
  })

  it('merge: after a merge within one scope the default search returns the record merged into and not the one merged, and export keeps both with the merge recorded', () => {
    const { thrown, active, exported } = reading()
    expect(thrown.merge).toBeUndefined()
    expect(active.survivor).toBe(true)
    expect(active.merged).toBe(false)
    expect(exported.merged?.status).not.toBe('active')
    expect(exported.merged?.status).not.toBeNull()
    expect(exported.survivor?.relations?.map(relation => relation.target)).toContain('merged')
  })

  it('merge across sessions without an authorization naming both scopes is refused with MEMORY_MERGE_NOT_AUTHORIZED, and both records stay active', () => {
    const { unauthorizedMerge } = reading()
    expect(unauthorizedMerge).toEqual({ code: 'MEMORY_MERGE_NOT_AUTHORIZED', fromActive: true, intoActive: true })
  })

  it('merge across sessions with an authorization naming both scopes merges: the default search returns the record merged into and not the one merged', () => {
    const { thrown, active } = reading()
    expect(thrown['merge-authorized']).toBeUndefined()
    expect(active['cross-into']).toBe(true)
    expect(active['cross-from']).toBe(false)
  })
})

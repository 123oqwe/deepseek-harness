/**
 * P6-03's second slice on the shipped composition: must[0] 「Agent 只能提交
 * MemoryProposal，包含证据、预期用途、TTL、敏感等级。」, and the lifecycle of a
 * proposal the policy holds for review (must[1] 「Policy 决定
 * auto-accept/review/reject」, must[2] 「高敏感默认人工。」).
 *
 * `./loader/p6-03-proposal/review-driver.ts` boots the SHIPPED headless
 * profile with the base layer's `memory` row enabled (the overlay
 * `./loader/p6-03-proposal/base.patch.yml` lets the default search return
 * sensitive content). A proposal that waits for review is one `propose`
 * accepts, the default search does not return, and the pending list names.
 * "No expiry" is stated as `validUntil: null`; an omitted `validUntil` is a
 * TTL nobody stated. The review verbs are `ctx.memory.listPending`,
 * `ctx.memory.approve` and `ctx.memory.reject`. Today a proposal that states
 * no intended use or no TTL is active at once, and the seam has no review
 * verbs.
 * @module tests/first100/fixtures/P6-03.review.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p6-03-proposal/review-driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p6-03-proposal/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver saw, as its `P6-03-REVIEW` line reports it. */
interface Report {
  /** What each step threw, keyed `propose:<name>`, `list-before`, `approve`, `reject` or `list-after`. */
  readonly thrown: Readonly<Record<string, string>>
  /** Whether the default search returned each proposal once every step had run. */
  readonly active: Readonly<Record<string, boolean>>
  /** The proposals the pending list named before approve and reject; `null` when listing threw. */
  readonly pendingBefore: readonly string[] | null
  /** The proposals the pending list named after approve and reject; `null` when listing threw. */
  readonly pendingAfter: readonly string[] | null
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P6-03 review',
    tempDirPrefix: 'p6-03-review-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P6-03-REVIEW (?<json>.+)/u.exec(stdout)?.groups?.json
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

describe('P6-03 second slice on the shipped headless profile: must[0] holds a proposal that leaves out its intended use or TTL for review', () => {
  it('control: a complete normal proposal that states "no expiry" as validUntil: null is accepted, and the default search returns it', () => {
    const { thrown, active } = reading()
    expect(thrown['propose:open-ended']).toBeUndefined()
    expect(active['open-ended']).toBe(true)
  })

  it('must[0]: a normal proposal that states no intended use waits for review: propose accepts it, the default search does not return it, and the pending list names it', () => {
    const { thrown, active, pendingBefore } = reading()
    expect(thrown['propose:no-purpose']).toBeUndefined()
    expect(active['no-purpose']).toBe(false)
    expect(pendingBefore, JSON.stringify(thrown)).toContain('no-purpose')
  })

  it('must[0]: a normal proposal that states no TTL waits for review: propose accepts it, the default search does not return it, and the pending list names it', () => {
    const { thrown, active, pendingBefore } = reading()
    expect(thrown['propose:no-ttl']).toBeUndefined()
    expect(active['no-ttl']).toBe(false)
    expect(pendingBefore, JSON.stringify(thrown)).toContain('no-ttl')
  })
})

describe('P6-03 second slice on the shipped headless profile: a proposal held for review is listed, then approved or rejected', () => {
  it('list: the pending list names the two sensitive proposals held for review, and not the accepted normal one', () => {
    const { thrown, active, pendingBefore } = reading()
    expect(thrown['list-before']).toBeUndefined()
    expect(active.accepted).toBe(true)
    expect(pendingBefore).toEqual(expect.arrayContaining(['approved', 'rejected']))
    expect(pendingBefore).not.toContain('accepted')
  })

  it('approve: a held proposal that is approved becomes active memory, and the pending list no longer names it', () => {
    const { thrown, active, pendingAfter } = reading()
    expect(thrown.approve).toBeUndefined()
    expect(active.approved).toBe(true)
    expect(thrown['list-after']).toBeUndefined()
    expect(pendingAfter).not.toContain('approved')
  })

  it('reject: a held proposal that is rejected stays out of the default search, and the pending list no longer names it', () => {
    const { thrown, active, pendingAfter } = reading()
    expect(thrown.reject).toBeUndefined()
    expect(active.rejected).toBe(false)
    expect(thrown['list-after']).toBeUndefined()
    expect(pendingAfter).not.toContain('rejected')
  })
})

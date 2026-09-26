/**
 * P6-03's second slice on the shipped composition: only a person decides a
 * proposal held for review (must[2] 「高敏感默认人工。」). Without this, an
 * agent could approve its own sensitive proposal.
 *
 * `./loader/p6-03-proposal/review-principal-driver.ts` boots the SHIPPED
 * headless profile with the base layer's `memory` row enabled (overlay
 * `./loader/p6-03-proposal/base.patch.yml`). A user principal proposes four
 * complete sensitive proposals, which the policy holds for review; an agent
 * principal the user delegated to, and a service principal, each try to
 * approve one and reject another. A refusal is a call that throws an error
 * carrying a `code`, as the seam's other refusals do, and leaves the proposal
 * pending and out of the default search. Today the seam has no review verbs.
 * @module tests/first100/fixtures/P6-03.review-principal.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p6-03-proposal/review-principal-driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p6-03-proposal/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What one driver step threw. */
interface Failure {
  readonly code: string | null
  readonly text: string
}

/** What the driver saw, as its `P6-03-REVIEW-PRINCIPAL` line reports it. */
interface Report {
  /** What each step threw, keyed `propose:<name>`, the proposal name for its non-person decision, `list`, or `user-approve`. */
  readonly failures: Readonly<Record<string, Failure>>
  /** The proposals the user's pending list named after the four attempts; `null` when listing threw. */
  readonly pending: readonly string[] | null
  /** Whether the default search returned each proposal after the four attempts. */
  readonly active: Readonly<Record<string, boolean>>
  /** Whether the default search returned `agent-approve` once the user had approved it. */
  readonly activeAfterUserApproval: boolean
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P6-03 review principal',
    tempDirPrefix: 'p6-03-review-principal-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P6-03-REVIEW-PRINCIPAL (?<json>.+)/u.exec(stdout)?.groups?.json
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

/**
 * Assert that a non-person's decision on one held proposal was refused and left it pending.
 * @param name - the proposal, which is also the key of the decision's failure.
 */
function expectRefusedAndPending(name: string): void {
  const { failures, pending, active } = reading()
  expect(failures[`propose:${name}`]).toBeUndefined()
  expect(failures[name]?.code, JSON.stringify(failures[name])).toEqual(expect.any(String))
  expect(pending, JSON.stringify(failures)).toContain(name)
  expect(active[name]).toBe(false)
}

describe('P6-03 second slice on the shipped headless profile: only a user principal decides a proposal held for review', () => {
  it('control: after the refused attempts, the user approves the same proposal, and the default search returns it', () => {
    const { failures, activeAfterUserApproval } = reading()
    expect(failures['user-approve']).toBeUndefined()
    expect(activeAfterUserApproval).toBe(true)
  })

  it('an agent principal the user delegated to cannot approve a held proposal: the call is refused with a coded error, and the proposal stays pending and out of the default search', () => {
    expectRefusedAndPending('agent-approve')
  })

  it('an agent principal the user delegated to cannot reject a held proposal: the call is refused with a coded error, and the proposal stays pending', () => {
    expectRefusedAndPending('agent-reject')
  })

  it('a service principal cannot approve a held proposal: the call is refused with a coded error, and the proposal stays pending and out of the default search', () => {
    expectRefusedAndPending('service-approve')
  })

  it('a service principal cannot reject a held proposal: the call is refused with a coded error, and the proposal stays pending', () => {
    expectRefusedAndPending('service-reject')
  })
})

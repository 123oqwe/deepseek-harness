/**
 * A-567 under P4-06 lock (a) («收件箱消息被领取之后、写进对话记录之前，让回合中止…
 * 之后这条消息要能再投、恰好生效一次，不许既不在待处理也不在对话记录里»), blind
 * review F2 / BLOCKED-088: on the SHIPPED headless profile, an inbox message that
 * a turn has CLAIMED (agent.ts:272) but has not yet written to the conversation
 * record (agent.ts:433), when that turn is refused in pre-step, must not be lost —
 * it must take effect exactly once.
 *
 * `./loader/p4-06-inbox-claim-lost/driver.ts` delivers a marked user message
 * through `followup`; `./loader/p4-06-inbox-claim-lost/pre-step-reject.ts` rejects
 * the first `agent/pre-step` that carries the marker, so the turn ends `blocked`
 * between the claim and the record and the refused turn's end consumes the claim.
 * The driver then delivers a control message the pre-step does not reject, flushes,
 * and counts how many times each reached the parent's durable log.
 * @module tests/first100/fixtures/P4-06.inbox-claim-lost.composition
 */

import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p4-06-inbox-claim-lost/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-06-inbox-claim-lost/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Deadline for the single-process driver: boot, two turns, disposal. */
const DRIVER_TIMEOUT_MS = 120_000

/** What the driver reported, as far as these cases read it. */
interface Report {
  readonly markedRecorded: number | null
  readonly controlRecorded: number | null
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P4-06 inbox claim lost',
    tempDirPrefix: 'p4-06-inbox-claim-lost-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: DRIVER_TIMEOUT_MS,
  })
  const json = /P4-06-CLAIM-LOST (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as Report
}, DRIVER_TIMEOUT_MS + 15_000)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): Report {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

describe('P4-06 lock (a): an inbox message claimed then refused before the record still takes effect exactly once', () => {
  it('control: a message the pre-step does not refuse is recorded exactly once', () => {
    expect(reported().controlRecorded, JSON.stringify(reported())).toBe(1)
  })

  it('a message claimed then refused between the claim and the record still reaches the record exactly once', () => {
    // Today the refused turn's end consumes the claim, so the marked message is
    // neither pending nor recorded — zero (RED). B-677 re-queues the claimed
    // message on the refusal, so a later turn records it exactly once.
    expect(reported().markedRecorded, JSON.stringify(reported())).toBe(1)
  })
})

/**
 * A-566 under P4-06 acceptance[0] («… ack 前后 kill，消息最终只产生一次业务 effect，
 * 由 consumer 按 (source, messageId, epoch) 幂等保证，不由传输保证 exactly-once»),
 * blind review F1 / BLOCKED-350: on the SHIPPED headless profile, a child's
 * settlement is committed to the durable bus, delivered to the parent (a
 * `subagent-settled` notice spliced as a user message) and acknowledged, and the
 * host is killed AROUND that ack. After the restart the settlement must have
 * produced exactly one business effect in the parent — the notice in the
 * parent's durable record.
 *
 * `./loader/p4-06-settlement-crash/driver.ts` starts a continuable child whose
 * first request the scripted model holds open, interrupts it so it settles, and:
 * - `crash-before-flush` kills the process the instant the bus acks the
 *   settlement — inside the same synchronous drain that buffered the notice,
 *   before the ≤200 ms batch timer flushes it — so the ack is durable but the
 *   parent's log never received the notice on disk. This is the acceptance case.
 * - `crash-after-flush` waits for the notice to reach the parent's durable log
 *   before killing. This is the control that isolates the ack/flush window: the
 *   effect survives a crash once it is on disk.
 *
 * After the Run lease lapses, the same working directory boots again and the
 * parent is resumed the way the Web host resumes it; the cases count how many
 * times the settlement notice reached the parent's durable record.
 * @module tests/first100/fixtures/P4-06.settlement-crash.composition
 */

import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p4-06-settlement-crash/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-06-settlement-crash/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Deadline for one restart: two phase processes of at most two minutes each, and the wait past the Run lease. */
const RESTART_TIMEOUT_MS = 300_000

/** What one variant's two phases reported, as far as these cases read it. */
interface Report {
  readonly variant: string
  readonly before: { readonly signal: string | null; readonly reading: Record<string, unknown> }
  readonly after: {
    readonly reading: {
      readonly beforeResume: { readonly settlementAcked: boolean; readonly effectCount: number | null }
      readonly afterResume: { readonly effectCount: number | null }
      readonly afterPrompt: { readonly effectCount: number | null }
    }
  }
}

const reports = new Map<string, Report>()

/**
 * Run one crash variant end to end and keep its report.
 * @param variant - the driver variant to orchestrate.
 */
async function run(variant: string): Promise<void> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `P4-06 settlement crash (${variant})`,
    tempDirPrefix: `p4-06-settlement-crash-${variant}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay, 'orchestrate', variant],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: RESTART_TIMEOUT_MS,
  })
  const json = /P4-06-SETTLEMENT-CRASH (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the ${variant} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  reports.set(variant, JSON.parse(json) as Report)
}

beforeAll(async () => {
  // The two crash variants run sequentially; each waits past the Run lease.
  await run('crash-before-flush')
  await run('crash-after-flush')
}, RESTART_TIMEOUT_MS * 2 + 30_000)

/**
 * One variant's report, or the reason there is none.
 * @param variant - the variant to read.
 * @returns the report.
 */
function reported(variant: string): Report {
  const report = reports.get(variant)
  if (report === undefined) throw new Error(`the ${variant} driver reported nothing`)
  return report
}

describe('P4-06 acceptance[0]: a settlement acked around a host crash still takes effect exactly once', () => {
  it('control: the settlement whose flush survived the crash is in the parent\'s record exactly once after the restart', () => {
    const report = reported('crash-after-flush')
    expect({
      killed: report.before.signal,
      ackedInDurableBus: report.after.reading.beforeResume.settlementAcked,
      effectAfterRestart: report.after.reading.afterPrompt.effectCount,
    }, JSON.stringify(report)).toEqual({ killed: 'SIGKILL', ackedInDurableBus: true, effectAfterRestart: 1 })
  })

  it('the settlement acked before its flush, then lost to the crash, still takes effect exactly once after the restart', () => {
    const report = reported('crash-before-flush')
    // Control half: the crash landed on the ack, and the ack is durable — the bus
    // outbox row is `sent` after the restart, so the delivery was acknowledged.
    expect({ killed: report.before.signal, ackedInDurableBus: report.after.reading.beforeResume.settlementAcked }, JSON.stringify(report))
      .toEqual({ killed: 'SIGKILL', ackedInDurableBus: true })
    // Acceptance half: exactly one business effect. Today the acked row is not
    // redelivered and the pre-crash splice never flushed, so it is zero (RED);
    // B-676 reconciles the acked-but-unconsumed row on restart, idempotently.
    expect(report.after.reading.afterPrompt.effectCount, JSON.stringify(report)).toBe(1)
  })
})

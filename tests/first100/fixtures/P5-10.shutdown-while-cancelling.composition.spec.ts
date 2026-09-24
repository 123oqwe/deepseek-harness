/**
 * BLOCKED-333 (P5-10 must[2]) on the shipped headless composition: a
 * continuable child whose cancellation is still ending when the host shuts
 * down gracefully is reported to its parent as stopped, once, and no later
 * turn of that child reaches the parent before the report.
 *
 * `./loader/p5-10-restart/driver.ts` runs its `shutdown-while-cancelling`
 * restart. Before it, a parent takes one turn, starts a continuable child
 * whose first request the scripted model holds open, cancels the child, and
 * disposes the tree while the cancelled request is still ending. After it, the
 * same working directory boots again, the parent is resumed, the child is sent
 * one prompt, and the user speaks to the parent. The cases read the parent's
 * log, which holds what both processes wrote to it. `P5_10_TRACE_SHUTDOWN=0`
 * leaves out the driver's trace of the continuation registry's private
 * members, which a fix may rename.
 */

import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p5-10-restart/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p5-10-restart/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Deadline for the restart: two phase processes of at most two minutes each. */
const RESTART_TIMEOUT_MS = 300_000

/** The notice a parent gets for a child stopped before it finished. */
const STOPPED = /was stopped before it finished\./u

/** One user message in the parent's log, as the driver reports it. */
interface LoggedMessage {
  readonly source: string
  readonly sender: string | null
  readonly text: string
}

/** What the driver reported, as far as these cases read it. */
interface Report {
  readonly before: {
    readonly reading: {
      readonly ids: { readonly parent: string; readonly child: string }
      readonly interrupt: { readonly accepted?: unknown }
      readonly childLive: boolean
      readonly child: { readonly turnEnds: number }
    }
  }
  readonly after: {
    readonly reading: {
      readonly afterResume: { readonly parentLog: readonly LoggedMessage[] | null }
      readonly parentLog: readonly LoggedMessage[] | null
    }
  }
}

/**
 * The settlement notices a log holds from one child, in log order.
 * @param log - the parent's logged user messages.
 * @param child - the child's session id.
 * @returns the notices whose sender is that child.
 */
function settlementsFrom(log: readonly LoggedMessage[] | null, child: string): readonly LoggedMessage[] {
  return (log ?? []).filter(message => message.source === 'subagent-settled' && message.sender === child)
}

describe('BLOCKED-333: a child still cancelling when the host shuts down gracefully is reported to its parent as stopped, on the shipped headless profile', () => {
  const reports: Report[] = []
  beforeAll(async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'BLOCKED-333 observation: shutdown while cancelling',
      tempDirPrefix: 'p5-10-shutdown-while-cancelling-',
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
      binArgs: [overlay, 'orchestrate', 'shutdown-while-cancelling'],
      tsconfigPath: repoTsconfig,
      processTimeoutMs: RESTART_TIMEOUT_MS,
      env: { P5_10_TRACE_SHUTDOWN: '0' },
    })
    const json = /P5-10-RESTART (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    reports.push(JSON.parse(json) as Report)
  }, RESTART_TIMEOUT_MS + 15_000)

  it('control: the host shuts down while the cancelled child is still resident, and the parent log read after the restart holds what both processes wrote', () => {
    const before = reports[0]?.before.reading
    expect(before?.interrupt.accepted).toBe(true)
    expect(before?.childLive).toBe(true)
    expect(before?.child.turnEnds).toBe(0)
    const log = reports[0]?.after.reading.parentLog ?? []
    expect(log.some(message => message.text.includes('the parent takes one turn before it starts a child')), JSON.stringify(log)).toBe(true)
  })

  it('the parent log holds the stop notice for the child exactly once', () => {
    const log = reports[0]?.after.reading.parentLog ?? null
    const stops = settlementsFrom(log, reports[0]?.before.reading.ids.child ?? '').filter(message => STOPPED.test(message.text))
    expect(stops, JSON.stringify(log)).toHaveLength(1)
  })

  it('the stop notice is in the parent log by the time the parent is resumed', () => {
    const log = reports[0]?.after.reading.afterResume.parentLog ?? null
    const stops = settlementsFrom(log, reports[0]?.before.reading.ids.child ?? '').filter(message => STOPPED.test(message.text))
    expect(stops.length, JSON.stringify(log)).toBeGreaterThan(0)
  })

  it('a later turn of the child does not reach the parent before the stop notice', () => {
    const log = reports[0]?.after.reading.parentLog ?? null
    const first = settlementsFrom(log, reports[0]?.before.reading.ids.child ?? '')[0]
    expect(first?.text ?? '(no settlement notice from the child)', JSON.stringify(log)).toMatch(STOPPED)
  })
})

/**
 * A-537 · BLOCKED-333 latter half: on the SHIPPED headless profile, a
 * settlement write that fails at shutdown is not lost silently — it reaches an
 * operator on stderr, through base's `logger-stderr` (the BLOCKED-336 fix).
 *
 * `./loader/p5-10-shutdown-warn/driver.ts` boots the shipped headless profile,
 * holds a continuable child open, cancels it, replaces the durable bus's
 * `commitIntake` with a thrower, and disposes the tree. It prints one
 * `A537-SHUTDOWN-WARN <json>` line confirming the scenario armed (the child was
 * resident and announced at dispose, and `commitIntake` was replaced), and the
 * shutdown-settlement warning (`continuation-activation.ts:964`) reaches the
 * driver's stderr.
 *
 * This is a GREEN observation with a sensitivity mutation (M-A537-1 removes the
 * warning), not a BLOCKED-336 red-first — 336's fix (logger-stderr) already
 * landed. routeThrough coverage: the shutdown warning takes the post-`unroute`
 * path (logger-stderr's default write), since shutdown runs after streaming
 * ends and, in this case, with the headless runner disabled; the in-reroute
 * path (headless/src/index.ts:212, a warning during an open reasoning section)
 * is NOT covered here and is recorded in the BLOCKED-333 closure.
 * @module tests/first100/fixtures/P5-10.shutdown-settlement-warn.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p5-10-shutdown-warn/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p5-10-shutdown-warn/base.patch.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver reported about the armed scenario. */
interface Report {
  readonly child: string
  readonly inFlight: boolean
  readonly interrupt: string
  readonly residentChild: { readonly id: string; readonly announced: boolean; readonly epoch: number | null } | null
  readonly commitIntakeReplaced: boolean
}

describe('A-537 P5-10 BLOCKED-333: a settlement write that fails at shutdown reaches stderr on the shipped headless profile', () => {
  let report: Report
  let stderr: string
  beforeAll(async () => {
    const smoke = await runLoaderSmoke({
      label: 'A-537 shutdown-settlement warn (headless)',
      tempDirPrefix: 'p5-10-shutdown-warn-',
      binScript: driver,
      configPath: overlay,
      tsconfigPath,
    })
    stderr = smoke.stderr
    const json = /A537-SHUTDOWN-WARN (?<json>.+)/u.exec(smoke.stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${smoke.stderr.slice(-1500)}`)
    report = JSON.parse(json) as Report
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('the scenario arms: the cancelled child is resident and announced at dispose, and the bus write is forced to fail', () => {
    expect({
      inFlight: report.inFlight,
      interrupt: report.interrupt,
      residentPresent: report.residentChild !== null,
      announced: report.residentChild?.announced ?? false,
      epochDefined: typeof report.residentChild?.epoch === 'number',
      commitIntakeReplaced: report.commitIntakeReplaced,
    }, JSON.stringify(report)).toEqual({
      inFlight: true,
      interrupt: 'accepted',
      residentPresent: true,
      announced: true,
      epochDefined: true,
      commitIntakeReplaced: true,
    })
  })

  it('the shutdown-settlement warning reaches stderr, naming the child (GREEN — base logger-stderr writes it; M-A537-1 removes the warning and this goes red)', () => {
    expect(stderr, `stderr must carry the shutdown-settlement warning for ${report.child}`)
      .toContain(`subagent "${report.child}" settlement was not committed at shutdown`)
  })
})

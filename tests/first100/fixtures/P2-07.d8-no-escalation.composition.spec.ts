/**
 * D8 under P2-07 U2 (ruling d8-redelegate-growth-security-finding.md): on the shipped
 * headless profile, a workflow run launched by a FILTERED launcher must not let that
 * launcher — a session derived with `allow: ['read']` — gain `write`. The re-delegation
 * growth path signs the resources a child sees but does not hold back into the PARENT
 * session, and this launcher's parent is itself a `read`-only derived session, so it is
 * grown past its own boundary. The authoritative test is a REAL dispatch read at the
 * capability gate (§19.3), not the token's resource list.
 *
 * `./loader/p2-07-d8-no-escalation/driver.ts` runs two phases over one shared working
 * directory (the restart is the process boundary):
 * - `wait`   derives a filtered launcher (`read`, not `write`, with a model route), launches
 *   a detached run whose script spawns a sub-agent FIRST (triggering the launcher's growth)
 *   and then awaits approval, and once it settles drives one real turn on the now-grown
 *   launcher whose model opens with a `write` call, reporting whether the gate refused it.
 * - `resume` boots fresh, decides the approval, waits for the run to complete, and reports
 *   the resumed run's resources, `issuanceError`, and whether it ended (diagnostics).
 *
 * Load-bearing control: `launcherWriteAllowed`. RED on 4844d9919b (pre-fix): growth grows
 * the launcher to include `write`, the gate lets the dispatch through, so it is `true`.
 * GREEN on the (B) fix (lane B): growth is bounded by each hop's filter, the launcher keeps
 * only `read`, the gate refuses the write, so it is `false`. §21.4: derived from the ruling,
 * hashed before reading the (B) fix, hooking only the public approval store, capability-token
 * provider, and session events.
 * @module tests/first100/fixtures/P2-07.d8-no-escalation.composition
 */

import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p2-07-d8-no-escalation/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** One restart of phase processes of at most two minutes each, plus the Run lease between them. */
const DEADLINE_MS = 240_000

/** What the two phases reported. */
interface Report {
  /** `wait`: the approval, the launcher/run token resources, and the launcher's real write decision. */
  readonly wait: {
    readonly approvalId: string | null
    readonly launcherHasKept: boolean
    readonly launcherHasDropped: boolean
    readonly runHasKept: boolean
    readonly runHasDropped: boolean
    readonly launcherWriteObserved: boolean
    readonly launcherWriteAllowed: boolean
  }
  /** `resume`: the resumed run's token, issuance, and whether it completed after approval (diagnostics). */
  readonly resume: {
    readonly resumeHasKept: boolean
    readonly resumeHasDropped: boolean
    readonly hasToken: boolean
    readonly issuanceError: string | null
    readonly runEnded: boolean
  }
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P2-07 D8 no-escalation',
    tempDirPrefix: 'p2-07-d8-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    binArgs: [overlay, 'orchestrate'],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: DEADLINE_MS,
  })
  const json = /P2-07-D8 (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as Report
}, DEADLINE_MS + 15_000)

/**
 * The driver's report, or the reason there is none.
 * @returns the report.
 */
function reported(): Report {
  if (report === undefined) throw new Error('the driver reported nothing')
  return report
}

describe('P2-07 D8: a filtered launcher cannot gain write through re-delegation growth', () => {
  it('control: the read-only launcher really dispatched a write and the gate refused it', () => {
    // GREEN on the (B) fix: the launcher keeps only `read`, so the gate refuses the write.
    // RED on 4844d9919b: growth grows the launcher to include `write`, so the gate lets it through.
    const { wait } = reported()
    expect(
      { decided: wait.approvalId !== null, writeObserved: wait.launcherWriteObserved, writeAllowed: wait.launcherWriteAllowed },
      JSON.stringify(reported()),
    ).toEqual({ decided: true, writeObserved: true, writeAllowed: false })
  })
})

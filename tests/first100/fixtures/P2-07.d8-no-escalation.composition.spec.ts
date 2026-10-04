/**
 * D8 under P2-07 U2 (ruling p2-07-u2-d8-token-ruling.md, 「a resumed run's effective
 * capability must equal the ORIGINAL filtered scope, not a broader root」): on the
 * shipped headless profile, a workflow run launched by a FILTERED launcher — one whose
 * token allows `read` and not `write` — keeps that filtered capability when it is
 * resumed after a restart that lost the in-memory delegation record. It is not re-signed
 * a broader root token.
 *
 * `./loader/p2-07-d8-no-escalation/driver.ts` runs two phases over one shared working
 * directory (the restart is the process boundary, which loses the in-memory delegation
 * record the escalation path depends on):
 * - `wait`   derives a filtered launcher (`read`, not `write`), launches a detached run
 *   from it (so the run's derived token is filtered too), settles `waiting_for_approval`,
 *   and reports the launcher's and run's token resources — a masked filter shows at once.
 * - `resume` boots fresh, decides the approval, lets the engine wake the run, and reports
 *   the resumed run's token resources.
 *
 * Red on M-D8-1 (adopt's empty-claim returns true, so resume re-signs a root token):
 * the resumed run's resources include `write`. §21.4: derived from the ruling, not copied
 * from lane B's evidence, and the driver hooks only the public approval store and
 * capability-token provider — never the adopt fix.
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
  /** `wait`: the approval, and whether the filter applied to the launcher and the run before the restart. */
  readonly wait: {
    readonly approvalId: string | null
    readonly launcherHasKept: boolean
    readonly launcherHasDropped: boolean
    readonly runHasKept: boolean
    readonly runHasDropped: boolean
  }
  /** `resume`: the resumed run's token after the restart. */
  readonly resume: { readonly resumeHasKept: boolean; readonly resumeHasDropped: boolean; readonly hasToken: boolean }
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

describe('P2-07 D8: a resumed run keeps its filtered capability, not a broader root', () => {
  it('control: the launcher and its run held the filtered capability (read, not write) before the restart', () => {
    const { wait } = reported()
    expect({
      decided: wait.approvalId !== null,
      launcher: { kept: wait.launcherHasKept, dropped: wait.launcherHasDropped },
      run: { kept: wait.runHasKept, dropped: wait.runHasDropped },
    }, JSON.stringify(reported())).toEqual({
      decided: true,
      launcher: { kept: true, dropped: false },
      run: { kept: true, dropped: false },
    })
  })

  it('the resumed run keeps `read` and is NOT re-signed `write`', () => {
    // GREEN on 4844d9919b: resume holds the persisted derived token — `read`, not `write`.
    // RED on M-D8-1: resume re-signs root, so the resumed run's resources include `write`.
    const { resume } = reported()
    expect({ hasToken: resume.hasToken, kept: resume.resumeHasKept, dropped: resume.resumeHasDropped }, JSON.stringify(reported()))
      .toEqual({ hasToken: true, kept: true, dropped: false })
  })
})

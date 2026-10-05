/**
 * D8 under P2-07 U2 (ruling d8-redelegate-growth-security-finding.md): on the shipped
 * headless profile, a workflow run launched by a FILTERED launcher must not let that
 * launcher — a session derived with `allow: ['read']` — gain `write`. The re-delegation
 * growth path signs the resources a child sees but does not hold back into the PARENT
 * session, and this launcher's parent is itself a `read`-only derived session, so it is
 * grown past its own boundary. The authoritative witness is the launcher's own capability
 * token: a `read`-only-derived session that holds a `write`-bearing token has been widened
 * past its filter, whether or not any dispatch runs (the token carries the authority).
 *
 * `./loader/p2-07-d8-no-escalation/driver.ts` runs two phases over one shared working
 * directory (the restart is the process boundary):
 * - `wait`   derives a filtered launcher (`read`, not `write`, with a model route), launches
 *   a detached run whose script spawns a sub-agent FIRST (triggering the launcher's growth)
 *   and then awaits approval, and once it settles reports the launcher's token resources
 *   plus a diagnostic real-dispatch attempt (`launcherWriteObserved`/`Allowed`).
 * - `resume` boots fresh, decides the approval, waits for the run to complete, and reports
 *   the resumed run's resources, `issuanceError`, and whether it ended (diagnostics).
 *
 * Load-bearing control: `launcherHasDropped` (the launcher's token lists `write`). RED on
 * 4844d9919b (pre-fix): growth signs `write` into the filtered launcher's token, so it is
 * `true`. GREEN on the (B) fix (lane B): growth is bounded by each hop's filter, the launcher
 * keeps only `read`, so it is `false`. The real-dispatch fields stay diagnostic (the dispatch
 * did not fire on 4844; not chased — §76-3 observation switch). §21.4: derived from the
 * ruling, hashed before reading the (B) fix, hooking only the public approval store,
 * capability-token provider, and session events.
 *
 * A second scenario (the ruling's pin 3) revokes the run's token before the restart and
 * asserts the resumed run is re-signed none: a revoked session fails closed. GREEN where
 * revocation is honored, RED on a mutation that re-signs a revoked or expired session.
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
  it('control: the read-only launcher token is NOT grown to include write', () => {
    // The capability token is the authoritative carrier of authority: a session derived
    // with `allow: ['read']` that holds a `write`-bearing token has been widened past its
    // own filter by re-delegation growth (BLOCKED-363 under-refuse), regardless of whether
    // any dispatch runs. launcherWriteObserved/Allowed and the run token fields stay as
    // diagnostics — the real dispatch did not fire on 4844 and is not chased.
    const { wait } = reported()
    // GREEN on the (B) fix: growth is bounded by each hop's filter, so the launcher keeps only `read`.
    // RED on 4844d9919b: growth signs `write` into the filtered launcher's own token.
    expect(
      { decided: wait.approvalId !== null, launcherGrewWrite: wait.launcherHasDropped },
      JSON.stringify(reported()),
    ).toEqual({ decided: true, launcherGrewWrite: false })
  })
})

/** What the revoke scenario's three phases reported (pin 3: expired/revoked fail-closed). */
interface RevokeReport {
  readonly wait: { readonly approvalId: string | null }
  readonly revoke: { readonly revoked: string | null }
  readonly resume: { readonly hasToken: boolean; readonly issuanceError: string | null; readonly resources: readonly string[] | null }
}

let revokeReport: RevokeReport | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P2-07 D8 revoke fail-closed',
    tempDirPrefix: 'p2-07-d8-revoke-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    binArgs: [overlay, 'orchestrate-revoke'],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: DEADLINE_MS,
  })
  const json = /P2-07-D8-REVOKE (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the revoke driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  revokeReport = JSON.parse(json) as RevokeReport
}, DEADLINE_MS + 15_000)

/**
 * The revoke scenario's report, or the reason there is none.
 * @returns the report.
 */
function revokeReported(): RevokeReport {
  if (revokeReport === undefined) throw new Error('the revoke driver reported nothing')
  return revokeReport
}

describe('P2-07 D8 pin 3: a revoked run token is not re-signed on resume (expired/revoked fail-closed)', () => {
  it('the run whose token was revoked before the restart holds no token after resume', () => {
    // The run holds a derived token when it settles (`revoked: 'revoked'` proves there was one
    // to withdraw); a correct resume refuses to re-sign a revoked session, so the resumed run
    // holds no token. GREEN where revocation is honored. RED on the mutation that re-signs a
    // revoked or expired session, handing the run a token again. §21.4: hooks only the public
    // capability-token provider, never the fix.
    const { revoke, resume } = revokeReported()
    expect(
      { revoked: revoke.revoked, hasToken: resume.hasToken },
      JSON.stringify(revokeReported()),
    ).toEqual({ revoked: 'revoked', hasToken: false })
  })
})

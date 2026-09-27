/**
 * A-558b: P1-01 admission + post-mount quarantine on a BASE-FREE profile of
 * self-contained test layers, through the shipped `runProfile` (must[3],
 * acceptance[0]; BLOCKED-322). Isolates the 甲/乙 comparison fix without base's
 * Q27 dependency — the shipped-composition observation is A-558a's.
 *
 * `./loader/p1-01-quarantine/driver.ts` boots a base-free profile with both
 * enforce env vars and prints `P1-01-QUARANTINE <json>` (the live Loader entries
 * and their fiber state); admission denials reach stderr.
 *
 * This increment covers the two control layers (match-stays STAYS,
 * missing-manifest DENIED) and that a base-free tree boots; the three quarantine
 * layers (RED until 甲/乙) follow.
 * @module tests/first100/fixtures/P1-01.quarantine.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { DECLARES_UNREGISTERED_LAYER, MATCH_STAYS_LAYER, MISSING_MANIFEST_LAYER } from './loader/p1-01-quarantine/shared.ts'

const driver = fileURLToPath(new URL('./loader/p1-01-quarantine/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver reported. */
interface Report {
  readonly bootSucceeded: boolean
  readonly bootError: string | null
  readonly loaderEntries: readonly { readonly name: string; readonly active: boolean }[]
}

describe('A-558b P1-01 must[3]/acceptance[0]: admission and quarantine on a base-free test profile', () => {
  let report: Report
  let stderr: string
  beforeAll(async () => {
    const smoke = await runLoaderSmoke({
      label: 'P1-01 quarantine (base-free)',
      tempDirPrefix: 'p1-01-quarantine-',
      binScript: driver,
      configPath: driver,
      tsconfigPath,
    })
    stderr = smoke.stderr
    const json = /P1-01-QUARANTINE (?<json>.+)/u.exec(smoke.stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${smoke.stderr.slice(-1200)}`)
    report = JSON.parse(json) as Report
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('a base-free profile of self-contained test layers boots under enforcement', () => {
    expect(report.bootSucceeded, `boot failed: ${report.bootError ?? 'unknown'}`).toBe(true)
  })

  it('the match-stays layer STAYS: it declares exactly what its entry registers, so it is admitted and not quarantined (present and ACTIVE)', () => {
    expect(report.loaderEntries.find(entry => entry.name === MATCH_STAYS_LAYER), JSON.stringify(report)).toEqual({ name: MATCH_STAYS_LAYER, active: true })
  })

  it('the missing-manifest layer is DENIED at admission: stderr names it excluded (legacy-untrusted)', () => {
    expect(stderr, `stderr must name ${MISSING_MANIFEST_LAYER} as an excluded bundle`).toContain(MISSING_MANIFEST_LAYER)
  })

  it('a declares-unregistered ENTRY layer is QUARANTINED: post-mount enforcement disposes it, naming it (RED today — staged in the profile\'s node_modules it is not found by plugin-inventory\'s own-location resolution, so the comparison skips it and it is never quarantined; green after 甲)', () => {
    expect(stderr, `stderr must show ${DECLARES_UNREGISTERED_LAYER} quarantined/disposed`)
      .toMatch(new RegExp(`disposing[^\\n]*${DECLARES_UNREGISTERED_LAYER}`, 'u'))
  })
})

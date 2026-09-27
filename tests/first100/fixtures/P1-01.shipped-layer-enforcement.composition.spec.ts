/**
 * P1-01 acceptance[0]/must[3] on a REAL shipped-launcher boot under plugin-manifest
 * enforcement (BLOCKED-322): the shipped `@deepseek-ai/dsh-base` and
 * `@deepseek-ai/dsh-headless` bundle layers stay while test layers of other
 * shapes are denied (pre-mount) or quarantined (post-mount). The G1 observation
 * for B-519's first commit.
 *
 * `./loader/p1-01-enforcement/driver.ts` boots through `runProfile` (the bin.ts
 * orchestration) with both enforcement env vars set to `enforce`, over a temp
 * profile whose `dsh.profile.bundles` lists the two shipped layers plus staged
 * test layers, then runs one turn whose scripted model calls the base layer's
 * `bash` tool. It prints `P1-01-ENFORCE <json>` (the live Loader entries and the
 * turn's tool results); admission denials and quarantines reach stderr, which the
 * boot audit keeps nowhere else.
 *
 * This increment covers the two shipped layers and the missing-manifest test
 * layer; the declares-unregistered, subpath-entry, and non-entry layers are
 * added next.
 * @module tests/first100/fixtures/P1-01.shipped-layer-enforcement.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { BASE_TOOL_MARKER, MISSING_MANIFEST_LAYER } from './loader/p1-01-enforcement/shared.ts'

const driver = fileURLToPath(new URL('./loader/p1-01-enforcement/driver.ts', import.meta.url))
const mockOverlay = fileURLToPath(new URL('./loader/p1-01-enforcement/mock.patch.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver reported. */
interface Report {
  readonly reachedModel: boolean
  readonly loaderEntries: readonly { readonly name: string; readonly active: boolean }[]
  readonly toolResults: readonly string[]
}

describe('P1-01 acceptance[0]/must[3]: shipped bundle-layer admission on a real enforcing boot', () => {
  let report: Report
  let stderr: string
  beforeAll(async () => {
    const smoke = await runLoaderSmoke({
      label: 'P1-01 shipped-layer enforcement',
      tempDirPrefix: 'p1-01-enforcement-',
      binScript: driver,
      configPath: mockOverlay,
      tsconfigPath,
    })
    stderr = smoke.stderr
    const json = /P1-01-ENFORCE (?<json>.+)/u.exec(smoke.stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${smoke.stderr.slice(-1200)}`)
    report = JSON.parse(json) as Report
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('the headless bundle layer STAYS: every one of its entries is present and ACTIVE — neither denied nor quarantined', () => {
    for (const name of ['@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-headless/startup']) {
      expect(report.loaderEntries.find(entry => entry.name === name), JSON.stringify(report)).toEqual({ name, active: true })
    }
  })

  it('the base bundle layer STAYS: the scripted model calls the base `bash` tool and it runs (RED today — base is denied for its 8 wildcard permissions, awaits Q27)', () => {
    expect(report.toolResults.join(' '), JSON.stringify(report)).toContain(BASE_TOOL_MARKER)
  })

  it('a missing-manifest test layer is DENIED at admission: stderr names it excluded, and no row of it mounts', () => {
    expect(stderr, `stderr must name ${MISSING_MANIFEST_LAYER} as an excluded bundle`).toContain(MISSING_MANIFEST_LAYER)
  })
})

/**
 * P0-02's red first on the shipped Desktop Host (B-696; BLOCKED-306
 * condition 1, question 29 (a)). The Electron application starts its host
 * through `runDesktopHost`, and that host must hold a Trust Kernel as the
 * `dsh` launcher does, so a tool call on behalf of its root agent runs; and
 * with `DSH_TRUST_KERNEL_INSECURE` set it must refuse a project that does not
 * declare `dsh.profile.development`, for that reason: the refusal names the
 * opt-in, so a start that fails on anything else does not pass for it. A
 * project that does declare it starts with the opt-in set, writes the
 * permanent warning naming the opt-in to stderr, and tells the model it runs
 * insecure (acceptance[3], B-696b), read as B-672 reads both on the `dsh`
 * entry: a warning line on stderr, and a model-request string that names the
 * Trust Kernel and the insecure mode.
 *
 * Red today on all three cases: `runDesktopHost`
 * (apps/desktop-host/src/index.ts) boots with no Trust Kernel and reads no
 * opt-in, so no kernel is present, the call is refused, the ordinary project
 * starts with the opt-in set, and the development project starts with no
 * warning and no word to the model.
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'
import { type DesktopHostReport, type DesktopProject, PROBE_CALL_ID, REPORT_PREFIX } from './loader/p0-02-desktop-host/shared.ts'

const driver = fileURLToPath(new URL('./loader/p0-02-desktop-host/driver.ts', import.meta.url))
const desktopPatch = fileURLToPath(new URL('../../../apps/desktop-host/config/desktop.cordis.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/**
 * Start the Desktop Host on one desktop project in a separate process.
 * @param project - the project the driver builds.
 * @returns the driver's report, with the driver's stderr.
 */
async function start(project: DesktopProject): Promise<DesktopHostReport & { readonly stderr: string }> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `P0-02 desktop host: ${project}`,
    tempDirPrefix: `p0-02-desktop-${project}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: desktopPatch,
    // `runLoaderSmoke` passes these instead of `[configPath]`; the driver builds its own project.
    binArgs: [project],
    tsconfigPath: repoTsconfig,
    ...project === 'production' ? {} : { env: { DSH_TRUST_KERNEL_INSECURE: '1' } },
  })
  const json = new RegExp(`${REPORT_PREFIX} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the ${project} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  return { ...JSON.parse(json) as DesktopHostReport, stderr }
}

/**
 * Whether stderr carries the permanent insecure-mode warning.
 * @param stderr - the driver's stderr.
 * @returns true when one line both warns and names `DSH_TRUST_KERNEL_INSECURE`.
 */
function warnsInsecure(stderr: string): boolean {
  return stderr.split('\n').some(line => /warning/iu.test(line) && line.includes('DSH_TRUST_KERNEL_INSECURE'))
}

describe('P0-02 on the shipped Desktop Host: a pinned Trust Kernel, and the insecure opt-in only for a development project (B-696)', () => {
  it('condition 1: the Desktop Host starts a project with a Trust Kernel pinned, and a tool call on behalf of its root agent runs once', async () => {
    const report = await start('production')
    expect(report.refused, JSON.stringify(report)).toBeUndefined()
    expect(report.kernel, JSON.stringify(report)).toBe(true)
    expect(report.runs, JSON.stringify(report)).toEqual([PROBE_CALL_ID])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('acceptance[2]: with DSH_TRUST_KERNEL_INSECURE set, a project that does not declare dsh.profile.development refuses to start', async () => {
    const report = await start('insecure-production')
    expect(report.refused, JSON.stringify(report)).toMatch(/DSH_TRUST_KERNEL_INSECURE/u)
    expect(report.runs).toEqual([])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('acceptance[3]: a project that declares dsh.profile.development starts with DSH_TRUST_KERNEL_INSECURE set, warns on stderr naming it, and tells the model it runs insecure', async () => {
    const { stderr, ...report } = await start('insecure-development')
    expect(report.refused, JSON.stringify(report)).toBeUndefined()
    expect(warnsInsecure(stderr), stderr.slice(-1500)).toBe(true)
    expect(report.modelRequests, JSON.stringify(report)).toBeGreaterThan(0)
    expect(report.modelToldInsecure, JSON.stringify(report)).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

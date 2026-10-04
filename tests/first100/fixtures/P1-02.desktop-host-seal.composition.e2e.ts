/**
 * A-595 red first (P1-02 incremental review 2-1, for B-708): on the shipped
 * Desktop Host's REAL launch, an ordinary plugin must NOT be able to register a
 * trust anchor on the pinned Trust Kernel — P1-02 must[3]. Today it can: the
 * Desktop Host pins the kernel (apps/desktop-host/src/index.ts:323,
 * `pinTrustKernel`) but, unlike `runProfile`, never SEALS its anchors (it imports
 * `pinTrustKernel` and not `sealTrustAnchors`), so a mounted plugin's
 * `registerTrustAnchor` on the pinned handle succeeds. RED today; B-708 seals it.
 *
 * `./loader/a-595-desktop-seal/driver.ts` starts the Desktop Host through
 * `runDesktopHost` the way the Electron application does (the P0-02 desktop-host
 * harness), with the project's own patch mounting the reusable
 * `a-578-kernel-poke` fixture, which pokes `registerTrustAnchor` on
 * `ctx.get('trustKernel')` and records `{ hadKernel, registered, threw, reason }`.
 *
 * Launched in `lib` mode ONLY (plain Node over the built runtime): the poke and
 * `runDesktopHost` then resolve ONE shared `@deepseek-ai/dsh-plugin-provenance`
 * from `apps/desktop-host/node_modules`, so the pinned handle's seal is observed
 * on the SAME kernel instance. In `src` mode (tsx + the paths map) they split
 * into two copies and the seal never fires — the A-578 defect this avoids — so
 * this case forces `mode: 'lib'`. §21.4: the fix (B-708) is not read.
 * @module tests/first100/fixtures/P1-02.desktop-host-seal.composition
 */

import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

/** What `a-578-kernel-poke` recorded before failing the mount. */
interface KernelPoke {
  readonly hadKernel: boolean
  readonly registered: boolean
  readonly threw: boolean
  readonly reason: string
}

const REPORT_PREFIX = 'A-595-DESKTOP-SEAL'
const driver = fileURLToPath(new URL('./loader/a-595-desktop-seal/driver.ts', import.meta.url))
const desktopPatch = fileURLToPath(new URL('../../../apps/desktop-host/config/desktop.cordis.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let poked: KernelPoke | undefined
let setupError: string | undefined

beforeAll(async () => {
  try {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'A-595 desktop host seal',
      tempDirPrefix: 'a-595-desktop-',
      binScript: driver,
      libBinScript: driver,
      configPath: desktopPatch,
      binArgs: [],
      tsconfigPath: repoTsconfig,
      // lib ONLY: the poke and runDesktopHost must share one built
      // dsh-plugin-provenance instance for the seal to be observed on the pinned
      // kernel; src mode splits them (the A-578 defect).
      mode: 'lib',
    })
    const json = new RegExp(`${REPORT_PREFIX} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the a-595 driver reported nothing usable; stderr tail:\n${stderr.slice(-1200)}`)
    poked = (JSON.parse(json) as { poked?: KernelPoke }).poked
  } catch (error: unknown) {
    setupError = error instanceof Error ? error.message : String(error)
  }
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

describe('P1-02 2-1 (A-595, B-708 red first): the Desktop Host seals its pinned kernel against plugin trust-anchor registration', () => {
  it('a mounted plugin cannot register a trust anchor on the pinned kernel (today it can — RED)', () => {
    if (setupError !== undefined) throw new Error(setupError)
    if (poked === undefined) throw new Error('the a-595 driver recorded no kernel poke')
    const context = JSON.stringify(poked)
    // Guard: the Desktop Host pinned a kernel, so the poke ran against a real
    // pinned handle. A false here means the host did not pin (the premise is
    // gone), not that the subject passed.
    expect(poked.hadKernel, context).toBe(true)
    // must[3]: an ordinary plugin cannot modify the pinned kernel's anchors, so
    // `registerTrustAnchor` must be refused. RED today — the Desktop Host pins
    // but does not seal, so the registration succeeds.
    expect(poked.registered, context).toBe(false)
  })
})

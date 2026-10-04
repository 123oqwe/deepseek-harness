/**
 * Driver for A-595 (P1-02 incremental review 2-1, for B-708): the shipped
 * Desktop Host pins a Trust Kernel but, unlike `runProfile`, never seals its
 * anchors (apps/desktop-host/src/index.ts imports `pinTrustKernel` but not
 * `sealTrustAnchors`), so an ordinary plugin can register a trust anchor on the
 * pinned handle — which P1-02 must[3] forbids.
 *
 * It starts the Desktop Host the way the Electron application does, through
 * `runDesktopHost`, on a project built in this process's working directory, the
 * runtime directory and frontend stand-in assembled exactly as the P0-02
 * desktop-host driver does (tests/first100/fixtures/loader/p0-02-desktop-host/
 * driver.ts), except the project's own patch mounts the reusable
 * `a-578-kernel-poke` fixture: on mount it pokes `registerTrustAnchor` on the
 * pinned kernel, writes `{ hadKernel, registered, threw, reason }` to the
 * marker, and throws to end the launch. The boot therefore rejects; the marker
 * is already on disk, so this driver reads it whatever the boot did and prints
 * it for the spec.
 * @module tests/first100/fixtures/loader/a-595-desktop-seal/driver
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runDesktopHost } from '../../../../../apps/desktop-host/src/index.ts'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const kernelPoke = fileURLToPath(new URL('../../../../../apps/cli/tests/fixtures/a-578-kernel-poke.mjs', import.meta.url))

/** The line prefix the spec parses the JSON report from. */
export const REPORT_PREFIX = 'A-595-DESKTOP-SEAL'

const marker = join(process.cwd(), 'kernel-poke.json')

const projectDir = join(process.cwd(), 'desktop-project')
mkdirSync(projectDir, { recursive: true })
writeFileSync(join(projectDir, 'package.json'), `${JSON.stringify({
  name: 'a-595-desktop-project',
  private: true,
  version: '0.0.0',
  dependencies: {},
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}, undefined, 2)}\n`)
writeFileSync(
  join(projectDir, 'cordis.patch.yml'),
  `- insert:\n    - id: a-595-kernel-poke\n      name: '${pathToFileURL(kernelPoke).href}'\n      config:\n        marker: '${marker}'\n`,
)

const runtimeDir = join(process.cwd(), 'desktop-runtime')
const runtimeScope = join(runtimeDir, 'node_modules', '@deepseek-ai')
mkdirSync(runtimeScope, { recursive: true })
writeFileSync(join(runtimeDir, 'package.json'), `${JSON.stringify({ name: 'a-595-desktop-runtime', private: true, version: '0.0.0' }, undefined, 2)}\n`)
symlinkSync(realpathSync(join(repoRoot, 'apps', 'desktop-host', 'node_modules', '@deepseek-ai', 'dsh')), join(runtimeScope, 'dsh'), 'junction')
const frontendDir = join(runtimeScope, 'dsh-web-frontend')
mkdirSync(join(frontendDir, 'dist'), { recursive: true })
writeFileSync(join(frontendDir, 'package.json'), `${JSON.stringify({ name: '@deepseek-ai/dsh-web-frontend', private: true, version: '0.0.0' }, undefined, 2)}\n`)
writeFileSync(join(frontendDir, 'dist', 'index.html'), '<!doctype html>\n<title>a-595 desktop runtime</title>\n')

// The kernel-poke throws at mount, so the boot rejects; the marker it wrote
// before throwing is what this observes, so the rejection is expected and
// swallowed.
const controller = await runDesktopHost(runtimeDir, projectDir, () => Promise.resolve(), { allowLinkedPackages: true })
  .catch(() => undefined)
try {
  const poked = existsSync(marker)
    ? (JSON.parse(readFileSync(marker, 'utf8')) as { hadKernel: boolean; registered: boolean; threw: boolean; reason: string })
    : undefined
  process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify({ poked })}\n`)
} finally {
  await controller?.dispose()
}

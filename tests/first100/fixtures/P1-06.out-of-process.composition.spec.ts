/**
 * A-467 under P1-06 must[0] (「默认第三方插件在独立进程或 microVM 中运行」),
 * must[2] (「禁止传递宿主 Context、raw credentials、任意函数或可变对象引用。」) and
 * acceptance[0] (「插件尝试直接读取宿主 home、process.env、socket、其他插件内存均失败。」):
 * a third-party bundle's plugin, mounted at a real `dsh --profile` boot,
 * runs outside the launcher's process and reaches none of the host's
 * environment, harness home or services.
 *
 * As `apps/cli/tests/plugin-compat-boot.spec.ts` does, `runLoaderSmoke`
 * spawns the real `dsh` bin against an isolated `DSH_HOME` (`<cwd>/.dsh`)
 * holding a profile with two bundles in the profile's own `node_modules`,
 * where `dsh plugin add` installs them. The third-party bundle declares no
 * execution mode, so it gets the default. Its plugin prints one
 * `A467-PLUGIN <json>` line from `apply` — its process ids, whether it read
 * the host's environment sentinel and a file in the host's harness home by
 * absolute path, and which host services `ctx.get` returned — and returns
 * without ending the boot, because an out-of-process plugin cannot reach
 * `appExit`. A second, in-process bundle ends the boot: the profile lists it
 * in `dsh.profile.trustedBundles`, and its plugin calls `appExit` from
 * `appReady`, which the P1-06 host fires only once every bundle has mounted
 * and every out-of-process plugin's `apply` output has been forwarded, so the
 * probe's line is on `stdout` first. `runLoaderSmoke` spawns the bin with no
 * shell, so a plugin inside the launcher's process has this spec's process as
 * its parent.
 *
 * On a tree without the P1-06 host, `trustedBundles` is inert and both
 * bundles run in-process: the terminator still ends the boot, but the probe
 * reaches the host — its parent is the launcher, the environment and home
 * file read, and `ctx.get` returns host services — so these cases fail. That
 * is the red this slice's fix (B-635) turns green.
 * @module tests/first100/fixtures/P1-06.out-of-process.composition
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BIN_SCRIPT = join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')
const TSCONFIG = join(REPOSITORY_ROOT, 'tsconfig.json')

const PROFILE = 'a467'
const BUNDLE = 'a467-third-party-bundle'

/** The in-process bundle that ends the boot; the probe cannot, once it runs out of process. */
const TERMINATOR = 'a467-boot-terminator'

/** The value the host puts in its environment and in a file in its harness home. */
const SECRET = 'a467-host-secret-value'

/** Host services the probe asks its context for. */
const HOST_SERVICES = ['appExit', 'loader', 'agents', 'tools'] as const

/** What the probe plugin reports from inside `apply`. */
interface ProbeReport {
  readonly pid: number
  readonly ppid: number
  /** `read` when the host's environment sentinel was visible. */
  readonly env: string
  /** `read` when the file in the host's harness home held the secret. */
  readonly file: string
  /** The host services `ctx.get` returned. */
  readonly hostServices: readonly string[]
}

/**
 * The probe plugin's source.
 * @param secretPath - the absolute path of the file in the host's harness home.
 * @returns the module text.
 */
function probeSource(secretPath: string): string {
  return [
    "import { readFileSync } from 'node:fs'",
    `export const name = ${JSON.stringify(BUNDLE)}`,
    'export function apply(ctx) {',
    "  let file = 'unreadable'",
    `  try { file = readFileSync(${JSON.stringify(secretPath)}, 'utf8').trim() === ${JSON.stringify(SECRET)} ? 'read' : 'other' } catch { file = 'unreadable' }`,
    `  const env = process.env.A467_HOST_SECRET === ${JSON.stringify(SECRET)} ? 'read' : 'unreadable'`,
    `  const hostServices = ${JSON.stringify(HOST_SERVICES)}.filter((name) => {`,
    "    try { return typeof ctx?.get === 'function' && ctx.get(name) !== undefined } catch { return false }",
    '  })',
    "  process.stdout.write('A467-PLUGIN ' + JSON.stringify({ pid: process.pid, ppid: process.ppid, env, file, hostServices }) + '\\n')",
    '}',
    '',
  ].join('\n')
}

/**
 * The boot terminator's source. Listed in the profile's
 * `dsh.profile.trustedBundles`, it runs in process and ends the boot from
 * `appReady` — the probe cannot, once P1-06 runs it out of process with no
 * reachable `appExit`. `appReady` fires only after every bundle has mounted
 * and every out-of-process plugin's `apply` output has been forwarded, so the
 * probe's `A467-PLUGIN` line is on `stdout` before the exit.
 * @returns the module text.
 */
function terminatorSource(): string {
  return [
    `export const name = ${JSON.stringify(TERMINATOR)}`,
    'export function apply(ctx) {',
    "  ctx.get('appReady').onReady(() => { ctx.get('appExit')(0) })",
    '}',
    '',
  ].join('\n')
}

/**
 * Stage the profile, its third-party bundle, the in-process boot terminator and the file in the host's harness home.
 * @param cwd - the smoke's isolated working directory; `runLoaderSmoke` points `DSH_HOME` at `<cwd>/.dsh`.
 */
function stageProfile(cwd: string): void {
  const home = join(cwd, '.dsh')
  const profileDir = join(home, 'profiles', PROFILE)
  const pkgDir = join(profileDir, 'node_modules', BUNDLE)
  mkdirSync(pkgDir, { recursive: true })
  const secretPath = join(home, 'a467-host-secret')
  writeFileSync(secretPath, `${SECRET}\n`)
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-a467',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [BUNDLE, TERMINATOR], trustedBundles: [TERMINATOR], patchReload: 'startup' } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(pkgDir, 'package.json'), `${JSON.stringify({
    name: BUNDLE,
    version: '1.0.0',
    type: 'module',
    main: './index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })}\n`)
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), `- insert:\n    - id: ${BUNDLE}-row\n      name: ${BUNDLE}\n`)
  writeFileSync(join(pkgDir, 'index.mjs'), probeSource(secretPath))
  stageTerminator(profileDir)
}

/**
 * Stage the in-process boot terminator bundle in the profile's node_modules.
 * @param profileDir - the profile's directory under the isolated harness home.
 */
function stageTerminator(profileDir: string): void {
  const pkgDir = join(profileDir, 'node_modules', TERMINATOR)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), `${JSON.stringify({
    name: TERMINATOR,
    version: '1.0.0',
    type: 'module',
    main: './index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })}\n`)
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), `- insert:\n    - id: ${TERMINATOR}-row\n      name: ${TERMINATOR}\n`)
  writeFileSync(join(pkgDir, 'index.mjs'), terminatorSource())
}

let report: ProbeReport | undefined
let failure: string | undefined

beforeAll(async () => {
  try {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'A-467 third-party plugin host',
      tempDirPrefix: 'p1-06-out-of-process-',
      binScript: BIN_SCRIPT,
      configPath: '',
      binArgs: ['--profile', PROFILE],
      tsconfigPath: TSCONFIG,
      env: { DSH_TRUST_KERNEL_INSECURE: '1', A467_HOST_SECRET: SECRET },
      prepare: stageProfile,
    })
    const json = /A467-PLUGIN (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the probe plugin reported nothing; stderr tail:\n${stderr.slice(-800)}`)
    report = JSON.parse(json) as ProbeReport
  } catch (error: unknown) {
    failure = error instanceof Error ? error.message : String(error)
  }
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The probe's report, or the reason there is none.
 * @returns the report.
 */
function reported(): ProbeReport {
  if (report === undefined) throw new Error(failure ?? 'the probe plugin reported nothing')
  return report
}

describe('P1-06: a third-party bundle\'s plugin at a real dsh --profile boot runs outside the host and reaches nothing of it', () => {
  it('control: the bundle\'s plugin is mounted and reports from inside apply', () => {
    expect(typeof reported().pid, JSON.stringify(reported())).toBe('number')
  })

  it('must[0]: the plugin does not run in the dsh launcher\'s process', () => {
    expect({ parentIsThisSpec: reported().ppid === process.pid }, JSON.stringify({ ...reported(), specPid: process.pid }))
      .toEqual({ parentIsThisSpec: false })
  })

  it('acceptance[0]: the plugin cannot read the host\'s environment', () => {
    expect(reported().env, JSON.stringify(reported())).toBe('unreadable')
  })

  it('acceptance[0]: the plugin cannot read a file in the host\'s harness home', () => {
    expect(reported().file, JSON.stringify(reported())).toBe('unreadable')
  })

  it('must[2]: the plugin is handed no host context: none of the host\'s services is reachable through it', () => {
    expect(reported().hostServices, JSON.stringify(reported())).toEqual([])
  })
})

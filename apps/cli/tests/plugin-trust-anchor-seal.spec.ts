/**
 * P1-02 must[3] ("普通插件不能修改" / an ordinary plugin cannot modify the
 * trust anchors): a plugin that, on mount, takes the Trust Kernel handle the
 * host pinned and calls `registerTrustAnchor` on it must be refused — the
 * pinned handle a plugin can reach is not one a plugin may write to.
 *
 * Red first for B-690 (§21.4: the fix is not read). This observes the SHIPPED
 * launcher, not an in-process boot: A-578's in-process `runProfile` had the
 * fixture and the launcher resolve two different `@deepseek-ai/dsh-plugin-
 * provenance` module copies, so the seal that lives in that module never saw
 * the plugin's registration and the case stayed red on the fix too. Here the
 * built `dsh` bin runs as a subprocess under plain Node (`mode: 'lib'`), and the
 * fixture is a real `.mjs` plugin inserted with `--patch`, so the launcher and
 * the plugin share one `plugin-provenance` instance — the sealed pinned handle
 * is the same object a shipped third-party plugin would reach.
 *
 * The fixture (`./fixtures/a-578-kernel-poke.mjs`) pokes `ctx.get('trustKernel')`,
 * writes its outcome to a marker file, and throws to end the launch; the marker
 * is already on disk, so a non-zero exit does not lose it. `hadKernel` is the
 * harness guard: a boot that never reached the pinned kernel shows
 * `hadKernel: false` rather than passing the refusal assertion for free. The
 * unit control shows a kernel the host did NOT pin/seal still accepts
 * registration, so the refusal is specific to the sealed pinned handle and not
 * to `registerTrustAnchor` itself.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { registerTrustAnchor } from '@deepseek-ai/dsh-plugin-provenance'
import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BIN_SCRIPT = join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')
const TSCONFIG = join(REPOSITORY_ROOT, 'tsconfig.json')
const POKE_FIXTURE = fileURLToPath(new URL('./fixtures/a-578-kernel-poke.mjs', import.meta.url))

/** The subprocess launch deadline. */
const PROCESS_TIMEOUT_MS = 30_000

/** What the mounted plugin recorded about its attempt to register an anchor. */
interface PokeResult {
  readonly hadKernel: boolean
  readonly registered: boolean
  readonly threw: boolean
  readonly reason: string
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Launch the built `dsh` bin once with the kernel-poke fixture inserted by
 * `--patch`, and return what the fixture recorded.
 * @param profile - the shipped profile to launch (one that pins a Trust Kernel).
 * @returns the plugin's recorded outcome plus the launch's exit code and stderr.
 */
async function launchWithPoke(profile: string): Promise<PokeResult & { exitCode: number | undefined; stderr: string }> {
  const cwd = mkdtempSync(join(tmpdir(), 'p1-02-seal-'))
  roots.push(cwd)
  const marker = join(cwd, 'poke-result.json')
  const overlay = join(cwd, 'kernel-poke.patch.yml')
  writeFileSync(overlay, [
    '- insert:',
    '    - id: a-578-kernel-poke',
    `      name: '${POKE_FIXTURE}'`,
    '      config:',
    `        marker: '${marker}'`,
    '',
  ].join('\n'))
  // `mode: 'lib'` is the point of this spec: the built bin under plain Node and
  // the `.mjs` fixture share one plugin-provenance module, which an in-process
  // or tsx launch does not guarantee.
  const command = resolveExampleLaunch({
    srcBin: BIN_SCRIPT,
    configArgs: ['--profile', profile, '--patch', overlay],
    tsconfigPath: TSCONFIG,
    mode: 'lib',
    env: {
      DSH_HOME: join(cwd, '.dsh'),
      DSH_AGENTS_HOME: join(cwd, '.agents'),
      DSH_TELEMETRY_DISABLED: '1',
      // Empty, not '1': the shipped profile must pin a real Trust Kernel (the handle under test).
      DSH_TRUST_KERNEL_INSECURE: '',
    },
  })
  const result = await execa(command.command, command.args, {
    cwd,
    env: command.env,
    timeout: PROCESS_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    reject: false,
    stripFinalNewline: false,
  })
  const base = { exitCode: result.exitCode, stderr: result.stderr }
  if (!existsSync(marker)) {
    return { hadKernel: false, registered: false, threw: false, reason: 'the fixture never mounted', ...base }
  }
  return { ...JSON.parse(readFileSync(marker, 'utf8')) as PokeResult, ...base }
}

describe('P1-02 must[3]: a mounted plugin cannot register a trust anchor on the pinned kernel, on the shipped launcher (red first for B-690)', () => {
  it('a plugin that reaches the pinned kernel through ctx and calls registerTrustAnchor is refused, not quietly allowed to modify the anchor set', async () => {
    const result = await launchWithPoke('sdk-minimal')
    const detail = JSON.stringify(result)

    // Harness guard: the plugin actually reached the pinned kernel. A broken
    // launch shows here rather than passing the refusal assertion for free.
    expect(result.hadKernel, detail).toBe(true)
    // must[3]: the registration must be refused. Today the pinned handle is not
    // sealed, so the plugin registers an anchor and succeeds — these fail.
    expect(result.registered, detail).toBe(false)
    expect(result.threw, detail).toBe(true)
  }, PROCESS_TIMEOUT_MS + 15_000)

  it('control: a kernel the host did not pin and seal still accepts registration, so the refusal is specific to the sealed pinned handle', () => {
    const kernel = createTrustKernel()
    const anchorId = registerTrustAnchor(kernel.signatureRoots, {
      mode: 'sigstore',
      trustedIssuer: 'https://token.actions.githubusercontent.com',
    })
    expect(typeof anchorId).toBe('string')
    expect((anchorId as string).length).toBeGreaterThan(0)
  })
})

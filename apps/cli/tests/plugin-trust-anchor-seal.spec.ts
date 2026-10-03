/**
 * P1-02 must[3] ("普通插件不能修改" / an ordinary plugin cannot modify the
 * trust anchors): a plugin that, on mount, takes the Trust Kernel handle the
 * host pinned and calls `registerTrustAnchor` on it must be refused — the
 * pinned handle a plugin can reach is not one a plugin may write to.
 *
 * Red first for B-690 (§21.4: the fix is not read). Today the host pins the
 * kernel but does not seal its anchor registry, so a mounted plugin registers
 * an anchor on the real pinned handle and succeeds — the frozen unit case
 * `plugin-provenance/tests/provenance.spec.ts:234-240` only ever demonstrated
 * this success, never the refusal its title claims. These cases observe the
 * SHIPPED factory boot: `./fixtures/a-578-kernel-poke.ts` is inserted as a
 * `--patch` config-tree entry that pokes `ctx.get('trustKernel')` and records
 * the outcome, exactly as a third-party plugin would.
 *
 * The `hadKernel` assertion is the harness guard: a boot that never reached the
 * pinned kernel (a broken launch) shows `hadKernel: false` rather than passing
 * the refusal assertion for the wrong reason. The unit control shows a kernel
 * the host did NOT pin/seal still accepts registration, so the refusal is
 * specific to the sealed pinned handle and not to `registerTrustAnchor` itself.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { registerTrustAnchor } from '@deepseek-ai/dsh-plugin-provenance'
import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { runProfile } from '../src/profile-boot.ts'

/** Case deadline for one in-process factory launch (cold module-graph transform on the first case). */
const LAUNCH_TIMEOUT_MS = 60_000

const SENTINEL = fileURLToPath(new URL('./fixtures/a-578-kernel-poke.ts', import.meta.url))
const RESTORED_ENV = ['DSH_HOME', 'DSH_TRUST_KERNEL_INSECURE'] as const
const OBSERVED_EVENTS = ['SIGTERM', 'SIGINT', 'unhandledRejection'] as const

/** What the mounted plugin recorded about its attempt to register an anchor. */
interface PokeResult {
  readonly hadKernel: boolean
  readonly registered: boolean
  readonly threw: boolean
  readonly reason: string
}

const emitter: NodeJS.EventEmitter = process
const roots: string[] = []
let savedEnv = new Map<string, string | undefined>()
let savedListeners = new Map<string, readonly unknown[]>()

beforeEach(() => {
  savedEnv = new Map(RESTORED_ENV.map((name): [string, string | undefined] => [name, process.env[name]]))
  savedListeners = new Map(OBSERVED_EVENTS.map((event): [string, readonly unknown[]] => [event, emitter.listeners(event)]))
})

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
  for (const [event, before] of savedListeners) {
    for (const listener of emitter.listeners(event)) {
      if (!before.includes(listener)) emitter.off(event, listener as (...args: unknown[]) => void)
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Boot a factory profile in-process with the kernel-poke sentinel inserted, and
 * return what it recorded.
 * @param profile - the factory profile to boot.
 * @returns the plugin's recorded outcome, or a `hadKernel: false` default when the marker was never written.
 */
async function launchWithPoke(profile: string): Promise<PokeResult> {
  const root = mkdtempSync(join(tmpdir(), 'p1-02-seal-'))
  roots.push(root)
  const cwd = join(root, 'cwd')
  mkdirSync(cwd)
  const marker = join(root, 'poke-result.json')
  const overlay = join(root, 'kernel-poke.patch.yml')
  writeFileSync(overlay, [
    '- insert:',
    '    - id: a-578-kernel-poke',
    `      name: '${SENTINEL}'`,
    '      config:',
    `        marker: '${marker}'`,
    '',
  ].join('\n'))
  process.env.DSH_HOME = join(root, 'home')
  // Unset so the factory boot pins a real Trust Kernel (the handle under test).
  delete process.env.DSH_TRUST_KERNEL_INSECURE
  await runProfile({
    environment: loadLayeredEnv('dsh', cwd),
    profile,
    fromDefaultProfile: undefined,
    patchFiles: [overlay],
    args: [],
  }).then(
    async ({ ctx }) => { await ctx.fiber.dispose() },
    () => undefined, // a later boot failure does not erase the marker the sentinel already wrote at mount
  )
  if (!existsSync(marker)) return { hadKernel: false, registered: false, threw: false, reason: 'the sentinel never mounted' }
  return JSON.parse(readFileSync(marker, 'utf8')) as PokeResult
}

describe('P1-02 must[3]: a mounted plugin cannot register a trust anchor on the pinned kernel (red first for B-690)', () => {
  it('a plugin that reaches the pinned kernel through ctx and calls registerTrustAnchor is refused, not quietly allowed to modify the anchor set', async () => {
    const result = await launchWithPoke('sdk-minimal')

    // Harness guard: the plugin actually reached the pinned kernel. A broken
    // launch shows here rather than passing the refusal assertion for free.
    expect(result.hadKernel, JSON.stringify(result)).toBe(true)
    // must[3]: the registration must be refused. Today the pinned handle is not
    // sealed, so the plugin registers an anchor and succeeds — these fail.
    expect(result.registered, JSON.stringify(result)).toBe(false)
    expect(result.threw, JSON.stringify(result)).toBe(true)
  }, LAUNCH_TIMEOUT_MS)

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

/**
 * P3-01 acceptance[2] (「WorldHandle 不能被模型或第三方插件伪造。」) and
 * acceptance[1] (「无 provider 满足 policy 时 fail closed，禁止静默降级。」) on
 * the shipped headless composition, the complete red-first for BLOCKED-316
 * closing conditions 2 (both the forbid-`absent` rule and the no-rule
 * degradation) and 3 (refusal at registration and at binding).
 *
 * `./loader/p3-01-world-identity/driver.ts` boots the SHIPPED headless profile
 * over the world-swap cases' base overlay, with a keyless scripted model that
 * calls the shipped `read` tool once, in modes that share one working
 * directory this file creates:
 * - `shipped`: the local provider binds the call's world;
 * - `honest` and `forging`: a test provider registered through the public
 *   `executionWorlds.register` replaces the shipped two, and reports its own
 *   identity or claims to be `local` with a digest it did not compute;
 * - `network-none`: the deployment asks for a world with no network, which no
 *   shipped provider can hold;
 * - `forbid-absent`: the same no-provider request plus a policy forbidding an
 *   `absent` world (condition 2a);
 * - `register-local`: the driver registers a provider under the reserved id
 *   `local` and reports whether `register` threw (condition 3, registration).
 * @module tests/first100/fixtures/P3-01.world-identity.composition
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { READ_FILE, READ_LINE } from './loader/p3-01-world-swap/shared.ts'
import { FORGED_SPEC_DIGEST, HONEST_PROVIDER_ID } from './loader/p3-01-world-identity/shared.ts'

const driver = fileURLToPath(new URL('./loader/p3-01-world-identity/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p3-01-world-swap/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The driver's boot modes. */
const MODES = ['shipped', 'honest', 'forging', 'network-none', 'forbid-absent', 'register-local'] as const

/** One boot mode. */
type Mode = typeof MODES[number]

/** What the driver reported. */
interface Report {
  readonly mode: Mode
  readonly worldBound: readonly { readonly provider: string; readonly spec: string }[]
  readonly worldEventTypes: readonly string[]
  readonly toolResults: readonly string[]
  readonly registerLocal?: { readonly threw: boolean; readonly error: string }
}

/**
 * Run the driver once.
 * @param mode - the boot mode.
 * @param workspace - the working directory every mode shares.
 * @returns the driver's report.
 */
async function run(mode: Mode, workspace: string): Promise<Report> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `P3-01 world identity: ${mode}`,
    tempDirPrefix: `p3-01-world-identity-${mode}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay, mode, workspace],
    tsconfigPath: repoTsconfig,
  })
  const json = /P3-01-IDENTITY (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the ${mode} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  return JSON.parse(json) as Report
}

/**
 * Whether the call's tool body ran and read the file.
 * @param report - one mode's report.
 * @returns true when a tool result carries the file's line.
 */
function readTheFile(report: Report): boolean {
  return report.toolResults.some(result => result.includes(READ_LINE))
}

describe('P3-01 acceptance[1] and [2]: the world a call is bound to on the shipped headless profile', () => {
  let workspace: string | undefined
  const reports = new Map<Mode, Report>()
  beforeAll(async () => {
    const shared = await mkdtemp(join(tmpdir(), 'p3-01-world-identity-workspace-'))
    workspace = shared
    await writeFile(join(shared, READ_FILE), `${READ_LINE}\n`)
    for (const mode of MODES) reports.set(mode, await run(mode, shared))
  }, MODES.length * LOADER_SMOKE_TEST_TIMEOUT_MS)
  afterAll(async () => {
    if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
  })

  it('control: a plugin provider that reports its own identity binds the call\'s world under its id and the digest it computed', () => {
    const report = reports.get('honest')
    expect(report?.worldBound, JSON.stringify(report)).toHaveLength(1)
    expect(report?.worldBound[0]?.provider, JSON.stringify(report)).toBe(HONEST_PROVIDER_ID)
    expect(report?.worldBound[0]?.spec, JSON.stringify(report)).toMatch(/^[0-9a-f]{64}$/u)
    expect(report?.worldBound[0]?.spec, JSON.stringify(report)).not.toBe(FORGED_SPEC_DIGEST)
    expect(report !== undefined && readTheFile(report), JSON.stringify(report)).toBe(true)
  })

  it('P3-01 acceptance[2] / BLOCKED-316 condition 3: a plugin provider whose handle claims local with a digest it did not compute is refused at binding — the tool does not run, the result names the mismatch, and nothing binds under the claim', () => {
    const report = reports.get('forging')
    expect(report, 'the forging driver reported').toBeDefined()
    // Nothing binds under the forged claim (kept from A-432's original case).
    expect(report?.worldBound.filter(bound => bound.provider === 'local'), JSON.stringify(report)).toEqual([])
    expect(report?.worldBound.filter(bound => bound.spec === FORGED_SPEC_DIGEST), JSON.stringify(report)).toEqual([])
    // Condition 3 requires refusal, not merely a missing binding: the bind is
    // refused, so the tool does not run, and the tool result states whether it
    // was an identity or a digest mismatch.
    expect(report !== undefined && readTheFile(report), JSON.stringify(report)).toBe(false)
    const results = report?.toolResults.join(' ') ?? ''
    expect(/identit|provider|digest/iu.test(results), `the refusal must name an identity or digest mismatch: ${results}`).toBe(true)
  })

  it('P3-01 BLOCKED-316 condition 3: registering a world provider under the reserved id local is refused, with an error naming the identity', () => {
    const report = reports.get('register-local')
    expect(report?.registerLocal, JSON.stringify(report)).toBeDefined()
    expect(report?.registerLocal?.threw, JSON.stringify(report)).toBe(true)
    expect((report?.registerLocal?.error ?? '').includes('local'), JSON.stringify(report)).toBe(true)
  })

  it('control: under the shipped request the local provider binds the call\'s world and the tool runs', () => {
    const report = reports.get('shipped')
    expect(report?.worldBound.map(bound => bound.provider), JSON.stringify(report)).toEqual(['local'])
    expect(report !== undefined && readTheFile(report), JSON.stringify(report)).toBe(true)
  })

  it('P3-01 acceptance[1]: a requested world no provider can hold refuses the call or records that it ran without that world', () => {
    const report = reports.get('network-none')
    expect(report, 'the network-none driver reported').toBeDefined()
    const refused = report !== undefined && !readTheFile(report)
    const declaredDegradation = report?.worldEventTypes.some(type => type !== 'action/world-bound') ?? false
    expect(refused || declaredDegradation, JSON.stringify(report)).toBe(true)
  })

  it('P3-01 acceptance[1] / BLOCKED-316 condition 2a: with a deployment rule forbidding an absent world, a call whose world no provider can hold is refused and the tool does not run', () => {
    const report = reports.get('forbid-absent')
    expect(report, 'the forbid-absent driver reported').toBeDefined()
    expect(report !== undefined && readTheFile(report), JSON.stringify(report)).toBe(false)
  })
})

/**
 * Epic P4-11's mount slice: the retry budget and the circuit breaker on the
 * profile a user actually starts.
 *
 * The C, P and U stages proved the decisions, the provider and the consumers.
 * A 4.4d pass then measured what no test had: NO shipped bundle mounted
 * `@deepseek-ai/dsh-retry` or `@deepseek-ai/dsh-retry-cockatiel`, so both
 * consumers resolved `undefined` on every `dsh` a user starts and fell back to
 * their pre-epic behaviour. must[1], acceptance[1] and acceptance[2] were true
 * of the packages and false of the product.
 *
 * This fixture boots the SHIPPED headless profile — the rows
 * `packages/bundle/base/cordis.patch.yml` carries, with a test overlay
 * supplying only a keyless flaky model — and reads back what is mounted and
 * what a real retry cost the run.
 */
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('../../../packages/reliability/retry-cockatiel/tests/fixtures/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../packages/reliability/retry-cockatiel/tests/fixtures/retry-mount.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Boot the shipped profile once and return what the driver reported. */
async function boot(): Promise<{ mounted: { runRetryUsage: boolean, circuitBreaker: boolean }, charged: { run: string, usage?: { retriesUsed: number, delayMsUsed: number } }[] }> {
  const { stdout } = await runLoaderSmoke({
    label: 'p4-11-retry-mount',
    tempDirPrefix: 'p4-11-mount-',
    binScript: driver,
    configPath,
    tsconfigPath: repoTsconfig,
  })
  const mounted = /P4-11-MOUNTED (?<json>.+)/u.exec(stdout)?.groups?.json
  const charged = /P4-11-CHARGED (?<json>.+)/u.exec(stdout)?.groups?.json
  if (mounted === undefined || charged === undefined) throw new Error(`driver reported nothing usable:\n${stdout}`)
  // Surfaced on failure: what the boot actually charged is the whole question,
  // and a bare `expected false to be true` would hide it.
  if (process.env['P4_11_SHOW'] !== undefined) process.stdout.write(`charged=${charged}\n${stdout}\n`)
  return { mounted: JSON.parse(mounted) as never, charged: JSON.parse(charged) as never }
}

describe('P4-11 mount: the factory profile has a retry budget and a breaker', () => {
  it('mounts both services in the shipped headless profile, with no row this fixture added', async () => {
    const { mounted } = await boot()

    expect(mounted).toEqual({ runRetryUsage: true, circuitBreaker: true })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('charges a real retry to the run, so must[1] happens rather than merely being available', async () => {
    // The endpoint fails once and succeeds on the second attempt. The retry is
    // the layer's own, taken through `llm-retry`'s real path; what this asserts
    // is that it was ACCOUNTED — a retry charged to nothing is the state the
    // 4.4d pass found.
    const { charged } = await boot()

    expect(charged.length).toBeGreaterThan(0)
    expect(charged.some(entry => (entry.usage?.retriesUsed ?? 0) > 0)).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

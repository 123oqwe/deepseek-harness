/**
 * P4-01 U-stage composition contract: `@deepseek-ai/dsh-run` mounted through
 * a real Loader composition and booted by `@deepseek-ai/dsh-app-boot`
 * (`tests/first100/fixtures/loader/p4-01-run/`), alongside the real agent
 * registry and agent loop.
 *
 * Contract and Provider stages proved the Run state machine and the durable
 * registry against Runs a test constructed by hand. Nothing produced a Run
 * from real harness work: no plugin registered the service on a `Context` and
 * no product surface called one. This fixture closes exactly that gap — a
 * real `dsh-app-boot` boot of a real Cordis composition, whose configured
 * root agent's session start is the only thing that opens the Run this spec
 * then reads back out of the durable store.
 *
 * Every assertion is on the durable store's contents, never on a filesystem
 * behavior, so the property each case checks is evaluated identically on
 * every platform.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { RUN_SERVICE_OWNER_ID, type Run } from '@deepseek-ai/dsh-run'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = fileURLToPath(new URL('./loader/p4-01-run/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./loader/p4-01-run/cordis.yml', import.meta.url))
const resumedBinScript = fileURLToPath(new URL('./loader/p4-01-run-resumed/driver.ts', import.meta.url))
const resumedConfigPath = fileURLToPath(new URL('./loader/p4-01-run-resumed/cordis.yml', import.meta.url))
const tsconfigPath = join(repoRoot, 'tsconfig.json')

const storeRoots: string[] = []

afterEach(() => {
  for (const root of storeRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * An isolated directory holding one Run store document, owned through
 * teardown by this file's `afterEach` so concurrently forked workers never
 * share a path.
 */
function makeStorePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-p4-01-run-store-'))
  storeRoots.push(root)
  return join(root, 'runs.json')
}

/** Read every Run a completed boot left in the durable store at `storePath`. */
function readRuns(storePath: string): readonly Run[] {
  const document = JSON.parse(readFileSync(storePath, 'utf8')) as { runs: readonly Run[] }
  return document.runs
}

/** Boot the fixture composition once, writing its Runs to `storePath`. */
async function boot(storePath: string, label: string): Promise<void> {
  await runLoaderSmoke({
    label,
    tempDirPrefix: 'p4-01-run-',
    binScript,
    libBinScript: binScript,
    configPath,
    tsconfigPath,
    env: { P4_01_RUN_STORE: storePath },
  })
}

/**
 * Boot the STABLE-SESSION composition once (`./loader/p4-01-run-resumed/`).
 *
 * The only difference from {@link boot} is that its configured agent declares a
 * `sessionId`, so two boots are a restart of one durable session rather than two
 * sessions. That is the arrangement adoption needs: without the id the loop
 * mints a session per boot, and each one correctly gets its own Run.
 * @param storePath - the Run store document both boots share.
 * @param label - the smoke run's label, for its own diagnostics.
 * @returns the driver's stdout, which carries what the plugin enumerated at mount.
 */
async function bootResumed(storePath: string, label: string): Promise<string> {
  const result = await runLoaderSmoke({
    label,
    tempDirPrefix: 'p4-01-run-resumed-',
    binScript: resumedBinScript,
    libBinScript: resumedBinScript,
    configPath: resumedConfigPath,
    tsconfigPath,
    env: { P4_01_RUN_STORE: storePath },
  })
  return result.stdout
}

describe('P4-01 Run Service composition (U-stage)', () => {
  it('opens a durable Run for the agent session a real harness boot starts', async () => {
    const storePath = makeStorePath()
    await boot(storePath, 'p4-01-run first boot')
    const runs = readRuns(storePath)
    expect(runs).toHaveLength(1)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('owns that Run with RUN_SERVICE_OWNER_ID, never the agent session that started it', async () => {
    const storePath = makeStorePath()
    await boot(storePath, 'p4-01-run ownership boot')
    const [run] = readRuns(storePath)
    expect(run?.ownerId).toBe(RUN_SERVICE_OWNER_ID)
    expect(run?.sessionIds).not.toContain(RUN_SERVICE_OWNER_ID)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('associates the Run with the exact session the harness started, as its initiating Session', async () => {
    const storePath = makeStorePath()
    await boot(storePath, 'p4-01-run session boot')
    const [run] = readRuns(storePath)
    expect(run?.sessionIds).toHaveLength(1)
    expect(run?.sessionIds[0]).toMatch(/^p4-01-root-session-/)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it("mints the Run's genesis log entry with no prior state, at seq 0", async () => {
    const storePath = makeStorePath()
    await boot(storePath, 'p4-01-run genesis boot')
    const [run] = readRuns(storePath)
    expect(run?.events).toHaveLength(1)
    expect(run?.events[0]?.seq).toBe(0)
    expect(run?.events[0]?.fromState).toBeNull()
    expect(run?.events[0]?.toState).toBe('accepted')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it("references the initiating Session in the Run's append-only log, not just in sessionIds", async () => {
    const storePath = makeStorePath()
    await boot(storePath, 'p4-01-run reference boot')
    const [run] = readRuns(storePath)
    const sessionReferences = run?.events.flatMap(event =>
      event.references.filter(reference => reference.kind === 'session')) ?? []
    expect(sessionReferences).toHaveLength(1)
    expect(sessionReferences[0]?.id).toBe(run?.sessionIds[0])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('opens a second, independent Run on the next boot over the same store, keeping the first', async () => {
    const storePath = makeStorePath()
    await boot(storePath, 'p4-01-run restart boot 1')
    const first = readRuns(storePath)
    await boot(storePath, 'p4-01-run restart boot 2')
    const both = readRuns(storePath)
    expect(both).toHaveLength(2)
    expect(both[0]).toStrictEqual(first[0])
    expect(both[1]?.id).not.toBe(both[0]?.id)
    expect(both[1]?.sessionIds[0]).not.toBe(both[0]?.sessionIds[0])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('lists the Run a previous boot left behind as non-terminal, so a restart can resume it', async () => {
    const storePath = makeStorePath()
    await boot(storePath, 'p4-01-run resume boot 1')
    await boot(storePath, 'p4-01-run resume boot 2')
    const runs = readRuns(storePath)
    for (const run of runs) expect(run.state).toBe('accepted')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('CONTINUES one durable session\'s Run across a restart, rather than opening a second (U2)', async () => {
    // The withdrawal's own ground: production arrival, observed through a real
    // `dsh-app-boot` boot of a real composition rather than a hand-built
    // `ctx.plugin`. Before the U2 slice this store held TWO Runs for one session
    // after two boots, the first non-terminal forever.
    const storePath = makeStorePath()
    await bootResumed(storePath, 'p4-01-run-resumed boot 1')
    const first = readRuns(storePath)
    expect(first).toHaveLength(1)

    await bootResumed(storePath, 'p4-01-run-resumed boot 2')
    const after = readRuns(storePath)

    expect(after).toHaveLength(1)
    expect(after[0]?.id).toBe(first[0]?.id)
    expect(after[0]?.sessionIds).toStrictEqual(first[0]?.sessionIds)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('enumerates what it restored at mount, which the durable document cannot show (U2)', async () => {
    // acceptance[0]'s enumerate half has no trace in the store: the document
    // records which Runs are non-terminal, not that this process asked. The
    // driver prints the plugin's own answer, so the claim is observed rather
    // than inferred from the state it acted on.
    const storePath = makeStorePath()
    const cold = await bootResumed(storePath, 'p4-01-run-resumed cold boot')
    expect(cold).toContain('restored 0 non-terminal Run(s)')

    const warm = await bootResumed(storePath, 'p4-01-run-resumed warm boot')
    expect(warm).toContain('restored 1 non-terminal Run(s)')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

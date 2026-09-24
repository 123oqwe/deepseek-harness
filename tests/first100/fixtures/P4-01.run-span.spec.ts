/**
 * P4-01 acceptance[2] on the shipped composition (K1, K2): one Run spans a root
 * session and the in-process child its subagent service starts, and keeps
 * doing so across a restart.
 *
 * The driver boots the SHIPPED headless profile through `PROFILE_TEMPLATES`,
 * whose bundles carry `@deepseek-ai/dsh-base`, with an overlay supplying only a
 * keyless model, a readable session log and a stable root session id. The Run
 * Service, the lease store, the subagent service and its `spawn` provider are
 * the rows the base layer ships. Every assertion reads the driver's report of
 * the Run store the product wrote, after a clean unload.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tsconfigPath = join(repoRoot, 'tsconfig.json')
const driver = fileURLToPath(new URL('../../../packages/run/run/tests/fixtures/p4-01-span/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('../../../packages/run/run/tests/fixtures/p4-01-span/base-mount.patch.yml', import.meta.url))

/** What one boot of the driver reported. */
interface Report {
  readonly mounted: { readonly runs: boolean; readonly subagents: boolean }
  readonly owned: readonly string[]
  readonly restored: readonly { readonly id: string; readonly sessionIds: readonly string[] }[]
  readonly parent: { readonly id: string; readonly runId: string | null }
  readonly runs: readonly { readonly id: string; readonly sessionIds: readonly string[] }[]
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Boot the shipped profile once and parse the driver's report.
 * @param label - the smoke run's label.
 * @param env - the driver's mode, and a `DSH_HOME` two boots share.
 * @returns the report.
 */
async function boot(label: string, env: Record<string, string>): Promise<Report> {
  const { stdout } = await runLoaderSmoke({ label, tempDirPrefix: 'p4-01-span-', binScript: driver, configPath: overlay, tsconfigPath, env })
  const line = (tag: string): unknown => {
    const json = new RegExp(`^P4-01-${tag} (?<json>.+)$`, 'mu').exec(stdout)?.groups?.json
    return json === undefined ? undefined : JSON.parse(json) as unknown
  }
  const report = { mounted: line('MOUNTED'), owned: line('OWNED') ?? [], restored: line('RESTORED') ?? [], parent: line('PARENT'), runs: line('RUNS') }
  if (report.mounted === undefined || report.parent === undefined || report.runs === undefined) throw new Error(`the driver reported nothing usable:\n${stdout}`)
  return report as Report
}

describe('P4-01 acceptance[2] on the shipped base profile: a subagent child and its parent share one Run', () => {
  it('records a subagent child in its parent\'s Run on the shipped base profile', async () => {
    const report = await boot('p4-01-span first boot', { P4_01_SPAN_MODE: 'first' })

    // The services are the base layer's rows; the overlay mounts none of them.
    expect(report.mounted).toEqual({ runs: true, subagents: true })
    expect(readFileSync(overlay, 'utf8')).not.toMatch(/^\s*- id: (?:run|lease-store|subagent|subagent-spawn-in-process)$/mu)
    expect(report.owned).toHaveLength(1)
    const [child] = report.owned
    const spanning = report.runs.filter(run => run.sessionIds.includes(report.parent.id) && run.sessionIds.includes(child!))
    expect(spanning).toStrictEqual([{ id: report.parent.runId, sessionIds: [report.parent.id, child] }])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('keeps that Run spanning both sessions across a restart of the shipped profile', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-p4-01-span-home-'))
    roots.push(home)
    const first = await boot('p4-01-span restart boot 1', { P4_01_SPAN_MODE: 'first', DSH_HOME: home })
    const second = await boot('p4-01-span restart boot 2', { P4_01_SPAN_MODE: 'second', DSH_HOME: home })

    const [child] = first.owned
    expect(child).toBeDefined()
    // Restored at mount, before the root continued it, and then continued by the root.
    expect(second.restored.find(run => run.id === first.parent.runId)?.sessionIds).toStrictEqual([first.parent.id, child])
    expect(second.parent.runId).toBe(first.parent.runId)
  }, 2 * LOADER_SMOKE_TEST_TIMEOUT_MS)
})

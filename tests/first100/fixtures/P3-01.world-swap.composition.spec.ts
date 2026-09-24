/**
 * P3-01 acceptance[0] as C18 narrows it ("one ToolExecution switches between
 * the registered providers, local and fenced today, without changing the
 * semantics of the ActionManifest or of Policy") on the shipped headless
 * composition.
 *
 * `./loader/p3-01-world-swap/driver.ts` boots the SHIPPED headless profile
 * twice with a keyless scripted model that calls the shipped `read` tool once:
 * as shipped, where the local provider builds the call's world, and with
 * `./loader/p3-01-world-swap/fenced-only.patch.yml` removing the local
 * provider's row, where the fenced one does. The cases compare what the two
 * processes recorded for the same call.
 * @module tests/first100/fixtures/P3-01.world-swap.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { CALL_ID, READ_LINE } from './loader/p3-01-world-swap/shared.ts'

const driver = fileURLToPath(new URL('./loader/p3-01-world-swap/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p3-01-world-swap/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Manifest fields each session derives for itself: two processes are two sessions. */
const SESSION_SCOPED = new Set(['runId', 'actor', 'idempotencyKey'])

/** What the driver reported. */
interface Report {
  readonly mode: 'shipped' | 'fenced'
  readonly worldBound: readonly { readonly provider: string; readonly spec: string }[]
  readonly manifests: readonly Record<string, unknown>[]
  readonly policyRecords: readonly Record<string, unknown>[]
  readonly riskGated: readonly Record<string, unknown>[]
  readonly toolResults: readonly string[]
}

/**
 * Run the driver once.
 * @param mode - `shipped` keeps every world provider row; `fenced` removes the local one.
 * @returns the driver's report.
 */
async function run(mode: 'shipped' | 'fenced'): Promise<Report> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `P3-01 acceptance[0] world swap: ${mode}`,
    tempDirPrefix: `p3-01-world-swap-${mode}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay, mode],
    tsconfigPath: repoTsconfig,
  })
  const json = /P3-01-SWAP (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the ${mode} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  return JSON.parse(json) as Report
}

/**
 * A manifest without the fields its session derives.
 * @param manifest - one appended manifest's data.
 * @returns the fields a provider swap must leave unchanged.
 */
function withoutSessionFields(manifest: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(manifest).filter(([key]) => !SESSION_SCOPED.has(key)))
}

describe('P3-01 acceptance[0]: one tool call through the local and the fenced world provider on the shipped headless profile', () => {
  let shipped: Report
  let fenced: Report
  beforeAll(async () => {
    [shipped, fenced] = await Promise.all([run('shipped'), run('fenced')])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('the shipped composition binds the call\'s world from the local provider and, with the local row removed, from the fenced provider, under the same confinement digest', () => {
    expect(shipped.worldBound.map(bound => bound.provider)).toEqual(['local'])
    expect(fenced.worldBound.map(bound => bound.provider)).toEqual(['fenced'])
    expect(typeof shipped.worldBound[0]?.spec).toBe('string')
    expect(fenced.worldBound[0]?.spec).toBe(shipped.worldBound[0]?.spec)
  })

  it('the ActionManifest the call appends is the same under either provider, apart from the session-scoped runId, actor and idempotencyKey', () => {
    expect(shipped.manifests).toHaveLength(1)
    expect(fenced.manifests).toHaveLength(1)
    expect(shipped.manifests[0]?.actionId).toBe(CALL_ID)
    expect(fenced.manifests.map(withoutSessionFields)).toEqual(shipped.manifests.map(withoutSessionFields))
  })

  it('the policy decision the Trust Kernel audits for the call, the risk gate\'s record and the tool\'s result are the same under either provider', () => {
    expect(shipped.policyRecords).toHaveLength(1)
    expect((shipped.policyRecords[0]?.decision as { readonly effect?: unknown } | undefined)?.effect).toBe('permit')
    expect(fenced.policyRecords).toEqual(shipped.policyRecords)
    expect(shipped.riskGated).toEqual([{ actionId: 'read', riskClass: 'read', preset: 'workspace-write', decision: 'allowed-by-preset' }])
    expect(fenced.riskGated).toEqual(shipped.riskGated)
    expect(shipped.toolResults.join('\n')).toContain(READ_LINE)
    expect(fenced.toolResults).toEqual(shipped.toolResults)
  })
})

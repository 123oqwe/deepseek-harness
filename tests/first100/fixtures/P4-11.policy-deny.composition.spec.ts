/**
 * P4-11 acceptance[0], its policy-deny kind, on the shipped mount (A-423): a
 * tool call the deployment's policy refuses is not dispatched again and
 * charges the Run's retry budget nothing.
 *
 * `beforeAll` boots the SHIPPED headless profile twice through
 * `runLoaderSmoke`, each time with the Trust Kernel pinned and one call of a
 * probe tool tagged `a423-probe`: over `control.patch.yml`, whose deployment
 * rule maps that tag to `read`, and over `deny.patch.yml`, whose rule maps it
 * to `safety-critical` so the shipped `kernel-hard-deny` policy refuses it.
 * The two overlays differ only in that rule's risk class. No retry layer on the shipped product receives a policy
 * denial (the LLM layers' failure facts never carry `denied`), so the refusal
 * is observed at the dispatch path: one decision, no second dispatch, no charge.
 */
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p4-11-policy-deny/driver.ts', import.meta.url))
const overlays = {
  control: fileURLToPath(new URL('./loader/p4-11-policy-deny/control.patch.yml', import.meta.url)),
  deny: fileURLToPath(new URL('./loader/p4-11-policy-deny/deny.patch.yml', import.meta.url)),
} as const
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver reported for one boot. */
interface Result {
  readonly trustKernel: boolean
  readonly probeRuns: number
  readonly decisions: readonly { readonly effect: unknown, readonly reason: unknown, readonly matched: unknown }[]
  readonly charged: readonly { readonly run: string, readonly retriesUsed: number | null }[]
  readonly retryEvents: number
  readonly turnError: string | null
}

const results = new Map<string, Result>()

beforeAll(async () => {
  for (const [variant, configPath] of Object.entries(overlays)) {
    const { stdout } = await runLoaderSmoke({
      label: `a423-${variant}`,
      tempDirPrefix: 'a423-policy-deny-',
      binScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
    })
    const json = /A423-RESULT (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the ${variant} boot reported nothing usable:\n${stdout}`)
    results.set(variant, JSON.parse(json) as Result)
  }
}, 2 * LOADER_SMOKE_TEST_TIMEOUT_MS + 15_000)

/**
 * Whether one audited decision's matched policy ids include the shipped kernel hard-deny policy.
 * @param matched - the decision's `matched` field.
 * @returns true when an id names `kernel-hard-deny`.
 */
function matchesKernelHardDeny(matched: unknown): boolean {
  return Array.isArray(matched) && matched.some(id => String(id).includes('kernel-hard-deny'))
}

describe('P4-11 acceptance[0] on the shipped mount: a policy-denied tool call is not dispatched again and charges nothing', () => {
  it('control: without the deployment rule the probe runs once, and the kernel audits one permit for its call', () => {
    const result = results.get('control')
    expect(result?.probeRuns, JSON.stringify(result)).toBe(1)
    expect(result?.decisions.map(decision => decision.effect), JSON.stringify(result)).toEqual(['permit'])
  })

  it('with the deployment rule, the kernel audits the call as denied by the shipped kernel-hard-deny policy, and the probe does not run', () => {
    const result = results.get('deny')
    expect(result?.trustKernel, JSON.stringify(result)).toBe(true)
    expect(result?.decisions.length ?? 0, JSON.stringify(result)).toBeGreaterThanOrEqual(1)
    expect(result?.decisions.every(decision => decision.effect === 'deny' && matchesKernelHardDeny(decision.matched)), JSON.stringify(result)).toBe(true)
    expect(result?.probeRuns, JSON.stringify(result)).toBe(0)
  })

  it('the denied call is not dispatched again and charges the run retry budget nothing', () => {
    const result = results.get('deny')
    expect(result?.decisions.length, JSON.stringify(result)).toBe(1)
    expect(Math.max(0, ...(result?.charged ?? []).map(entry => entry.retriesUsed ?? 0)), JSON.stringify(result)).toBe(0)
    expect(result?.retryEvents, JSON.stringify(result)).toBe(0)
  })
})

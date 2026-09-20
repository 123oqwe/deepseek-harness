/**
 * P3-02 must[3] at the point it decides something: a provider declares what it
 * can enforce, and the solver refuses a dimension nobody claimed.
 *
 * The Contract stage already wrote that rule into `satisfiesPolicySet`, and
 * nothing called it: the whole repository reached it from `policy.spec.ts`
 * only, so "weak may not pose as strong" held in a function no request passed
 * through. These cases are about the seam instead of the rule -- a provider
 * carrying its claim, selection consulting it, the shipped provider answering
 * at all, and the deployment schema not inventing a policy nobody wrote.
 * @module packages/execution/execution-world/tests/policy-features.spec
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import { selectWorldProvider } from '../src/lifecycle.ts'
import { createLocalWorldProvider } from '../src/local-provider.ts'
import ExecutionWorldService, { digestWorldSpec, filesystemForSandboxMode, resolveWorldSpec } from '../src/plugin.ts'
import type { PolicySet } from '../src/policy.ts'
import { WORLD_SPEC_DIMENSIONS, type WorldId, type WorldProvider, type WorldSpec, type WorldSpecDimension } from '../src/types.ts'

const HOST_TENANT = brandString<TenantId>('local-host')

/** The dimensions a `PolicySet` can carry rules for: the nine minus `lifetime` and `tenant`. */
const GOVERNABLE: readonly WorldSpecDimension[] = WORLD_SPEC_DIMENSIONS
  .filter(dimension => dimension !== 'lifetime' && dimension !== 'tenant')

/** A complete spec, built the way the production path builds one. */
function spec(): WorldSpec {
  const filesystem = filesystemForSandboxMode('workspace-write', '/workspace')
  if (filesystem === undefined) throw new Error('the sandbox mode this fixture uses must resolve to a filesystem effect')
  return resolveWorldSpec({}, filesystem, HOST_TENANT)
}

/**
 * A policy that PERMITS exactly what {@link spec} asks for, on every governable
 * dimension.
 *
 * Complete on purpose. A policy that names one dimension refuses on the other
 * six as `unknown-dimension` (must[2]: silence is not permission), so a partial
 * policy cannot tell "the provider does not claim this" from "no rule covers
 * it" -- and a case built on one would pass for the wrong reason.
 */
const PERMITS_THIS_SPEC: PolicySet = {
  filesystem: { allowedEffects: ['workspace-write'], allowedRights: [] },
  network: { allowedPostures: ['unrestricted'] },
  process: { allowSpawn: true },
  ipc: { allowedPostures: ['unrestricted'] },
  devices: { allowedDevices: ['/dev/null'] },
  secrets: { allowedPostures: ['inherited'] },
  resources: {},
}

/**
 * A provider that satisfies every spec, carrying the claim under test.
 * @param features - what it declares it enforces; omitted declares nothing.
 * @returns the provider.
 */
function providerDeclaring(features?: WorldProvider['supportedPolicyFeatures']): WorldProvider {
  const base = {
    id: brandString<WorldProvider['id']>('declaring-provider'),
    unsatisfiableDimensions: () => [],
    create: () => Promise.reject(new Error('this fixture is never asked to build a world')),
    terminate: () => Promise.reject(new Error('unused')),
    snapshot: () => Promise.reject(new Error('unused')),
    restore: () => Promise.reject(new Error('unused')),
    attest: () => Promise.reject(new Error('unused')),
  }
  return features === undefined ? base : { ...base, supportedPolicyFeatures: features }
}

/**
 * The dimensions a selection refused for a named provider, by refusal kind.
 * @param selection - the answer from {@link selectWorldProvider}.
 * @param kind - the refusal kind to collect.
 * @returns the dimensions refused under that kind, in the solver's order.
 */
function refusedFor(selection: ReturnType<typeof selectWorldProvider>, kind: string): readonly WorldSpecDimension[] {
  if (selection.outcome !== 'refused') return []
  return (selection.policyRefusals?.['declaring-provider'] ?? [])
    .filter(refusal => refusal.kind === kind)
    .map(refusal => refusal.dimension)
}

let minted = 0
/** A fresh world id per call, as the plugin's own factory supplies. */
function ids(): WorldId {
  minted += 1
  return brandString<WorldId>(`policy-features-world-${String(minted)}`)
}

/**
 * One mounted registry holding the shipped provider, under an optional policy.
 * @param policy - the deployment's rules, or `undefined` for a row that states none.
 * @returns the mounted service.
 */
async function mounted(policy: PolicySet | undefined): Promise<ExecutionWorldService> {
  const ctx = new Context()
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/workspace' }) } as never)
  await ctx.plugin(ExecutionWorldService, policy === undefined
    ? { tenant: 'local-host', request: {} }
    : { tenant: 'local-host', request: {}, policy })
  const service = ctx.get('executionWorlds') as unknown as ExecutionWorldService
  service.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
  return service
}

describe('P3-02 must[3] — a provider enforces what it declares, and only that', () => {
  it('P3-02 P: a provider that declares nothing supports nothing, so every governed dimension refuses it', () => {
    const selection = selectWorldProvider(spec(), [providerDeclaring()], PERMITS_THIS_SPEC)

    expect(selection.outcome).toBe('refused')
    expect([...refusedFor(selection, 'unsupported-by-provider')].sort()).toEqual([...GOVERNABLE].sort())
  })

  it('P3-02 P: the same policy admits a provider that declares every dimension, so the refusal above is the claim and not the rule', () => {
    const selection = selectWorldProvider(spec(), [providerDeclaring({ dimensions: GOVERNABLE })], PERMITS_THIS_SPEC)

    expect(selection.outcome).toBe('selected')
  })

  it('P3-02 P: a partial claim is refused on exactly what it left out, which is what keeps weak from posing as strong', () => {
    const selection = selectWorldProvider(spec(), [providerDeclaring({ dimensions: ['filesystem'] })], PERMITS_THIS_SPEC)

    expect([...refusedFor(selection, 'unsupported-by-provider')].sort())
      .toEqual([...GOVERNABLE].filter(dimension => dimension !== 'filesystem').sort())
  })

  it('P3-02 P: the provider this package ships declares what it enforces rather than staying silent', () => {
    const local = createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 })

    expect(local.supportedPolicyFeatures?.dimensions).toEqual(['filesystem'])
  })

  it('P3-02 P: a deployment policy reaches the real selection path, so a world nobody can confine is not created', async () => {
    const agent = { id: 'agent-1', session: { id: 'agent-1' } }
    // The shipped provider declares `filesystem` alone, so under a policy that
    // governs all seven it is refused and the agent gets no world. The second
    // mount is identical but for the policy and binds one, which is what makes
    // this a reading of the policy rather than of a registry that binds
    // nothing.
    await expect((await mounted(PERMITS_THIS_SPEC)).bindingFor(agent)).resolves.toBeUndefined()
    await expect((await mounted(undefined)).bindingFor(agent)).resolves.toBeDefined()
  })
})

describe('P3-02 must[3] — the deployment schema states no policy of its own', () => {
  /** The real `Config` schema, parsed as the loader parses a profile's row. */
  const parse = (value: unknown): { policy?: PolicySet } =>
    (ExecutionWorldService.Config as unknown as (input: unknown) => { policy?: PolicySet })(value)

  it('P3-02 P: a row that writes no policy resolves to no policy, so the shipped bundles keep creating worlds', () => {
    // Schemastery gives an object an implicit `{}` default and an array an
    // implicit `[]`, so a bare `z.object` here would resolve an absent policy
    // into seven rules whose allowlists are all empty -- and an empty
    // allowlist refuses everything. This is the case that would have caught
    // that: it reads the real schema, not a hand-built config.
    expect(parse({}).policy).toBeUndefined()
    expect(parse({ request: {} }).policy).toBeUndefined()
  })

  it('P3-02 P: writing one rule does not conjure the other six, so an unwritten dimension refuses as unknown rather than as an empty list', () => {
    const resolved = parse({ policy: { network: { allowedPostures: ['unrestricted'] } } })

    expect(resolved.policy).toEqual({ network: { allowedPostures: ['unrestricted'] } })
  })
})

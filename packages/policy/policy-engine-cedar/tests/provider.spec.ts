/**
 * Epic P2-05 Provider stage: the Cedar authorizer behind `ctx.policy`.
 *
 * What is asserted here is the TRANSLATION and the failure taxonomy — how a
 * harness policy request becomes a Cedar request, and which failures stay
 * distinguishable. Cedar's own semantics are proven in the Contract stage's
 * conformance cases; repeating them here would test the library twice and the
 * translation not at all.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import CedarPolicyEngine, { decisionFromAnswer, policySetDigest } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { PolicyRequest } from '@deepseek-ai/dsh-policy-engine'

/** A permit-everything set, so a case that denies denies for its own reason. */
const PERMIT_ALL: Config['policies'] = { 'baseline-permit': 'permit(principal, action, resource);' }

/** One policy question: a destructive filesystem write by a user in a trusted workspace. */
function request(overrides: Partial<PolicyRequest> = {}): PolicyRequest {
  return {
    identity: { kind: 'user', id: brandString('user-1'), tenantId: brandString('tenant-1') },
    token: undefined,
    manifest: {
      actionId: brandString('action-1'),
      capability: brandString('fs.write'),
      target: { kind: 'filesystem', path: 'workspace/a.ts' },
      sideEffectClass: 'destructive',
      classified: true,
    },
    world: { kind: 'absent' },
    facts: { workspaceTrust: 'trusted-execute', permissionPosture: 'default' },
    ...overrides,
  } as unknown as PolicyRequest
}

/** Mount the provider on a fresh Context, as a profile would. */
async function mount(policies: Config['policies']): Promise<{ ctx: Context; engine: CedarPolicyEngine }> {
  const ctx = new Context()
  await ctx.plugin(CedarPolicyEngine, { policies })
  return { ctx, engine: ctx.policy as CedarPolicyEngine }
}

describe('P2-05 must[0]: the request translation', () => {
  it('routes a decision by the CAPABILITY the manifest names, not by a tool name', async () => {
    // Two tools invoking one capability are one authorization question, so a
    // policy is written against the capability.
    const { ctx, engine } = await mount({
      'forbid-fs-write': 'forbid(principal, action == Dsh::Action::"fs.write", resource);',
      ...PERMIT_ALL,
    })

    expect(engine.evaluate(request()).decision.effect).toBe('deny')
    expect(engine.evaluate(request({ manifest: { ...request().manifest, capability: brandString('fs.read') } as never })).decision.effect)
      .toBe('permit')
    await ctx.fiber.dispose()
  })

  it('keeps the target KIND in the resource id, so a path and a command are different resources', async () => {
    // `filesystem:/x` and `process:/x` would be one resource if the union's
    // discriminant were dropped in translation.
    const { ctx, engine } = await mount({
      'forbid-that-path': 'forbid(principal, action, resource == Dsh::Resource::"filesystem:workspace/a.ts");',
      ...PERMIT_ALL,
    })

    expect(engine.evaluate(request()).decision.effect).toBe('deny')
    expect(engine.evaluate(request({ manifest: { ...request().manifest, target: { kind: 'process', command: 'workspace/a.ts' } } as never })).decision.effect)
      .toBe('permit')
    await ctx.fiber.dispose()
  })

  it('exposes the declared context facts, including the absent execution world', async () => {
    // BLOCKED-178: `world` is `absent` until P3-01 lands, and a policy can
    // REFUSE on that — which is the difference between a declared absence and
    // a missing field.
    const { ctx, engine } = await mount({
      'require-known-world': 'forbid(principal, action, resource) when { context.world == "absent" };',
      ...PERMIT_ALL,
    })

    expect(engine.evaluate(request()).decision).toMatchObject({ effect: 'deny', reason: 'forbidden-by-policy' })
    await ctx.fiber.dispose()
  })

  it('distinguishes a declared side-effect class from a defaulted one', async () => {
    // P2-03 records `classified` because a declared `destructive` and a
    // defaulted one are different facts about how much the harness understood.
    const { ctx, engine } = await mount({
      'forbid-unclassified': 'forbid(principal, action, resource) unless { context.classified };',
      ...PERMIT_ALL,
    })

    expect(engine.evaluate(request()).decision.effect).toBe('permit')
    expect(engine.evaluate(request({ manifest: { ...request().manifest, classified: false } })).decision.effect)
      .toBe('deny')
    await ctx.fiber.dispose()
  })
})

describe('P2-05 must[3]: what the audit sees and what the model sees', () => {
  it('names the matched policy by ITS OWN id, from the id-to-source map', async () => {
    // Submitted as a source string, Cedar assigns `policy0`/`policy1` and an
    // `@id(...)` annotation does not become the reported id — an audit built
    // that way would name policies nobody wrote.
    const { ctx, engine } = await mount({
      ...PERMIT_ALL,
      'destructive-forbid': 'forbid(principal, action, resource) when { context.sideEffectClass == "destructive" };',
    })

    const { decision, explain } = engine.evaluate(request())

    expect(explain.matched).toEqual(['destructive-forbid'])
    // The model side carries a closed code and no policy text.
    expect(decision).toEqual({ effect: 'deny', reason: 'forbidden-by-policy', policySet: engine.digest })
    await ctx.fiber.dispose()
  })

  it('tells a forbid apart from nothing-permitted', async () => {
    // Both are `deny`, and an operator needs to know which: one means a rule
    // fired, the other means the set has no rule for this action at all.
    const { ctx: forbidCtx, engine: forbids } = await mount({
      ...PERMIT_ALL,
      'destructive-forbid': 'forbid(principal, action, resource) when { context.sideEffectClass == "destructive" };',
    })
    const { ctx: emptyCtx, engine: silent } = await mount({ 'unrelated': 'permit(principal, action == Dsh::Action::"other", resource);' })

    expect(forbids.evaluate(request()).decision.reason).toBe('forbidden-by-policy')
    expect(silent.evaluate(request()).decision.reason).toBe('no-matching-permit')
    await forbidCtx.fiber.dispose()
    await emptyCtx.fiber.dispose()
  })
})

describe('P2-05 acceptance[1]: every decision carries the policy-set digest', () => {
  it('records the digest on a permit and on a deny alike', async () => {
    const { ctx, engine } = await mount(PERMIT_ALL)

    expect(engine.evaluate(request()).decision.policySet).toBe(engine.digest)
    expect(engine.digest).toBe(policySetDigest(PERMIT_ALL))
    await ctx.fiber.dispose()
  })

  it('changes the digest when a policy CHANGES, and not when the set is merely reordered', async () => {
    // A replay compares the digest first. A digest that moved on reordering
    // would report drift that did not happen; one that did not move on an
    // edited rule would hide drift that did.
    const a = { first: 'permit(principal, action, resource);', second: 'forbid(principal, action, resource);' }
    const reordered = { second: a.second, first: a.first }
    const edited = { ...a, second: 'forbid(principal, action, resource) when { context.classified };' }

    expect(policySetDigest(reordered)).toBe(policySetDigest(a))
    expect(policySetDigest(edited)).not.toBe(policySetDigest(a))
  })

  it('does not confuse a set whose id and source were split differently', async () => {
    // Length-prefixed rather than concatenated: `{ab: 'c'}` and `{a: 'bc'}`
    // would otherwise digest identically.
    expect(policySetDigest({ ab: 'c' })).not.toBe(policySetDigest({ a: 'bc' }))
  })
})

describe('P2-05 acceptance[2]: a broken policy set is not a strict one', () => {
  it('maps a Cedar FAILURE to its own named deny, not to an ordinary refusal', () => {
    // Three states stay distinguishable: a policy said no, the policy set
    // could not be read, and no engine is mounted at all. Collapsed, a broken
    // deployment looks like a strict one — to an operator and to the replay.
    const digest = policySetDigest({ p: 'permit(principal, action, resource);' })

    const failed = decisionFromAnswer(
      { type: 'failure', errors: [{ message: 'failed to parse principal' }], warnings: [] } as never,
      digest,
    )

    expect(failed.decision).toEqual({ effect: 'deny', reason: 'policy-set-invalid', policySet: digest })
    // The engine's own words reach the audit and nothing else.
    expect(failed.explain.diagnostics).toEqual(['failed to parse principal'])
  })

  it('still tells an ordinary deny apart from that failure', () => {
    // The control: without it, a mapping that returned `policy-set-invalid`
    // for everything would satisfy the case above.
    const digest = policySetDigest({ p: 'permit(principal, action, resource);' })

    const denied = decisionFromAnswer(
      { type: 'success', response: { decision: 'deny', diagnostics: { reason: [], errors: [] } }, warnings: [] } as never,
      digest,
    )

    expect(denied.decision.reason).toBe('no-matching-permit')
  })

  it('refuses to LOAD when the policy set does not parse', async () => {
    // Fails loud at load rather than at the first tool call: a deployment whose
    // policies do not parse is misconfigured, and discovering it as a denied
    // action puts the failure in the wrong place.
    const ctx = new Context()

    await expect(ctx.plugin(CedarPolicyEngine, { policies: { broken: 'this is not a policy' } }))
      .rejects.toThrow(/policy set does not parse/)
    await ctx.fiber.dispose()
  })

  it('unloads with its fiber, and a remount starts from the configured set again', async () => {
    // The provider is an ordinary plugin: it may be unmounted like any other,
    // and what the enforcement point does when it is gone is the Trust
    // Kernel's (`policy-unavailable`), not this service's.
    const { ctx, engine } = await mount(PERMIT_ALL)
    expect(engine.evaluate(request()).decision.effect).toBe('permit')

    await ctx.fiber.dispose()
    expect(ctx.get('policy')).toBeUndefined()

    const remounted = await mount(PERMIT_ALL)
    expect(remounted.engine.evaluate(request()).decision.effect).toBe('permit')
    await remounted.ctx.fiber.dispose()
  })
})

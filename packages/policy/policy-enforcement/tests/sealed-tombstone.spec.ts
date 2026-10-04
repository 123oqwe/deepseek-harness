/**
 * B-728: once a provider the Trust Kernel sealed has unloaded, its name stays
 * unprovided until the host restarts, so the enforcement point and the risk
 * gate must refuse every action and say that a restart is what restores the
 * policy — never fall open, and never fail with a bare exception (P2-05
 * acceptance[2], P2-04 acceptance[2]).
 *
 * Every case runs real turns on the in-process stack with the kernel pinned
 * the way a `dsh` pins it, so the seal is the one `pinTrustKernel` installs.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import CedarPolicyEngine, { policySetDigest } from '@deepseek-ai/dsh-policy-engine-cedar'
import type { PolicyRequest } from '@deepseek-ai/dsh-policy-engine'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { enforceAction, POLICY_ROW_CHANGED } from '../src/index.ts'
import { callWriter, PERMIT_ALL, resultText, runTurn, stack } from './fixtures/stack.ts'

const PERMISSION_ROW_CHANGED = 'the permission policy row or a service it depends on changed; restart the host for it to take effect'

/**
 * Script `turns` turns that each call `writer` once.
 * @param ctx - a context from {@link stack}.
 * @param turns - how many turns the case drives.
 */
function scriptTurns(ctx: Context, turns: number): void {
  ctx.llm.registerAdapter(['mock'], new MockAdapter(Array.from({ length: turns }, (_, index) => [
    callWriter(`call-${String(index + 1)}`), textResponse('done'),
  ]).flat()))
}

/**
 * Mount a `policySet` provider yielding `policies`, as its own plugin so a case can unload it.
 * @param ctx - a context from {@link stack}.
 * @param policies - the set to yield.
 * @returns the provider's fiber.
 */
async function mountPolicySet(ctx: Context, policies: Readonly<Record<string, string>>) {
  return ctx.plugin({
    name: 'b728-policy-set',
    apply: (child: Context) => {
      child.provide('policySet', { current: () => ({ policies, digest: policySetDigest(policies) }) })
    },
  })
}

describe('B-728: an unloaded sealed policy provider refuses every action and names the restart', () => {
  it('policy: once the engine unloads, a call is refused policy-unavailable with the restart reason, and no engine can be mounted again', async () => {
    const { ctx, audit, engine } = await stack({ kernel: 'deployment', policies: PERMIT_ALL })
    scriptTurns(ctx, 2)
    expect(resultText(await runTurn(ctx, 'b728-engine-live'))).toContain('wrote')

    await engine?.dispose()

    const refused = await runTurn(ctx, 'b728-engine-unloaded')
    expect(resultText(refused)).toContain(`(policy-unavailable): ${POLICY_ROW_CHANGED}`)
    expect(resultText(refused)).not.toContain('wrote')
    expect(audit.at(-1)?.decision).toMatchObject({ effect: 'deny', reason: 'policy-unavailable' })
    expect(audit.at(-1)?.diagnostics).toEqual([POLICY_ROW_CHANGED])
    await expect(ctx.plugin(CedarPolicyEngine)).rejects.toThrow(/service "policy" is sealed by the Trust Kernel/u)
    await ctx.fiber.dispose()
  })

  it('policySet: once the policy set unloads, the engine that injects it follows it out and a call is refused the same way', async () => {
    const { ctx, audit } = await stack({ kernel: 'deployment' })
    const policySet = await mountPolicySet(ctx, PERMIT_ALL)
    await ctx.plugin(CedarPolicyEngine)
    scriptTurns(ctx, 2)
    expect(resultText(await runTurn(ctx, 'b728-set-live'))).toContain('wrote')

    await policySet.dispose()

    const refused = await runTurn(ctx, 'b728-set-unloaded')
    expect(resultText(refused)).toContain(`(policy-unavailable): ${POLICY_ROW_CHANGED}`)
    expect(resultText(refused)).not.toContain('wrote')
    expect(audit.at(-1)?.diagnostics).toEqual([POLICY_ROW_CHANGED])
    await expect(mountPolicySet(ctx, PERMIT_ALL)).rejects.toThrow(/service "policySet" is sealed by the Trust Kernel/u)
    await ctx.fiber.dispose()
  })

  it('policySet: an engine still mounted when its sealed set unloads is refused the same way rather than throwing', async () => {
    const { ctx, audit } = await stack({ kernel: 'deployment' })
    const policySet = await mountPolicySet(ctx, PERMIT_ALL)
    // Reads the set on every decision without injecting it, so it stays mounted
    // after the set unloads: the state between a sealed set unloading and Cordis
    // disposing an engine that injects it.
    ctx.provide('policy', {
      get digest() { return ctx.policySet.current().digest },
      evaluate: () => ({
        decision: { effect: 'permit', policySet: ctx.policySet.current().digest },
        explain: { matched: [], diagnostics: [] },
      }),
    })
    scriptTurns(ctx, 2)
    expect(resultText(await runTurn(ctx, 'b728-window-live'))).toContain('wrote')

    await policySet.dispose()

    const refused = await runTurn(ctx, 'b728-window-unloaded')
    expect(resultText(refused)).toContain(`(policy-unavailable): ${POLICY_ROW_CHANGED}`)
    expect(audit.at(-1)?.diagnostics).toEqual([POLICY_ROW_CHANGED])
    await ctx.fiber.dispose()
  })

  it('lets an engine fault propagate when no sealed provider unloaded, rather than reading it as one', async () => {
    const { ctx } = await stack({ kernel: 'deployment' })
    ctx.provide('policy', {
      digest: 'b728-faulty-engine',
      evaluate: () => { throw new Error('engine fault') },
    })
    // The engine throws before anything reads the request.
    expect(() => enforceAction(ctx, {} as unknown as PolicyRequest, 'plugin-rpc')).toThrow('engine fault')
    await ctx.fiber.dispose()
  })
})

describe('B-728, P2-04 acceptance[2]: an unloaded sealed permission policy refuses every action', () => {
  it('runs while the permission policy was never mounted or is live, and refuses every call with the restart reason once it unloads', async () => {
    const never = await stack({ kernel: 'deployment', policies: PERMIT_ALL, tags: ['filesystem-write'] })
    scriptTurns(never.ctx, 1)
    expect(resultText(await runTurn(never.ctx, 'b728-presets-never-mounted'))).toContain('wrote')
    await never.ctx.fiber.dispose()

    const { ctx } = await stack({ kernel: 'deployment', policies: PERMIT_ALL, preset: 'workspace-write', tags: ['filesystem-write'] })
    scriptTurns(ctx, 2)
    expect(resultText(await runTurn(ctx, 'b728-presets-live'))).toContain('wrote')

    const runtime = ctx.registry.get(PermissionPresetService)
    await Promise.all([...runtime === undefined ? [] : runtime.fibers].map(fiber => fiber.dispose()))
    expect(ctx.get('permissionPresets')).toBeUndefined()

    const refused = await runTurn(ctx, 'b728-presets-unloaded')
    expect(resultText(refused)).toContain(PERMISSION_ROW_CHANGED)
    expect(resultText(refused)).not.toContain('wrote')
    await ctx.fiber.dispose()
  })
})

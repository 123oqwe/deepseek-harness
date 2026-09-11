/**
 * Epic P2-05 acceptance[2]: the policy service cannot be replaced or unmounted
 * into a bypass.
 *
 * **Why this is two claims and not one.** The clause names two Cordis
 * operations, and they have different answers. REPLACE is refused by Cordis
 * itself: `ctx.provide` throws when a name is already registered, so a second
 * engine cannot take the first one's place. UNMOUNT is NOT refused — the
 * disposer `provide` returns deletes the store entry, and any fiber that
 * mounted the service can dispose it. Reading `reflect.ts` gives that shape;
 * these cases measure it, because the preFlight recorded the unmount half as
 * an open question (`evidence-P2-05.md`, OQ1) precisely because the trust
 * kernel's pin answers the forgery attack and not this one.
 *
 * **What makes the unmount half acceptable.** The clause's purpose is that no
 * Cordis operation turns a denial into permission. Losing the service does not:
 * `enforceManifestedAction` reads `ctx.get('policy')` per decision and answers
 * `policy-unavailable` when it is absent, so an unmount degrades to fail-closed
 * deny. The case below asserts that an action PERMITTED with the engine mounted
 * is DENIED after it is disposed — same stack, same action, one operation
 * between them — which is the property the clause is protecting. An unmount
 * that left the last decision cached, or that fell through to permit, would
 * redden it.
 */
import { describe, expect, it } from 'vitest'
import CedarPolicyEngine from '@deepseek-ai/dsh-policy-engine-cedar'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { callWriter, PERMIT_ALL, resultText, runTurn, stack } from './fixtures/stack.ts'

describe('P2-05 acceptance[2]: the policy service resists replace and unmount', () => {
  it('REFUSES a second policy service, so no engine can be swapped in over the mounted one', async () => {
    const { ctx } = await stack({ kernel: 'deployment', policies: PERMIT_ALL })
    // The attack: mount a second engine whose set permits everything the first
    // one forbids. Cordis rejects the registration itself, so the swap never
    // reaches a decision — the refusal is structural, not a policy outcome.
    await expect(ctx.plugin(CedarPolicyEngine, {
      policies: { 'attacker-permit': 'permit(principal, action, resource);' },
    })).rejects.toThrow(/service "policy" has been registered/)
  })

  it('keeps the FIRST engine deciding after the refused replace, not a half-installed second one', async () => {
    // A throw during registration could still have left the store pointing at
    // the loser. Drive a real turn afterwards and read the audit: the digest
    // must be the one the original set hashes to.
    const { ctx, audit } = await stack({
      kernel: 'deployment',
      policies: { ...PERMIT_ALL, 'forbid-writer': 'forbid(principal, action, resource);' },
    })
    const mounted = ctx.get('policy') as CedarPolicyEngine
    await expect(ctx.plugin(CedarPolicyEngine, { policies: PERMIT_ALL })).rejects.toThrow()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))
    await runTurn(ctx, 'p2-05-replace-refused')
    expect(audit.at(-1)?.decision.effect).toBe('deny')
    // The digest is the identity check: the deciding set is still the one the
    // stack mounted, not the attacker's permit-all.
    expect(audit.at(-1)?.decision.policySet).toBe(mounted.digest)
    // Compared as digests rather than as objects: `expect(service).toBe(…)`
    // makes vitest probe the value for `asymmetricMatch`, and a Cordis service
    // proxy throws on any property it was not injected for.
    expect((ctx.get('policy') as CedarPolicyEngine).digest).toBe(mounted.digest)
  })

  it('DEGRADES TO DENY when the engine is unmounted, rather than falling through to permit', async () => {
    // The honest half of the clause. Unmount is not refused by Cordis, so the
    // property that matters is what the enforcement point does without a
    // service. Same stack and same action on both sides of the dispose.
    const { ctx, audit, engine } = await stack({ kernel: 'deployment', policies: PERMIT_ALL })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      callWriter('call-1'), textResponse('done'),
      callWriter('call-2'), textResponse('done'),
    ]))

    const permitted = await runTurn(ctx, 'p2-05-before-unmount')
    expect(resultText(permitted)).toContain('wrote')
    expect(audit.at(-1)?.decision.effect).toBe('permit')

    await engine?.ctx.fiber.dispose()

    const denied = await runTurn(ctx, 'p2-05-after-unmount')
    expect(resultText(denied)).toContain('policy')
    expect(audit.at(-1)?.decision.reason).toBe('policy-unavailable')
  })
})

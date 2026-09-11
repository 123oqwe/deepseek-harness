/**
 * Epic P2-05 Usage stage: the enforcement point on a real dispatch, on the
 * real in-process stack.
 *
 * The mocked boundary is the model. Everything else is what a `dsh` runs: a
 * pinned Trust Kernel, a mounted Cedar provider over a real policy set, the
 * agent loop's own dispatch, and the manifests it appends.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import CedarPolicyEngine from '@deepseek-ai/dsh-policy-engine-cedar'
import * as PolicyEnforcement from '../src/index.ts'
import { callWriter, FORBID_WRITER, PERMIT_ALL, resultText, runTurn, stack } from './fixtures/stack.ts'

describe('P2-05 acceptance[2]: losing the provider mid-session denies by name', () => {
  it('permits while the provider is mounted, and denies `policy-unavailable` after it unmounts', async () => {
    const { ctx, audit, engine } = await stack({ policies: PERMIT_ALL })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done'), callWriter('call-2'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const permitted = await runTurn(ctx, 'p2-05-1')
    expect(resultText(permitted)).toContain('wrote')
    expect(audit.at(-1)?.decision.effect).toBe('permit')

    // The provider is an ordinary plugin: unmounting it is allowed. What may
    // not be lost is the ENFORCEMENT.
    await engine?.dispose?.()
    expect(ctx.get('policy')).toBeUndefined()

    const refused = await runTurn(ctx, 'p2-05-2')
    expect(resultText(refused)).toContain('policy-unavailable')
    expect(audit.at(-1)?.decision).toMatchObject({ effect: 'deny', reason: 'policy-unavailable' })
    await ctx.fiber.dispose()
  })

  it('records WHICH policy set it could not reach, so a replay can tell the two failures apart', async () => {
    const { ctx, audit, engine } = await stack({ policies: PERMIT_ALL })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done'), callWriter('call-2'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)
    await runTurn(ctx, 'p2-05-3')
    const mountedDigest = audit.at(-1)?.decision.policySet

    await engine?.dispose?.()
    await runTurn(ctx, 'p2-05-4')

    expect(audit.at(-1)?.decision.policySet).toBe(mountedDigest)
    await ctx.fiber.dispose()
  })
})

describe('P2-05 acceptance[0]: one PEP, whichever originator dispatches', () => {
  it('refuses a forbidden tool on the NATIVE path, with the audit naming the matched policy', async () => {
    const { ctx, audit } = await stack({ policies: FORBID_WRITER })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-5')

    expect(resultText(events)).toContain('refused by policy')
    // The model sees a closed reason code; the audit sees the rule.
    expect(resultText(events)).not.toContain('forbid-writer')
    expect(audit.at(-1)).toMatchObject({
      origin: 'native-tool-call',
      decision: { effect: 'deny', reason: 'forbidden-by-policy' },
      matched: ['forbid-writer'],
    })
    await ctx.fiber.dispose()
  })

  it('decides every dispatch against the same manifest the log records', async () => {
    // acceptance[0] is about ONE point, so the audit's action id is the
    // manifest's: a second decision path would produce an id nothing in the
    // session log cites.
    const { ctx, audit } = await stack({ policies: PERMIT_ALL })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-6')
    const manifest = events.find(event => event.type === 'action/manifest-appended')

    expect(audit.at(-1)?.actionId).toBe((manifest?.data as { actionId: string } | undefined)?.actionId)
    await ctx.fiber.dispose()
  })

  it('lets the KERNEL bind: a kernel deny refuses a call the policy permitted', async () => {
    // The kernel is the one participant a plugin cannot replace, so its
    // verdict is what the dispatch acts on.
    const { ctx, audit } = await stack({ policies: PERMIT_ALL, verdict: 'deny' })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-7')

    expect(resultText(events)).toContain('refused by policy')
    // The engine permitted and the kernel vetoed. The audit records the
    // decision that was ENFORCED, and names the one it displaced, so a reader
    // can tell a kernel veto from an engine denial (BLOCKED-194). It used to
    // record only the engine's permit, which described an action that never
    // happened.
    expect(audit.at(-1)?.decision).toMatchObject({ effect: 'deny', reason: 'policy-unavailable' })
    expect(audit.at(-1)?.overrode?.effect).toBe('permit')
    await ctx.fiber.dispose()
  })

  it('runs with no policy service at all exactly as it did before this epic', async () => {
    // The control for every case above: a composition mounting no provider
    // still dispatches, because absence is capability absence — but it is
    // DENIED rather than permitted, which is acceptance[2]'s direction.
    const { ctx, audit } = await stack()
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    await runTurn(ctx, 'p2-05-8')

    expect(audit.at(-1)?.decision).toMatchObject({ effect: 'deny', reason: 'policy-unavailable' })
    await ctx.fiber.dispose()
  })
})

describe('P2-05 must[2]: a plugin constraint narrows and never widens', () => {
  it('turns a permitted call into a deny, and records the constraint reason for the audit', async () => {
    const { ctx, audit } = await stack({ policies: PERMIT_ALL })
    ctx.policyConstraints.register(() => 'the workspace is read-only today')
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-9')

    expect(resultText(events)).toContain('constrained-by-plugin')
    expect(audit.at(-1)?.constraintReasons).toEqual(['the workspace is read-only today'])
    await ctx.fiber.dispose()
  })

  it('stops constraining when its plugin unmounts', async () => {
    // A constraint that outlived its owner would be a policy nobody can find.
    const { ctx } = await stack({ policies: PERMIT_ALL })
    const dispose = ctx.policyConstraints.register(() => 'temporarily refused')
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done'), callWriter('call-2'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    expect(resultText(await runTurn(ctx, 'p2-05-10'))).toContain('constrained-by-plugin')
    dispose()
    expect(resultText(await runTurn(ctx, 'p2-05-11'))).toContain('wrote')
    await ctx.fiber.dispose()
  })
})

describe('P2-05 acceptance[2]: a policy set that does not parse refuses to load', () => {
  it('fails the mount loudly rather than deciding with a broken set', async () => {
    // The real occurrence point for `policy-set-invalid`: a deployment whose policies do
    // not parse must refuse to boot, not surface as a denied action later.
    const ctx = new Context()
    pinTrustKernel(ctx, createTrustKernel())

    await expect(ctx.plugin(CedarPolicyEngine, { policies: { broken: 'this is not a policy' } }))
      .rejects.toThrow(/policy set does not parse/)

    expect(ctx.get('policy')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

describe('P2-05 must[0]: the capability token is a policy input, not a placeholder', () => {
  it('decides by the CAPABILITY the presented token carries', async () => {
    // The token's claims reach the policy in `redactTokenForLog`'s projection
    // — P2-02 already audited that form as safe outside the token layer. A
    // policy can therefore refuse an action whose authority does not name the
    // capability it needs, which is the whole reason must[0] lists the token.
    const { ctx, audit } = await stack({
      tokens: true,
      policies: {
        ...PERMIT_ALL,
        'require-writer-authority':
          'forbid(principal, action, resource) unless { context.tokenCapability == "writer" };',
      },
    })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-token-1')

    // The session token names the session's capability, not `writer`, so the
    // policy refuses — and the audit records the rule that did it.
    expect(resultText(events)).toContain('refused by policy')
    expect(audit.at(-1)?.matched).toEqual(['require-writer-authority'])
    await ctx.fiber.dispose()
  })

  it('permits the same action when the policy accepts the token that was presented', async () => {
    // The control: without it, a context field that was always empty would
    // satisfy the case above just as well as one carrying real claims.
    const { ctx, audit } = await stack({
      tokens: true,
      policies: {
        ...PERMIT_ALL,
        'require-any-authority':
          'forbid(principal, action, resource) unless { context.tokenPresented };',
      },
    })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-token-2')

    expect(resultText(events)).toContain('wrote')
    expect(audit.at(-1)?.decision.effect).toBe('permit')
    await ctx.fiber.dispose()
  })

  it('refuses when NO token was presented and the policy requires one', async () => {
    // With no token provider mounted, `tokenPresented` is false — the same
    // policy now refuses, which is what makes the field a real input rather
    // than a constant.
    const { ctx } = await stack({
      policies: {
        ...PERMIT_ALL,
        'require-any-authority':
          'forbid(principal, action, resource) unless { context.tokenPresented };',
      },
    })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    expect(resultText(await runTurn(ctx, 'p2-05-token-3'))).toContain('refused by policy')
    await ctx.fiber.dispose()
  })
})

describe('P2-05: the kernel endorses a decision, it does not answer for a human', () => {
  // The deployment decider is IMPORTED, never re-declared: a copy that happened
  // to look like the shipped one would put the evidence outside the product,
  // which is exactly how this epic's cells came to be green on nothing
  // (BLOCKED-187 — the suite supplied the engine, the decider and the sink).
  //
  // Asserted as direct calls rather than through a turn, because `ask` has NO
  // PRODUCER in this tree: it appears only in `PolicyEffect`'s declaration
  // (`policy-engine/src/types.ts:147`), and the Cedar provider never emits it.
  // Driving it end-to-end would mean mounting a stub engine invented to return
  // it — a fabricated subject, which is the shape this entry exists to refuse.
  // The decider is a pure total function over that closed union, so calling it
  // IS the product path for the mapping under test.
  it('endorses `ask`, so a human decision is not rewritten into `policy-unavailable`', () => {
    // The regression this pins: a decider refusing anything non-`permit` makes
    // `enforceAction` rewrite every `ask` to `policy-unavailable`, replacing
    // "needs a human decision before it runs" with "was refused by policy" in
    // text the model and the user both read.
    expect(PolicyEnforcement.endorseComposedDecision({ payload: { effect: 'ask' } })).toBe('allow')
  })

  it('endorses a plain permit, so the endorsement is not blanket refusal', () => {
    expect(PolicyEnforcement.endorseComposedDecision({ payload: { effect: 'permit' } })).toBe('allow')
  })

  it('passes a deny through, so a kernel allow never widens an existing refusal', () => {
    expect(PolicyEnforcement.endorseComposedDecision({ payload: { effect: 'deny' } })).toBe('deny')
  })

  it('refuses an unrecognizable payload, so widening for `ask` did not lose fail-closed', () => {
    // `TrustKernelPolicyQuery.payload` is `unknown` by design; this is the one
    // boundary where the deployment supplies the meaning, so an unreadable
    // payload is refused rather than waved through.
    expect(PolicyEnforcement.endorseComposedDecision({ payload: undefined })).toBe('deny')
    expect(PolicyEnforcement.endorseComposedDecision({ payload: 'not-a-decision' })).toBe('deny')
    expect(PolicyEnforcement.endorseComposedDecision({ payload: {} })).toBe('deny')
  })
})

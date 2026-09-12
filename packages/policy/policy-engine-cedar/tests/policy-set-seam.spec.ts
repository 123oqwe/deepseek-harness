/**
 * P2-10 U: what the engine records is what the PROVIDER yielded.
 *
 * These two cases exist because the provider double used elsewhere in this
 * package collapses the distinction they are about. It returns
 * `{policies, digest: policySetDigest(policies)}`, so the pin, a recomputed
 * digest, and a second read of the source are all the same value — and every
 * mutation that swaps one for another is undetectable. Measured on this tree:
 * replacing `evaluate`'s `current.digest` with `this.digest` (a second source
 * read, which `evaluate`'s own comment says never to do) reddened 0 of 225.
 *
 * A test double that makes two things equal cannot observe that they are kept
 * apart. Both providers below make them deliberately unequal.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CurrentPolicySet, PolicyRequest, PolicySetDigest } from '@deepseek-ai/dsh-policy-engine'
import CedarPolicyEngine, { policySetDigest } from '../src/index.ts'

const PERMIT_ALL = { 'baseline-permit': 'permit(principal, action, resource);' }

/** One policy question, shaped as `toCedarRequest` expects. */
function request(): PolicyRequest {
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
  } as unknown as PolicyRequest
}

/**
 * A provider whose pin is deliberately NOT the digest of its own policies.
 *
 * In production it is not: `@deepseek-ai/dsh-policy-language` pins over the
 * canonical text PLUS the vocabulary and the engine version, so a set whose
 * text is unchanged still re-pins when Cedar is upgraded. An engine that
 * recomputed a digest from the policies instead of recording what it was handed
 * would silently drop that.
 */
class ForeignPinProvider extends Service {
  static readonly inject = []
  static readonly PIN = brandString<PolicySetDigest>('sha256-a-pin-no-recomputation-produces')

  constructor(ctx: Context) {
    super(ctx, 'policySet')
  }

  current(): CurrentPolicySet {
    return { policies: PERMIT_ALL, digest: ForeignPinProvider.PIN }
  }
}

/**
 * A provider whose answer CHANGES between calls, standing in for a reload
 * landing between two reads of the source.
 */
class ShiftingProvider extends Service {
  static readonly inject = []
  static readonly FIRST = brandString<PolicySetDigest>('sha256-the-set-this-decision-was-made-against')
  static readonly SECOND = brandString<PolicySetDigest>('sha256-a-set-that-arrived-after-the-decision')

  private calls = 0

  constructor(ctx: Context) {
    super(ctx, 'policySet')
  }

  current(): CurrentPolicySet {
    this.calls += 1
    return this.calls === 1
      ? { policies: PERMIT_ALL, digest: ShiftingProvider.FIRST }
      : { policies: PERMIT_ALL, digest: ShiftingProvider.SECOND }
  }
}

/** Mount an engine over one provider class. */
async function engineOver(
  provider: typeof ForeignPinProvider | typeof ShiftingProvider,
): Promise<{ ctx: Context; engine: CedarPolicyEngine }> {
  const ctx = new Context()
  await ctx.plugin(provider)
  await ctx.plugin(CedarPolicyEngine)
  return { ctx, engine: ctx.policy as CedarPolicyEngine }
}

describe('P2-10 U: the decision records the pin the provider yielded', () => {
  it('records the provider pin verbatim, not a digest recomputed from the policies', async () => {
    const { ctx, engine } = await engineOver(ForeignPinProvider)

    const decision = engine.evaluate(request()).decision

    expect(decision.policySet).toBe(ForeignPinProvider.PIN)
    // The control that makes the assertion above mean something: the recomputed
    // digest of the same policies is a DIFFERENT value, so an engine that
    // recomputed would fail here rather than coincide.
    expect(decision.policySet).not.toBe(policySetDigest(PERMIT_ALL))
    await ctx.fiber.dispose()
  })

  it('decides and records from ONE read of the source, so a reload cannot land between them', async () => {
    // The provider answers differently on its second call. If `evaluate` asked
    // twice — deciding against one read and recording another's digest — the
    // decision would carry the SECOND answer while having been made against the
    // first. That is the straddle `evaluate` exists to avoid, and nothing else
    // in this package observes it.
    const { ctx, engine } = await engineOver(ShiftingProvider)

    const decision = engine.evaluate(request()).decision

    expect(decision.policySet).toBe(ShiftingProvider.FIRST)
    expect(decision.policySet).not.toBe(ShiftingProvider.SECOND)
    await ctx.fiber.dispose()
  })
})

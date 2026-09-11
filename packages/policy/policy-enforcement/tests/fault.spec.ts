/**
 * Epic P2-05 Fault stage: the two boundaries the Contract, Provider and Usage
 * stages left with no case.
 *
 * Four of the six candidates the fault matrix considered are already pinned by
 * live frozen cases — losing the provider mid-session, a policy set that fails
 * to load, a Cedar FAILURE, and a decision with no token presented — and
 * `preflight-P2-05-F.md` records which case covers each. Writing them again
 * would re-prove the register. What follows is the two that are real.
 *
 * Both run on the same stack the Usage stage runs on, from
 * `fixtures/stack.ts`, so a difference between the stages is attributable to
 * the one thing each case changes.
 */

import { describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { callWriter, PERMIT_ALL, resultText, runTurn, stack } from './fixtures/stack.ts'

/**
 * Boundary 1 — a Trust Kernel with no `policyDecider`.
 *
 * This shipped. `createTrustKernel()` with no decider denies EVERY query, and
 * `enforceAction` rewrites a kernel deny over a non-deny decision into
 * `policy-unavailable`, so every tool call on a factory profile was refused
 * even with a real engine mounted and permitting (BLOCKED-187).
 *
 * No case anywhere covered it. The nearest — C and U's "losing the provider
 * denies by name" — is about the ENGINE being absent, which is a DIFFERENT
 * PRODUCER of the same reason code: the engine-absent path carries
 * `EMPTY_POLICY_SET`, the kernel-override path carries the real digest. The
 * assertion on `policySet` below is what tells this case apart from those, and
 * without it the case would pass for the wrong reason.
 */
describe('P2-05 fault: a kernel with no decider refuses what the engine permitted', () => {
  it('denies `policy-unavailable` against the real policy set, not the empty one', async () => {
    const { ctx, audit } = await stack({ policies: PERMIT_ALL, kernel: 'none' })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))

    const refused = await runTurn(ctx, 'p2-05-f-1')

    expect(resultText(refused)).toContain('policy-unavailable')
    // The engine DID answer, and the audit proves it: a matched policy and a
    // real digest. That is what tells this refusal apart from the one C and U
    // already freeze — the engine-absent path carries no matched policy and the
    // EMPTY digest. Without this the case would pass for the wrong reason.
    const record = audit.at(-1)
    expect(record?.matched.length).toBeGreaterThan(0)
    expect(record?.decision.policySet).not.toBe('')
    // NOT asserted here, deliberately: that the audit record shows the
    // refusal. It does not — `enforceAction` appends the record BEFORE the
    // kernel binds, so an override is never recorded and this record says
    // `permit` about an action that was refused. Pinning that would freeze the
    // defect; it is reported separately.
    await ctx.fiber.dispose()
  })

  it('permits the same action once the deployment decider is wired, so the refusal above is the placeholder', async () => {
    // The control, and the mutation target: this case and the one above differ
    // in the kernel and in nothing else. `deployment` is the SHIPPED
    // `endorseComposedDecision`, not a copy that happens to look alike — the
    // fixture kernel refuses `ask`, which the shipped one endorses.
    const { ctx, audit } = await stack({ policies: PERMIT_ALL, kernel: 'deployment' })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))

    const permitted = await runTurn(ctx, 'p2-05-f-2')

    expect(resultText(permitted)).toContain('wrote')
    expect(audit.at(-1)?.decision.effect).toBe('permit')
    await ctx.fiber.dispose()
  })
})

/**
 * Boundary 2 — a plugin constraint that throws (delegate ruling OQ7).
 *
 * `composeDecision` called `constraint(request)` with no `try`, and a
 * constraint is plugin-supplied, so a plugin could make a policy decision
 * throw: the exception left `enforceAction` and landed in whichever dispatch
 * path called it. It did not fail open — the action never ran — but it
 * produced no DECISION: no named deny, no audit record naming the constraint,
 * and one plugin could break every dispatch that reached the enforcement point.
 *
 * The ruling: a throw is that constraint's own named deny. It must stay inside
 * `enforceAction`, be attributable to the constraint that threw, carry the
 * throw's message, be recorded in the audit, and must NOT be folded into
 * `policy-unavailable` — which would say "no policy service is available" about
 * a service that answered.
 */
describe('P2-05 fault: a constraint that throws is that constraint\'s own deny', () => {
  it('refuses `constrained-by-plugin` rather than letting the exception escape the enforcement point', async () => {
    const { ctx, audit } = await stack({ policies: PERMIT_ALL })
    ctx.get('policyConstraints')?.register(function budgetGuard() {
      throw new Error('budget ledger unreachable')
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))

    const refused = await runTurn(ctx, 'p2-05-f-3')

    expect(resultText(refused)).toContain('constrained-by-plugin')
    // Not `policy-unavailable`: the engine was mounted and it answered.
    expect(resultText(refused)).not.toContain('policy-unavailable')
    expect(audit.at(-1)?.decision).toMatchObject({ effect: 'deny', reason: 'constrained-by-plugin' })
    await ctx.fiber.dispose()
  })

  it('names the constraint that threw and carries its message, so an operator is not left with an anonymous refusal', async () => {
    const { ctx, audit } = await stack({ policies: PERMIT_ALL })
    ctx.get('policyConstraints')?.register(function budgetGuard() {
      throw new Error('budget ledger unreachable')
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))

    await runTurn(ctx, 'p2-05-f-4')

    const reasons = audit.at(-1)?.constraintReasons ?? []
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('budgetGuard')
    expect(reasons[0]).toContain('budget ledger unreachable')
    await ctx.fiber.dispose()
  })

  it('leaves the other constraints\' composition unchanged, in either registration order', async () => {
    // must[2] and acceptance[1] both turn on order-independence, so the throw
    // must not consume or reorder what the others contributed. Two stacks,
    // registered in opposite orders, must produce the same two reasons.
    const reasonsFor = async (throwFirst: boolean, session: string): Promise<readonly string[]> => {
      const { ctx, audit } = await stack({ policies: PERMIT_ALL })
      const thrower = function budgetGuard(): string { throw new Error('budget ledger unreachable') }
      const refuser = function quotaGuard(): string { return 'quota exhausted' }
      const registry = ctx.get('policyConstraints')
      if (throwFirst) { registry?.register(thrower); registry?.register(refuser) }
      else { registry?.register(refuser); registry?.register(thrower) }
      ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))
      await runTurn(ctx, session)
      const reasons = audit.at(-1)?.constraintReasons ?? []
      await ctx.fiber.dispose()
      return [...reasons].sort()
    }

    const throwFirst = await reasonsFor(true, 'p2-05-f-5')
    const refuseFirst = await reasonsFor(false, 'p2-05-f-6')
    expect(throwFirst).toEqual(refuseFirst)
    expect(throwFirst).toHaveLength(2)
    expect(throwFirst.some(reason => reason.includes('quota exhausted'))).toBe(true)
  })

  it('control: a constraint that returns a reason still narrows a permit, so the cases above are not "constraints are broken"', async () => {
    const { ctx, audit } = await stack({ policies: PERMIT_ALL })
    ctx.get('policyConstraints')?.register(function quotaGuard() { return 'quota exhausted' })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))

    const refused = await runTurn(ctx, 'p2-05-f-7')

    expect(resultText(refused)).toContain('constrained-by-plugin')
    expect(audit.at(-1)?.constraintReasons).toEqual(['quota exhausted'])
    await ctx.fiber.dispose()
  })
})

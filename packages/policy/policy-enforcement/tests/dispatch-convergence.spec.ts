/**
 * Epic P2-05 acceptance[0]: one ActionManifest reaches one PEP, whichever
 * initiator raised it.
 *
 * **What the clause's five initiators turn out to be.** The clause names tool,
 * workflow, SDK, plugin and subagent. Measured on this tree, they are not five
 * enforcement points and not even five dispatch paths. `enforceManifestedAction`
 * has exactly TWO callers — `agent-loop/src/tool-calls.ts` for a native call and
 * `core/tools/src/ptc.ts` for a code-mode sub-dispatch — and `ActionOrigin` has
 * three members, of which `plugin-rpc` has no producer in the tree at all.
 *
 * Subagent, workflow and SDK are not separate paths: each obtains an Agent
 * through `ctx.agents.create` (`subagent-in-process-driver/src/index.ts:136`,
 * `subagent/src/continuation.ts:1301`, `workflow-worker-thread/src/index.ts:405`)
 * and every tool that Agent calls goes through `appendToolCall`, documented as
 * "the single point every native call passes through". So the clause holds by
 * convergence rather than by four repetitions of a check, and what these cases
 * pin is the convergence: independently created Agents in one composition are
 * decided by one policy set, with no per-Agent policy and no decision carried
 * from one to the next.
 *
 * The `plugin-rpc` half is NOT proven here and is not provable: it has no
 * producer to drive. Recorded in `evidence-P2-05.md` rather than asserted
 * through a grep, because a test that greps source is a claim about text.
 */
import { describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { callWriter, PERMIT_ALL, resultText, runTurn, stack } from './fixtures/stack.ts'

describe('P2-05 acceptance[0]: independently created agents converge on one PEP', () => {
  it('decides two separately created agents against the SAME policy set, not a per-agent one', async () => {
    const { ctx, audit } = await stack({
      kernel: 'deployment',
      policies: { ...PERMIT_ALL, 'forbid-all': 'forbid(principal, action, resource);' },
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      callWriter('call-1'), textResponse('done'),
      callWriter('call-2'), textResponse('done'),
    ]))

    const first = await runTurn(ctx, 'p2-05-converge-a')
    const second = await runTurn(ctx, 'p2-05-converge-b')

    // Both refused, and refused by the same set: a composition that gave each
    // Agent its own engine would still deny here, but the digests would differ.
    expect(resultText(first)).toContain('policy')
    expect(resultText(second)).toContain('policy')
    expect(audit).toHaveLength(2)
    expect(audit[0]?.decision.effect).toBe('deny')
    expect(audit[1]?.decision.effect).toBe('deny')
    expect(audit[1]?.decision.policySet).toBe(audit[0]?.decision.policySet)
  })

  it('decides each action on its own, so one agent\'s permit is not reused for the next', async () => {
    // The control for the case above. Two agents under a permit-all set both
    // reach a decision — two audit records, not one cached verdict replayed —
    // which is what makes "same policy set" a statement about enforcement
    // rather than about a memoized answer.
    const { ctx, audit } = await stack({ kernel: 'deployment', policies: PERMIT_ALL })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      callWriter('call-1'), textResponse('done'),
      callWriter('call-2'), textResponse('done'),
    ]))

    const first = await runTurn(ctx, 'p2-05-permit-a')
    const second = await runTurn(ctx, 'p2-05-permit-b')

    expect(resultText(first)).toContain('wrote')
    expect(resultText(second)).toContain('wrote')
    expect(audit).toHaveLength(2)
    // Different actions: each turn raised its own manifest and each was asked
    // about separately.
    expect(audit[0]?.actionId).toBeDefined()
    expect(audit[1]?.actionId).not.toBe(audit[0]?.actionId)
  })

  it('refuses an agent created AFTER the policy set is in place, with no re-registration needed', async () => {
    // The subagent/workflow shape in miniature: the Agent that acts did not
    // exist when the engine was mounted. It is still decided, because the
    // enforcement point reads the service per decision rather than binding one
    // at Agent construction.
    const { ctx, audit } = await stack({
      kernel: 'deployment',
      policies: { ...PERMIT_ALL, 'forbid-all': 'forbid(principal, action, resource);' },
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('late'), textResponse('done')]))

    const late = await runTurn(ctx, 'p2-05-late-agent')

    expect(resultText(late)).toContain('policy')
    expect(audit.at(-1)?.decision.effect).toBe('deny')
  })
})

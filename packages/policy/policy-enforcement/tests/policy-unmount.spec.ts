/**
 * A-507 under P2-05 acceptance[2] × BLOCKED-313: the Policy service cannot be
 * unmounted by Cordis. acceptance[2]'s text is "the Policy service cannot be
 * replaced or unmounted"; replace is already refused, but an unmount today
 * succeeds — disposing the provider's fiber deletes the `policy` store entry
 * (`packages/policy/policy-enforcement/src/index.ts:153-154`), so any code that
 * can dispose that plugin can stop the product. This is red on today's code and
 * green after B-652 pins the store name (`Fiber.pinStoreName('policy', …)`, the
 * pattern `trust-kernel/src/index.ts:267-272` uses for `trustKernel`).
 *
 * The mocked boundary is the model; everything else is the real in-process
 * stack a `dsh` runs (pinned Trust Kernel, mounted Cedar provider, the agent
 * loop's dispatch).
 * @module packages/policy/policy-enforcement/tests/policy-unmount
 */

import { describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { callWriter, PERMIT_ALL, resultText, runTurn, stack } from './fixtures/stack.ts'

describe('P2-05 acceptance[2] × BLOCKED-313: the Policy service cannot be unmounted by Cordis', () => {
  it('control: the mounted policy engine decides an action (permit)', async () => {
    const { ctx, audit, engine } = await stack({ policies: PERMIT_ALL })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))
    const permitted = await runTurn(ctx, 'a507-control')
    expect(resultText(permitted)).toContain('wrote')
    expect(audit.at(-1)?.decision.effect).toBe('permit')
    await engine?.dispose?.()
    await ctx.fiber.dispose()
  })

  it('acc[2]: after a Cordis unmount attempt the policy service is still mounted and still decides', async () => {
    const { ctx, audit, engine } = await stack({ policies: PERMIT_ALL })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      callWriter('call-1'), textResponse('done'), callWriter('call-2'), textResponse('done'),
    ]))

    const before = await runTurn(ctx, 'a507-1')
    expect(resultText(before)).toContain('wrote')
    expect(audit.at(-1)?.decision.effect).toBe('permit')

    // Attempt to unmount the provider through Cordis. The requirement
    // (acceptance[2]) is that this cannot remove the policy service.
    await engine?.dispose?.()

    // Red today: the dispose deleted the `policy` store entry, so this is
    // undefined and the next action is refused `policy-unavailable`. Green after
    // B-652 pins the store name: the service survives and keeps deciding.
    expect(ctx.get('policy'), 'the policy service must survive a Cordis unmount attempt').toBeDefined()
    const after = await runTurn(ctx, 'a507-2')
    expect(resultText(after), 'the surviving engine still decides the action').toContain('wrote')
    expect(audit.at(-1)?.decision.effect).toBe('permit')
    await ctx.fiber.dispose()
  })
})

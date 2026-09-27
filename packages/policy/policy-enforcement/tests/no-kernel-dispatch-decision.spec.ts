/**
 * Epic P0-02 acceptance[2]: the dispatch decision the three dispatch paths take
 * when no Trust Kernel is pinned, exercised directly.
 *
 * `dispatchDecisionWithoutKernel` reads only whether the launch is a
 * development profile and whether a policy engine is mounted; its contract is
 * that the caller has already established that no kernel is pinned, so the
 * kernel this stack pins is irrelevant to it. These cases drive its three
 * postures, its once-per-composition warning, and the reader beside it, which
 * the shipped dispatch paths reach only from subprocess drivers that contribute
 * no coverage here.
 */
import { describe, expect, it, vi } from 'vitest'
import { dispatchDecisionWithoutKernel, isDevelopmentProfile, DEVELOPMENT_PROFILE_KEY } from '../src/index.ts'
import { PERMIT_ALL, stack } from './fixtures/stack.ts'

describe('P0-02 acceptance[2]: dispatchDecisionWithoutKernel', () => {
  it('denies `policy-unavailable` when a policy engine is mounted and the launch is not a development profile, and warns once per composition', async () => {
    const { ctx } = await stack({ policies: PERMIT_ALL })
    const warn = vi.spyOn(ctx.logger, 'warn')
    expect(dispatchDecisionWithoutKernel(ctx)).toMatchObject({ effect: 'deny', reason: 'policy-unavailable' })
    // A second refusal on the same composition denies again but does not repeat the warning.
    expect(dispatchDecisionWithoutKernel(ctx)).toMatchObject({ effect: 'deny', reason: 'policy-unavailable' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('no Trust Kernel is pinned')
    warn.mockRestore()
    await ctx.fiber.dispose()
  })

  it('gives no decision for a bare harness that mounts no policy engine', async () => {
    const { ctx, engine } = await stack({ policies: PERMIT_ALL })
    await engine?.dispose?.()
    expect(ctx.get('policy')).toBeUndefined()
    expect(dispatchDecisionWithoutKernel(ctx)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('gives no decision when the launch is an explicit development profile, even with an engine mounted', async () => {
    const { ctx } = await stack({ policies: PERMIT_ALL })
    expect(isDevelopmentProfile(ctx)).toBe(false)
    ctx.provide(DEVELOPMENT_PROFILE_KEY, true)
    expect(isDevelopmentProfile(ctx)).toBe(true)
    expect(dispatchDecisionWithoutKernel(ctx)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

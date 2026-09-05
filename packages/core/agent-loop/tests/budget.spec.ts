/**
 * P9-07 Contract — the loop's hard budget decision.
 *
 * The rule most likely to be got wrong is must[3]: a limit of `0` means
 * UNLIMITED, not "no turns permitted". Every limit is therefore pinned from
 * both sides — the value that still admits, and the first value that refuses.
 */
import { describe, expect, it } from 'vitest'

import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'

/** The smallest context an agent-loop plugin can load in. */
async function makeCoreContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  return ctx
}
import { decideTurnAdmission, isBudgetEnforced } from '../src/budget.ts'

const FRESH = { turnsUsed: 0, spentUsd: 0 }

describe('P9-07 Contract — hard loop budget', () => {
  it('must[3]: an ABSENT maxTurns is unlimited, so a long run is never stopped by a field nobody set', () => {
    expect(decideTurnAdmission({ turnsUsed: 10_000, spentUsd: 0 }, {})).toStrictEqual({ admitted: true })
  })

  it('must[3]: a ZERO maxTurns is unlimited too, NOT a run that may take no turns', () => {
    expect(decideTurnAdmission({ turnsUsed: 500, spentUsd: 0 }, { maxTurns: 0 })).toStrictEqual({ admitted: true })
  })

  it('must[3]: a ZERO maxSpendUsd is unlimited, on the same rule', () => {
    expect(decideTurnAdmission({ turnsUsed: 0, spentUsd: 99 }, { maxSpendUsd: 0 })).toStrictEqual({ admitted: true })
  })

  it('must[0]: the turn BEFORE the limit is admitted', () => {
    expect(decideTurnAdmission({ turnsUsed: 2, spentUsd: 0 }, { maxTurns: 3 })).toStrictEqual({ admitted: true })
  })

  it('must[0]: the turn AT the limit is refused, so maxTurns=3 permits exactly three turns', () => {
    const decision = decideTurnAdmission({ turnsUsed: 3, spentUsd: 0 }, { maxTurns: 3 })
    expect(decision).toStrictEqual({
      admitted: false,
      reason: 'max-turns-reached',
      limit: 3,
      observed: 3,
    })
  })

  it('must[0]: a run already past its limit stays refused rather than wrapping to admitted', () => {
    const decision = decideTurnAdmission({ turnsUsed: 9, spentUsd: 0 }, { maxTurns: 3 })
    expect(decision.admitted).toBe(false)
  })

  it('must[0]: spend below the cap is admitted', () => {
    expect(decideTurnAdmission({ turnsUsed: 0, spentUsd: 1.99 }, { maxSpendUsd: 2 })).toStrictEqual({ admitted: true })
  })

  it('must[0]: spend exactly AT the cap is refused, so the cap is a ceiling and not a target', () => {
    expect(decideTurnAdmission({ turnsUsed: 0, spentUsd: 2 }, { maxSpendUsd: 2 })).toStrictEqual({
      admitted: false,
      reason: 'spend-cap-reached',
      limit: 2,
      observed: 2,
    })
  })

  it('reports the turn limit when BOTH are exhausted, since that needs no pricing data to act on', () => {
    const decision = decideTurnAdmission({ turnsUsed: 5, spentUsd: 5 }, { maxTurns: 5, maxSpendUsd: 5 })
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.reason).toBe('max-turns-reached')
  })

  it('reports the spend cap when only spend is exhausted, even with a turn limit configured', () => {
    const decision = decideTurnAdmission({ turnsUsed: 1, spentUsd: 5 }, { maxTurns: 5, maxSpendUsd: 5 })
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.reason).toBe('spend-cap-reached')
  })

  it('carries the limit and the observation, so a refusal is actionable without re-reading config', () => {
    const decision = decideTurnAdmission({ turnsUsed: 0, spentUsd: 7.5 }, { maxSpendUsd: 2.5 })
    expect(decision).toStrictEqual({
      admitted: false,
      reason: 'spend-cap-reached',
      limit: 2.5,
      observed: 7.5,
    })
  })

  it('admits a fresh run under any configured budget', () => {
    expect(decideTurnAdmission(FRESH, { maxTurns: 1, maxSpendUsd: 0.01 })).toStrictEqual({ admitted: true })
  })

  it('must[3]: a maxTurns of 1 permits exactly one turn, the smallest budget that bounds anything', () => {
    expect(decideTurnAdmission(FRESH, { maxTurns: 1 })).toStrictEqual({ admitted: true })
    expect(decideTurnAdmission({ turnsUsed: 1, spentUsd: 0 }, { maxTurns: 1 }).admitted).toBe(false)
  })
})

describe('isBudgetEnforced', () => {
  it('an empty budget enforces nothing', () => {
    expect(isBudgetEnforced({})).toBe(false)
  })

  it('zeros enforce nothing, matching the admission rule rather than restating it differently', () => {
    expect(isBudgetEnforced({ maxTurns: 0, maxSpendUsd: 0 })).toBe(false)
  })

  it('either limit alone counts as enforced', () => {
    expect(isBudgetEnforced({ maxTurns: 3 })).toBe(true)
    expect(isBudgetEnforced({ maxSpendUsd: 0.5 })).toBe(true)
  })
})

/**
 * P9-07 Usage — a budget written in `cordis.yml` reaches the agent.
 *
 * must[2] asks for a conservative default that a profile can override, and the
 * override half is the half that can silently not exist: `AgentOptions.budget`
 * is typed, and the configured-agent row spreads its extra fields straight into
 * the options it constructs an agent with, so the TypeScript path looks whole.
 * Schemastery is what actually decides which keys survive a `cordis.yml` row,
 * and a key it does not declare is dropped without complaint — the run then
 * proceeds unbounded while its configuration says otherwise. These cases pin
 * the schema, because the schema is the only place the answer is decided.
 */
describe('P9-07 Usage — the configured-agent row carries a budget', () => {
  it('must[2]: a budget written on a cordis.yml agent row survives config validation', () => {
    const config = AgentLoop.Config({
      agents: [{ id: 'bounded', model: 'deepseek-chat', budget: { maxTurns: 3, maxSpendUsd: 0.25 } }],
    })
    expect(config.agents[0]?.budget).toStrictEqual({ maxTurns: 3, maxSpendUsd: 0.25 })
  })

  it('must[3]: an explicit zero survives too, so "unlimited" can be stated in a profile', () => {
    const config = AgentLoop.Config({ agents: [{ id: 'unbounded', budget: { maxTurns: 0 } }] })
    expect(config.agents[0]?.budget).toStrictEqual({ maxTurns: 0 })
  })

  it('a row with no budget stays absent rather than acquiring a default that would bound existing runs', () => {
    const config = AgentLoop.Config({ agents: [{ id: 'plain' }] })
    expect(config.agents[0]?.budget).toBeUndefined()
  })

  it('a negative maxTurns is refused at load, not carried into a loop that can never admit a turn', async () => {
    const ctx = await makeCoreContext()
    await expect(ctx.plugin(AgentLoop, { agents: [{ id: 'bad', model: 'mock', budget: { maxTurns: -1 } }] }))
      .rejects.toThrow('agent "bad": budget.maxTurns must be a non-negative safe integer (0 means unlimited)')
    await ctx.fiber.dispose()
  })

  it('a fractional maxTurns is refused: turns are counted, and rounding is a choice nobody stated', async () => {
    const ctx = await makeCoreContext()
    await expect(ctx.plugin(AgentLoop, { agents: [{ id: 'bad', model: 'mock', budget: { maxTurns: 1.5 } }] }))
      .rejects.toThrow('budget.maxTurns must be a non-negative safe integer')
    await ctx.fiber.dispose()
  })

  it('a negative maxSpendUsd is refused, while a fractional one is money and stays legal', async () => {
    const rejecting = await makeCoreContext()
    await expect(rejecting.plugin(AgentLoop, {
      agents: [{ id: 'bad', model: 'mock', budget: { maxSpendUsd: -0.01 } }],
    })).rejects.toThrow('budget.maxSpendUsd must be a non-negative finite number')
    await rejecting.fiber.dispose()

    const accepting = await makeCoreContext()
    await accepting.plugin(AgentLoop, {
      agents: [{ id: 'ok', model: 'mock', budget: { maxSpendUsd: 0.01 } }],
    })
    await accepting.fiber.dispose()
  })

  it('the checked row is the one with no exact identity too, which the identity loop skips early', async () => {
    const ctx = await makeCoreContext()
    await expect(ctx.plugin(AgentLoop, {
      agents: [{ id: 'anonymous', model: 'mock', budget: { maxTurns: Number.NaN } }],
    })).rejects.toThrow('agent "anonymous": budget.maxTurns must be a non-negative safe integer')
    await ctx.fiber.dispose()
  })
})

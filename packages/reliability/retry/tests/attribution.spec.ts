/**
 * Epic P4-11 must[1]: which run a retry is charged to, and one store for the
 * total.
 *
 * These are still pure calls — the layers consuming them are the Usage stage's
 * subject, and `chargedRun`/`RunRetryUsageStore` having callers is what closes
 * the clause. What they pin here is the ARITHMETIC and the walk, so a layer
 * that wires them wrong fails against a decision that was already agreed.
 */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { RunId } from '@deepseek-ai/dsh-principal/types'

import { chargedRun, RunRetryUsageStore, type DelegationNode } from '@deepseek-ai/dsh-retry'

const run = (name: string): RunId => brandString<RunId>(name)

/** A delegation chain as a lookup, the shape every in-scope layer can build. */
function chain(nodes: Record<string, DelegationNode>): (id: string) => DelegationNode | undefined {
  return id => nodes[id]
}

describe('P4-11 must[1]: a retry is charged to the delegation ROOT run', () => {
  it('walks to the root and returns ITS run, not the retrying session’s', () => {
    // The defect this exists to end: a Run is 1:1 with a session, so charging
    // "this agent's run" gives a parent and each child an independent
    // allowance, and the finite budgets stack.
    const lookup = chain({
      root: { runId: run('run-root') },
      middle: { parentSession: 'root', runId: run('run-middle') },
      leaf: { parentSession: 'middle', runId: run('run-leaf') },
    })
    expect(chargedRun('leaf', lookup)).toBe(run('run-root'))
    expect(chargedRun('middle', lookup)).toBe(run('run-root'))
    // A root charges itself, so the walk is not unconditionally climbing.
    expect(chargedRun('root', lookup)).toBe(run('run-root'))
  })

  it('stops at the furthest ancestor this process can see', () => {
    // A parent in another process is not a reason to fall back to the leaf's
    // own allowance -- that IS the per-session accounting being replaced. The
    // widest total actually resolvable is the honest answer.
    const lookup = chain({
      visible: { parentSession: 'elsewhere', runId: run('run-visible') },
      leaf: { parentSession: 'visible', runId: run('run-leaf') },
    })
    expect(chargedRun('leaf', lookup)).toBe(run('run-visible'))
  })

  it('reports no run rather than a wrong one when the chain has none', () => {
    expect(chargedRun('leaf', chain({ leaf: { parentSession: 'root' }, root: {} }))).toBeUndefined()
    expect(chargedRun('unknown', chain({}))).toBeUndefined()
  })

  it('terminates on a circular chain instead of hanging a retry', () => {
    // Unreachable from a real delegation, where a parent is always older. The
    // walk reads durable state, though, and a budget lookup that hangs would
    // stall the request it was deciding for.
    const lookup = chain({
      a: { parentSession: 'b', runId: run('run-a') },
      b: { parentSession: 'a', runId: run('run-b') },
    })
    expect(() => chargedRun('a', lookup)).not.toThrow()
  })
})

describe('P4-11 must[1]: one store, so two layers share a total by construction', () => {
  it('charges two different layers against ONE run total', () => {
    // The clause itself: an LLM retry and an MCP reconnect for the same run
    // draw from one allowance, so three retries exhaust a budget of three
    // however they are divided between the layers.
    const store = new RunRetryUsageStore({ maxRetries: 3 })
    expect(store.admit(run('r'), 100).admitted).toBe(true)
    expect(store.admit(run('r'), 100).admitted).toBe(true)
    expect(store.admit(run('r'), 100).admitted).toBe(true)
    const refused = store.admit(run('r'), 100)
    expect(refused).toEqual({ admitted: false, reason: 'retry-cap-reached' })
    expect(store.usageOf(run('r'))).toEqual({ retriesUsed: 3, delayMsUsed: 300 })
  })

  it('keeps another run’s total separate, so one run cannot exhaust another', () => {
    const store = new RunRetryUsageStore({ maxRetries: 1 })
    expect(store.admit(run('one'), 10).admitted).toBe(true)
    expect(store.admit(run('two'), 10).admitted).toBe(true)
    expect(store.admit(run('one'), 10).admitted).toBe(false)
  })

  it('records nothing for a refusal, so a refused retry costs no budget', () => {
    const store = new RunRetryUsageStore({ maxRetries: 0 })
    expect(store.admit(run('r'), 10).admitted).toBe(false)
    expect(store.usageOf(run('r'))).toEqual({ retriesUsed: 0, delayMsUsed: 0 })
  })

  it('charges the DELAY too, so a run cannot wait past its time budget', () => {
    const store = new RunRetryUsageStore({ maxRetries: 10, maxDelayBudgetMs: 250 })
    expect(store.admit(run('r'), 200).admitted).toBe(true)
    expect(store.admit(run('r'), 100)).toEqual({ admitted: false, reason: 'delay-budget-exhausted' })
    // The refused delay was not charged either.
    expect(store.usageOf(run('r')).delayMsUsed).toBe(200)
  })

  it('forgets a finished run, so the map does not hold one entry per run forever', () => {
    const store = new RunRetryUsageStore({ maxRetries: 5 })
    store.admit(run('r'), 10)
    store.forget(run('r'))
    expect(store.usageOf(run('r'))).toEqual({ retriesUsed: 0, delayMsUsed: 0 })
  })
})

/**
 * P4-07 Usage stage: a state write is admitted only when a fencing token
 * issued by the store authorizes it (must[1]).
 *
 * The subject is the composition, not either half: `advanceAgentLifecycle`
 * alone admits any epoch at or above the lifecycle's, because nothing issues
 * that epoch. These cases prove the store's check runs first and closes it.
 */

import { describe, expect, it } from 'vitest'
import { advanceAgentLifecycle, advanceAgentLifecycleFenced } from '@deepseek-ai/dsh-agent'
import type { AgentLifecycle, AgentRunId, AgentTransition } from '@deepseek-ai/dsh-agent'
import { LeaseStore } from '../src/store.ts'
import type { WorkerId, WorkItemId } from '../src/types.ts'

const ITEM = 'work-item-1' as WorkItemId
const WORKER_A = 'worker-a' as WorkerId
const WORKER_B = 'worker-b' as WorkerId
const RUN = 'run-1' as AgentRunId

function at(epoch: number): AgentLifecycle {
  return { runId: RUN, state: 'running', epoch }
}

function move(epoch: number): AgentTransition {
  return { from: 'running', to: 'paused', reason: 'test', runId: RUN, epoch }
}

describe('P4-07 must[1]: a state write needs a token the store issued', () => {
  it('CHARACTERIZATION: unfenced, a self-asserted high epoch is admitted and becomes the authority', () => {
    // The gap this stage closes. Nothing issues the lifecycle's epoch --
    // decideTransition refuses only a strictly OLDER one and then adopts
    // whatever the proposal carried. This case exists so the composition below
    // is measured against a real hole rather than an imagined one.
    const result = advanceAgentLifecycle(at(1), move(9_999))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable: asserted ok above')
    expect(result.next.epoch).toBe(9_999)
  })

  it('fenced, that same self-asserted epoch is refused', () => {
    const store = new LeaseStore()
    const acquired = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!acquired.acquired) throw new Error('unreachable')

    const forged = { ...acquired.token, epoch: 9_999 as typeof acquired.token.epoch }
    expect(advanceAgentLifecycleFenced(at(1), move(9_999), forged, store.get(ITEM)))
      .toEqual({ ok: false, reason: 'fenced' })
  })

  it('admits the holder\'s real token, so the check is not refusing everything', () => {
    const store = new LeaseStore()
    const acquired = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!acquired.acquired) throw new Error('unreachable')

    const result = advanceAgentLifecycleFenced(at(0), move(0), acquired.token, store.get(ITEM))
    expect(result).toMatchObject({ ok: true })
  })

  it('refuses the previous holder after the item is reclaimed', () => {
    const store = new LeaseStore()
    const old = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!old.acquired) throw new Error('unreachable')
    store.acquire(ITEM, WORKER_B, 1_001, 1_000)

    // acceptance[0]: the recovered old worker cannot submit or act.
    expect(advanceAgentLifecycleFenced(at(0), move(0), old.token, store.get(ITEM)))
      .toEqual({ ok: false, reason: 'fenced' })
  })

  it('still applies the lifecycle rules once fencing admits the token', () => {
    const store = new LeaseStore()
    const acquired = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!acquired.acquired) throw new Error('unreachable')

    // Fencing is an ADDITIONAL gate, not a replacement: an illegal edge is
    // still refused, and with its own reason rather than 'fenced'.
    const illegal: AgentTransition = { from: 'running', to: 'queued', reason: 'test', runId: RUN, epoch: 0 }
    expect(advanceAgentLifecycleFenced(at(0), illegal, acquired.token, store.get(ITEM)))
      .toEqual({ ok: false, reason: 'illegal-transition' })
  })

  it('reports `fenced` for a token that is BOTH fenced and proposing an illegal edge', () => {
    // Pins the check ORDER. This codebase already applies the principle in
    // decideTransition, whose JSDoc says ordering authority first means "a
    // stale worker never learns whether its proposed edge would have been
    // legal". Running fencing after the lifecycle decision would leak exactly
    // that to a worker with no authority to ask.
    const store = new LeaseStore()
    const old = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!old.acquired) throw new Error('unreachable')
    store.acquire(ITEM, WORKER_B, 1_001, 1_000)

    const illegal: AgentTransition = { from: 'running', to: 'queued', reason: 'test', runId: RUN, epoch: 0 }
    expect(advanceAgentLifecycleFenced(at(0), illegal, old.token, store.get(ITEM)))
      .toEqual({ ok: false, reason: 'fenced' })
  })

  it('refuses when the item holds no lease at all', () => {
    const store = new LeaseStore()
    const acquired = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!acquired.acquired) throw new Error('unreachable')

    expect(advanceAgentLifecycleFenced(at(0), move(0), acquired.token, undefined))
      .toEqual({ ok: false, reason: 'fenced' })
  })
})

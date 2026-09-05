/**
 * P4-07 Fault stage: the fencing and lease boundaries, the audit record a
 * refusal produces, and one case pinning that the unfenced path is still
 * reachable today.
 *
 * Boundaries are enumerated as data and driven by one runner, with the count
 * asserted against a floor, so a boundary cannot be deleted while every
 * remaining case still passes.
 */

import { describe, expect, it } from 'vitest'
import { advanceAgentLifecycle, advanceAgentLifecycleFenced } from '@deepseek-ai/dsh-agent'
import type { AgentLifecycle, AgentRunId, AgentTransition } from '@deepseek-ai/dsh-agent'
import { describeFencingRejection, LeaseStore } from '../src/store.ts'
import { checkFencing, isReclaimable, type FencingToken, type Lease, type LeaseEpoch, type WorkerId, type WorkItemId } from '../src/types.ts'

const ITEM = 'work-item-1' as WorkItemId
const OTHER_ITEM = 'work-item-2' as WorkItemId
const WORKER_A = 'worker-a' as WorkerId
const WORKER_B = 'worker-b' as WorkerId
const RUN = 'run-1' as AgentRunId

function lease(overrides: Partial<Lease> = {}): Lease {
  return { workItem: ITEM, holder: WORKER_A, epoch: 1 as LeaseEpoch, expiresAtMs: 1_000, ...overrides }
}

function token(overrides: Partial<FencingToken> = {}): FencingToken {
  return { workItem: ITEM, epoch: 1 as LeaseEpoch, holder: WORKER_A, ...overrides }
}

/** One enumerated fault boundary and the outcome it must produce. */
interface LeaseFault {
  readonly boundary: string
  readonly run: () => void
}

const MATRIX: readonly LeaseFault[] = [
  {
    boundary: '01 a strictly older epoch is refused as stale',
    run: () => expect(checkFencing(token({ epoch: 0 as LeaseEpoch }), lease()))
      .toEqual({ admitted: false, reason: 'stale-epoch' }),
  },
  {
    boundary: '02 an epoch above the current one is refused, not treated as newer authority',
    run: () => expect(checkFencing(token({ epoch: 99 as LeaseEpoch }), lease()))
      .toEqual({ admitted: false, reason: 'stale-epoch' }),
  },
  {
    boundary: '03 the exact current epoch is admitted, so the check is not refusing everything',
    run: () => expect(checkFencing(token(), lease())).toEqual({ admitted: true }),
  },
  {
    boundary: '04 a token for another work item is refused',
    run: () => expect(checkFencing(token({ workItem: OTHER_ITEM }), lease()))
      .toEqual({ admitted: false, reason: 'wrong-work-item' }),
  },
  {
    boundary: '05 a token from another holder at the current epoch is refused',
    run: () => expect(checkFencing(token({ holder: WORKER_B }), lease()))
      .toEqual({ admitted: false, reason: 'holder-mismatch' }),
  },
  {
    boundary: '06 no lease at all refuses rather than admits',
    run: () => expect(checkFencing(token(), undefined)).toEqual({ admitted: false, reason: 'no-lease' }),
  },
  {
    boundary: '07 a lease is still held AT its expiry instant',
    run: () => expect(isReclaimable(lease({ expiresAtMs: 1_000 }), 1_000)).toBe(false),
  },
  {
    boundary: '08 a lease one millisecond past expiry is reclaimable',
    run: () => expect(isReclaimable(lease({ expiresAtMs: 1_000 }), 1_001)).toBe(true),
  },
  {
    boundary: '09 acquiring is refused while another holder\'s lease is live',
    run: () => {
      const store = new LeaseStore()
      store.acquire(ITEM, WORKER_A, 0, 1_000)
      expect(store.acquire(ITEM, WORKER_B, 500, 1_000)).toEqual({ acquired: false, reason: 'held-by-another' })
    },
  },
  {
    boundary: '10 renewing an expired lease is refused rather than resurrecting it',
    run: () => {
      const store = new LeaseStore()
      const acquired = store.acquire(ITEM, WORKER_A, 0, 1_000)
      if (!acquired.acquired) throw new Error('unreachable')
      expect(store.renew(acquired.token, 1_001, 1_000)).toEqual({ renewed: false, reason: 'already-expired' })
    },
  },
  {
    boundary: '11 renewing on a superseded token is refused',
    run: () => {
      const store = new LeaseStore()
      const first = store.acquire(ITEM, WORKER_A, 0, 1_000)
      if (!first.acquired) throw new Error('unreachable')
      store.acquire(ITEM, WORKER_B, 1_001, 1_000)
      expect(store.renew(first.token, 1_100, 1_000)).toEqual({ renewed: false, reason: 'not-holder' })
    },
  },
  {
    boundary: '12 an unavailable store refuses acquisition instead of reporting the item free',
    run: () => {
      const store = new LeaseStore()
      store.setAvailable(false)
      expect(store.acquire(ITEM, WORKER_A, 0, 1_000)).toEqual({ acquired: false, reason: 'store-unavailable' })
    },
  },
  {
    boundary: '13 an unavailable store offers nothing reclaimable',
    run: () => {
      const store = new LeaseStore()
      store.acquire(ITEM, WORKER_A, 0, 1_000)
      store.setAvailable(false)
      expect(store.reclaimable(1_001)).toEqual([])
    },
  },
  {
    boundary: '14 an unavailable store refuses renewal',
    run: () => {
      const store = new LeaseStore()
      const acquired = store.acquire(ITEM, WORKER_A, 0, 1_000)
      if (!acquired.acquired) throw new Error('unreachable')
      store.setAvailable(false)
      expect(store.renew(acquired.token, 500, 1_000)).toEqual({ renewed: false, reason: 'store-unavailable' })
    },
  },
  {
    boundary: '15 a delayed packet from a reclaimed holder is refused on arrival',
    run: () => {
      // validation[0]'s delayed-packet case: the write was authorized when it
      // was sent and is judged against the lease as it stands on arrival.
      const store = new LeaseStore()
      const inflight = store.acquire(ITEM, WORKER_A, 0, 1_000)
      if (!inflight.acquired) throw new Error('unreachable')
      store.acquire(ITEM, WORKER_B, 1_001, 1_000)
      expect(checkFencing(inflight.token, store.get(ITEM))).toEqual({ admitted: false, reason: 'stale-epoch' })
    },
  },
  {
    boundary: '16 split brain: two holders across a reclaim, only the later one writes',
    run: () => {
      const store = new LeaseStore()
      const a = store.acquire(ITEM, WORKER_A, 0, 1_000)
      if (!a.acquired) throw new Error('unreachable')
      const b = store.acquire(ITEM, WORKER_B, 1_001, 1_000)
      if (!b.acquired) throw new Error('unreachable')
      const admitted = [a.token, b.token].filter(candidate => checkFencing(candidate, store.get(ITEM)).admitted)
      expect(admitted).toEqual([b.token])
    },
  },
]

describe('P4-07 validation[0]: systematic fault matrix', () => {
  it('enumerates at least twelve boundaries, each named once', () => {
    expect(MATRIX.length).toBeGreaterThanOrEqual(12)
    expect(new Set(MATRIX.map(row => row.boundary)).size).toBe(MATRIX.length)
  })

  for (const row of MATRIX) {
    it(`fault boundary ${row.boundary}`, () => { row.run() })
  }
})

describe('P4-07 validation[2]: a refused write produces an audit record', () => {
  it('names who was refused, who was current, and why', () => {
    const record = describeFencingRejection(token({ epoch: 0 as LeaseEpoch }), lease(), 'stale-epoch')

    // An auditor asking "who was fenced out, and by whom" answers from the
    // record alone, without replaying a lease that has since moved on.
    expect(record).toEqual({
      workItem: ITEM,
      rejectedHolder: WORKER_A,
      rejectedEpoch: 0,
      currentHolder: WORKER_A,
      currentEpoch: 1,
      reason: 'stale-epoch',
    })
  })

  it('records the absence of a lease rather than omitting the fields', () => {
    const record = describeFencingRejection(token(), undefined, 'no-lease')

    expect(record.currentHolder).toBeUndefined()
    expect(record.currentEpoch).toBeUndefined()
    expect(record.reason).toBe('no-lease')
  })

  it('carries no field capable of holding key or signature material', () => {
    const record = describeFencingRejection(token(), lease(), 'stale-epoch')

    // The record describes an authorization DECISION. Quoting the token's
    // credentials would leak them into whatever backs the audit chain.
    expect(Object.keys(record).sort())
      .toEqual(['currentEpoch', 'currentHolder', 'reason', 'rejectedEpoch', 'rejectedHolder', 'workItem'])
  })

  it('KNOWN GAP (validation[2]): producing the record is reachable, appending it is not', () => {
    // `TrustKernel.auditAppend` is `(_entry) => {}` and the kernel exposes no
    // read member at all, so an appended entry cannot be observed by anything
    // — including a test. What is proved here is the half that exists: a
    // refusal yields a complete, well-formed record.
    //
    // When a real audit chain lands, this case's comment stops being true and
    // the assertion should be replaced by one that reads the entry back.
    const record = describeFencingRejection(token({ epoch: 0 as LeaseEpoch }), lease(), 'stale-epoch')
    expect(record.reason).toBe('stale-epoch')
  })
})

describe('P4-07 residual: the unfenced entry point is public and still reachable', () => {
  it('CHARACTERIZATION: the same forged proposal is refused when fenced and ADMITTED when not', () => {
    // Two facts, deliberately separated. `decideTransition` adopting the
    // proposal's epoch is permissive but harmless on its own; what makes it
    // REACHABLE is that `advanceAgentLifecycle` is a public export of
    // `@deepseek-ai/dsh-agent`, so any consumer — including a third-party
    // plugin, in a product whose premise is that everything is a plugin —
    // reaches the unfenced path by importing it.
    //
    // A JSDoc on the unfenced function already says it cannot enforce
    // authority. Documentation is not a gate: a consumer need not read it and
    // the compiler will not object. So the reachability is pinned here as a
    // measured fact instead.
    //
    // This case PASSING is the defect. It starts failing when the unfenced
    // export is withdrawn or gated — a P4-05 supersession, not P4-07's to
    // make — and that failure is the unlock signal, not a regression.
    const store = new LeaseStore()
    const acquired = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!acquired.acquired) throw new Error('unreachable')

    const lifecycle: AgentLifecycle = { runId: RUN, state: 'running', epoch: 1 }
    const forgedMove: AgentTransition = { from: 'running', to: 'paused', reason: 'test', runId: RUN, epoch: 9_999 }
    const forgedToken = { ...acquired.token, epoch: 9_999 as LeaseEpoch }

    expect(advanceAgentLifecycleFenced(lifecycle, forgedMove, forgedToken, store.get(ITEM)))
      .toEqual({ ok: false, reason: 'fenced' })

    const unfenced = advanceAgentLifecycle(lifecycle, forgedMove)
    expect(unfenced.ok).toBe(true)
    if (!unfenced.ok) throw new Error('unreachable: asserted ok above')
    expect(unfenced.next.epoch).toBe(9_999)
  })
})

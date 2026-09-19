/**
 * Every store refusal reaches the run under its own name (P2-12 must[2], P4-07).
 *
 * The regression this file exists for: the mapping used to be a ternary whose
 * `else` said `'held-by-another'`, so the emergency stop added to
 * `AcquireDenialReason` arrived at all three production callers — the Run
 * plugin, the workflow engine, and `dsh plugin upgrade` — as "another worker
 * holds this item", with no holder to name. Nothing was red: the two unions are
 * declared separately, so a ternary type-checks however many members the source
 * union grows.
 */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { acquireRunLease } from '../src/run-lease.ts'
import type { AcquireDenialReason, AcquireResult, LeaseStoreContract, WorkerId, WorkItemId } from '../src/types.ts'

const ITEM = brandString<WorkItemId>('run-1')
const WORKER = brandString<WorkerId>('worker-1')
const INCUMBENT = brandString<WorkerId>('worker-2')

/**
 * A store that refuses everything with one reason.
 * @param reason - the refusal to answer `acquire` with.
 * @returns a store whose other methods are never reached by these cases.
 */
function refusing(reason: AcquireDenialReason): LeaseStoreContract {
  const acquire = (): AcquireResult => reason === 'held-by-another'
    ? { acquired: false, reason, holder: INCUMBENT }
    : { acquired: false, reason }
  return { acquire } as unknown as LeaseStoreContract
}

describe('P2-12 must[2]: a stop is carried to the run as a stop', () => {
  it('names the stop rather than an owner, because no owner exists to name', () => {
    const taken = acquireRunLease(refusing('stopped'), ITEM, WORKER, 1_000, 30_000)
    expect(taken).toEqual({ denied: { reason: 'stopped' } })
  })

  it('still names the holder when one really holds the item', () => {
    // The positive control for the case above: had the mapping stayed a
    // ternary, BOTH cases would pass this shape and only this one would be
    // true.
    const taken = acquireRunLease(refusing('held-by-another'), ITEM, WORKER, 1_000, 30_000)
    expect(taken).toEqual({ denied: { reason: 'held-by-another', holder: INCUMBENT } })
  })

  it('still reports an unreachable store as an outage', () => {
    const taken = acquireRunLease(refusing('store-unavailable'), ITEM, WORKER, 1_000, 30_000)
    expect(taken).toEqual({ denied: { reason: 'store-unavailable' } })
  })
})

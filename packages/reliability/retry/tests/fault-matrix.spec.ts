/**
 * Epic P4-11 Fault stage: the retry decision boundaries, enumerated as data.
 *
 * The count is asserted so a silently dropped row fails rather than shrinking
 * the matrix in silence, following P4-08.F and P2-04.F.
 *
 * Two boundaries the plan proposed are absent because they cannot happen, and
 * that is recorded rather than papered over: the budget store has no
 * persistence to corrupt, and `admit` is synchronous with no read/write pair a
 * caller could await between. The second is kept in a different form — the
 * last row asserts the CONTRACT that makes the race impossible, since what
 * would reintroduce it is a refactor to `usageOf` + `record`.
 */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { RunId } from '@deepseek-ai/dsh-principal/types'

import {
  chargedRun,
  classifyFailure,
  RunRetryUsageStore,
  spendsRetryBudget,
  type FailureFacts,
  type RetryVerdict,
} from '@deepseek-ai/dsh-retry'

const run = (name: string): RunId => brandString<RunId>(name)

/** One classification boundary: what was observed, and the verdict it earns. */
interface ClassifyBoundary {
  readonly name: string
  readonly facts: FailureFacts
  readonly verdict: RetryVerdict
}

const CLASSIFY_BOUNDARIES: readonly ClassifyBoundary[] = [
  {
    name: '01 a 4xx that is not 408 or 429 is permanent, and names client-error',
    facts: { status: 404 },
    verdict: { retryable: false, reason: 'client-error' },
  },
  {
    name: '02 408 is retryable, so "4xx" is not read as "never"',
    facts: { status: 408 },
    verdict: { retryable: true },
  },
  {
    name: '03 429 is retryable for the same reason: it names a next attempt',
    facts: { status: 429 },
    verdict: { retryable: true },
  },
  {
    name: '04 a malformed request is invalid-input, not client-error',
    facts: { status: 400, malformed: true },
    verdict: { retryable: false, reason: 'invalid-input' },
  },
  {
    name: '05 a policy denial is policy-denied, distinct again',
    facts: { denied: true },
    verdict: { retryable: false, reason: 'policy-denied' },
  },
  {
    name: '06 a side-effecting attempt with NO ledger verdict is refused',
    facts: { sideEffecting: true, status: 503 },
    verdict: { retryable: false, reason: 'effect-unsettled' },
  },
  {
    name: '07 sent is refused: the request left and no receipt came back',
    facts: { sideEffecting: true, ledger: 'sent', status: 503 },
    verdict: { retryable: false, reason: 'effect-unsettled' },
  },
  {
    name: '08 prepared is admitted: the request never left',
    facts: { sideEffecting: true, ledger: 'prepared', status: 503 },
    verdict: { retryable: true },
  },
  {
    name: '09 compensated is admitted: the effect happened and was undone',
    facts: { sideEffecting: true, ledger: 'compensated', status: 503 },
    verdict: { retryable: true },
  },
  {
    name: '10 a 5xx with no side effect is retryable, so the ledger gate is scoped to effects',
    facts: { status: 503 },
    verdict: { retryable: true },
  },
  {
    name: '11 a failure carrying NO status at all is retryable — a timeout reaches here',
    facts: {},
    verdict: { retryable: true },
  },
  {
    name: '12 malformed outranks the ledger, because the request is wrong either way',
    facts: { malformed: true, sideEffecting: true, ledger: 'prepared' },
    verdict: { retryable: false, reason: 'invalid-input' },
  },
]

describe('P4-11 Fault — retry decision boundary matrix', () => {
  it('enumerates at least twelve classification boundaries, each named once', () => {
    expect(CLASSIFY_BOUNDARIES.length).toBeGreaterThanOrEqual(12)
    expect(new Set(CLASSIFY_BOUNDARIES.map(boundary => boundary.name)).size).toBe(CLASSIFY_BOUNDARIES.length)
  })

  it.each(CLASSIFY_BOUNDARIES.map(boundary => [boundary.name, boundary] as const))(
    'fault boundary %s',
    (_name, boundary) => {
      expect(classifyFailure(boundary.facts)).toEqual(boundary.verdict)
    },
  )

  it('fault boundary 13 a hedged attempt spends no budget, and a retry does', () => {
    expect(spendsRetryBudget({ hedged: true })).toBe(false)
    expect(spendsRetryBudget({})).toBe(true)
  })

  it('fault boundary 14 maxRetries 0 forbids retrying, rather than meaning unlimited', () => {
    const store = new RunRetryUsageStore({ maxRetries: 0 })
    expect(store.admit(run('r'), 1)).toEqual({ admitted: false, reason: 'retry-cap-reached' })
  })

  it('fault boundary 15 the delay budget refuses AT the boundary, and the refusal costs nothing', () => {
    const store = new RunRetryUsageStore({ maxRetries: 10, maxDelayBudgetMs: 100 })
    expect(store.admit(run('r'), 100).admitted).toBe(true)
    // One millisecond past the total is refused, and the refused delay is not
    // charged: a run that was told "no" has not waited.
    expect(store.admit(run('r'), 1)).toEqual({ admitted: false, reason: 'delay-budget-exhausted' })
    expect(store.usageOf(run('r'))).toEqual({ retriesUsed: 1, delayMsUsed: 100 })
  })

  it('fault boundary 16 the walk stops at the furthest ancestor this process can see', () => {
    expect(chargedRun('leaf', id => ({
      leaf: { parentSession: 'visible', runId: run('run-leaf') },
      visible: { parentSession: 'gone-elsewhere', runId: run('run-visible') },
    })[id])).toBe(run('run-visible'))
  })

  it('fault boundary 17 a circular chain terminates instead of hanging the retry', () => {
    expect(() => chargedRun('a', id => ({
      a: { parentSession: 'b', runId: run('a') },
      b: { parentSession: 'a', runId: run('b') },
    })[id])).not.toThrow()
  })

  it('fault boundary 18 a resolved charge is remembered, so a vanished parent cannot reset it', () => {
    // The boundary the F stage found in what the Usage stage landed. The
    // resolver is asked ONCE; a second ask that returned the child's own run --
    // which is what re-walking a chain with a disposed parent does -- must not
    // reach the store at all.
    const store = new RunRetryUsageStore({ maxRetries: 5 })
    let asks = 0
    const resolveFirst = (): RunId | undefined => { asks += 1; return run('parent-run') }
    expect(store.chargedRunFor('child', resolveFirst)).toBe(run('parent-run'))
    expect(store.chargedRunFor('child', () => run('child-own-run'))).toBe(run('parent-run'))
    expect(asks).toBe(1)
  })

  it('fault boundary 19 an unresolvable charge is remembered too, so a broken chain is not re-walked', () => {
    const store = new RunRetryUsageStore({ maxRetries: 5 })
    let asks = 0
    expect(store.chargedRunFor('orphan', () => { asks += 1; return undefined })).toBeUndefined()
    expect(store.chargedRunFor('orphan', () => run('appeared-later'))).toBeUndefined()
    expect(asks).toBe(1)
  })

  it('fault boundary 20 the store exposes no read/write pair, which is why no update can be lost', () => {
    // The concurrency boundary, asserted as a CONTRACT rather than simulated.
    // `admit` decides and stores in one synchronous call, so there is no
    // instant at which a caller holds a usage and has not yet written its
    // successor. What would reintroduce the race is a refactor to
    // `usageOf` + `record`, and this row is what would notice it.
    const store = new RunRetryUsageStore({ maxRetries: 5 })
    expect('record' in store).toBe(false)
    expect('setUsage' in store).toBe(false)
    expect(typeof store.admit(run('r'), 1)).toBe('object')
    // `usageOf` is read-only reporting: what it returns cannot be written back.
    expect(Object.keys(store.usageOf(run('r')))).toEqual(['retriesUsed', 'delayMsUsed'])
  })
})

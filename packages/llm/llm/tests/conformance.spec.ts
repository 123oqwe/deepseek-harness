/**
 * P9-01 Contract — the conformance registration gate.
 *
 * The rule the whole gate rests on is that an ABSENT result denies. A route
 * that skipped a behaviour and a route that handles it correctly are
 * indistinguishable from their result sets unless absence is a denial, so most
 * of these cases exist to pin that from both directions.
 */
import { describe, expect, it } from 'vitest'

import {
  REQUIRED_BEHAVIORS,
  admitConformantRoute,
  extraBehaviors,
} from '../src/conformance.ts'
import type { ConformanceBehavior, ConformanceOutcome } from '../src/conformance.ts'

const allPassing = (): ConformanceOutcome[] =>
  REQUIRED_BEHAVIORS.map(behavior => ({ behavior, passed: true, cases: 3 }))

describe('P9-01 Contract — conformance registration gate', () => {
  it('must[1]: a route demonstrating every behaviour is admitted', () => {
    expect(admitConformantRoute(allPassing())).toStrictEqual({ admitted: true })
  })

  it('must[1]: a MISSING behaviour denies — untested is not passed', () => {
    const partial = allPassing().filter(outcome => outcome.behavior !== 'mid-stream-abort')
    expect(admitConformantRoute(partial)).toStrictEqual({
      admitted: false,
      reason: 'behavior-not-demonstrated',
      behaviors: ['mid-stream-abort'],
    })
  })

  it('must[1]: an EMPTY result set denies, naming every required behaviour', () => {
    const decision = admitConformantRoute([])
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.reason).toBe('behavior-not-demonstrated')
    expect(decision.behaviors).toStrictEqual(REQUIRED_BEHAVIORS)
  })

  it('must[1]: a failing behaviour denies and names it', () => {
    const outcomes = allPassing().map(outcome =>
      outcome.behavior === 'usage-accounting' ? { ...outcome, passed: false } : outcome,
    )
    expect(admitConformantRoute(outcomes)).toStrictEqual({
      admitted: false,
      reason: 'behavior-failed',
      behaviors: ['usage-accounting'],
    })
  })

  it('a behaviour that PASSED over zero cases denies as vacuous, since it demonstrated nothing', () => {
    const outcomes = allPassing().map(outcome =>
      outcome.behavior === 'parallel-tool-calls' ? { ...outcome, cases: 0 } : outcome,
    )
    expect(admitConformantRoute(outcomes)).toStrictEqual({
      admitted: false,
      reason: 'behavior-vacuous',
      behaviors: ['parallel-tool-calls'],
    })
  })

  it('a FAILING behaviour over zero cases is reported as failed, not vacuous — it already denies on its merits', () => {
    const outcomes = allPassing().map(outcome =>
      outcome.behavior === 'parallel-tool-calls' ? { ...outcome, passed: false, cases: 0 } : outcome,
    )
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.reason).toBe('behavior-failed')
  })

  it('reports missing behaviours BEFORE failures, so a half-tested route is told the bigger problem first', () => {
    const outcomes = allPassing()
      .filter(outcome => outcome.behavior !== 'mid-stream-abort')
      .map(outcome => (outcome.behavior === 'usage-accounting' ? { ...outcome, passed: false } : outcome))
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.reason).toBe('behavior-not-demonstrated')
  })

  it('reports every missing behaviour at once, in REQUIRED_BEHAVIORS order rather than input order', () => {
    const decision = admitConformantRoute([
      { behavior: 'usage-accounting', passed: true, cases: 1 },
      { behavior: 'parallel-tool-calls', passed: true, cases: 1 },
    ])
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.behaviors).toStrictEqual([
      'streaming-tool-call-deltas',
      'mid-stream-abort',
      'error-retry-classification',
      'oversized-input-rejection',
    ])
  })

  it('a duplicated behaviour takes its LAST result, so a re-run supersedes rather than accumulates', () => {
    const outcomes: ConformanceOutcome[] = [
      ...allPassing(),
      { behavior: 'mid-stream-abort', passed: false, cases: 2 },
    ]
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.behaviors).toStrictEqual(['mid-stream-abort'])
  })

  it('every required behaviour is individually load-bearing: dropping any one of the six denies', () => {
    for (const dropped of REQUIRED_BEHAVIORS) {
      const partial = allPassing().filter(outcome => outcome.behavior !== dropped)
      const decision = admitConformantRoute(partial)
      expect(decision.admitted, `dropping ${dropped} must deny`).toBe(false)
      if (decision.admitted) continue
      expect(decision.behaviors).toStrictEqual([dropped])
    }
  })

  it('the required set is exactly the six behaviours must[0] enumerates, each named once', () => {
    expect(REQUIRED_BEHAVIORS).toHaveLength(6)
    expect(new Set(REQUIRED_BEHAVIORS).size).toBe(6)
  })
})

describe('extraBehaviors', () => {
  it('reports a behaviour beyond the required set without denying, so a growing kit does not fail the gate', () => {
    const outcomes = [
      ...allPassing(),
      { behavior: 'reasoning-deltas' as ConformanceBehavior, passed: true, cases: 1 },
    ]
    expect(admitConformantRoute(outcomes)).toStrictEqual({ admitted: true })
    expect(extraBehaviors(outcomes)).toStrictEqual(['reasoning-deltas'])
  })

  it('reports nothing when a route demonstrates exactly the required set', () => {
    expect(extraBehaviors(allPassing())).toStrictEqual([])
  })
})

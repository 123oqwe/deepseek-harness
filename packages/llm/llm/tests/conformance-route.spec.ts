/**
 * P9-01 Provider — the complete kit, and the first route it can admit.
 *
 * The C stage's gate could deny but never admit, because no kit demonstrated
 * all six behaviours. The first case here is that a correct route is now
 * ADMITTED — which is what makes every denial below meaningful rather than
 * merely the gate's only possible answer.
 */
import { describe, expect, it } from 'vitest'

import { admitConformantRoute } from '../src/conformance.ts'
import { runAllProbes } from '../src/conformance-probes.ts'
import { createScriptedRoute } from '../src/conformance-route.ts'

describe('P9-01 Provider — the complete conformance kit', () => {
  it('a correct route demonstrates all six behaviours and is ADMITTED', async () => {
    const outcomes = await runAllProbes(createScriptedRoute())
    expect(outcomes).toHaveLength(6)
    expect(outcomes.every(outcome => outcome.passed)).toBe(true)
    expect(admitConformantRoute(outcomes)).toStrictEqual({ admitted: true })
  })

  it('a route that emits whole tool calls without deltas is denied on merging', async () => {
    const outcomes = await runAllProbes(createScriptedRoute({ noToolCallDeltas: true }))
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.behaviors).toStrictEqual(['streaming-tool-call-deltas'])
  })

  it('a route that drops the second of two tool calls is denied on parallel calls', async () => {
    const outcomes = await runAllProbes(createScriptedRoute({ dropsSecondToolCall: true }))
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.behaviors).toStrictEqual(['parallel-tool-calls'])
  })

  it('a cancelled request reported as `stop` is denied: the caller cannot tell it from a normal finish', async () => {
    const outcomes = await runAllProbes(createScriptedRoute({ abortReportsStop: true }))
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.behaviors).toStrictEqual(['mid-stream-abort'])
  })

  it('a failure carrying no code is denied: llm-retry routes on the code and cannot route on nothing', async () => {
    const outcomes = await runAllProbes(createScriptedRoute({ failureWithoutCode: true }))
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.behaviors).toStrictEqual(['error-retry-classification'])
  })

  it('a route that TRUNCATES an over-long input and finishes normally is denied', async () => {
    // The dangerous failure is not an error, it is a confident answer to a
    // question the caller did not ask.
    const outcomes = await runAllProbes(createScriptedRoute({ truncatesOversizedInput: true }))
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.behaviors).toStrictEqual(['oversized-input-rejection'])
  })

  it('a scenario the route cannot stage leaves its behaviour ABSENT, and absence denies', async () => {
    const outcomes = await runAllProbes(createScriptedRoute({ cannotStage: ['oversized-input'] }))
    expect(outcomes).toHaveLength(5)
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.reason).toBe('behavior-not-demonstrated')
    expect(decision.behaviors).toStrictEqual(['oversized-input-rejection'])
  })

  it('each defect is independent: breaking one behaviour denies on that one alone', async () => {
    const defects = [
      ['noToolCallDeltas', 'streaming-tool-call-deltas'],
      ['dropsSecondToolCall', 'parallel-tool-calls'],
      ['noUsage', 'usage-accounting'],
      ['abortReportsStop', 'mid-stream-abort'],
      ['failureWithoutCode', 'error-retry-classification'],
      ['truncatesOversizedInput', 'oversized-input-rejection'],
    ] as const
    for (const [defect, behavior] of defects) {
      const decision = admitConformantRoute(await runAllProbes(createScriptedRoute({ [defect]: true })))
      expect(decision.admitted, `${defect} must deny`).toBe(false)
      if (decision.admitted) continue
      expect(decision.behaviors, `${defect} must name only ${behavior}`).toStrictEqual([behavior])
    }
  })
})

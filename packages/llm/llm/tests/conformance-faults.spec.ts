/**
 * P9-01 Fault — the injections the epic's Validation clause names.
 *
 * Two families, both chosen because they are the ones a provider varies without
 * telling anyone: WHERE a cancellation lands, and HOW the transport framed the
 * bytes. Neither is part of any contract, so a kit that only works for one
 * framing or one abort point would pass today and fail on a provider's next
 * deploy.
 */
import { describe, expect, it } from 'vitest'

import { admitConformantRoute } from '../src/conformance.ts'
import { runAllProbes } from '../src/conformance-probes.ts'
import { createScriptedRoute, splitArguments } from '../src/conformance-route.ts'
import type { AbortTiming, DeltaFraming } from '../src/conformance-route.ts'

const TIMINGS: AbortTiming[] = ['before-first-token', 'mid-tool-call-delta', 'at-wrap-up']
const FRAMINGS: DeltaFraming[] = ['natural', 'single-character', 'single-frame', 'split-multibyte']

describe('P9-01 Fault — abort timing, all three points', () => {
  it.each(TIMINGS)('a correct route aborted %s is still admitted', async (abortTiming) => {
    const outcomes = await runAllProbes(createScriptedRoute({ abortTiming }))
    expect(admitConformantRoute(outcomes)).toStrictEqual({ admitted: true })
  })

  it.each(TIMINGS)('a route reporting stop instead of aborted is denied at %s, so no timing hides the defect', async (abortTiming) => {
    const outcomes = await runAllProbes(createScriptedRoute({ abortTiming, abortReportsStop: true }))
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.behaviors).toStrictEqual(['mid-stream-abort'])
  })

  it('aborting before the first token still ends the stream, rather than emitting nothing at all', async () => {
    const outcomes = await runAllProbes(createScriptedRoute({ abortTiming: 'before-first-token' }))
    expect(outcomes.find(outcome => outcome.behavior === 'mid-stream-abort')?.cases).toBe(1)
  })
})

describe('P9-01 Fault — delta framing', () => {
  it.each(FRAMINGS)('merging survives %s framing, since framing is not a contract', async (framing) => {
    const outcomes = await runAllProbes(createScriptedRoute({ framing }))
    expect(admitConformantRoute(outcomes)).toStrictEqual({ admitted: true })
  })

  it.each(FRAMINGS)('a route that drops deltas is still caught under %s framing', async (framing) => {
    const outcomes = await runAllProbes(createScriptedRoute({ framing, noToolCallDeltas: true }))
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.behaviors).toStrictEqual(['streaming-tool-call-deltas'])
  })

  it('every framing reassembles to the identical arguments, which is the property merging depends on', () => {
    const args = '{"path":"a"}'
    for (const framing of FRAMINGS) {
      expect(splitArguments(args, framing).join(''), framing).toBe(args)
    }
  })

  it('single-character framing really does split into one piece per character, not one frame', () => {
    expect(splitArguments('{"a":1}', 'single-character')).toHaveLength(7)
    expect(splitArguments('{"a":1}', 'single-frame')).toHaveLength(1)
  })

  it('a multibyte split reassembles too: pieces may be individually invalid so long as the join is not', () => {
    const args = '{"path":"日本"}'
    const pieces = splitArguments(args, 'split-multibyte')
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.join('')).toBe(args)
  })
})

describe('P9-01 Fault — the six injections acceptance[1] requires', () => {
  it('one fixture deviation per behaviour, each reddening exactly its own', async () => {
    const injections = [
      ['noToolCallDeltas', 'streaming-tool-call-deltas'],
      ['dropsSecondToolCall', 'parallel-tool-calls'],
      ['noUsage', 'usage-accounting'],
      ['abortReportsStop', 'mid-stream-abort'],
      ['failureWithoutCode', 'error-retry-classification'],
      ['truncatesOversizedInput', 'oversized-input-rejection'],
    ] as const
    for (const [injection, behavior] of injections) {
      const decision = admitConformantRoute(await runAllProbes(createScriptedRoute({ [injection]: true })))
      expect(decision.admitted, injection).toBe(false)
      if (decision.admitted) continue
      expect(decision.behaviors, injection).toStrictEqual([behavior])
    }
  })
})

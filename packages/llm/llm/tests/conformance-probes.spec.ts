/**
 * P9-01 Provider — the probes, and the end-to-end fact that an INCOMPLETE kit
 * denies the route it examines.
 *
 * The last describe block is the point of the stage: a perfectly conformant
 * stream still fails registration, because three behaviours need the request
 * path this kit does not have yet. A kit that greened the route on three of six
 * would be the vacuous pass the gate was written to reject.
 */
import { describe, expect, it } from 'vitest'

import { admitConformantRoute } from '../src/conformance.ts'
import { deltasMergeIntoFinalCalls, observeStream, runStreamProbes } from '../src/conformance-probes.ts'
import type { StreamChunk } from '../src/types.ts'

const toolCall = (index: number, id: string, name: string, args: string): StreamChunk[] => [
  { type: 'block-start', index, blockType: 'tool-call' },
  { type: 'tool-call-delta', index, id, name, argumentsDelta: args.slice(0, 4) } as StreamChunk,
  { type: 'tool-call-delta', index, id, argumentsDelta: args.slice(4) } as StreamChunk,
  { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } } as StreamChunk,
]

async function* stream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) yield chunk
}

const CONFORMANT: StreamChunk[] = [
  ...toolCall(0, 'call_a', 'read', '{"path":"a"}'),
  ...toolCall(1, 'call_b', 'read', '{"path":"b"}'),
  { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } } as StreamChunk,
  { type: 'finish', reason: { kind: 'tool-calls' } } as StreamChunk,
]

describe('P9-01 Provider — stream probes', () => {
  it('a conformant stream passes all three stream-observable behaviours', async () => {
    const outcomes = await runStreamProbes(stream(CONFORMANT))
    expect(outcomes.every(outcome => outcome.passed)).toBe(true)
    expect(outcomes.map(outcome => outcome.behavior)).toStrictEqual([
      'streaming-tool-call-deltas',
      'parallel-tool-calls',
      'usage-accounting',
    ])
  })

  it('a dropped delta fails merging, which a caller cannot detect after the stream is consumed', async () => {
    const broken = CONFORMANT.filter(
      chunk => !(chunk.type === 'tool-call-delta' && chunk.index === 0 && chunk.argumentsDelta === '{"pa'),
    )
    const outcomes = await runStreamProbes(stream(broken))
    expect(outcomes.find(outcome => outcome.behavior === 'streaming-tool-call-deltas')?.passed).toBe(false)
  })

  it('an adapter that emits whole calls and never streams deltas FAILS rather than passes vacuously', async () => {
    const noDeltas = CONFORMANT.filter(chunk => chunk.type !== 'tool-call-delta')
    const outcomes = await runStreamProbes(stream(noDeltas))
    expect(outcomes.find(outcome => outcome.behavior === 'streaming-tool-call-deltas')?.passed).toBe(false)
  })

  it('a single tool call fails parallel-tool-calls, since one cannot show the second is not dropped', async () => {
    const single = [
      ...toolCall(0, 'call_a', 'read', '{"path":"a"}'),
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } as StreamChunk,
      { type: 'finish', reason: { kind: 'tool-calls' } } as StreamChunk,
    ]
    const outcomes = await runStreamProbes(stream(single))
    const parallel = outcomes.find(outcome => outcome.behavior === 'parallel-tool-calls')
    expect(parallel?.passed).toBe(false)
    expect(parallel?.cases).toBe(1)
  })

  it('a stream with no usage chunk fails accounting rather than reporting silence as success', async () => {
    const noUsage = CONFORMANT.filter(chunk => chunk.type !== 'usage')
    const outcomes = await runStreamProbes(stream(noUsage))
    expect(outcomes.find(outcome => outcome.behavior === 'usage-accounting')?.passed).toBe(false)
  })

  it('an empty stream reports zero cases, so no probe can claim a pass over nothing', async () => {
    const outcomes = await runStreamProbes(stream([]))
    expect(outcomes.every(outcome => outcome.cases === 0)).toBe(true)
    expect(outcomes.every(outcome => !outcome.passed)).toBe(true)
  })

  it('observeStream concatenates deltas per block index rather than across the whole stream', async () => {
    const observation = await observeStream(stream(CONFORMANT))
    expect(observation.deltasByIndex.get(0)).toBe('{"path":"a"}')
    expect(observation.deltasByIndex.get(1)).toBe('{"path":"b"}')
  })

  it('deltasMergeIntoFinalCalls rejects an observation with no completed tool call', () => {
    expect(deltasMergeIntoFinalCalls({
      deltasByIndex: new Map(), finalByIndex: new Map(), toolCallBlocks: 0, sawUsage: true, sawFinish: true,
    })).toBe(false)
  })
})

describe('P9-01 Provider — an incomplete kit denies the route it examines', () => {
  it('a fully conformant stream STILL fails registration, because three behaviours were never demonstrated', async () => {
    const outcomes = await runStreamProbes(stream(CONFORMANT))
    const decision = admitConformantRoute(outcomes)
    expect(decision.admitted).toBe(false)
    if (decision.admitted) return
    expect(decision.reason).toBe('behavior-not-demonstrated')
    expect(decision.behaviors).toStrictEqual([
      'mid-stream-abort',
      'error-retry-classification',
      'oversized-input-rejection',
    ])
  })
})

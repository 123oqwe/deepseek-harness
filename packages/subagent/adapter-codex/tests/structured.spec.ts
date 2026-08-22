import { describe, it, expect } from 'vitest'
import { mapEvents, createContinuation, buildProviderResult } from '../src/index.ts'
import type { ProviderEvent } from '../src/types.ts'

function makeEvents(types: string[]): ProviderEvent[] {
  return types.map((t, i) => ({ type: t, data: { i }, timestamp: Date.now() + i }))
}

describe('P5 Adapter: map-events & continuation', () => {
  it('maps known event types', () => {
    const events = makeEvents(['progress', 'tool_use', 'tool_result', 'diff', 'usage', 'completed'])
    const mapped = mapEvents(events)
    expect(mapped).toHaveLength(6)
    expect(mapped[1]?.type).toBe('tool_request')
    expect(mapped[2]?.type).toBe('tool_result')
  })

  it('maps unknown event types to progress', () => {
    const events = makeEvents(['unknown_type'])
    const mapped = mapEvents(events)
    expect(mapped[0]?.type).toBe('progress')
  })

  it('creates continuation token', () => {
    const token = createContinuation('codex', 'thread-1', 'turn-1', 'resume-abc')
    expect(token.providerId).toBe('codex')
    expect(token.resumeToken).toBe('resume-abc')
  })

  it('builds provider result with usage and artifacts', () => {
    const events = mapEvents(makeEvents(['progress', 'completed']))
    const result = buildProviderResult('done', events, 100, 50, ['art-1'])
    expect(result.answer).toBe('done')
    expect(result.usage.inputTokens).toBe(100)
    expect(result.usage.outputTokens).toBe(50)
    expect(result.artifacts).toContain('art-1')
  })

  it('builds provider result with continuation', () => {
    const token = createContinuation('codex', 't1', 'turn-1', 'resume')
    const result = buildProviderResult('partial', [], 50, 25, [], token)
    expect(result.continuation?.resumeToken).toBe('resume')
  })

  it('mapped events have unique IDs', () => {
    const events = makeEvents(['progress', 'progress', 'progress'])
    const mapped = mapEvents(events)
    const ids = new Set(mapped.map(m => m.childEventId))
    expect(ids.size).toBe(3)
  })

  it('handles empty events', () => {
    expect(mapEvents([])).toHaveLength(0)
  })

  it('preserves event data', () => {
    const events = makeEvents(['diff'])
    const mapped = mapEvents(events)
    expect(mapped[0]?.data).toEqual({ i: 0 })
  })
})

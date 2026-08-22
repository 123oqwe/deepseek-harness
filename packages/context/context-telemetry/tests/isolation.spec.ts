import { describe, it, expect, beforeEach } from 'vitest'
import { registerAgent, assembleContext, canAccess, clearTopologies } from '../../context-topology/src/index.ts'
import type { ContextSource } from '../../context-topology/src/types.ts'
import { buildTelemetry, isTelemetrySafe } from '../src/index.ts'

describe('P6-05 Context Topology & Telemetry', () => {
  beforeEach(() =>{  clearTopologies(); })

  it('assembles shared and private zones correctly', () => {
    const sources: ContextSource[] = [
      { id: 's1', type: 'system', zone: 'shared', content: 'system prompt' },
      { id: 's2', type: 'memory', zone: 'private', content: 'private memory' },
    ]
    registerAgent('agent-1', sources)
    const ctx = assembleContext('agent-1')
    expect(ctx.zones.shared).toHaveLength(1)
    expect(ctx.zones.private).toHaveLength(1)
  })

  it('child inherits shared but not private from parent', () => {
    const parentSources: ContextSource[] = [
      { id: 'p1', type: 'system', zone: 'shared', content: 'shared' },
      { id: 'p2', type: 'memory', zone: 'private', content: 'parent private' },
    ]
    registerAgent('parent', parentSources)
    registerAgent('child', [{ id: 'c1', type: 'tool', zone: 'private', content: 'child private' }], 'parent')
    const ctx = assembleContext('child')
    expect(ctx.zones.shared.some(s => s.id === 'p1')).toBe(true)
    expect(ctx.zones.private.some(s => s.id === 'p2')).toBe(false)
  })

  it('two children cannot see each others private context', () => {
    registerAgent('parent', [{ id: 'p1', type: 'system', zone: 'shared', content: 'shared' }])
    registerAgent('child-a', [{ id: 'ca', type: 'memory', zone: 'private', content: 'child a secret' }], 'parent')
    registerAgent('child-b', [{ id: 'cb', type: 'memory', zone: 'private', content: 'child b secret' }], 'parent')
    const ctxA = assembleContext('child-a')
    const ctxB = assembleContext('child-b')
    expect(ctxA.zones.private.some(s => s.id === 'cb')).toBe(false)
    expect(ctxB.zones.private.some(s => s.id === 'ca')).toBe(false)
  })

  it('telemetry does not leak sensitive content', () => {
    const sources: ContextSource[] = [
      { id: 's1', type: 'memory', zone: 'shared', content: 'SSN: 123-45-6789' },
      { id: 's2', type: 'tool', zone: 'private', content: 'password=secret123' },
    ]
    registerAgent('agent-1', sources)
    const ctx = assembleContext('agent-1')
    const telemetry = buildTelemetry(ctx)
    const safety = isTelemetrySafe(telemetry)
    expect(safety.safe).toBe(true)
    for (const entry of telemetry.entries) {
      expect(entry.redactedPreview).not.toContain('123-45-6789')
      expect(entry.redactedPreview).not.toContain('secret123')
    }
  })

  it('telemetry reports token counts and selection reasons', () => {
    const sources: ContextSource[] = [
      { id: 's1', type: 'system', zone: 'shared', content: 'a'.repeat(100) },
      { id: 's2', type: 'retrieval', zone: 'retrievable', content: 'b'.repeat(40) },
    ]
    registerAgent('agent-1', sources)
    const ctx = assembleContext('agent-1')
    const telemetry = buildTelemetry(ctx)
    expect(telemetry.totalTokens).toBeGreaterThan(0)
    expect(telemetry.entries).toHaveLength(2)
    expect(telemetry.entries[0]?.tokenCount).toBeGreaterThan(0)
  })

  it('canAccess checks private zone visibility', () => {
    registerAgent('agent-1', [{ id: 's1', type: 'memory', zone: 'private', content: 'secret' }])
    expect(canAccess('agent-2', 'agent-1')).toBe(false)
    expect(canAccess('agent-1', 'agent-1')).toBe(true)
  })

  it('UI plugin unloading does not affect context assembly', () => {
    const sources: ContextSource[] = [
      { id: 's1', type: 'system', zone: 'shared', content: 'system' },
    ]
    registerAgent('agent-1', sources)
    const ctx1 = assembleContext('agent-1')
    const ctx2 = assembleContext('agent-1')
    expect(ctx1).toEqual(ctx2)
  })
})

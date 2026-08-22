import { describe, it, expect } from 'vitest'
import { compilePrompt, getCapability } from '../src/index.ts'

describe('P5-03 Prompt Compiler', () => {
  it('compiles for OpenAI with all features', () => {
    const result = compilePrompt({
      systemPrompt: 'You are helpful', userPrompt: 'Hello',
      toolDefinitions: ['tool1'], stopSequences: ['END'], jsonMode: true,
    }, 'openai')
    expect(result.systemPrompt).toBe('You are helpful')
    expect(result.toolDefinitions).toHaveLength(1)
    expect(result.jsonMode).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('adapts for local provider without system prompt', () => {
    const result = compilePrompt({
      systemPrompt: 'System', userPrompt: 'User',
      toolDefinitions: [], stopSequences: [], jsonMode: false,
    }, 'local')
    expect(result.systemPrompt).toBe('')
    expect(result.userPrompt).toContain('System')
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('drops tool definitions for unsupported provider', () => {
    const result = compilePrompt({
      systemPrompt: '', userPrompt: 'Hello',
      toolDefinitions: ['tool1'], stopSequences: [], jsonMode: false,
    }, 'local')
    expect(result.toolDefinitions).toHaveLength(0)
    expect(result.warnings.some(w => w.includes('Tool'))).toBe(true)
  })

  it('drops JSON mode for unsupported provider', () => {
    const result = compilePrompt({
      systemPrompt: '', userPrompt: 'Hello',
      toolDefinitions: [], stopSequences: [], jsonMode: true,
    }, 'anthropic')
    expect(result.jsonMode).toBe(false)
    expect(result.warnings.some(w => w.includes('JSON'))).toBe(true)
  })

  it('truncates stop sequences', () => {
    const result = compilePrompt({
      systemPrompt: '', userPrompt: 'Hello',
      toolDefinitions: [], stopSequences: ['A', 'B', 'C', 'D', 'E'], jsonMode: false,
    }, 'local')
    expect(result.stopSequences.length).toBeLessThanOrEqual(2)
    expect(result.warnings.some(w => w.includes('truncat'))).toBe(true)
  })

  it('getCapability returns provider info', () => {
    const caps = getCapability('openai')
    expect(caps.supportsToolCalls).toBe(true)
    expect(caps.maxContextTokens).toBeGreaterThan(0)
  })

  it('same input produces same output for same provider', () => {
    const input = { systemPrompt: 'S', userPrompt: 'U', toolDefinitions: ['t'], stopSequences: ['X'], jsonMode: true }
    const r1 = compilePrompt(input, 'openai')
    const r2 = compilePrompt(input, 'openai')
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })
})

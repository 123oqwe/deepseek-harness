import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { addRule, evaluate, clearRules } from '../src/index.ts'

describe('P2-05 Policy Decision Service with Monotonic Deny', () => {
  beforeEach(() =>{  clearRules() })
  afterEach(() =>{  clearRules() })

  it('kernel deny is monotonic and cannot be overridden', () => {
    addRule({ id: 'k1', capability: 'kernel:replace', decision: 'deny', priority: 100, source: 'kernel', reason: 'kernel deny' })
    addRule({ id: 'p1', capability: 'kernel:replace', decision: 'allow', priority: 50, source: 'plugin', reason: 'plugin allow' })
    const result = evaluate({ principalId: 'u', tenantId: 't', runId: 'r', capability: 'kernel:replace' })
    expect(result.decision).toBe('deny')
    expect(result.monotonic).toBe(true)
    expect(result.source).toBe('kernel')
  })

  it('plugin deny blocks lower priority allow', () => {
    addRule({ id: 'a1', capability: 'fs:write', decision: 'allow', priority: 10, source: 'plugin', reason: 'allow' })
    addRule({ id: 'd1', capability: 'fs:write', decision: 'deny', priority: 20, source: 'plugin', reason: 'deny' })
    const result = evaluate({ principalId: 'u', tenantId: 't', runId: 'r', capability: 'fs:write' })
    expect(result.decision).toBe('deny')
  })

  it('allows when only allow rules match', () => {
    addRule({ id: 'a1', capability: 'fs:read', decision: 'allow', priority: 10, source: 'plugin', reason: 'allow' })
    const result = evaluate({ principalId: 'u', tenantId: 't', runId: 'r', capability: 'fs:read' })
    expect(result.decision).toBe('allow')
  })

  it('default deny when no rules match', () => {
    const result = evaluate({ principalId: 'u', tenantId: 't', runId: 'r', capability: 'unknown' })
    expect(result.decision).toBe('deny')
    expect(result.source).toBe('default')
  })

  it('condition-based rules evaluate correctly', () => {
    addRule({
      id: 'c1', capability: 'fs:write', decision: 'deny', priority: 20, source: 'plugin', reason: 'deny outside workspace',
      condition: ctx => ctx.parameters?.path === '/etc',
    })
    const outsideResult = evaluate({ principalId: 'u', tenantId: 't', runId: 'r', capability: 'fs:write', parameters: { path: '/etc' } })
    expect(outsideResult.decision).toBe('deny')
    const insideResult = evaluate({ principalId: 'u', tenantId: 't', runId: 'r', capability: 'fs:write', parameters: { path: '/workspace' } })
    expect(insideResult.decision).toBe('deny') // default deny since no allow rule
  })

  it('wildcard rules match any capability', () => {
    addRule({ id: 'w1', capability: '*', decision: 'deny', priority: 100, source: 'kernel', reason: 'emergency stop' })
    const result = evaluate({ principalId: 'u', tenantId: 't', runId: 'r', capability: 'anything' })
    expect(result.decision).toBe('deny')
    expect(result.monotonic).toBe(true)
  })
})

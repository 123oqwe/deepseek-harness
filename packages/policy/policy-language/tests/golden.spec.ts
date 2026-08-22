import { describe, it, expect } from 'vitest'
import { parsePolicy, compileRules, evaluate, dryRun } from '../src/index.ts'

const policyText = `
# Deny dangerous capabilities
deny kernel:replace because "kernel deny is monotonic"
deny fs:delete because "deletion requires explicit approval"

# Allow safe reads
allow fs:read when path.starts-with("/workspace")

# Require approval for external writes
require-approval net:post from security-team

# Rate limit
limit net:get to 100 actions per 60 seconds
`

describe('P2-10 Policy-as-Code', () => {
  it('parses policy text into rules', () => {
    const exprs = parsePolicy(policyText)
    expect(exprs.length).toBe(5)
    expect(exprs[0]!.type).toBe('deny')
    expect(exprs[2]!.type).toBe('allow')
  })

  it('compiles rules with priority', () => {
    const exprs = parsePolicy(policyText)
    const rules = compileRules(exprs)
    expect(rules.length).toBe(5)
    expect(rules[0]!.priority).toBeGreaterThan(rules[2]!.priority)
  })

  it('evaluate denies kernel:replace', () => {
    const rules = compileRules(parsePolicy(policyText))
    const result = evaluate({ capability: 'kernel:replace' }, rules)
    expect(result.decision).toBe('deny')
    expect(result.reason).toContain('monotonic')
  })

  it('evaluate allows fs:read', () => {
    const rules = compileRules(parsePolicy(policyText))
    const result = evaluate({ capability: 'fs:read' }, rules)
    expect(result.decision).toBe('allow')
  })

  it('evaluate requires approval for net:post', () => {
    const rules = compileRules(parsePolicy(policyText))
    const result = evaluate({ capability: 'net:post' }, rules)
    expect(result.decision).toBe('require-approval')
    expect(result.reason).toContain('security-team')
  })

  it('evaluate returns no-match for unknown capability', () => {
    const rules = compileRules(parsePolicy(policyText))
    const result = evaluate({ capability: 'unknown:cap' }, rules)
    expect(result.decision).toBe('no-match')
  })

  it('evaluate produces trace', () => {
    const rules = compileRules(parsePolicy(policyText))
    const result = evaluate({ capability: 'fs:delete' }, rules)
    expect(result.trace.length).toBeGreaterThan(0)
  })

  it('dryRun produces same result as evaluate', () => {
    const rules = compileRules(parsePolicy(policyText))
    const evalResult = evaluate({ capability: 'fs:read' }, rules)
    const dryResult = dryRun({ capability: 'fs:read' }, rules)
    expect(evalResult.decision).toBe(dryResult.decision)
  })
})

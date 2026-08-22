import { describe, it, expect } from 'vitest'
import { WorkflowRegistry } from '../src/index.ts'
import { WorkflowVersion } from '../src/types.ts'

const baseDef = {
  id: 'wf-code-review',
  version: WorkflowVersion(1, 0, 0),
  scriptDigest: 'abc123',
  meta: { name: 'Code Review', description: 'Reviews code changes', whenToUse: 'after code changes' },
  maxRecursionDepth: 3,
  defaultBudget: { tokens: 10000, cost: 0.5, time: 300, agents: 5 },
  failureStrategy: 'propagate' as const,
}

const childDef = {
  id: 'wf-lint',
  version: WorkflowVersion(1, 0, 0),
  scriptDigest: 'def456',
  meta: { name: 'Lint', description: 'Runs linter', whenToUse: 'before review' },
  maxRecursionDepth: 2,
  defaultBudget: { tokens: 5000, cost: 0.2, time: 120, agents: 2 },
  failureStrategy: 'isolate' as const,
}

describe('P4-09 Workflow Registry', () => {
  it('registers a workflow definition', () => {
    const reg = new WorkflowRegistry()
    const result = reg.register(baseDef)
    expect(result.status).toBe('registered')
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects duplicate registration with same digest', () => {
    const reg = new WorkflowRegistry()
    reg.register(baseDef)
    const result = reg.register(baseDef)
    expect(result.status).toBe('already-exists')
  })

  it('binds a run to a registered definition', () => {
    const reg = new WorkflowRegistry()
    const regResult = reg.register(baseDef)
    const bindResult = reg.bindRun('run-1', {
      definitionId: 'wf-code-review',
      version: '1.0.0',
      digest: regResult.digest,
    })
    expect(bindResult.bound).toBe(true)
  })

  it('rejects binding to unknown definition', () => {
    const reg = new WorkflowRegistry()
    const result = reg.bindRun('run-1', {
      definitionId: 'unknown',
      version: '1.0.0',
      digest: 'fake',
    })
    expect(result.bound).toBe(false)
    expect(result.reason).toContain('Unknown')
  })

  it('rejects binding with digest mismatch', () => {
    const reg = new WorkflowRegistry()
    reg.register(baseDef)
    const result = reg.bindRun('run-1', {
      definitionId: 'wf-code-review',
      version: '1.0.0',
      digest: 'wrong-digest',
    })
    expect(result.bound).toBe(false)
    expect(result.reason).toContain('Digest')
  })

  it('allows nested workflow call within recursion limit', () => {
    const reg = new WorkflowRegistry()
    const parentReg = reg.register(baseDef)
    const childReg = reg.register(childDef)
    reg.bindRun('run-1', {
      definitionId: 'wf-code-review',
      version: '1.0.0',
      digest: parentReg.digest,
    })
    const result = reg.registerNestedCall({
      parentRunId: 'run-1',
      childDefinitionRef: {
        definitionId: 'wf-lint',
        version: '1.0.0',
        digest: childReg.digest,
      },
      depth: 0,
      attenuatedBudget: { tokens: 3000, cost: 0.1, time: 60, agents: 1 },
      capabilityTokenDigest: 'token-hash',
      traceId: 'trace-1',
    })
    expect(result.allowed).toBe(true)
  })

  it('rejects nested call exceeding recursion depth', () => {
    const reg = new WorkflowRegistry()
    const parentReg = reg.register(baseDef)
    const childReg = reg.register(childDef)
    reg.bindRun('run-1', {
      definitionId: 'wf-code-review',
      version: '1.0.0',
      digest: parentReg.digest,
    })
    const result = reg.registerNestedCall({
      parentRunId: 'run-1',
      childDefinitionRef: {
        definitionId: 'wf-lint',
        version: '1.0.0',
        digest: childReg.digest,
      },
      depth: 10,
      attenuatedBudget: { tokens: 1000, cost: 0.1, time: 30, agents: 1 },
      capabilityTokenDigest: 'token-hash',
      traceId: 'trace-1',
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Recursion')
  })

  it('rejects circular workflow reference', () => {
    const reg = new WorkflowRegistry()
    const parentReg = reg.register(baseDef)
    reg.bindRun('run-1', {
      definitionId: 'wf-code-review',
      version: '1.0.0',
      digest: parentReg.digest,
    })
    reg.registerNestedCall({
      parentRunId: 'run-1',
      childDefinitionRef: {
        definitionId: 'wf-code-review',
        version: '1.0.0',
        digest: parentReg.digest,
      },
      depth: 0,
      attenuatedBudget: { tokens: 5000, cost: 0.2, time: 150, agents: 3 },
      capabilityTokenDigest: 'token-hash',
      traceId: 'trace-1',
    })
    const result2 = reg.registerNestedCall({
      parentRunId: 'run-1',
      childDefinitionRef: {
        definitionId: 'wf-code-review',
        version: '1.0.0',
        digest: parentReg.digest,
      },
      depth: 1,
      attenuatedBudget: { tokens: 3000, cost: 0.1, time: 100, agents: 2 },
      capabilityTokenDigest: 'token-hash-2',
      traceId: 'trace-2',
    })
    expect(result2.allowed).toBe(false)
    expect(result2.reason).toContain('Circular')
  })

  it('rejects child budget exceeding parent budget', () => {
    const reg = new WorkflowRegistry()
    const parentReg = reg.register(baseDef)
    const childReg = reg.register(childDef)
    reg.bindRun('run-1', {
      definitionId: 'wf-code-review',
      version: '1.0.0',
      digest: parentReg.digest,
    })
    const result = reg.registerNestedCall({
      parentRunId: 'run-1',
      childDefinitionRef: {
        definitionId: 'wf-lint',
        version: '1.0.0',
        digest: childReg.digest,
      },
      depth: 0,
      attenuatedBudget: { tokens: 50000, cost: 5, time: 600, agents: 10 },
      capabilityTokenDigest: 'token-hash',
      traceId: 'trace-1',
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('attenuation')
  })

  it('cancels all nested workflows for a parent', () => {
    const reg = new WorkflowRegistry()
    const parentReg = reg.register(baseDef)
    const childReg = reg.register(childDef)
    reg.bindRun('run-1', {
      definitionId: 'wf-code-review',
      version: '1.0.0',
      digest: parentReg.digest,
    })
    reg.registerNestedCall({
      parentRunId: 'run-1',
      childDefinitionRef: { definitionId: 'wf-lint', version: '1.0.0', digest: childReg.digest },
      depth: 0,
      attenuatedBudget: { tokens: 1000, cost: 0.1, time: 30, agents: 1 },
      capabilityTokenDigest: 'token-hash',
      traceId: 'trace-1',
    })
    const cancelResult = reg.cancelNested('run-1')
    expect(cancelResult.cancelled).toHaveLength(1)
  })

  it('rejects excessive recursion depth in definition', () => {
    const reg = new WorkflowRegistry()
    const result = reg.register({ ...baseDef, maxRecursionDepth: 20 })
    expect(result.status).toBe('rejected')
    expect(result.reason).toContain('maxRecursionDepth')
  })

  it('resolves version compatible definition', () => {
    const reg = new WorkflowRegistry()
    reg.register(baseDef)
    reg.register({ ...baseDef, version: WorkflowVersion(1, 1, 0), scriptDigest: 'abc456' })
    reg.register({ ...baseDef, version: WorkflowVersion(2, 0, 0), scriptDigest: 'abc789' })
    const def = reg.getDefinition('wf-code-review')
    expect(def?.version.major).toBe(2)
  })
})

import { describe, it, expect } from 'vitest'
import { validateResult, mergeResults, type SubagentResult } from '../src/result.ts'

const valid: SubagentResult = {
  requestId: 'req-1', runId: 'run-1', status: 'completed',
  output: 'Task done', artifacts: [], evidence: [],
  metrics: { tokensUsed: 100, cost: 0.5, durationMs: 5000, toolCalls: 3 },
  completedAt: Date.now(),
}

describe('P5-06 SubagentResult', () => {
  it('validates correct result', () => {
    expect(validateResult(valid).valid).toBe(true)
  })

  it('rejects missing output for completed', () => {
    const result = validateResult({ ...valid, output: '' })
    expect(result.valid).toBe(false)
  })

  it('rejects negative tokens', () => {
    const result = validateResult({ ...valid, metrics: { ...valid.metrics, tokensUsed: -1 } })
    expect(result.valid).toBe(false)
  })

  it('accepts failed status without output', () => {
    const result = validateResult({ ...valid, status: 'failed', output: '', error: 'timeout' })
    expect(result.valid).toBe(true)
  })

  it('merges results without duplicates', () => {
    const r1 = { ...valid, requestId: 'r1' }
    const r2 = { ...valid, requestId: 'r2' }
    const { merged, conflicts } = mergeResults([r1, r2])
    expect(merged).toHaveLength(2)
    expect(conflicts).toHaveLength(0)
  })

  it('detects duplicate results', () => {
    const r1 = { ...valid, requestId: 'r1' }
    const { merged, conflicts } = mergeResults([r1, r1])
    expect(merged).toHaveLength(1)
    expect(conflicts).toHaveLength(1)
  })

  it('includes artifact and evidence refs', () => {
    const result: SubagentResult = {
      ...valid,
      artifacts: [{ artifactId: 'art-1', digest: 'abc', mimeType: 'text/plain' }],
      evidence: [{ evidenceId: 'ev-1', digest: 'def', type: 'test-result' }],
    }
    expect(result.artifacts).toHaveLength(1)
    expect(result.evidence).toHaveLength(1)
  })
})

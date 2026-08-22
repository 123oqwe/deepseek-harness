import { describe, it, expect, beforeEach } from 'vitest'
import { ClaimGraph } from '../src/projector.ts'

describe('P7-04 ClaimGraph', () => {
  let graph: ClaimGraph

  beforeEach(() => { graph = new ClaimGraph() })

  it('starts as unverified without evidence', () => {
    graph.addClaim('c1', 'The sky is blue')
    expect(graph.getClaim('c1')?.status).toBe('unverified')
  })

  it('becomes verified when gate marks it', () => {
    graph.addClaim('c1', 'Test passed')
    graph.markVerifiedByGate('c1')
    expect(graph.getClaim('c1')?.status).toBe('verified')
  })

  it('becomes conflicted when contradiction added', () => {
    graph.addClaim('c1', 'API is up')
    graph.addEvidence('c1', 'ev-1', 'test', true)
    graph.addEvidence('c1', 'ev-2', 'test', false)
    graph.recompute()
    expect(graph.getClaim('c1')?.status).toBe('conflicted')
  })

  it('becomes stale when evidence expires', () => {
    graph.addClaim('c1', 'Server is running')
    graph.addEvidence('c1', 'ev-1', 'health-check', true, Date.now() - 1000)
    graph.recompute()
    expect(graph.getClaim('c1')?.status).toBe('stale')
  })

  it('propagates conflicted status to derived claims', () => {
    graph.addClaim('c1', 'Base claim')
    graph.addClaim('c2', 'Derived claim')
    graph.addDerivation('c2', 'c1')
    graph.addEvidence('c1', 'ev-1', 'test', true)
    graph.addEvidence('c1', 'ev-2', 'test', false)
    graph.markVerifiedByGate('c2')
    expect(graph.getClaim('c1')?.status).toBe('conflicted')
    expect(graph.getClaim('c2')?.status).toBe('conflicted')
  })

  it('traces claims to evidence', () => {
    graph.addClaim('c1', 'Base')
    graph.addClaim('c2', 'Derived')
    graph.addEvidence('c1', 'ev-1', 'test', true)
    graph.addDerivation('c2', 'c1')
    const trace = graph.traceToEvidence('c2')
    expect(trace.found).toBe(true)
    expect(trace.evidenceRefs).toContain('ev-1')
  })

  it('reports unverified when no evidence found', () => {
    graph.addClaim('c1', 'No evidence claim')
    const trace = graph.traceToEvidence('c1')
    expect(trace.found).toBe(false)
  })

  it('handles circular derivations gracefully', () => {
    graph.addClaim('c1', 'A')
    graph.addClaim('c2', 'B')
    graph.addDerivation('c1', 'c2')
    graph.addDerivation('c2', 'c1')
    graph.addEvidence('c1', 'ev-1', 'test', true)
    graph.recompute()
    expect(graph.getClaim('c1')?.status).not.toBe('verified')
  })

  it('does not allow unverified claims to be marked verified without evidence', () => {
    graph.addClaim('c1', 'No evidence')
    graph.markVerifiedByGate('c1')
    expect(graph.getClaim('c1')?.status).toBe('verified')
    const trace = graph.traceToEvidence('c1')
    expect(trace.found).toBe(false)
  })

  it('supports multiple evidence sources', () => {
    graph.addClaim('c1', 'Multi-evidence claim')
    graph.addEvidence('c1', 'ev-1', 'test', true)
    graph.addEvidence('c1', 'ev-2', 'log', true)
    graph.addEvidence('c1', 'ev-3', 'screenshot', true)
    const evidence = graph.getEvidenceFor('c1')
    expect(evidence).toHaveLength(3)
  })
})

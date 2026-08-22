import { describe, it, expect } from 'vitest'
import { ExtensionProposalPipeline } from '../src/index.ts'

const baseProposal = {
  id: 'ext-1', name: 'code-formatter', description: 'Formats code',
  codeDigest: 'abc123', manifestDigest: 'def456', submittedBy: 'dev-1', submittedAt: 1000,
}

describe('P1-11 Extension Proposal Pipeline', () => {
  it('submits a proposal', () => {
    const pipe = new ExtensionProposalPipeline()
    const result = pipe.submit(baseProposal)
    expect(result.status).toBe('drafted')
  })

  it('passes static scan', () => {
    const pipe = new ExtensionProposalPipeline()
    pipe.submit(baseProposal)
    const result = pipe.scan('ext-1', { passed: true, findings: 0 })
    expect(result.status).toBe('scanned')
  })

  it('rejects on scan failure', () => {
    const pipe = new ExtensionProposalPipeline()
    pipe.submit(baseProposal)
    const result = pipe.scan('ext-1', { passed: false, findings: 5 })
    expect(result.status).toBe('rejected')
  })

  it('passes isolation test', () => {
    const pipe = new ExtensionProposalPipeline()
    pipe.submit(baseProposal)
    pipe.scan('ext-1', { passed: true, findings: 0 })
    const result = pipe.test('ext-1', { passed: true, coverage: 0.9 })
    expect(result.status).toBe('tested')
  })

  it('signs proposal', () => {
    const pipe = new ExtensionProposalPipeline()
    pipe.submit(baseProposal)
    pipe.scan('ext-1', { passed: true, findings: 0 })
    pipe.test('ext-1', { passed: true, coverage: 0.9 })
    const result = pipe.sign('ext-1', 'sig-hash')
    expect(result.status).toBe('signed')
    expect(result.signature).toBe('sig-hash')
  })

  it('deploys canary and approves', () => {
    const pipe = new ExtensionProposalPipeline()
    pipe.submit(baseProposal)
    pipe.scan('ext-1', { passed: true, findings: 0 })
    pipe.test('ext-1', { passed: true, coverage: 0.9 })
    pipe.sign('ext-1', 'sig-hash')
    const result = pipe.canary('ext-1', true)
    expect(result.status).toBe('approved')
  })

  it('publishes after approval', () => {
    const pipe = new ExtensionProposalPipeline()
    pipe.submit(baseProposal)
    pipe.scan('ext-1', { passed: true, findings: 0 })
    pipe.test('ext-1', { passed: true, coverage: 0.9 })
    pipe.sign('ext-1', 'sig-hash')
    pipe.canary('ext-1', true)
    const result = pipe.publish('ext-1')
    expect(result.status).toBe('published')
  })

  it('rollbacks published proposal', () => {
    const pipe = new ExtensionProposalPipeline()
    pipe.submit(baseProposal)
    pipe.scan('ext-1', { passed: true, findings: 0 })
    pipe.test('ext-1', { passed: true, coverage: 0.9 })
    pipe.sign('ext-1', 'sig-hash')
    pipe.canary('ext-1', true)
    pipe.publish('ext-1')
    const result = pipe.rollback('ext-1')
    expect(result.status).toBe('rollback')
  })

  it('prevents self-approval', () => {
    const pipe = new ExtensionProposalPipeline()
    pipe.submit(baseProposal)
    const check = pipe.canSelfApprove('ext-1', 'dev-1')
    expect(check.allowed).toBe(false)
  })

  it('allows external approval', () => {
    const pipe = new ExtensionProposalPipeline()
    pipe.submit(baseProposal)
    const check = pipe.canSelfApprove('ext-1', 'reviewer-1')
    expect(check.allowed).toBe(true)
  })

  it('rejects out-of-order stages', () => {
    const pipe = new ExtensionProposalPipeline()
    pipe.submit(baseProposal)
    expect(() => pipe.test('ext-1', { passed: true, coverage: 0.9 })).toThrow('scanned')
  })
})

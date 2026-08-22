import { describe, it, expect } from 'vitest'
import { EvidenceCollector, EvidenceStore, checkInvariants, isTamperEvident } from '../src/index.ts'

describe('P7-02 Evidence Collector', () => {
  it('collects evidence with digest', () => {
    const ec = new EvidenceCollector()
    const item = ec.collect('test-result', 'all tests passed', 'run-1', 'verifier')
    expect(item.contentDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('verifies evidence content', () => {
    const ec = new EvidenceCollector()
    const item = ec.collect('command-output', 'exit code 0', 'run-1', 'verifier')
    expect(ec.verify(item, 'exit code 0')).toBe(true)
    expect(ec.verify(item, 'exit code 1')).toBe(false)
  })

  it('bundles evidence', () => {
    const ec = new EvidenceCollector()
    ec.collect('test-result', 'passed', 'run-1', 'v1')
    ec.collect('build-log', 'build ok', 'run-1', 'v1')
    const bundle = ec.bundle('run-1')
    expect(bundle.items).toHaveLength(2)
    expect(bundle.bundleDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('verifies bundle integrity', () => {
    const ec = new EvidenceCollector()
    ec.collect('test-result', 'passed', 'run-1', 'v1')
    const bundle = ec.bundle('run-1')
    expect(ec.verifyBundle(bundle)).toBe(true)
  })

  it('detects tampered bundle', () => {
    const ec = new EvidenceCollector()
    ec.collect('test-result', 'passed', 'run-1', 'v1')
    const bundle = ec.bundle('run-1')
    const tampered = { ...bundle, bundleDigest: 'wrong' }
    expect(ec.verifyBundle(tampered)).toBe(false)
  })

  it('stores and retrieves bundles', () => {
    const store = new EvidenceStore()
    const ec = new EvidenceCollector()
    ec.collect('test-result', 'passed', 'run-1', 'v1')
    const bundle = ec.bundle('run-1')
    store.store(bundle)
    expect(store.get(bundle.id)?.bundleDigest).toBe(bundle.bundleDigest)
  })

  it('checks invariants', () => {
    const ec = new EvidenceCollector()
    const item1 = ec.collect('test-result', 'passed', 'run-1', 'v1')
    const item2 = ec.collect('build-log', 'ok', 'run-1', 'v1')
    const result = checkInvariants([item1, item2])
    expect(result.passed).toBe(true)
  })

  it('isTamperEvident checks digest length', () => {
    const ec = new EvidenceCollector()
    ec.collect('test-result', 'passed', 'run-1', 'v1')
    const bundle = ec.bundle('run-1')
    expect(isTamperEvident(bundle)).toBe(true)
  })

  it('gets items by run', () => {
    const ec = new EvidenceCollector()
    ec.collect('test-result', 'a', 'run-1', 'v1')
    ec.collect('build-log', 'b', 'run-2', 'v1')
    expect(ec.getItems('run-1')).toHaveLength(1)
  })
})

import { describe, it, expect } from 'vitest'
import { classify, shouldRedact } from '../src/index.ts'
import { redact } from '../../redaction/src/index.ts'
import { DataLineage } from '../../data-lineage/src/index.ts'

describe('P6-10 Privacy Classification', () => {
  it('classifies public text', () => {
    const result = classify('Hello world')
    expect(result.level).toBe('public')
  })

  it('classifies PII text', () => {
    const result = classify('SSN: 123-45-6789')
    expect(result.level).toBe('pii')
    expect(result.matches.length).toBeGreaterThan(0)
  })

  it('classifies secret text', () => {
    const result = classify('password=abc123')
    expect(result.level).toBe('secret')
  })

  it('shouldRedact checks threshold', () => {
    expect(shouldRedact('public')).toBe(false)
    expect(shouldRedact('secret')).toBe(true)
  })

  it('redacts SSN', () => {
    expect(redact('My SSN is 123-45-6789')).toContain('[REDACTED-SSN]')
  })

  it('redacts email', () => {
    expect(redact('Email: user@example.com')).toContain('[REDACTED-EMAIL]')
  })

  it('redacts secret', () => {
    const redacted = redact('password=secret123')
    expect(redacted).toContain('[REDACTED]')
  })

  it('lineage tracks data origin', () => {
    const dl = new DataLineage()
    dl.record({ dataId: 'd1', source: 'upload', tenantId: 't1', snapshotAt: Date.now() })
    expect(dl.getLineage('d1')).toHaveLength(1)
  })

  it('lineage blocks cross-tenant export', () => {
    const dl = new DataLineage()
    dl.record({ dataId: 'd1', source: 'upload', tenantId: 't1', snapshotAt: Date.now() })
    const result = dl.canExport('d1', 't2')
    expect(result.allowed).toBe(false)
  })

  it('lineage supports erase', () => {
    const dl = new DataLineage()
    dl.record({ dataId: 'd1', source: 'upload', tenantId: 't1', snapshotAt: Date.now() })
    const result = dl.erase('d1')
    expect(result.erased).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { getCanonicalSchema, checkParity } from '../src/index.ts'

describe('P8-07 SDK Parity', () => {
  it('canonical schema has required fields', () => {
    const schema = getCanonicalSchema()
    expect(schema.version).toBe('1.0.0')
    expect(schema.fields.length).toBeGreaterThan(8)
    expect(schema.fields.every(f => f.name && f.type)).toBe(true)
  })

  it('checks parity for matching SDK', () => {
    const schema = getCanonicalSchema()
    const actual: Record<string, { type: string; required: boolean }> = {}
    for (const f of schema.fields) actual[f.name] = { type: f.type, required: f.required }
    const result = checkParity('typescript', '1.0.0', actual)
    expect(result.passed).toBe(true)
    expect(result.fieldsMismatched).toBe(0)
  })

  it('detects missing field', () => {
    const actual: Record<string, { type: string; required: boolean }> = {
      'serverInfo.name': { type: 'string', required: true },
    }
    const result = checkParity('python', '1.0.0', actual)
    expect(result.passed).toBe(false)
    expect(result.mismatches.some(m => m.actual === 'missing')).toBe(true)
  })

  it('detects type mismatch', () => {
    const schema = getCanonicalSchema()
    const actual: Record<string, { type: string; required: boolean }> = {}
    for (const f of schema.fields) actual[f.name] = { type: f.type, required: f.required }
    actual['sessionId'] = { type: 'number', required: true }
    const result = checkParity('python', '1.0.0', actual)
    expect(result.passed).toBe(false)
    expect(result.mismatches.some(m => m.field === 'sessionId')).toBe(true)
  })

  it('detects required mismatch', () => {
    const schema = getCanonicalSchema()
    const actual: Record<string, { type: string; required: boolean }> = {}
    for (const f of schema.fields) actual[f.name] = { type: f.type, required: f.required }
    actual['maxTokens'] = { type: 'number', required: true }
    const result = checkParity('typescript', '1.0.0', actual)
    expect(result.passed).toBe(false)
  })

  it('checks defaultValue mismatch', () => {
    const schema = getCanonicalSchema()
    const actual: Record<string, { type: string; required: boolean; defaultValue?: unknown }> = {}
    for (const f of schema.fields) actual[f.name] = { type: f.type, required: f.required, defaultValue: f.defaultValue }
    actual['serverInfo.name'] = { type: 'string', required: true, defaultValue: 'wrong-name' }
    const result = checkParity('typescript', '1.0.0', actual)
    expect(result.passed).toBe(false)
  })

  it('reports correct counts', () => {
    const schema = getCanonicalSchema()
    const actual: Record<string, { type: string; required: boolean }> = {}
    for (const f of schema.fields) actual[f.name] = { type: f.type, required: f.required }
    const result = checkParity('typescript', '1.0.0', actual)
    expect(result.fieldsMatched).toBe(schema.fields.length)
    expect(result.fieldsMatched + result.fieldsMismatched).toBe(schema.fields.length)
  })

  it('schema version is stable', () => {
    expect(getCanonicalSchema().version).toBe('1.0.0')
  })
})

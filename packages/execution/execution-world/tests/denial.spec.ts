import { describe, it, expect } from 'vitest'
import { isSuccess, isDenied, isRetryable, isTerminal, formatOutcome, type ExecutionOutcome } from '../src/errors.ts'
import { packageOutcome, getOutcomeFromPackage, getRawOutputFromPackage } from '../src/outcome.ts'

describe('P3-03 Structured Outcome and Errors', () => {
  it('isSuccess identifies success', () => {
    const o: ExecutionOutcome = { type: 'success', result: 'ok' }
    expect(isSuccess(o)).toBe(true)
    expect(isSuccess({ type: 'cancelled', reason: 'r' })).toBe(false)
  })

  it('isDenied identifies policy denial', () => {
    const o: ExecutionOutcome = { type: 'policy_denied', capability: 'fs:write', reason: 'denied' }
    expect(isDenied(o)).toBe(true)
    expect(isDenied({ type: 'success', result: 'ok' })).toBe(false)
  })

  it('isRetryable identifies timeout and sandbox unavailable', () => {
    expect(isRetryable({ type: 'timeout', timeoutMs: 100, elapsedMs: 150 })).toBe(true)
    expect(isRetryable({ type: 'sandbox_unavailable', reason: 'r' })).toBe(true)
    expect(isRetryable({ type: 'success', result: 'ok' })).toBe(false)
  })

  it('isTerminal identifies terminal states', () => {
    expect(isTerminal({ type: 'success', result: 'ok' })).toBe(true)
    expect(isTerminal({ type: 'policy_denied', capability: 'c', reason: 'r' })).toBe(true)
    expect(isTerminal({ type: 'cancelled', reason: 'r' })).toBe(true)
    expect(isTerminal({ type: 'timeout', timeoutMs: 100, elapsedMs: 150 })).toBe(false)
  })

  it('formatOutcome produces readable string', () => {
    const o = formatOutcome({ type: 'timeout', timeoutMs: 100, elapsedMs: 150 })
    expect(o).toContain('timeout')
    expect(o).toContain('150')
  })

  it('packageOutcome separates control from raw output', () => {
    const pkg = packageOutcome({ type: 'success', result: 'ok' }, 'raw stdout', 'control:ok')
    expect(pkg.separated).toBe(true)
    expect(getOutcomeFromPackage(pkg).type).toBe('success')
    expect(getRawOutputFromPackage(pkg)).toBe('raw stdout')
  })
})

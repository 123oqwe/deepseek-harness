/**
 * P9-06 Contract — task input resolution and the scriptable exit-code map.
 *
 * Both decisions exist for a caller that is a script rather than a person: a
 * script cannot notice that its piped input was silently ignored, and cannot
 * branch on a failure it can only read as exit 1.
 */
import { describe, expect, it } from 'vitest'

import { exitStatusFor, resolveTaskInput } from '../src/scriptability.ts'

describe('P9-06 Contract — resolveTaskInput', () => {
  it('must[2]: a positional task alone resolves to the argument source', () => {
    expect(resolveTaskInput('summarize the diff', undefined)).toStrictEqual({
      resolved: true,
      source: { kind: 'argument', task: 'summarize the diff' },
    })
  })

  it('must[2]: piped text alone resolves to the stdin source', () => {
    expect(resolveTaskInput(undefined, 'summarize the diff')).toStrictEqual({
      resolved: true,
      source: { kind: 'stdin', task: 'summarize the diff' },
    })
  })

  it('must[2]: supplying BOTH is refused rather than ranked, so a script is told about its bug', () => {
    const outcome = resolveTaskInput('from argv', 'from stdin')
    expect(outcome.resolved).toBe(false)
    if (outcome.resolved) return
    expect(outcome.denial.reason).toBe('ambiguous-input')
  })

  it('must[2]: supplying neither is refused', () => {
    const outcome = resolveTaskInput(undefined, undefined)
    expect(outcome.resolved).toBe(false)
    if (outcome.resolved) return
    expect(outcome.denial.reason).toBe('no-input')
  })

  it('whitespace-only stdin is refused, since that is what a failed upstream command produces', () => {
    const outcome = resolveTaskInput(undefined, '  \n\t ')
    expect(outcome.resolved).toBe(false)
    if (outcome.resolved) return
    expect(outcome.denial.reason).toBe('empty-input')
    expect(outcome.denial.detail).toContain('stdin')
  })

  it('an empty positional argument is refused, and says so about the argument rather than stdin', () => {
    const outcome = resolveTaskInput('', undefined)
    expect(outcome.resolved).toBe(false)
    if (outcome.resolved) return
    expect(outcome.denial.reason).toBe('empty-input')
    expect(outcome.denial.detail).toContain('argument')
  })

  it('an empty POSITIONAL alongside real stdin is still ambiguous, not a fallback to stdin', () => {
    // Precedence would make this "work", which is exactly the silent behaviour
    // must[2] forbids: the caller passed two inputs and meant one.
    const outcome = resolveTaskInput('', 'real task')
    expect(outcome.resolved).toBe(false)
    if (outcome.resolved) return
    expect(outcome.denial.reason).toBe('ambiguous-input')
  })

  it('preserves the task verbatim, including internal newlines a piped document carries', () => {
    const doc = 'line one\nline two\n'
    const outcome = resolveTaskInput(undefined, doc)
    expect(outcome.resolved).toBe(true)
    if (!outcome.resolved) return
    expect(outcome.source.task).toBe(doc)
  })
})

describe('P9-06 Contract — exitStatusFor', () => {
  it('must[3]: a completed run exits 0 with no failure reason', () => {
    expect(exitStatusFor({ kind: 'completed' })).toStrictEqual({ exitCode: 0, failure: undefined })
  })

  it('must[3]: a blocked run exits non-zero and names itself', () => {
    expect(exitStatusFor({ kind: 'blocked' })).toStrictEqual({ exitCode: 2, failure: 'blocked' })
  })

  it('must[3]: max-tokens is its own code, not folded into a generic error', () => {
    expect(exitStatusFor({ kind: 'max-tokens' })).toStrictEqual({ exitCode: 5, failure: 'max-tokens' })
  })

  it('must[3]: interrupted is its own code', () => {
    expect(exitStatusFor({ kind: 'interrupted' })).toStrictEqual({ exitCode: 6, failure: 'interrupted' })
  })

  it('must[3]: every failure class gets a DISTINCT code, so a script can branch without parsing output', () => {
    const codes = ['blocked', 'aborted', 'error', 'max-tokens', 'interrupted'].map(
      kind => exitStatusFor({ kind } as never).exitCode,
    )
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).not.toContain(0)
  })

  it('must[3]: a MISSING reason is exit 1 and unknown — never success, since a turn that never ended did not complete', () => {
    expect(exitStatusFor(undefined)).toStrictEqual({ exitCode: 1, failure: 'unknown' })
  })

  it('a reason this build does not know stays non-zero rather than falling through to success', () => {
    expect(exitStatusFor({ kind: 'some-future-reason' } as never)).toStrictEqual({ exitCode: 1, failure: 'unknown' })
  })

  it('only completion produces exit 0, across every reason the session layer defines', () => {
    const reasons = ['completed', 'blocked', 'aborted', 'error', 'max-tokens', 'interrupted']
    const zero = reasons.filter(kind => exitStatusFor({ kind } as never).exitCode === 0)
    expect(zero).toStrictEqual(['completed'])
  })
})

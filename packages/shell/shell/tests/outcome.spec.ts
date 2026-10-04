/**
 * Epic P3-03 U1: a shell command's outcome comes from its exit facts only.
 */
import { describe, expect, it } from 'vitest'
import { shellRunOutcome, type ShellExitFacts } from '../src/index.ts'

/**
 * Exit facts of a command that exited 0, with `overrides`.
 * @param overrides - the facts that differ.
 * @returns the facts.
 */
function run(overrides: Partial<ShellExitFacts> = {}): ShellExitFacts {
  return { exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 120_000, ...overrides }
}

describe('P3-03 U1: a shell command\'s outcome from its exit facts', () => {
  it('records nothing for a command that exited 0', () => {
    expect(shellRunOutcome(run())).toBeUndefined()
    expect(shellRunOutcome(run({ exitCode: null }))).toBeUndefined()
  })

  it('records an abort, the executor\'s deadline, a signal and a non-zero exit, in that order', () => {
    expect(shellRunOutcome(run({ aborted: true, timedOut: true, signal: 'SIGTERM', exitCode: null }))).toEqual({ kind: 'cancelled', by: 'abort' })
    expect(shellRunOutcome(run({ timedOut: true, signal: 'SIGKILL', exitCode: null, timeoutMs: 5000 })))
      .toEqual({ kind: 'timeout', by: 'executor', deadlineMs: 5000 })
    expect(shellRunOutcome(run({ signal: 'SIGKILL', exitCode: null }))).toEqual({ kind: 'tool_failed', signal: 'SIGKILL' })
    expect(shellRunOutcome(run({ signal: 'SIGSEGV', exitCode: 139 }))).toEqual({ kind: 'tool_failed', signal: 'SIGSEGV', exitCode: 139 })
    expect(shellRunOutcome(run({ exitCode: 1 }))).toEqual({ kind: 'tool_failed', exitCode: 1 })
  })
})

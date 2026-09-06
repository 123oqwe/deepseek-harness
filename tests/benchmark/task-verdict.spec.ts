/**
 * P9-08 Contract — deterministic scoring, and the two ways a score can be faked.
 *
 * acceptance[1] names the negatives that matter: a fabricated output and an
 * edited judge file must both score FAIL. Both are things the executor can
 * actually do — it runs in the workspace the checks describe — so they are not
 * hypothetical hostile input, they are the two cheapest ways for a benchmark to
 * report a number that is not about the model.
 */
import { describe, expect, it } from 'vitest'

import {
  judgeTask,
  judgeTaskWithIntegrity,
  resolveSuiteStatus,
  scoreSuite,
  type CheckObservation,
  type TaskCheck,
} from '../../benchmarks/judge/verdict.ts'

const CHECKS: TaskCheck[] = [
  { kind: 'exit-code', id: 'tests-pass', expectedExitCode: 0 },
  { kind: 'file-contains', id: 'file-written', path: 'out.txt', substring: 'done' },
]

const satisfied: CheckObservation[] = [
  { id: 'tests-pass', satisfied: true, detail: 'exit 0' },
  { id: 'file-written', satisfied: true, detail: 'out.txt contains "done"' },
]

describe('P9-08 Contract — task scoring is mechanical', () => {
  it('must[0]: a task passes only when every declared check was satisfied', () => {
    expect(judgeTask(CHECKS, satisfied)).toStrictEqual({ passed: true, checks: 2 })
  })

  it('must[0]: one unsatisfied check fails the task, and the verdict names which', () => {
    const verdict = judgeTask(CHECKS, [satisfied[0]!, { id: 'file-written', satisfied: false, detail: 'missing' }])
    expect(verdict).toStrictEqual({ passed: false, failure: { reason: 'check-failed', failed: ['file-written'] } })
  })

  it('a check with NO observation is unobserved, not passed', () => {
    // The distinction the whole scorer rests on: a runner that died before a
    // check produces the same silence as one whose check trivially held.
    const verdict = judgeTask(CHECKS, [satisfied[0]!])
    expect(verdict).toStrictEqual({ passed: false, failure: { reason: 'check-unobserved', missing: ['file-written'] } })
  })

  it('acceptance[1]: an observation for a check the task never declared adds no credit', () => {
    const fabricated: CheckObservation[] = [
      ...satisfied.slice(0, 1),
      { id: 'a-check-nobody-declared', satisfied: true, detail: 'invented' },
    ]
    // The fabricated observation cannot stand in for the real one it displaced.
    expect(judgeTask(CHECKS, fabricated)).toStrictEqual({
      passed: false,
      failure: { reason: 'check-unobserved', missing: ['file-written'] },
    })
  })

  it('a task declaring no checks fails: an empty task list is the cheapest way to raise a score', () => {
    expect(judgeTask([], [])).toStrictEqual({
      passed: false,
      failure: { reason: 'no-checks', detail: 'a task with no checks cannot be passed' },
    })
  })
})

describe('P9-08 Contract — the judge cannot be edited by the run it scores', () => {
  it('acceptance[1]: a changed judge digest fails the task', () => {
    const verdict = judgeTaskWithIntegrity('digest-before', 'digest-after', CHECKS, satisfied)
    expect(verdict.passed).toBe(false)
    expect(verdict.passed === false ? verdict.failure.reason : undefined).toBe('judge-tampered')
  })

  it('tampering is reported AHEAD of the checks, even when every check reports satisfied', () => {
    // The case that matters: an executor that rewrote the criteria will usually
    // have made them pass. Reporting `check-failed` here would name the wrong
    // cause, and reporting `passed` would be the exploit succeeding.
    const verdict = judgeTaskWithIntegrity('before', 'after', CHECKS, satisfied)
    expect(verdict.passed === false ? verdict.failure.reason : undefined).toBe('judge-tampered')
  })

  it('an unchanged digest scores the task normally', () => {
    expect(judgeTaskWithIntegrity('same', 'same', CHECKS, satisfied)).toStrictEqual({ passed: true, checks: 2 })
  })
})

describe('P9-08 Contract — a keyless suite reports BLOCKED, never a rate', () => {
  it('must[3]: no credential blocks the suite instead of scoring it', () => {
    expect(resolveSuiteStatus(false).status).toBe('BLOCKED')
    expect(resolveSuiteStatus(true)).toStrictEqual({ status: 'RUN' })
  })

  it('must[3]: an empty suite has NO success rate rather than 0%', () => {
    // 0% claims every task failed; 100% claims every task passed. Both are
    // measurements of a model that was never asked anything.
    expect(scoreSuite([])).toStrictEqual({ tasks: 0, passed: 0, successRate: null })
  })

  it('a suite that ran reports the ratio of the tasks that actually ran', () => {
    expect(scoreSuite([
      { passed: true, checks: 1 },
      { passed: false, failure: { reason: 'check-failed', failed: ['x'] } },
      { passed: true, checks: 2 },
    ])).toStrictEqual({ tasks: 3, passed: 2, successRate: 2 / 3 })
  })
})

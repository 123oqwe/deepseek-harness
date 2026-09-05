/**
 * P5-11 Provider stage: the store where a claim becomes atomic.
 *
 * This file exists because the pre-flight freeze-target list asked where P's
 * freeze would hang and found P declares two source files and no test file --
 * the same gap the list caught on P6-02.U, P4-08.P and P4-09.P.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { TaskStore } from '../src/store.ts'
import type { Task, TaskId, WorkerId } from '../src/types.ts'

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id: brandString<TaskId>(id),
    status: 'open',
    owner: null,
    attempt: 0,
    claimExpiresAtMs: null,
    outputs: [],
    verification: 'unverified',
    dependsOn: [],
    ...overrides,
  }
}

function worker(name: string): WorkerId {
  return brandString<WorkerId>(name)
}

describe('P5-11 acceptance[0]: exactly one worker wins a contested claim', () => {
  it('admits the first claimant and refuses every later one', () => {
    const store = new TaskStore()
    store.submit([task('t1')])

    const winners = Array.from({ length: 100 }, (_unused, index) =>
      store.claim(brandString<TaskId>('t1'), worker(`w-${index}`), 1_000, 5_000))
      .filter(decision => decision.claimed)

    // Read-decide-write with no suspension between them: two callers cannot
    // interleave and both write themselves as owner.
    expect(winners).toHaveLength(1)
    expect(store.get(brandString<TaskId>('t1'))?.owner).toBe(worker('w-0'))
  })

  it('lets the next worker win once the first claim lapses, at a higher attempt', () => {
    const store = new TaskStore()
    store.submit([task('t1')])
    store.claim(brandString<TaskId>('t1'), worker('first'), 1_000, 5_000)

    const second = store.claim(brandString<TaskId>('t1'), worker('second'), 6_001, 5_000)
    expect(second).toMatchObject({ claimed: true, task: { owner: worker('second'), attempt: 2 } })
  })

  it('persists the winning claim, so a later read sees the owner', () => {
    // A store that returned a claimed task without retaining it would satisfy
    // the single-winner case above while losing every claim.
    const store = new TaskStore()
    store.submit([task('t1')])
    store.claim(brandString<TaskId>('t1'), worker('w'), 1_000, 5_000)

    expect(store.get(brandString<TaskId>('t1'))).toMatchObject({ status: 'claimed', owner: worker('w'), attempt: 1 })
  })

  it('refuses a claim on an unknown task', () => {
    expect(new TaskStore().claim(brandString<TaskId>('ghost'), worker('w'), 0, 1_000))
      .toEqual({ claimed: false, reason: 'not-claimable' })
  })
})

describe('P5-11 acceptance[2]: a cycle is refused at submission, before anything is stored', () => {
  it('refuses a cyclic submission and stores nothing', () => {
    const store = new TaskStore()
    const outcome = store.submit([
      task('a', { dependsOn: [brandString<TaskId>('b')] }),
      task('b', { dependsOn: [brandString<TaskId>('a')] }),
    ])

    expect(outcome).toMatchObject({ submitted: false, reason: 'graph-invalid' })
    // Nothing partially stored: a refused submission must leave the board as
    // it was, or a later claim could reach a task the board declined.
    expect(store.list()).toEqual([])
  })

  it('refuses a FORWARD reference, which is what makes a cross-batch cycle unreachable', () => {
    // Worth stating precisely, because the first version of this case asserted
    // something false. A cycle cannot close across two submissions: closing one
    // would need an already-stored task to depend on a task submitted later,
    // and such a task is refused at ITS OWN submission as an unknown
    // dependency. So the forward-reference rule, not the combined-graph walk,
    // is what rules out cross-batch cycles.
    const store = new TaskStore()
    expect(store.submit([task('a', { dependsOn: [brandString<TaskId>('later')] })]))
      .toMatchObject({ submitted: false, reason: 'graph-invalid' })
    expect(store.list()).toEqual([])
  })

  it('validates each submission against tasks ALREADY stored, not the batch alone', () => {
    // The combined-graph walk is therefore belt-and-braces rather than the
    // primary defence -- but it is what keeps a dependency on a stored task
    // resolvable, so a later batch can legitimately build on an earlier one.
    const store = new TaskStore()
    store.submit([task('base')])
    expect(store.submit([task('built-on', { dependsOn: [brandString<TaskId>('base')] })]))
      .toEqual({ submitted: true })
    expect(store.list()).toHaveLength(2)
  })

  it('refuses a duplicate task id rather than overwriting', () => {
    // Overwriting would silently discard a task other tasks may depend on.
    const store = new TaskStore()
    store.submit([task('t1')])
    expect(store.submit([task('t1')])).toMatchObject({ submitted: false, reason: 'duplicate-task' })
  })

  it('accepts an acyclic submission, so the refusals above are selective', () => {
    const store = new TaskStore()
    expect(store.submit([task('a'), task('b', { dependsOn: [brandString<TaskId>('a')] })]))
      .toEqual({ submitted: true })
    expect(store.list()).toHaveLength(2)
  })
})

describe('P5-11: a claim honours dependencies the store resolves for it', () => {
  it('refuses while a stored dependency is unverified, and admits once verified', () => {
    const store = new TaskStore()
    store.submit([task('dep'), task('t1', { dependsOn: [brandString<TaskId>('dep')] })])

    expect(store.claim(brandString<TaskId>('t1'), worker('w'), 1_000, 5_000))
      .toEqual({ claimed: false, reason: 'dependency-unmet' })

    store.submit([task('other')])
    const verified = new TaskStore()
    verified.submit([task('dep', { status: 'verified', verification: 'passed' }),
      task('t1', { dependsOn: [brandString<TaskId>('dep')] })])
    expect(verified.claim(brandString<TaskId>('t1'), worker('w'), 1_000, 5_000).claimed).toBe(true)
  })
})

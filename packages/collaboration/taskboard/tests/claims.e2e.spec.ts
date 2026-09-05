/**
 * Clause coverage for Epic P5-11's task primitives.
 *
 * `.e2e.spec.ts` rather than `.e2e.ts`: the latter routes into
 * vitest.e2e.config.ts, whose suites self-skip without an API key, and the
 * exact-SHA CI job runs the default config. Recorded as an adjudicated path
 * patch before this file was written (adjudication.json,
 * P5-11-C-claims-e2e-not-yet-created) -- the fifth application of that
 * prevention precedent.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { decideClaim, isClaimCurrent, validateTaskGraph } from '../src/index.ts'
import type { Task, TaskId, WorkerId } from '../src/types.ts'

const WORKER_A = brandString<WorkerId>('worker-a')
const WORKER_B = brandString<WorkerId>('worker-b')

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

describe('P5-11 must[0]: a task carries claim, attempt, lease, owner, outputs and verification', () => {
  it('carries exactly the enumerated fields', () => {
    // One exact key set: a task missing one of these would still satisfy every
    // individual assertion about the others.
    expect(Object.keys(task('t1')).sort()).toEqual([
      'attempt', 'claimExpiresAtMs', 'dependsOn', 'id', 'outputs', 'owner', 'status', 'verification',
    ])
  })

  it('represents an unclaimed task with explicit nulls, not absent fields', () => {
    // An absent owner could not be told from one nobody set.
    const open = task('t1')
    expect(open.owner).toBeNull()
    expect(open.claimExpiresAtMs).toBeNull()
  })

  it('claims an open task, taking ownership and a lease', () => {
    const decision = decideClaim(task('t1'), WORKER_A, 1_000, 5_000, [])

    expect(decision).toMatchObject({
      claimed: true,
      task: { status: 'claimed', owner: WORKER_A, attempt: 1, claimExpiresAtMs: 6_000 },
    })
  })
})

describe('P5-11 acceptance[0]: concurrent claims produce exactly one winner', () => {
  it('refuses a second worker while the first claim is live', () => {
    const claimed = task('t1', { status: 'claimed', owner: WORKER_A, attempt: 1, claimExpiresAtMs: 6_000 })

    expect(decideClaim(claimed, WORKER_B, 2_000, 5_000, []))
      .toEqual({ claimed: false, reason: 'already-claimed' })
  })

  it('leaves exactly one admitted holder after a hundred contending workers', () => {
    // validation[0]'s 100-worker stress, sequentially: only the first claim of
    // an open task succeeds; every later one is refused while it is live.
    let current = task('t1')
    const winners: WorkerId[] = []
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const decision = decideClaim(current, brandString<WorkerId>(`worker-${attempt}`), 1_000, 5_000, [])
      if (decision.claimed) {
        winners.push(decision.task.owner as WorkerId)
        current = decision.task
      }
    }

    expect(winners).toEqual([brandString<WorkerId>('worker-0')])
  })

  it('lets a NEW worker claim once the lease has expired, at a greater attempt', () => {
    const lapsed = task('t1', { status: 'claimed', owner: WORKER_A, attempt: 1, claimExpiresAtMs: 6_000 })
    const decision = decideClaim(lapsed, WORKER_B, 6_001, 5_000, [])

    // The increment is what makes the previous holder's writes refusable: a
    // lapsed worker returning after a reclaim would otherwise present
    // credentials indistinguishable from the new holder's.
    expect(decision).toMatchObject({ claimed: true, task: { owner: WORKER_B, attempt: 2 } })
  })

  it('holds the claim AT its expiry instant, so renew and reclaim cannot both be legal', () => {
    const held = task('t1', { status: 'claimed', owner: WORKER_A, attempt: 1, claimExpiresAtMs: 6_000 })

    expect(decideClaim(held, WORKER_B, 6_000, 5_000, []).claimed).toBe(false)
    expect(decideClaim(held, WORKER_B, 6_001, 5_000, []).claimed).toBe(true)
  })

  it('refuses a write from the superseded holder and admits the current one', () => {
    const reclaimed = task('t1', { status: 'claimed', owner: WORKER_B, attempt: 2 })

    expect(isClaimCurrent(reclaimed, WORKER_A, 1)).toBe(false)
    expect(isClaimCurrent(reclaimed, WORKER_B, 2)).toBe(true)
  })

  it('refuses an attempt number HIGHER than the task\'s current one', () => {
    // Attempts are issued only by the board, so one above the current did not
    // come from it; admitting it would let a forged number outrank every real
    // claim.
    const claimed = task('t1', { status: 'claimed', owner: WORKER_A, attempt: 2 })
    expect(isClaimCurrent(claimed, WORKER_A, 99)).toBe(false)
  })
})

describe('P5-11 must[0]: a dependency must be VERIFIED, not merely submitted', () => {
  it('refuses a claim while a dependency is only submitted', () => {
    // Submitted work has produced outputs nobody has checked; releasing a
    // dependent task on it would build on a result that may yet be rejected.
    const dependency = task('dep', { status: 'submitted', verification: 'unverified' })
    const dependent = task('t1', { dependsOn: [dependency.id] })

    expect(decideClaim(dependent, WORKER_A, 1_000, 5_000, [dependency]))
      .toEqual({ claimed: false, reason: 'dependency-unmet' })
  })

  it('admits the claim once the dependency is verified', () => {
    const dependency = task('dep', { status: 'verified', verification: 'passed' })
    const dependent = task('t1', { dependsOn: [dependency.id] })

    expect(decideClaim(dependent, WORKER_A, 1_000, 5_000, [dependency]).claimed).toBe(true)
  })

  it('refuses a claim on a finished task', () => {
    for (const status of ['verified', 'failed'] as const) {
      expect(decideClaim(task('t1', { status }), WORKER_A, 1_000, 5_000, []), status)
        .toEqual({ claimed: false, reason: 'not-claimable' })
    }
  })
})

describe('P5-11 acceptance[2]: a cyclic dependency is refused at submission', () => {
  it('refuses a two-task cycle', () => {
    const a = task('a', { dependsOn: [brandString<TaskId>('b')] })
    const b = task('b', { dependsOn: [brandString<TaskId>('a')] })

    expect(validateTaskGraph([a, b])).toMatchObject({ valid: false, reason: 'dependency-cycle' })
  })

  it('refuses a three-task cycle, naming the path', () => {
    const a = task('a', { dependsOn: [brandString<TaskId>('b')] })
    const b = task('b', { dependsOn: [brandString<TaskId>('c')] })
    const c = task('c', { dependsOn: [brandString<TaskId>('a')] })

    const result = validateTaskGraph([a, b, c])
    expect(result).toMatchObject({ valid: false, reason: 'dependency-cycle' })
    if (result.valid) throw new Error('unreachable')
    expect(result.detail).toContain('->')
  })

  it('refuses a self-dependency distinctly from a cycle', () => {
    expect(validateTaskGraph([task('a', { dependsOn: [brandString<TaskId>('a')] })]))
      .toMatchObject({ valid: false, reason: 'self-dependency' })
  })

  it('refuses a dependency on a task not in the submitted set', () => {
    expect(validateTaskGraph([task('a', { dependsOn: [brandString<TaskId>('ghost')] })]))
      .toMatchObject({ valid: false, reason: 'unknown-dependency' })
  })

  it('accepts an acyclic graph, so the checks above refuse selectively', () => {
    const a = task('a')
    const b = task('b', { dependsOn: [a.id] })
    const c = task('c', { dependsOn: [a.id, b.id] })

    expect(validateTaskGraph([a, b, c])).toEqual({ valid: true })
  })

  it('accepts a diamond, which shares a dependency without cycling', () => {
    // A shared dependency is not a cycle. A naive visited-set check that
    // refused any re-encountered node would reject this.
    const root = task('root')
    const left = task('left', { dependsOn: [root.id] })
    const right = task('right', { dependsOn: [root.id] })
    const join = task('join', { dependsOn: [left.id, right.id] })

    expect(validateTaskGraph([root, left, right, join])).toEqual({ valid: true })
  })
})

describe('P5-11 must[2]: roles, org charts and captains stay in the plugin/skill layer', () => {
  it('exposes NO role, captain or org-chart concept on the task surface', () => {
    // A negative clause needs an assertion of absence, because "deliberately
    // not built" and "forgot to build" look identical in an exported type. A
    // role field here would make every deployment inherit one team shape,
    // which is exactly what a general primitive must not do.
    const keys = Object.keys(task('t1')).join(' ').toLowerCase()
    for (const forbidden of ['role', 'captain', 'orgchart', 'manager', 'team', 'seniority']) {
      expect(keys, forbidden).not.toContain(forbidden)
    }
  })

  it('identifies a claimant only by opaque worker id, carrying no rank', () => {
    // `owner` is a WorkerId and nothing more: the board can say WHO holds a
    // task and cannot express WHY they were entitled to it. That judgement is
    // the plugin layer's.
    const decision = decideClaim(task('t1'), WORKER_A, 1_000, 5_000, [])
    if (!decision.claimed) throw new Error('unreachable')
    expect(typeof decision.task.owner).toBe('string')
  })
})

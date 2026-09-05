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
  it('exposes exactly the coordination fields, so ANY added field must be justified here', () => {
    // A negative clause needs an assertion of absence, because "deliberately
    // not built" and "forgot to build" look identical in an exported type.
    //
    // Written as a CLOSED SET rather than a forbidden-word list. A blacklist
    // of role-ish names invites the exact defect it aims at: `rank`, `tier`,
    // `authority`, `level`, `grade`, `supervisor`, `lead` and `chief` would
    // all pass one. A closed set reddens on ANY new field whatever it is
    // called, so whoever adds one must edit this list -- and that edit is the
    // moment they confront must[2].
    expect(Object.keys(task('t1')).sort()).toEqual([
      'attempt', 'claimExpiresAtMs', 'dependsOn', 'id', 'outputs', 'owner', 'status', 'verification',
    ])
  })

  it('carries the claimant\'s id through UNCHANGED, deriving nothing from it', () => {
    // `typeof owner === 'string'` would exclude nothing: string is the most
    // expressive primitive there is, and "senior-engineer:worker-a" passes it
    // while being precisely the thing must[2] forbids.
    //
    // Identity is the assertion that matches the claim: the board transports
    // an opaque id and never derives, decorates or composes one. It can say
    // WHO holds a task and cannot express why they were entitled to it.
    const decision = decideClaim(task('t1'), WORKER_A, 1_000, 5_000, [])
    if (!decision.claimed) throw new Error('unreachable')
    expect(decision.task.owner).toBe(WORKER_A)
  })
})

/**
 * P5-11 Fault stage: a systematic matrix over the claim, dependency and graph
 * boundaries, including validation[1]'s named scenarios.
 *
 * Enumerated as data with the count asserted against a floor, so a boundary
 * cannot be deleted while every remaining case still passes.
 */
describe('P5-11 Fault — claim and graph boundary matrix', () => {
  interface TaskFault {
    readonly boundary: string
    readonly run: () => void
  }

  const FAULTS: readonly TaskFault[] = [
    {
      boundary: '01 an open task admits its first claim',
      run: () => expect(decideClaim(task('t'), WORKER_A, 1_000, 5_000, []).claimed).toBe(true),
    },
    {
      boundary: '02 a live claim refuses a second worker',
      run: () => expect(decideClaim(
        task('t', { status: 'claimed', owner: WORKER_A, attempt: 1, claimExpiresAtMs: 6_000 }),
        WORKER_B, 2_000, 5_000, [],
      )).toEqual({ claimed: false, reason: 'already-claimed' }),
    },
    {
      boundary: '03 a claim is still held AT its expiry instant',
      run: () => expect(decideClaim(
        task('t', { status: 'claimed', owner: WORKER_A, attempt: 1, claimExpiresAtMs: 6_000 }),
        WORKER_B, 6_000, 5_000, [],
      ).claimed).toBe(false),
    },
    {
      boundary: '04 one millisecond past expiry the task is claimable again',
      run: () => expect(decideClaim(
        task('t', { status: 'claimed', owner: WORKER_A, attempt: 1, claimExpiresAtMs: 6_000 }),
        WORKER_B, 6_001, 5_000, [],
      ).claimed).toBe(true),
    },
    {
      boundary: '05 a reclaim issues a strictly greater attempt',
      run: () => {
        const decision = decideClaim(
          task('t', { status: 'claimed', owner: WORKER_A, attempt: 7, claimExpiresAtMs: 1 }),
          WORKER_B, 1_000, 5_000, [],
        )
        if (!decision.claimed) throw new Error('unreachable')
        expect(decision.task.attempt).toBe(8)
      },
    },
    {
      boundary: '06 a superseded holder\'s write is refused',
      run: () => expect(isClaimCurrent(task('t', { owner: WORKER_B, attempt: 2 }), WORKER_A, 1)).toBe(false),
    },
    {
      boundary: '07 an attempt above the current one is refused, not treated as newer',
      run: () => expect(isClaimCurrent(task('t', { owner: WORKER_A, attempt: 2 }), WORKER_A, 99)).toBe(false),
    },
    {
      boundary: '08 the current holder at the current attempt is admitted',
      run: () => expect(isClaimCurrent(task('t', { owner: WORKER_A, attempt: 2 }), WORKER_A, 2)).toBe(true),
    },
    {
      boundary: '09 a verified task is not claimable',
      run: () => expect(decideClaim(task('t', { status: 'verified' }), WORKER_A, 1_000, 5_000, []))
        .toEqual({ claimed: false, reason: 'not-claimable' }),
    },
    {
      boundary: '10 a failed task is not claimable',
      run: () => expect(decideClaim(task('t', { status: 'failed' }), WORKER_A, 1_000, 5_000, []))
        .toEqual({ claimed: false, reason: 'not-claimable' }),
    },
    {
      boundary: '11 a submitted-but-unverified dependency blocks the claim',
      run: () => expect(decideClaim(
        task('t', { dependsOn: [brandString<TaskId>('dep')] }), WORKER_A, 1_000, 5_000,
        [task('dep', { status: 'submitted' })],
      )).toEqual({ claimed: false, reason: 'dependency-unmet' }),
    },
    {
      boundary: '12 one unverified dependency among several still blocks',
      run: () => expect(decideClaim(
        task('t', { dependsOn: [brandString<TaskId>('a'), brandString<TaskId>('b')] }), WORKER_A, 1_000, 5_000,
        [task('a', { status: 'verified' }), task('b', { status: 'claimed' })],
      )).toEqual({ claimed: false, reason: 'dependency-unmet' }),
    },
    {
      boundary: '13 all dependencies verified admits the claim',
      run: () => expect(decideClaim(
        task('t', { dependsOn: [brandString<TaskId>('a')] }), WORKER_A, 1_000, 5_000,
        [task('a', { status: 'verified' })],
      ).claimed).toBe(true),
    },
    {
      boundary: '14 a not-claimable status wins over an unmet dependency',
      run: () => {
        // Pins the check order: a finished task is finished whatever its
        // dependencies say, and reporting dependency-unmet would send an
        // operator to fix a dependency that no longer matters.
        expect(decideClaim(
          task('t', { status: 'verified', dependsOn: [brandString<TaskId>('a')] }), WORKER_A, 1_000, 5_000,
          [task('a', { status: 'open' })],
        )).toEqual({ claimed: false, reason: 'not-claimable' })
      },
    },
    {
      boundary: '15 a two-task cycle is refused',
      run: () => expect(validateTaskGraph([
        task('a', { dependsOn: [brandString<TaskId>('b')] }),
        task('b', { dependsOn: [brandString<TaskId>('a')] }),
      ])).toMatchObject({ valid: false, reason: 'dependency-cycle' }),
    },
    {
      boundary: '16 a self-dependency is refused distinctly from a cycle',
      run: () => expect(validateTaskGraph([task('a', { dependsOn: [brandString<TaskId>('a')] })]))
        .toMatchObject({ valid: false, reason: 'self-dependency' }),
    },
    {
      boundary: '17 a forward reference is refused as an unknown dependency',
      run: () => expect(validateTaskGraph([task('a', { dependsOn: [brandString<TaskId>('later')] })]))
        .toMatchObject({ valid: false, reason: 'unknown-dependency' }),
    },
    {
      boundary: '18 a diamond is accepted: a shared dependency is not a cycle',
      run: () => {
        const root = task('root')
        const left = task('left', { dependsOn: [root.id] })
        const right = task('right', { dependsOn: [root.id] })
        const join = task('join', { dependsOn: [left.id, right.id] })
        expect(validateTaskGraph([root, left, right, join])).toEqual({ valid: true })
      },
    },
    {
      boundary: '19 an empty graph is valid',
      run: () => expect(validateTaskGraph([])).toEqual({ valid: true }),
    },
  ]

  it('enumerates at least twelve boundaries, each named once', () => {
    expect(FAULTS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(FAULTS.map(fault => fault.boundary)).size).toBe(FAULTS.length)
  })

  for (const fault of FAULTS) {
    it(`fault boundary ${fault.boundary}`, () => { fault.run() })
  }
})

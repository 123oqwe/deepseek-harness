/**
 * Task primitives: claim, lease, ownership and verification (Epic P5-11).
 *
 * A taskboard is a coordination primitive, not an organisation. It knows that
 * a task can be claimed by exactly one worker, that a claim expires, and
 * whether the work was verified. It deliberately knows nothing about **who**
 * should claim what.
 *
 * **Roles, org charts and captains stay in the plugin/skill layer (must[2]).**
 * That is a constraint on this module's surface, not an omission: a `role` or
 * `captain` field here would make every deployment inherit one team shape, and
 * the whole point of a general primitive is that a plugin decides the shape.
 * A case asserts the absence, because "we deliberately did not build this" and
 * "we forgot" look identical in an exported type.
 *
 * @module @deepseek-ai/dsh-taskboard/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** One unit of schedulable work. */
export type TaskId = Branded<'TaskId'>

/** A worker that may claim tasks. */
export type WorkerId = Branded<'WorkerId'>

/** A reference to stored content produced by a task. */
export type ArtifactRef = Branded<'ArtifactRef'>

/**
 * A claim generation, incremented on every successful claim of a task.
 *
 * Serves the same purpose as a lease epoch: comparing attempts is the whole
 * staleness test, so a worker whose claim expired cannot write using the
 * attempt number it still holds.
 */
export type Attempt = number

/** How far a task has progressed. */
export type TaskStatus = 'open' | 'claimed' | 'submitted' | 'verified' | 'failed'

/** Whether submitted work was checked, and how it came out. */
export type VerificationStatus = 'unverified' | 'passed' | 'failed'

/**
 * One task, carrying every fact must[0] enumerates.
 *
 * `owner` and `claimExpiresAtMs` are nullable rather than optional: an
 * unclaimed task is a state the board must represent, and an absent field
 * cannot be told from one nobody set.
 */
export interface Task {
  readonly id: TaskId
  readonly status: TaskStatus
  /** The worker currently holding the claim, or `null` when unclaimed. */
  readonly owner: WorkerId | null
  /** Incremented on each successful claim; 0 before the first. */
  readonly attempt: Attempt
  /** Epoch milliseconds after which the claim lapses, or `null` when unclaimed. */
  readonly claimExpiresAtMs: number | null
  /** Artifacts this task produced; empty until work is submitted. */
  readonly outputs: readonly ArtifactRef[]
  readonly verification: VerificationStatus
  /** Tasks that must reach `verified` before this one may be claimed. */
  readonly dependsOn: readonly TaskId[]
}

/** Why a claim was refused. */
export type ClaimDenialReason =
  /** Another worker holds an unexpired claim. */
  | 'already-claimed'
  /** The task is finished; there is nothing to claim. */
  | 'not-claimable'
  /** A dependency has not been verified yet. */
  | 'dependency-unmet'

/** The outcome of attempting a claim. */
export type ClaimDecision =
  | { readonly claimed: true; readonly task: Task }
  | { readonly claimed: false; readonly reason: ClaimDenialReason }

/**
 * Decide one claim attempt (must[0], acceptance[0]).
 *
 * A task whose claim has EXPIRED is claimable again, and the new claim gets a
 * strictly greater attempt number. That increment is what makes the previous
 * holder's writes refusable: without it a lapsed worker returning after a
 * reclaim would present credentials indistinguishable from the new holder's.
 *
 * Dependencies must be `verified`, not merely `submitted`. Submitted work has
 * produced outputs nobody has checked, and releasing a dependent task on it
 * would build on a result that may yet be rejected.
 * @param task - the task being claimed.
 * @param worker - the claiming worker.
 * @param nowMs - the instant to judge claim expiry against.
 * @param leaseMs - how long the new claim should hold.
 * @param dependencies - the tasks this one depends on, resolved.
 * @returns the claimed task, or why the claim is refused.
 */
export function decideClaim(
  task: Task,
  worker: WorkerId,
  nowMs: number,
  leaseMs: number,
  dependencies: readonly Task[],
): ClaimDecision {
  if (task.status === 'verified' || task.status === 'failed') {
    return { claimed: false, reason: 'not-claimable' }
  }
  if (dependencies.some(dependency => dependency.status !== 'verified')) {
    return { claimed: false, reason: 'dependency-unmet' }
  }
  const held = task.owner !== null && task.claimExpiresAtMs !== null && nowMs <= task.claimExpiresAtMs
  if (held) return { claimed: false, reason: 'already-claimed' }
  return {
    claimed: true,
    task: {
      ...task,
      status: 'claimed',
      owner: worker,
      attempt: task.attempt + 1,
      claimExpiresAtMs: nowMs + leaseMs,
    },
  }
}

/**
 * Whether a write from `worker` at `attempt` is still authorized.
 *
 * The attempt must match exactly, not merely be recent. An attempt above the
 * task's current one did not come from this board, and admitting it would let
 * a forged number outrank every real claim.
 * @param task - the task being written to.
 * @param worker - the writing worker.
 * @param attempt - the attempt number the worker holds.
 * @returns whether the write may proceed.
 */
export function isClaimCurrent(task: Task, worker: WorkerId, attempt: Attempt): boolean {
  return task.owner === worker && task.attempt === attempt
}

/** Why a release was refused. */
export type ReleaseDenialReason =
  /** The task is not claimed, so there is nothing to give back. */
  | 'not-held'
  /** The claim belongs to another worker. */
  | 'not-owner'
  /** The attempt presented is not the task's current one. */
  | 'stale-attempt'

/** The outcome of giving a claim back. */
export type ReleaseDecision =
  | { readonly released: true; readonly task: Task }
  | { readonly released: false; readonly reason: ReleaseDenialReason }

/**
 * Decide one release: a holder giving its claim back before it lapses
 * (must[0]).
 *
 * **Why a claim needs a way back at all.** Without one, a holder that finished
 * an attempt keeps the task looking owned until the lease expires, so the SAME
 * holder starting a second attempt on the same task is refused by its own dead
 * claim. Expiry alone cannot separate "the holder is gone" from "the holder
 * finished and is starting again", and waiting out a lease to do legitimate
 * work is the cost of not being able to say so.
 *
 * **Fenced by the attempt, which is the claim's generation.** A holder whose
 * claim lapsed and was reclaimed by someone else can still finish and try to
 * release; accepting that would strip the NEW holder's claim on the say-so of a
 * worker that no longer has one. The attempt must be the task's current one,
 * exactly as it must for a receipt.
 *
 * The task returns to `open` only from `claimed` — nothing was submitted, so
 * the work is there to be redone. A task whose work was already submitted or
 * verified keeps that status and merely loses its owner: releasing a claim
 * reports that the holder stopped holding it, never that the work went away.
 * @param task - the task being released.
 * @param worker - the worker giving the claim back.
 * @param attempt - the attempt number that worker holds.
 * @returns the released task, or why the release was refused.
 */
export function decideRelease(task: Task, worker: WorkerId, attempt: Attempt): ReleaseDecision {
  if (task.owner === null) return { released: false, reason: 'not-held' }
  if (task.owner !== worker) return { released: false, reason: 'not-owner' }
  if (task.attempt !== attempt) return { released: false, reason: 'stale-attempt' }
  return {
    released: true,
    task: {
      ...task,
      status: task.status === 'claimed' ? 'open' : task.status,
      owner: null,
      claimExpiresAtMs: null,
    },
  }
}

/** Why a task graph was rejected at submission. */
export type GraphDefectReason = 'dependency-cycle' | 'unknown-dependency' | 'self-dependency'

/** The outcome of validating a submitted task graph. */
export type GraphValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: GraphDefectReason; readonly detail: string }

/**
 * Validate a task graph at submission time (acceptance[2]).
 *
 * Cycles are refused when the graph is submitted rather than discovered when a
 * claim deadlocks. A cycle detected at claim time presents as "nothing is
 * claimable" — indistinguishable from a board whose dependencies are merely
 * unfinished, and an operator would wait instead of fixing it.
 * @param tasks - the submitted task set.
 * @returns valid, or the first defect found.
 */
export function validateTaskGraph(tasks: readonly Task[]): GraphValidation {
  const byId = new Map(tasks.map(task => [task.id, task]))
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) return { valid: false, reason: 'self-dependency', detail: task.id }
      if (!byId.has(dependency)) {
        return { valid: false, reason: 'unknown-dependency', detail: `${task.id} -> ${dependency}` }
      }
    }
  }
  const visiting = new Set<TaskId>()
  const done = new Set<TaskId>()
  const walk = (id: TaskId): TaskId[] | undefined => {
    if (done.has(id)) return undefined
    if (visiting.has(id)) return [id]
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      const cycle = walk(dependency)
      if (cycle !== undefined) return [id, ...cycle]
    }
    visiting.delete(id)
    done.add(id)
    return undefined
  }
  for (const task of tasks) {
    const cycle = walk(task.id)
    if (cycle !== undefined) {
      return { valid: false, reason: 'dependency-cycle', detail: cycle.join(' -> ') }
    }
  }
  return { valid: true }
}

/**
 * The task store: where a claim actually becomes atomic (Epic P5-11
 * acceptance[0]).
 *
 * `./types.ts` decides whether a claim SHOULD succeed given a task's state.
 * That decision is pure and says nothing about two workers deciding at once.
 * This module is the part that makes "exactly one winner" true: the decision
 * and the write happen without an intervening suspension point, so two callers
 * cannot both read an open task and both write themselves as owner.
 *
 * **Single-process atomicity only.** These methods are synchronous and the
 * store is in-memory, so the guarantee holds within one process. A shared
 * store across processes needs the write to be conditional on the attempt
 * number it read -- a compare-and-set the backing store enforces -- and that
 * is not implemented here. Stated because "atomic" is a word that invites
 * more confidence than the implementation earns.
 *
 * @module @deepseek-ai/dsh-taskboard/store
 */

import { decideClaim, validateTaskGraph } from './types.ts'
import type { ClaimDecision, GraphValidation, Task, TaskId, WorkerId } from './types.ts'

/** Why a submission was refused. */
export type SubmitRefusalReason = 'graph-invalid' | 'duplicate-task'

/** The outcome of submitting a task graph. */
export type SubmitOutcome =
  | { readonly submitted: true }
  | { readonly submitted: false; readonly reason: SubmitRefusalReason; readonly detail: string }

/** An in-memory taskboard. */
export class TaskStore {
  private readonly tasks = new Map<TaskId, Task>()

  /**
   * Submit a task graph, refusing cycles before anything is stored
   * (acceptance[2]).
   *
   * Validates the WHOLE submission against the tasks already present, not the
   * submission alone: a cycle can close across two separately-valid batches,
   * and validating each in isolation would admit it.
   * @param tasks - the tasks to add.
   * @returns whether the submission was accepted.
   */
  submit(tasks: readonly Task[]): SubmitOutcome {
    for (const task of tasks) {
      if (this.tasks.has(task.id)) {
        return { submitted: false, reason: 'duplicate-task', detail: task.id }
      }
    }
    const combined = [...this.tasks.values(), ...tasks]
    const validation: GraphValidation = validateTaskGraph(combined)
    if (!validation.valid) {
      return { submitted: false, reason: 'graph-invalid', detail: `${validation.reason}: ${validation.detail}` }
    }
    for (const task of tasks) this.tasks.set(task.id, task)
    return { submitted: true }
  }

  /** The task with this id, or `undefined`. */
  get(id: TaskId): Task | undefined {
    return this.tasks.get(id)
  }

  /**
   * Claim a task for `worker`, atomically within this process.
   *
   * Reads the task, decides, and writes with no `await` between them, so two
   * callers cannot interleave. The decision itself is delegated rather than
   * reimplemented, so the rule a claim follows is the same one the pure
   * function states and cannot drift from it.
   * @param id - the task to claim.
   * @param worker - the claiming worker.
   * @param nowMs - the instant to judge expiry against.
   * @param leaseMs - how long the claim should hold.
   * @returns the claim decision; on success the store already holds the update.
   */
  claim(id: TaskId, worker: WorkerId, nowMs: number, leaseMs: number): ClaimDecision {
    const task = this.tasks.get(id)
    if (task === undefined) return { claimed: false, reason: 'not-claimable' }
    const dependencies = task.dependsOn
      .map(dependency => this.tasks.get(dependency))
      .filter((dependency): dependency is Task => dependency !== undefined)
    const decision = decideClaim(task, worker, nowMs, leaseMs, dependencies)
    if (decision.claimed) this.tasks.set(id, decision.task)
    return decision
  }

  /** Every task currently held, in insertion order. */
  list(): readonly Task[] {
    return [...this.tasks.values()]
  }
}

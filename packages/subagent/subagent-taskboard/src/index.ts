/**
 * The taskboard's producer: one task per delegated child (Epic P5-11 Usage).
 *
 * **P5-11 shipped three primitives nothing created.** `decideClaim`,
 * `validateTaskGraph` and the store all had callers only in their own tests, so
 * every clause about what a claim or a receipt does was true of a library and
 * of nothing this harness runs. BLOCKED-154 recorded the reason: the epic had
 * no MOMENT to attach to the way P4-06 had a message arriving and P4-07 had a
 * run starting.
 *
 * The moment is delegation. `subagent/start` and `subagent/end` already bracket
 * every child of both shapes — one-shot runs and continuable Activations,
 * including cold resumes — and carry the child id and the delegating parent.
 * That pair maps onto the board exactly: the task IS the delegated work, its
 * owner is the parent that delegated it, its attempt is the activation epoch,
 * and its receipt is the child's terminal stop reason.
 *
 * **The board RECORDS; it does not decide whether a child may run.** A refused
 * claim is reported, not enforced, and the reason is a real gap rather than
 * caution: making the board authoritative over activation needs a claim a
 * finishing epoch can give back, and `TaskStoreContract` has no `release` — a
 * host that legitimately resumes its own child would be refused by its own
 * expired-but-unreleased claim. `@deepseek-ai/dsh-lease-contract` has that
 * method because P4-07 needed it; adding it here is a change to P5-11's
 * accepted Contract stage, so this plugin observes the refusal and says so.
 *
 * @module @deepseek-ai/dsh-subagent-taskboard
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { SubagentRunEndInfo, SubagentRunInfo, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { Attempt, Task, TaskId, TaskReceipt, WorkerId } from '@deepseek-ai/dsh-taskboard'
import z from '@deepseek-ai/schemastery'

export const name = 'subagent-taskboard'

/**
 * Both are required: without `subagents` nothing emits the lifecycle pair, and
 * without `taskStore` there is no board to record on. Neither has a meaningful
 * degraded mode — a producer with no board is the state this plugin exists to
 * end.
 */
export const inject = ['subagents', 'taskStore']

/** How long a delegation's claim holds. */
export interface Config {
  /**
   * How long the claim on a delegated child holds, in milliseconds.
   *
   * Deployment-varying because it is a bet on how long a child runs: a claim
   * shorter than the work lets a second host see the task as reclaimable while
   * the first is still driving it, and one much longer leaves a crashed host's
   * task looking owned. A profile whose children are one-shot tool calls and
   * one whose children run for an hour need different answers.
   */
  claimLeaseMs: number
}

/** Runtime configuration schema, validated at mount from the profile's `cordis.yml` row. */
export const Config: z<Config> = z.object({
  claimLeaseMs: z.number().required(),
}) as z<Config>

/**
 * Which board attempt each live run holds, keyed by the run id both lifecycle
 * edges carry.
 *
 * Held in memory deliberately. A receipt must name the attempt its claim was
 * granted at, and if this process dies before the child settles, no receipt is
 * the correct outcome: the task stays claimed until it lapses, which is the
 * state a reclaim is defined against. Persisting the pairing would let a
 * restarted host report work it did not observe finish.
 */
type LiveClaims = Map<string, Attempt>

/**
 * Record each delegated child on the mounted taskboard.
 * @param ctx - the mounting context, carrying `subagents` and `taskStore`.
 * @param config - the validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const claims: LiveClaims = new Map()

  ctx.on('subagent/start', function (this: Scoped<SubagentRuntime>, info: SubagentRunInfo) {
    const worker = workerOf(this)
    if (worker === undefined) return
    const taskId = brandString<TaskId>(info.id)
    // Submitted on first sight only. A cold resume re-activates a child this
    // board already holds, and `submit` reports that as `duplicate-task` —
    // which is the correct answer, not a failure: the task outlives the epoch.
    ctx.taskStore.submit([openTask(taskId)])
    const decision = ctx.taskStore.claim(taskId, worker, Date.now(), config.claimLeaseMs)
    if (!decision.claimed) {
      // Reported rather than enforced: see the module note. An operator seeing
      // this is looking at two hosts driving one child, which is a real
      // condition even though nothing here stops it.
      ctx.logger.warn(`subagent-taskboard: ${info.id} claimed by another worker (${decision.reason}); not recording this epoch`)
      return
    }
    claims.set(info.runId, decision.task.attempt)
  })

  ctx.on('subagent/end', function (this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo) {
    const worker = workerOf(this)
    const attempt = claims.get(info.runId)
    claims.delete(info.runId)
    if (worker === undefined || attempt === undefined) return
    // acceptance[1]: the RUNTIME advances the task from evidence. The model is
    // never asked to update it, and never could — nothing model-facing reads
    // or writes this board.
    const receipt: TaskReceipt = {
      taskId: brandString<TaskId>(info.id),
      worker,
      attempt,
      kind: info.stopReason === 'completed' ? 'submitted' : 'failed',
    }
    const outcome = ctx.taskStore.applyReceipt(receipt)
    if (!outcome.advanced) {
      ctx.logger.warn(`subagent-taskboard: receipt for ${info.id} refused (${outcome.reason})`)
    }
  })
}

/**
 * The worker a delegation belongs to: the parent session driving the child.
 *
 * The parent rather than the child, because the claim answers "who is
 * responsible for this work" and a child does not choose to be delegated. Two
 * hosts that both resume one continuable child are two workers contending for
 * one task; the child is the same either way.
 * @param carrier - the scoped dispatch carrier the lifecycle edge arrives on.
 * @returns the parent session as a worker, or `undefined` when the carrier
 *   names no parent — a run whose delegating agent is already gone has nobody
 *   to hold the claim.
 */
function workerOf(carrier: Scoped<SubagentRuntime>): WorkerId | undefined {
  const parent = carrierKeyOf(carrier) as Agent | undefined
  return parent === undefined ? undefined : brandString<WorkerId>(parent.session.id)
}

/**
 * An unclaimed task for one delegated child.
 *
 * `dependsOn` is empty and stays empty: a delegation is ordered by whoever
 * issued it, and inventing dependencies between children here would be this
 * plugin deciding a shape the board deliberately leaves to its caller.
 * @param id - the child session id, used as the task id.
 * @returns the task as it is first submitted.
 */
function openTask(id: TaskId): Task {
  return {
    id,
    status: 'open',
    owner: null,
    attempt: 0,
    claimExpiresAtMs: null,
    outputs: [],
    verification: 'unverified',
    dependsOn: [],
  }
}

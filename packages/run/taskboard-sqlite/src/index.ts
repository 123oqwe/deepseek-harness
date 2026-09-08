/**
 * The Cordis plugin that publishes the durable taskboard as a service
 * (Epic P5-11 Provider).
 *
 * Without it every consumer opens its own board, which puts the storage choice
 * — and the directory it lives in — inside each consumer. A delegating runtime
 * that calls `openTaskStore` decides for its callers where tasks live and
 * cannot be pointed at a shared one from a profile, which is the arrangement
 * acceptance[0] is about: two hosts contend for one task only when they were
 * pointed at one board. Mounting it once and letting consumers inject it moves
 * that decision to the profile, where a deployment can answer it.
 *
 * @module @deepseek-ai/dsh-taskboard-sqlite
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ClaimDecision,
  ReceiptOutcome,
  SubmitOutcome,
  Task,
  TaskId,
  TaskReceipt,
  TaskStoreContract,
  WorkerId,
} from '@deepseek-ai/dsh-taskboard'
import z from '@deepseek-ai/schemastery'
import { openTaskStore } from './store.ts'

export { openTaskStore } from './store.ts'

/** Where this mount keeps its tasks. */
export interface Config {
  /**
   * Directory holding `taskboard.sqlite`.
   *
   * Deployment-varying, and it is the setting that decides whether the board
   * coordinates anything: two hosts that must not both drive one delegated
   * child need the same directory, while a laptop keeps its board beside the
   * workspace. Only the profile knows which arrangement it is in.
   */
  directory: string
}

/**
 * The mounted durable taskboard, published as `ctx.taskStore`.
 *
 * Implements the store contract itself and forwards, so a consumer injecting
 * the service holds exactly what the contract describes and never learns that
 * SQLite is behind it.
 */
export default class TaskStorePlugin extends Service implements TaskStoreContract {
  /** Runtime configuration schema, validated at mount from the profile's `cordis.yml` row. */
  static Config = z.object({
    directory: z.string().required(),
  }) as z<Config>

  private opened: TaskStoreContract | undefined

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.taskStore`.
   * @param config - the validated configuration, naming the directory the board lives in.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'taskStore')
  }

  /**
   * Open the database at mount.
   *
   * In `Service.init` rather than in the constructor, for the reason
   * `@deepseek-ai/dsh-lease-sqlite` records: creating the directory and opening
   * SQLite are the two steps that can fail on a real deployment, and a
   * constructor that throws during service construction unwinds the tree into
   * `cannot create effect on inactive context` — a message naming neither the
   * path nor the database.
   * @yields the teardown that releases the store handle.
   */
  * [Service.init](): Generator<() => void, void, void> {
    this.opened = openTaskStore(this.config.directory)
    yield () => { this.opened = undefined }
  }

  /**
   * The opened board.
   * @returns the store this mount opened.
   * @throws when read before the mount finished, which no consumer can do —
   * `inject` holds them until the service is available.
   */
  private get store(): TaskStoreContract {
    if (this.opened === undefined) throw new Error('TaskStorePlugin used before its mount opened the database')
    return this.opened
  }

  /**
   * Submit a task graph, refusing cycles before anything is stored.
   * @param tasks - the tasks to add.
   * @returns whether the submission was accepted.
   */
  submit(tasks: readonly Task[]): SubmitOutcome {
    return this.store.submit(tasks)
  }

  /**
   * The task with this id.
   * @param id - the task to look up.
   * @returns the task, or `undefined` when this board holds none with that id.
   */
  get(id: TaskId): Task | undefined {
    return this.store.get(id)
  }

  /**
   * Claim a task for `worker`, serialized against every other host on this board.
   * @param id - the task to claim.
   * @param worker - the claiming worker.
   * @param nowMs - the instant to judge claim expiry against.
   * @param leaseMs - how long the new claim should hold.
   * @returns the claim decision; on success the board already holds the update.
   */
  claim(id: TaskId, worker: WorkerId, nowMs: number, leaseMs: number): ClaimDecision {
    return this.store.claim(id, worker, nowMs, leaseMs)
  }

  /**
   * Advance a task from a receipt, without the model touching it.
   * @param receipt - the evidence being applied.
   * @returns the advanced task, or why the receipt was refused.
   */
  applyReceipt(receipt: TaskReceipt): ReceiptOutcome {
    return this.store.applyReceipt(receipt)
  }

  /**
   * Every task currently held.
   * @returns the tasks, in submission order.
   */
  list(): readonly Task[] {
    return this.store.list()
  }
}

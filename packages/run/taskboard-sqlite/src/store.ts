/**
 * The durable taskboard (Epic P5-11 acceptance[0]).
 *
 * **acceptance[0] is about PROCESSES, and a `Map` cannot be about processes.**
 * `TaskStore` keeps its tasks in one, so "only one worker wins a contended
 * claim" held between two callers inside a single process — which is also all
 * its stress case could show, running a hundred workers sequentially against a
 * pure function. Two real workers are two processes, they each held their own
 * map, and both won.
 *
 * SQLite supplies the one property the clause turns on: `BEGIN IMMEDIATE`
 * makes the read-decide-write of a claim a serialized write, so two processes
 * reaching it together cannot both be told they hold the task. The decision
 * itself is still `decideClaim`'s — this provider stores and serializes; it
 * does not re-decide, because a second implementation of "may this worker
 * claim" is the shape BLOCKED-136 records and this would be the copy that
 * hands one task to two workers.
 *
 * @module @deepseek-ai/dsh-taskboard-sqlite/store
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { decideClaim, decideRelease, isClaimCurrent, TaskStore, validateTaskGraph } from '@deepseek-ai/dsh-taskboard'
import type {
  ClaimDecision,
  ReceiptOutcome,
  ReleaseDecision,
  SubmitOutcome,
  Task,
  TaskId,
  TaskReceipt,
  TaskStoreContract,
  WorkerId,
} from '@deepseek-ai/dsh-taskboard'

/** The schema this provider owns; `taskboard.sqlite` carries its own version. */
const SCHEMA = [
  // Contention must WAIT rather than fail: two workers claiming different
  // tasks at the same moment is ordinary, and the loser of the write lock
  // should proceed a millisecond later.
  'PRAGMA busy_timeout = 5000',
  'CREATE TABLE IF NOT EXISTS schema_version (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL)',
  'INSERT OR IGNORE INTO schema_version (singleton, version) VALUES (1, 1)',
  // The task is stored as its own JSON rather than as columns. The shape is
  // `dsh-taskboard`'s and changes with that package; mirroring it in DDL would
  // be a second declaration of one record, and the queries this store runs are
  // by id or all-rows, never by field.
  'CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, task TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS task_seq (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), next INTEGER NOT NULL)',
  'INSERT OR IGNORE INTO task_seq (singleton, next) VALUES (1, 0)',
]

/**
 * Open (creating if absent) the durable taskboard under one directory.
 * @param directory - the directory holding `taskboard.sqlite`.
 * @returns a store honouring the taskboard contract, backed by SQLite.
 */
export function openTaskStore(directory: string): TaskStoreContract {
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(join(directory, 'taskboard.sqlite'))
  for (const statement of SCHEMA) db.exec(statement)

  const readAll = (): Task[] =>
    (db.prepare('SELECT task FROM tasks ORDER BY seq').all() as unknown as { task: string }[])
      .map(row => JSON.parse(row.task) as Task)

  const readOne = (id: TaskId): Task | undefined => {
    const row = db.prepare('SELECT task FROM tasks WHERE id = ?').get(id) as { task: string } | undefined
    return row === undefined ? undefined : JSON.parse(row.task) as Task
  }

  const write = (task: Task): void => {
    const next = (db.prepare('SELECT next FROM task_seq WHERE singleton = 1').get() as { next: number }).next
    db.prepare('INSERT INTO tasks (id, seq, task) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET task = excluded.task')
      .run(task.id, next, JSON.stringify(task))
    db.prepare('UPDATE task_seq SET next = ? WHERE singleton = 1').run(next + 1)
  }

  return {
    submit(tasks: readonly Task[]): SubmitOutcome {
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const task of tasks) {
          if (readOne(task.id) !== undefined) {
            db.exec('COMMIT')
            return { submitted: false, reason: 'duplicate-task', detail: task.id }
          }
        }
        // Validated against everything already stored, not against the batch
        // alone: a cycle can close across two separately-valid submissions,
        // and the whole submission is inside this transaction so a concurrent
        // one cannot close a cycle underneath it.
        const validation = validateTaskGraph([...readAll(), ...tasks])
        if (!validation.valid) {
          db.exec('COMMIT')
          return { submitted: false, reason: 'graph-invalid', detail: `${validation.reason}: ${validation.detail}` }
        }
        for (const task of tasks) write(task)
        db.exec('COMMIT')
        return { submitted: true }
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    get: id => readOne(id),

    claim(id: TaskId, worker: WorkerId, nowMs: number, leaseMs: number): ClaimDecision {
      // One transaction around read, decide and write. Two processes reaching
      // this line together are serialized by SQLite, so the loser reads the
      // winner's row rather than the task as it was — which is the whole
      // reason a `Map` could not carry acceptance[0].
      db.exec('BEGIN IMMEDIATE')
      try {
        const task = readOne(id)
        if (task === undefined) {
          db.exec('COMMIT')
          return { claimed: false, reason: 'not-claimable' }
        }
        const dependencies = task.dependsOn
          .map(dependency => readOne(dependency))
          .filter((dependency): dependency is Task => dependency !== undefined)
        const decision = decideClaim(task, worker, nowMs, leaseMs, dependencies)
        if (decision.claimed) write(decision.task)
        db.exec('COMMIT')
        return decision
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    release(id: TaskId, worker: WorkerId, attempt: number): ReleaseDecision {
      // Same transaction discipline as `claim`, and for the same reason: a
      // release read outside the lock could strip a claim that was reclaimed
      // between the read and the write.
      db.exec('BEGIN IMMEDIATE')
      try {
        const task = readOne(id)
        if (task === undefined) {
          db.exec('COMMIT')
          return { released: false, reason: 'not-held' }
        }
        const decision = decideRelease(task, worker, attempt)
        if (decision.released) write(decision.task)
        db.exec('COMMIT')
        return decision
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    applyReceipt(receipt: TaskReceipt): ReceiptOutcome {
      db.exec('BEGIN IMMEDIATE')
      try {
        const task = readOne(receipt.taskId)
        if (task === undefined) {
          db.exec('COMMIT')
          return { advanced: false, reason: 'unknown-task' }
        }
        if (task.owner !== receipt.worker) {
          db.exec('COMMIT')
          return { advanced: false, reason: 'not-owner' }
        }
        // A worker whose claim lapsed and was reclaimed can still finish and
        // report; accepting that report would overwrite the new holder's task
        // with the old holder's result.
        if (!isClaimCurrent(task, receipt.worker, receipt.attempt)) {
          db.exec('COMMIT')
          return { advanced: false, reason: 'stale-attempt' }
        }
        // Inside the transaction, not after it: an earlier draft committed
        // the checks and then wrote, which put the read and the write on
        // opposite sides of the lock and let a concurrent reclaim land between
        // them — the exact interleaving BEGIN IMMEDIATE is here to prevent.
        const outcome = applyThroughMemory(task, receipt, write)
        db.exec('COMMIT')
        return outcome
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    list: () => readAll(),
  }
}

/**
 * Apply one receipt through the in-memory store's own transition rules.
 *
 * The legality table and the advanced-task shape are `dsh-taskboard`'s, and
 * restating them here would be a second implementation of which receipt may
 * follow which status — the difference this provider must not have. A fresh
 * single-task board decides, and only its result is written. Cheap: the board
 * is a `Map` with one entry, and it is discarded immediately.
 * @param task - the task as this store holds it.
 * @param receipt - the evidence being applied.
 * @param write - persists the advanced task.
 * @returns the advanced task, or why the receipt was refused.
 */
function applyThroughMemory(task: Task, receipt: TaskReceipt, write: (task: Task) => void): ReceiptOutcome {
  const board = new TaskStore()
  board.submit([task])
  const outcome = board.applyReceipt(receipt)
  if (outcome.advanced) write(outcome.task)
  return outcome
}

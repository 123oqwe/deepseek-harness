/**
 * Provider-stage Run Service for Epic P4-01: the durable Run registry that
 * turns `./state-machine.ts`'s pure Contract-stage decisions into a
 * first-class service whose Runs outlive the process that accepted them.
 *
 * Contract stage landed the decisions themselves — which transitions are
 * legal (`transition`), which Runs are non-terminal (`listNonTerminalRuns`),
 * whether a Run may resume (`resumeRun`) — as pure functions over a `Run`
 * value or a plain array of them that some caller already had in hand.
 * Nothing at that stage produced that array: acceptance[0] ("after a process
 * restart, every non-terminal Run can be listed and resumed") is unreachable
 * from a caller-supplied in-memory array, because the restart is exactly the
 * event that destroys it. This module supplies the missing half: a
 * {@link RunStore} durability seam, a real file-backed store over it, and a
 * {@link RunService} that writes every accepted Run and every accepted
 * transition through to that store and reconstructs the complete registry
 * from it on the next boot.
 *
 * **Why not `@deepseek-ai/dsh-session-persistence`'s coordinator.** Runs are
 * not stored through `PersistenceCoordinator`. Its whole storage contract is
 * keyed on session identity and session-log structure — `PersistenceBackend`
 * reads and writes by `SessionId`, its records are `SessionEvent`s under a
 * `SessionHeader` gated by `SESSION_FORMAT_VERSION`, and every operation is
 * serialized on a per-`SessionId` chain. Storing a Run there would make a
 * Run's durable existence a function of some Session's, which is precisely
 * what must[2] forbids: the Run is owned by the service itself, never a UI
 * session or turn holder. A Run outliving, preceding, and spanning several
 * Sessions (acceptance[2]) cannot be a row inside any one of their logs.
 * That package is therefore left untouched by this stage.
 *
 * Every function below has a real, epic-accurate signature and a placeholder
 * (`'not implemented'`) body — the Provider-stage RED scaffold this program's
 * prior stages follow. `tests/run-service.spec.ts` asserts the behavior a
 * later fix-round must satisfy.
 *
 * @module @deepseek-ai/dsh-run
 */

import type { RunId } from '@deepseek-ai/dsh-principal/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  Run,
  RunEntityReference,
  RunResumeDecision,
  RunState,
  RunTransitionDecision,
} from './types.ts'

export * from './types.ts'
export * from './events.ts'
export * from './state-machine.ts'

/**
 * The durability seam a {@link RunService} writes its Runs through
 * (acceptance[0]). Deliberately minimal — whole-Run reads and whole-Run
 * writes — because a `Run` already carries its own complete append-only
 * event log (must[1]) as one immutable value: there is no partial-Run update
 * a store would have to reconcile, so a store implementation cannot reorder
 * or drop a log entry the service did not itself drop.
 *
 * An implementation must be durable across a process restart: two store
 * instances constructed over the same underlying medium observe the same
 * Runs. {@link RunService.restore} is the only caller of {@link loadAll}, and
 * {@link RunService}'s accept/advance/attach paths are the only callers of
 * {@link put}.
 */
export interface RunStore {
  /**
   * Read every Run this store has on record, in no guaranteed order.
   * @returns every durably recorded {@link Run}; empty on a medium that has
   * never had a Run written to it (a first boot), never a rejection.
   */
  loadAll(): Promise<readonly Run[]>

  /**
   * Durably record `run` as the current state of the Run with `run.id`,
   * replacing any earlier record of the same id. Returns once the write is
   * durable.
   * @param run - the complete Run value to record, including its full event log.
   */
  put(run: Run): Promise<void>
}

/**
 * A real file-backed {@link RunStore}: one JSON document at `path` holding
 * every Run by id, rewritten in full on each {@link RunStore.put}. Durable
 * across a process restart — a second store constructed over the same `path`
 * reads back exactly the Runs the first one wrote, including each
 * {@link RunEvent}'s `seq` brand and each Run's `sessionIds` order.
 * @param path - filesystem path of the store's document; a path that does not
 * exist yet is a first boot, not an error, and is created on the first `put`.
 * @returns a store over `path`.
 */
export function createFileRunStore(path: string): RunStore {
  throw new Error(`not implemented: createFileRunStore(${path})`)
}

/**
 * Epic P4-01's first-class Run Service: the owner of every Run's identity,
 * state, and event log (must[2]), backed by a {@link RunStore} so the
 * registry survives the process that created it (acceptance[0]).
 *
 * Every state decision is delegated to `./state-machine.ts` — this class adds
 * durability and registry lookup, never a second, divergent transition table.
 */
export class RunService {
  /**
   * @param store - the durability seam every accepted Run and accepted
   * transition is written through.
   * @param runs - the registry this service starts from, keyed by Run id;
   * {@link RunService.restore} supplies the reconstructed contents of `store`.
   */
  private constructor(private readonly store: RunStore, private readonly runs: Map<RunId, Run>) {}

  /**
   * acceptance[0]'s restart entry point: build a service whose registry is
   * reconstructed entirely from `store`'s durable contents. This is the only
   * way to obtain a `RunService` — a fresh process has no in-memory registry
   * to start from, so there is no constructor path that could silently begin
   * with an empty one while durable Runs sit unlisted in the store.
   * @param store - the durable store to reconstruct the registry from.
   * @returns a service registering exactly the Runs `store` holds.
   */
  static restore(store: RunStore): Promise<RunService> {
    return Promise.reject(new Error(`not implemented: RunService.restore(${typeof store} RunStore)`))
  }

  /**
   * must[0]/must[2]'s Run-acceptance entry point: mint a new Run via
   * `./state-machine.ts`'s `createRun` (so `ownerId` is
   * `RUN_SERVICE_OWNER_ID`, never `initialSessionId`), register it, and
   * durably record it before returning.
   * @param id - the new Run's identity; rejects when this service already registers it.
   * @param initialSessionId - the Session that requested this Run.
   * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this Run is accepted at.
   * @returns the newly accepted, durably recorded {@link Run}.
   */
  accept(id: RunId, initialSessionId: SessionId, occurredAt: number): Promise<Run> {
    return Promise.reject(new Error(`not implemented: RunService.accept(${id}, ${initialSessionId}, ${occurredAt}) against its ${typeof this.store} RunStore holding ${this.runs.size} runs`))
  }

  /**
   * acceptance[1]'s state-transition entry point: ask `./state-machine.ts`'s
   * `transition` whether the registered Run `id` may move to `to`, and durably
   * record the advanced Run iff it may. A refused transition writes nothing —
   * the store still holds exactly the Run it held before the call, with its
   * event log unextended (must[1]'s append-only log gains no entry for a
   * transition that never happened).
   * @param id - the registered Run to transition; rejects when unregistered.
   * @param to - the state the Run is asked to move to.
   * @param references - entities this transition names (must[1]), possibly empty.
   * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this transition is stamped with.
   * @returns `./state-machine.ts`'s decision, unchanged.
   */
  advance(
    id: RunId,
    to: RunState,
    references: readonly RunEntityReference[],
    occurredAt: number,
  ): Promise<RunTransitionDecision> {
    return Promise.reject(new Error(`not implemented: RunService.advance(${id}, ${to}, ${references.length} refs, ${occurredAt}) against its ${typeof this.store} RunStore`))
  }

  /**
   * acceptance[2]'s Session-association entry point: durably add `sessionId`
   * to the registered Run `id`'s `sessionIds`, proving one Run spans multiple
   * Sessions/Agents across restarts. Idempotent, per
   * `./state-machine.ts`'s `attachSessionToRun`.
   * @param id - the registered Run to associate an additional Session with; rejects when unregistered.
   * @param sessionId - the Session/Agent to add.
   * @returns the Run with `sessionId` present in `sessionIds`.
   */
  attachSession(id: RunId, sessionId: SessionId): Promise<Run> {
    return Promise.reject(new Error(`not implemented: RunService.attachSession(${id}, ${sessionId}) against its ${typeof this.store} RunStore`))
  }

  /**
   * acceptance[0]'s listing entry point: every registered Run that is not in
   * a terminal state, decided by `./state-machine.ts`'s
   * `listNonTerminalRuns` over this service's registry — the complete set a
   * restarted process must be able to offer for resumption.
   * @returns exactly the registered non-terminal Runs.
   */
  listNonTerminal(): readonly Run[] {
    throw new Error(`not implemented: RunService.listNonTerminal() over ${this.runs.size} registered runs`)
  }

  /**
   * acceptance[0]'s resumption entry point: `./state-machine.ts`'s
   * `resumeRun` applied to the registered Run `id`.
   * @param id - the registered Run to resume; rejects when unregistered.
   * @returns `{ resumed: true, run }` for a non-terminal Run, or
   * `{ resumed: false, reason: 'already-terminal' }`.
   */
  resume(id: RunId): RunResumeDecision {
    throw new Error(`not implemented: RunService.resume(${id}) over ${this.runs.size} registered runs`)
  }

  /**
   * acceptance[2]'s "one Session associates with multiple Runs" query: every
   * registered Run whose `sessionIds` contains `sessionId`.
   * @param sessionId - the Session to look up Runs for.
   * @returns every matching registered Run; empty when the Session has none.
   */
  runsForSession(sessionId: SessionId): readonly Run[] {
    throw new Error(`not implemented: RunService.runsForSession(${sessionId}) over ${this.runs.size} registered runs`)
  }

  /**
   * Look one registered Run up by identity.
   * @param id - the Run to look up.
   * @returns the registered {@link Run}, or `undefined` when this service registers no such id.
   */
  get(id: RunId): Run | undefined {
    throw new Error(`not implemented: RunService.get(${id}) over ${this.runs.size} registered runs`)
  }
}

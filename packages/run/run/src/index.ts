/**
 * Epic P4-01's Run Service: the durable Run registry that
 * turns `./state-machine.ts`'s pure decisions into a
 * first-class service whose Runs outlive the process that accepted them,
 * plus the Cordis plugin that opens a Run for a real agent session.
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
 * That package is therefore left untouched.
 *
 * **The real caller.** {@link RunPlugin} is the Cordis plugin that gives the
 * registry one: mounted on a `Context` that also carries an agent registry,
 * it opens a Run for every agent session the harness starts
 * (`agent/session-start`), records the Run on the live {@link Agent} handle
 * (`Agent.runId`), and references each workflow execution the session runs
 * (`workflow/start`) in that Run's append-only log. Without it the registry
 * is reachable only from a caller that constructs it by hand.
 *
 * @module @deepseek-ai/dsh-run
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import { advanceAgentLifecycleFenced, advanceLeasedAgent, holdsDispatchSlot } from '@deepseek-ai/dsh-agent'
import type { AgentLifecycleState, AgentRunId, TransitionDenialReason } from '@deepseek-ai/dsh-agent'
import { acquireRunLease } from '@deepseek-ai/dsh-lease-contract'
import type { WorkItemId, WorkerId } from '@deepseek-ai/dsh-lease-contract'
// The `agent/session-start` declaration this plugin subscribes to is merged
// into Cordis's event map by the agent package's runtime face, not its
// type-only entry.
import type {} from '@deepseek-ai/dsh-agent'
import type { WorkflowRunId } from '@deepseek-ai/dsh-workflow/types'
import z from '@deepseek-ai/schemastery'
import type { RunId } from '@deepseek-ai/dsh-principal/types'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UserMessage } from '@deepseek-ai/dsh-llm/message'
import { compileTaskProfile } from '@deepseek-ai/dsh-task-profile'
// `taskOriginOf` is not on the package root: P4-02's Provider stage freezes
// `index.ts` at exactly one runtime export, so the classifier is reached through
// the module that declares it.
import { goalRoundOf, taskOriginOf } from '@deepseek-ai/dsh-task-profile/types'
import type { TaskProfileRef } from '@deepseek-ai/dsh-task-profile/types'
import { taskProfileRef } from '@deepseek-ai/dsh-task-profile/validate'
import {
  attachSessionToRun,
  createRun,
  LEGAL_RUN_TRANSITIONS,
  listNonTerminalRuns,
  resumeRun,
  RUN_SERVICE_OWNER_ID,
  TERMINAL_RUN_STATES,
  transition,
} from './state-machine.ts'
import type {
  Run,
  RunEntityReference,
  RunResumeDecision,
  RunState,
  RunTransitionDecision,
  WorkflowRef,
} from './types.ts'

export * from './types.ts'
export * from './events.ts'
export * from './state-machine.ts'

/**
 * The goal a message states, and the parts of it that statement leaves out.
 *
 * **Text blocks in order, everything else counted.** The loop's own flattening
 * idiom (`agent-loop`'s `runtime-context.ts`) yields `undefined` for anything
 * but a single text block, which made an image-led prompt refuse as
 * `empty-goal` and produce no profile at all — six recorded snapshot sessions
 * sat on that. Reading the text that IS there and reporting what was not read
 * follows must[2]'s own shape: the part nobody can express in text becomes a
 * question rather than a silent omission or an invented description.
 *
 * The counts are by the block's own `type`, not by a closed list, because the
 * content union is extensible and a kind this build does not recognise is
 * exactly the kind worth asking about.
 * @param message - the message this step was given.
 * @returns the joined text of its text blocks, and the count of each other block kind.
 */
function goalOf(message: UserMessage): { text: string; unread: readonly { kind: string; count: number }[] } {
  const text: string[] = []
  const counts = new Map<string, number>()
  for (const block of message.content) {
    if (block.type === 'text') text.push(block.text)
    else counts.set(block.type, (counts.get(block.type) ?? 0) + 1)
  }
  return { text: text.join('\n'), unread: [...counts].map(([kind, count]) => ({ kind, count })) }
}

/**
 * The profile reference the most recent `run/task-profile` event in a session
 * carries.
 *
 * Read from the log rather than from the Agent handle, because the case it
 * exists for is a RESUMED session: that session's events were restored, and the
 * handle driving them is new and carries nothing.
 * @param session - the session whose log to read.
 * @returns the latest reference, or `undefined` when the log holds no profile.
 */
function lastTaskProfileRef(session: Session): TaskProfileRef | undefined {
  const events = session.snapshotEvents()
  for (let seq = events.length - 1; seq >= 0; seq -= 1) {
    const event = events[seq]
    if (event?.type === 'run/task-profile') return (event.data as { ref: TaskProfileRef }).ref
  }
  return undefined
}

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
  // The chain is keyed on the resolved path rather than held per store
  // instance, so two stores over one path share it. A per-instance chain
  // serialized each store against itself only: two of them interleaved their
  // read-modify-write cycles and lost a Run, and — because the temporary file
  // below is named per process, not per store — collided on that name and
  // failed the rename outright.
  const key = resolvePath(path)
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const queue = pathQueues.get(key) ?? Promise.resolve()
    const next = queue.then(operation, operation)
    pathQueues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  const read = async (): Promise<Run[]> => {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      // A store file that was never written is a first boot, not a failure;
      // any other read failure (permissions, a directory at `path`) is real.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    if (text.trim() === '') return []
    const document = JSON.parse(text) as RunStoreDocument
    if (document.version !== RUN_STORE_FORMAT_VERSION) {
      throw new Error(
        `unsupported Run store format version ${String(document.version)} at ${path}, expected ${RUN_STORE_FORMAT_VERSION}`,
      )
    }
    for (const run of document.runs) assertRestorable(run, path)
    return [...document.runs]
  }

  const write = async (runs: readonly Run[]): Promise<void> => {
    const document: RunStoreDocument = { version: RUN_STORE_FORMAT_VERSION, runs }
    // **The directory is created first, and it is not defensive.** `dshHomePath`
    // builds a path and never creates it, so a machine that has never run `dsh`
    // has no `runs/` under its home — and `@deepseek-ai/dsh-lease-sqlite`, the
    // sibling store in this group, has always done this (`store.ts`'s
    // `mkdirSync(directory, { recursive: true })`). Without it every `put`
    // failed ENOENT, and nothing said so: the only caller's promise was awaited
    // in the plugin's disposer, where a rejection is swallowed by
    // `fiber.dispose()`. It surfaced only when P4-02 began awaiting a Run
    // transition inside a turn, which turned a discarded write failure into a
    // failed turn (BLOCKED-198, and BLOCKED-197 for the swallowing path).
    await mkdir(dirname(path), { recursive: true })
    // Write-then-rename: a crash mid-write leaves the previous complete
    // document in place at `path` rather than a truncated one.
    const temporaryPath = `${path}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(document)}\n`, 'utf8')
    await rename(temporaryPath, path)
  }

  return {
    loadAll: () => enqueue(read),
    put: (run: Run) =>
      enqueue(async () => {
        const runs = await read()
        // Replace in place so a Run keeps its original position in the
        // document across every later `put`.
        const index = runs.findIndex(existing => existing.id === run.id)
        if (index === -1) runs.push(run)
        else runs[index] = run
        await write(runs)
      }),
  }
}

/**
 * The read/write chain for each resolved store path in this process, shared by
 * every {@link createFileRunStore} over that path.
 *
 * Scope: one process. Two processes writing one store path still interleave
 * their read-modify-write cycles and can lose a Run; closing that needs
 * filesystem locking, which this store does not take.
 */
const pathQueues = new Map<string, Promise<unknown>>()

/**
 * Refuse a stored Run this service could not have written, so a damaged or
 * hand-edited store document never reaches the registry as a live Run.
 * Nothing downstream re-checks these: `listNonTerminalRuns` treats any state
 * outside {@link TERMINAL_RUN_STATES} as resumable, `resumeRun` re-stamps
 * `ownerId` (masking a foreign one), and `appendRunEvent` derives the next
 * `seq` from the log's length, so a gap makes it mint a `seq` a prior entry
 * already holds. The store is the only place these can still be caught.
 * @param run - one Run as read back from the store document.
 * @param path - the store document's path, named in the rejection.
 */
function assertRestorable(run: Run, path: string): void {
  if (!Object.hasOwn(LEGAL_RUN_TRANSITIONS, run.state)) {
    throw new Error(`run ${run.id} in Run store ${path} has state ${run.state}, which is not a Run state`)
  }
  if (run.ownerId !== RUN_SERVICE_OWNER_ID) {
    throw new Error(
      `run ${run.id} in Run store ${path} is owned by ${String(run.ownerId)}, not the Run Service (${RUN_SERVICE_OWNER_ID})`,
    )
  }
  run.events.forEach((event, index) => {
    if (Number(event.seq) !== index) {
      throw new Error(
        `run ${run.id} in Run store ${path} has an event log seq gap: entry ${String(index)} carries seq ${String(event.seq)}`,
      )
    }
  })
}

/** The on-disk format version {@link createFileRunStore} reads and writes. */
const RUN_STORE_FORMAT_VERSION = 1

/** The JSON document {@link createFileRunStore} keeps at its path. */
interface RunStoreDocument {
  readonly version: number
  readonly runs: readonly Run[]
}

/**
 * One line naming an unrecovered failure, for the lifecycle transition reason.
 * @param error - whatever the agent reported; `agent/error` types it `unknown`.
 * @returns the error's message, or its stringification when it is not an Error.
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
   * The read-decide-write chain for each registered Run, so two callers
   * mutating one Run never both decide against the same pre-mutation value.
   */
  private readonly chains = new Map<RunId, Promise<unknown>>()

  /**
   * Run `mutate` against the registered Run `id` with no other mutation of
   * that same Run interleaved: `mutate` observes the Run as of its turn in
   * `id`'s chain, and its result is durable before the next turn begins.
   * Mutations of different Runs stay concurrent — the chain is per Run, never
   * one lock over the whole registry.
   * @param id - the registered Run to mutate; rejects when unregistered.
   * @param mutate - decides the Run's next value from its current one; a
   * `undefined` result records nothing and leaves the registry untouched.
   * @returns whatever `mutate` returned, once any resulting write is durable.
   */
  private async serialize<T>(id: RunId, mutate: (run: Run) => { run?: Run | undefined; result: T }): Promise<T> {
    const apply = async (): Promise<T> => {
      const { run, result } = mutate(this.registered(id))
      if (run !== undefined) {
        await this.store.put(run)
        this.runs.set(id, run)
      }
      return result
    }
    const queue = this.chains.get(id) ?? Promise.resolve()
    // A rejected predecessor must not strand its Run's chain: the second
    // handler takes the same turn after a failed one.
    const next = queue.then(apply, apply)
    this.chains.set(
      id,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return await next
  }

  /**
   * acceptance[0]'s restart entry point: build a service whose registry is
   * reconstructed entirely from `store`'s durable contents. This is the only
   * way to obtain a `RunService` — a fresh process has no in-memory registry
   * to start from, so there is no constructor path that could silently begin
   * with an empty one while durable Runs sit unlisted in the store.
   * @param store - the durable store to reconstruct the registry from.
   * @returns a service registering exactly the Runs `store` holds.
   */
  static async restore(store: RunStore): Promise<RunService> {
    const runs = new Map<RunId, Run>()
    for (const run of await store.loadAll()) runs.set(run.id, run)
    return new RunService(store, runs)
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
  async accept(id: RunId, initialSessionId: SessionId, occurredAt: number): Promise<Run> {
    if (this.runs.has(id)) throw new Error(`run ${id} is already registered`)
    const run = createRun(id, initialSessionId, occurredAt)
    await this.store.put(run)
    this.runs.set(id, run)
    return run
  }

  /**
   * The Run-acceptance entry point for a caller that cannot await the durable
   * write: register a new Run in this service's registry immediately and hand
   * back the write it started, rather than awaiting that write first as
   * {@link RunService.accept} does.
   *
   * `RunPlugin` needs this because `agent/session-start` is emitted
   * synchronously and does not await its listeners — a Run that only became
   * visible after an awaited write would be absent from the registry for the
   * rest of the emitting call stack, including the code that reads
   * `Agent.runId` back. The caller owns the returned promise and must await
   * it before the process may exit; otherwise the Run is registered in memory
   * and missing from the store. Prefer {@link RunService.accept} wherever the
   * caller can await.
   * @param id - the new Run's identity; rejects when this service already registers it.
   * @param initialSessionId - the Session that requested this Run.
   * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this Run is accepted at.
   * @returns the newly accepted {@link Run}, and the promise resolving when it is durably recorded.
   */
  openForSession(id: RunId, initialSessionId: SessionId, occurredAt: number): { run: Run; durable: Promise<void> } {
    if (this.runs.has(id)) throw new Error(`run ${id} is already registered`)
    const run = createRun(id, initialSessionId, occurredAt)
    this.runs.set(id, run)
    return { run, durable: this.store.put(run) }
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
   *
   * **Ordering.** The decision is computed against the Run as of this call's
   * turn in `id`'s serialization chain, not as of the call. Concurrent calls
   * for one Run are therefore decided one after another, each seeing the
   * previous one's accepted result — so two callers can never both be told
   * `accepted: true` for mutually exclusive transitions out of one state, and
   * no accepted transition is overwritten in the append-only log by a decision
   * made against a value that predates it. A caller that needs a decision
   * against the Run as of the call has no way back to that behavior: reading
   * {@link RunService.get} first and acting on it is exactly the stale-snapshot
   * race this ordering exists to close.
   */
  async advance(
    id: RunId,
    to: RunState,
    references: readonly RunEntityReference[],
    occurredAt: number,
  ): Promise<RunTransitionDecision> {
    return await this.serialize(id, (run) => {
      const decision = transition(run, to, references, occurredAt)
      // A refused transition writes nothing, so its Run keeps the event log it
      // had — the chain simply hands the next caller the unchanged Run.
      return { run: decision.accepted ? decision.run : undefined, result: decision }
    })
  }

  /**
   * acceptance[2]'s Session-association entry point: durably add `sessionId`
   * to the registered Run `id`'s `sessionIds`, proving one Run spans multiple
   * Sessions/Agents across restarts. Idempotent, per
   * `./state-machine.ts`'s `attachSessionToRun`.
   * @param id - the registered Run to associate an additional Session with; rejects when unregistered.
   * @param sessionId - the Session/Agent to add.
   * @returns the Run with `sessionId` present in `sessionIds`.
   *
   * **Ordering.** Serialized with {@link RunService.advance} on the same Run's
   * chain, so two Sessions attaching concurrently both appear rather than one
   * overwriting the other's `sessionIds`.
   */
  async attachSession(id: RunId, sessionId: SessionId): Promise<Run> {
    return await this.serialize(id, (current) => {
      const run = attachSessionToRun(current, sessionId)
      return { run, result: run }
    })
  }

  /**
   * acceptance[0]'s listing entry point: every registered Run that is not in
   * a terminal state, decided by `./state-machine.ts`'s
   * `listNonTerminalRuns` over this service's registry — the complete set a
   * restarted process must be able to offer for resumption.
   * @returns exactly the registered non-terminal Runs.
   */
  listNonTerminal(): readonly Run[] {
    return listNonTerminalRuns([...this.runs.values()])
  }

  /**
   * acceptance[0]'s resumption entry point: `./state-machine.ts`'s
   * `resumeRun` applied to the registered Run `id`.
   * @param id - the registered Run to resume; rejects when unregistered.
   * @returns `{ resumed: true, run }` for a non-terminal Run, or
   * `{ resumed: false, reason: 'already-terminal' }`.
   */
  resume(id: RunId): RunResumeDecision {
    return resumeRun(this.registered(id))
  }

  /**
   * acceptance[2]'s "one Session associates with multiple Runs" query: every
   * registered Run whose `sessionIds` contains `sessionId`.
   * @param sessionId - the Session to look up Runs for.
   * @returns every matching registered Run; empty when the Session has none.
   */
  runsForSession(sessionId: SessionId): readonly Run[] {
    return [...this.runs.values()].filter(run => run.sessionIds.includes(sessionId))
  }

  /**
   * Look one registered Run up by identity.
   * @param id - the Run to look up.
   * @returns the registered {@link Run}, or `undefined` when this service registers no such id.
   */
  get(id: RunId): Run | undefined {
    return this.runs.get(id)
  }

  /**
   * The registered Run `id`, for the paths that have no decision to return
   * for an id this service does not know at all.
   * @param id - the Run to look up.
   * @returns the registered {@link Run}; throws when this service registers no such id.
   */
  private registered(id: RunId): Run {
    const run = this.runs.get(id)
    if (run === undefined) throw new Error(`run ${id} is not registered`)
    return run
  }
}

/**
 * The Run Service's Cordis face, registered as `ctx.runs` by
 * {@link RunPlugin}.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    runs: RunPlugin
  }
}

/**
 * must[1]'s Workflow-reference reconciliation. The Contract stage minted
 * {@link WorkflowRef} as a forward reference because no Workflow identity was
 * in its file scope; `@deepseek-ai/dsh-workflow`'s `WorkflowRunId` (one
 * workflow execution) is that identity. This function is the single, greppable
 * place the two brands meet, so a Run event log entry naming a Workflow always
 * names a real, running workflow execution rather than a parallel id universe.
 * @param id - the workflow execution's real id, as carried by every `workflow/*` event's `WorkflowRunInfo.id`.
 * @returns the same value as the Run event log's Workflow reference brand.
 */
export function workflowRefOf(id: WorkflowRunId): WorkflowRef {
  return brandString<WorkflowRef>(id)
}

/**
 * How many renewals fit inside one lease term.
 *
 * A protocol constant, not a tunable: it is a ratio between two things the
 * deployment already chose — the lease term and how much of it may pass
 * unrenewed — and exposing it would let a profile configure a heartbeat slower
 * than its own lease, which is the one setting that cannot be correct. Three
 * means two renewals may be lost before the lease lapses.
 */
const LEASE_RENEWAL_DIVISOR = 3

/** Deployment-varying configuration of {@link RunPlugin}. */
export interface Config {
  /**
   * Filesystem path of the durable Run store document this plugin's
   * {@link RunService} reads and writes (see {@link createFileRunStore}).
   */
  readonly storePath: string
  /**
   * How long a Run's lease is granted for, in milliseconds (default 30000).
   *
   * Deployment-varying: a laptop tolerates a long lease because nothing else
   * competes for the Run, while a scheduler with tight failover needs a short
   * one so a dead host's work is reclaimable sooner.
   */
  readonly leaseMs?: number
}

/**
 * Epic P4-01's Run Service as a mounted Cordis plugin: the one place a real
 * harness run becomes a Run.
 *
 * On mount it restores the durable registry from {@link Config.storePath}
 * (acceptance[0]'s restart path, executed on every boot including the first),
 * then subscribes to the agent registry's own extension points. Every agent
 * session the harness starts opens a Run owned by `RUN_SERVICE_OWNER_ID`
 * (must[2]) whose `sessionIds` begins with that session (acceptance[2]).
 *
 * **What it appends to a Run's log, and what it does not.** Each Run carries
 * its genesis entry, and the one transition this plugin drives is
 * `accepted → planning`, naming the TaskProfile compiled for the agent's first
 * model step (P4-02). Workflow executions are NOT referenced: `workflowRefOf`
 * reconciles the brands such a reference would need and no mounted listener
 * calls it, so must[1]'s log is append-only and, for workflows, empty. This
 * paragraph said the opposite until 2026-09-11; the sentence reached
 * `docs/subsystems/core.md` through the generated catalog, which is how a
 * claim nothing implements became architecture documentation.
 *
 * `inject` names the agent registry, so the plugin activates only where the
 * events it subscribes to are actually emitted rather than sitting inert.
 */
export default class RunPlugin extends Service {
  /** Cordis service dependencies; the plugin activates once these are available. */
  static inject = ['agents', 'leaseStore']

  /** Runtime configuration schema, validated at mount from the profile's `cordis.yml` row. */
  static Config = z.object({
    storePath: z.string().required(),
    leaseMs: z.natural().min(1).default(30_000),
  }) as z<Config>

  /**
   * This host's worker identity, minted per mount.
   *
   * Per MOUNT rather than per process: two engines in one process are two
   * holders as far as the store is concerned, which is what makes a
   * single-process test of "another holder is refused" mean anything.
   */
  private readonly worker = brandString<WorkerId>(`run-plugin-${randomUUID()}`)

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.runs`.
   * @param config - the validated configuration, naming the durable store's path.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'runs')
    // schemastery (static Config) has already filled the defaulted fields; the
    // assertion records that resolution rather than hiding a `?? default` at
    // the use site, which would put the choice inside `open()` instead of in
    // the schema a profile can change.
    this.config = config as Required<Config>
  }

  /** The validated configuration, with every defaulted field resolved. */
  public readonly config: Required<Config>

  /** The registry restored from {@link Config.storePath}; undefined until `Service.init` completes. */
  private restored: RunService | undefined

  /** In-flight durable writes this mount started, awaited by its disposer. */
  private readonly writes: Promise<void>[] = []

  /** Live renewal timers by Run; each value is its own clear. */
  private readonly heartbeats = new Map<RunId, NodeJS.Timeout>()

  /**
   * Runs whose agent reported a failure that was never followed by more work
   * (P4-05 must[0]).
   *
   * Keyed by Run rather than by Agent so a disposed agent's entry is dropped
   * with its Run. Cleared when the agent takes another step: an error the
   * agent recovered from and continued past is not how the run ENDED, and
   * `failed` is a statement about the end.
   */
  private readonly failures = new Map<RunId, unknown>()

  /**
   * The non-terminal Runs this mount restored, as they were at mount
   * (acceptance[0]'s enumerate half).
   *
   * Captured once in `Service.init` and never recomputed, so it answers "what
   * did this process come back to" rather than "what is non-terminal now" —
   * adoption removes Runs from the second set and must not change the first.
   */
  private restoredAtMount: readonly Run[] = []

  /**
   * The durable registry this plugin restored at mount, for a caller that
   * needs the Run Service's full surface rather than this plugin's
   * agent-shaped lookups.
   * @returns the mounted {@link RunService}.
   */
  get service(): RunService {
    if (this.restored === undefined) {
      throw new Error('RunPlugin.service read before the plugin finished mounting')
    }
    return this.restored
  }

  /**
   * The Run the harness opened for `agent`'s session.
   * @param agent - a live agent handle from the agent registry.
   * @returns the {@link Run} that agent's session is doing work inside, or
   * `undefined` when no Run was opened for it — a subagent session started
   * outside the agent registry this plugin observes, for instance.
   */
  runFor(agent: Agent): Run | undefined {
    const runId = agent.runId
    return runId === undefined ? undefined : this.service.get(runId)
  }

  /**
   * The non-terminal Runs this mount found in the store when it started
   * (acceptance[0]: "after a restart, list every non-terminal Run").
   *
   * The enumeration happens at mount, before any agent exists, because that is
   * the only moment that can answer it: `Service.init` has just restored the
   * registry, and nothing has adopted or opened anything yet. The list is fixed
   * from then on — a caller asking what is non-terminal NOW asks
   * {@link RunService.listNonTerminal}.
   *
   * A restart's other half, deciding what to do with these, is taken per
   * session in {@link RunPlugin.open} rather than here: at mount there is no
   * agent to drive a Run and `RunService.resume` appoints nobody.
   * @returns every Run that was non-terminal at mount; empty for a fresh store
   * or one holding only finished Runs.
   */
  restoredNonTerminal(): readonly Run[] {
    return this.restoredAtMount
  }

  /**
   * The Run this session should continue, if the store holds one it may
   * (acceptance[0]'s resume half).
   *
   * **The decision is taken here and not at mount**, because `RunService.resume`
   * answers only whether a Run MAY resume — it appoints no driver — and at mount
   * no agent exists to be one. Asking it per session, at the moment a session
   * appears, is what turns a restored registry into a continued run.
   *
   * Every Run the store holds for this session is offered, not only the ones
   * this build would have left behind: a store written before adoption existed
   * can hold several Runs for one session, at most one of them non-terminal.
   * @param agent - the live agent whose session is starting.
   * @returns the Run to continue, or `undefined` when every Run this session
   * has is already finished — or it has none at all.
   */
  private adoptable(agent: Agent): RunId | undefined {
    for (const run of this.service.runsForSession(agent.id)) {
      const decision = this.service.resume(run.id)
      if (decision.resumed) return run.id
      this.ctx.logger.debug(
        'run: not continuing %s for agent %s — %s',
        run.id,
        agent.id,
        decision.reason,
      )
    }
    return undefined
  }

  /**
   * Open the Run for one agent session: continue the one the store holds for
   * it, or accept a new one.
   *
   * **Continuing is the same operation as opening, minus the registration.**
   * The lease is taken either way and from the same work item, so a restarted
   * host writes under an epoch this store issued it rather than inheriting the
   * authority of the process that died.
   * @param agent - the live agent whose session is doing the work.
   */
  private open(agent: Agent): void {
    if (agent.runId !== undefined) return
    const continuing = this.adoptable(agent)
    const runId = continuing ?? brandString<RunId>(`run-${randomUUID()}`)
    // The lease is taken BEFORE the Run is registered. A Run that exists
    // without an owner is a Run a second host can also open work against, and
    // the window between registering and acquiring is exactly the window
    // P4-07 exists to close (§12.19-3: the core agent run is the holder).
    //
    // **The work item is the SESSION, not this Run (§12.35-2).** A `run-<uuid>`
    // is minted fresh on every open, so two hosts driving one session asked
    // for two different items and neither `acquire` could ever refuse the
    // other — measured: two processes over one SQLite lease store, both
    // creating an agent for the same session id, produced two run ids and two
    // granted leases at epoch 0. acceptance[1]'s "does not produce two
    // masters" held vacuously, because the thing two hosts actually open at
    // once is a durable SESSION. The Run keeps its own identity; what it
    // holds a lease ON is the session it is doing the work of.
    const taken = acquireRunLease(
      this.ctx.leaseStore,
      brandString<WorkItemId>(agent.id),
      this.worker,
      Date.now(),
      this.config.leaseMs,
    )
    if ('denied' in taken) {
      // No lifecycle and no Run. A refused lease is stop-work, not a warning:
      // an agent that proceeded without one would make state writes nothing
      // could refuse, which is the unauthorized path this epic removes.
      this.ctx.logger.warn(
        'run: no Run opened for agent %s — its lease was refused (%s)',
        agent.id,
        taken.denied.reason,
      )
      // Marked, not merely left empty. An agent with no lifecycle is either
      // running without a Run Service — which must dispatch normally — or one
      // a live store refused, which must not dispatch at all; leaving both as
      // absence let the second host of a contended work item keep executing
      // tools against it (§12.31-A).
      agent.leaseRefused = true
      return
    }
    // A continued Run is already registered and already durable, with the event
    // log it had: nothing is written for a restart, which is what makes the
    // restart continue a history rather than start one.
    if (continuing === undefined) {
      const opened = this.service.openForSession(runId, agent.id, Date.now())
      this.writes.push(opened.durable)
    }
    agent.runId = runId
    agent.lifecycle = { runId: brandString<AgentRunId>(runId), state: 'queued', epoch: taken.lease.token.epoch }
    agent.runLease = taken.lease
    this.heartbeats.set(runId, setInterval(() => { this.beat(agent) }, this.config.leaseMs / LEASE_RENEWAL_DIVISOR))
  }

  /**
   * Renew one live Run's lease (P4-07 must[2]).
   *
   * Without this every Run lapses at `leaseMs` while it is still working, and
   * the next tool dispatch refuses itself — the fencing rule would fire on the
   * run that legitimately holds the item, which is worse than not having it.
   *
   * A refused renewal stops the timer rather than retrying. `store-unavailable`
   * and `fenced-out` both mean this holder must not keep asserting ownership,
   * and a timer that kept firing would turn one outage into a stream of them.
   * The run is not torn down here: it discovers its position at its next state
   * write, which is the one notification that cannot be lost.
   * @param agent - the agent whose Run holds the lease.
   */
  private beat(agent: Agent): void {
    const denial = agent.runLease?.renew(Date.now())
    if (denial === undefined) return
    this.stopHeartbeat(agent.runId)
  }

  /**
   * Reclaim a run whose lease lapsed, recording it as `orphaned` (Epic P4-05
   * acceptance[2], §12.60).
   *
   * **The reclaimer writes this, never the orphaned host.** A host that lost
   * its lease must not write at all — from its own side a reclaim and a pause
   * are indistinguishable, so it cannot establish its own orphaning, and
   * `advanceLeasedAgent` refuses it as `fenced`. The party that OBSERVED the
   * loss is the one that acquired the item, and it records the state under the
   * epoch the store just issued it. No fencing bypass exists or is needed.
   *
   * `orphaned` leads to `starting` or `failed`, so a caller resumes the work
   * under its new epoch or fails it safely — acceptance[2]'s two arms.
   * @param agent - the agent whose work item is being reclaimed.
   * @param nowMs - the caller's clock reading, against which the lapse is judged.
   * @returns `'reclaimed'` when this host took the item and recorded the state,
   * `'held'` when the item is still validly owned, `'no-run'` when the agent
   * has no lifecycle to record against.
   */
  reclaim(agent: Agent, nowMs: number = Date.now()): 'reclaimed' | 'held' | 'no-run' {
    const { lifecycle } = agent
    if (lifecycle === undefined) return 'no-run'
    const workItem = brandString<WorkItemId>(agent.id)
    // `acquire` is the judge of the lapse, not a clock comparison here: the
    // store refuses while the current lease is live, so a run whose holder is
    // still renewing cannot be reclaimed out from under it.
    const taken = acquireRunLease(this.ctx.leaseStore, workItem, this.worker, nowMs, this.config.leaseMs)
    if ('denied' in taken) return 'held'
    const decided = advanceAgentLifecycleFenced(
      lifecycle,
      // The RECLAIMER's epoch, which the store just issued, not the one the
      // lapsed lifecycle still carries: `decideTransition` adopts whatever the
      // proposal names, so proposing the old epoch would record the orphaning
      // under the authority of the host that no longer has any.
      { runId: lifecycle.runId, from: lifecycle.state, to: 'orphaned', epoch: taken.lease.token.epoch, reason: 'its lease lapsed and this host reclaimed the work item' },
      taken.lease.token,
      taken.lease.currentLease(),
    )
    if (!decided.ok) {
      // The item is ours and the transition was still refused, which means the
      // run had already reached a terminal state. Releasing keeps the reclaim
      // from holding an item it will not work.
      taken.lease.release()
      return 'held'
    }
    agent.lifecycle = decided.next
    agent.runLease = taken.lease
    return 'reclaimed'
  }

  /**
   * Stop renewing one Run's lease, if it was being renewed.
   * @param runId - the Run whose timer should stop; absent runs are ignored.
   */
  private stopHeartbeat(runId: RunId | undefined): void {
    if (runId === undefined) return
    const timer = this.heartbeats.get(runId)
    if (timer !== undefined) clearInterval(timer)
    this.heartbeats.delete(runId)
  }

  /**
   * Finish one agent's Run: stop renewing, take the lifecycle to its terminal
   * state, and give the item back (§12.20-3).
   *
   * Releasing matters as much as the terminal state. A finished run that keeps
   * its lease until the deadline it no longer needs leaves the item owned by
   * nobody doing work, and a host running many short sessions spends its
   * capacity waiting out leases.
   * @param agent - the agent whose session ended.
   */
  private finish(agent: Agent): void {
    this.stopHeartbeat(agent.runId)
    // Only `running` reaches `completed` directly, and that is the state
    // machine being right rather than in the way: a run that was waiting, or
    // that never started, did not finish its work — it was ended. Those pass
    // through `cancelling`, which is what actually happened, instead of being
    // reported as a run that completed.
    const state = agent.lifecycle?.state
    if (state !== undefined && state !== 'running') {
      advanceLeasedAgent(agent, 'cancelling', 'the agent session ended before its work finished')
    }
    // `failed` is reachable exactly here (P4-05 must[0]): a run whose last
    // reported activity was an unrecovered error did not complete, and
    // reporting it as `completed` would make half of `TERMINAL_STATES` dead
    // and tell a supervisor the opposite of what happened.
    const failure = agent.runId === undefined ? undefined : this.failures.get(agent.runId)
    if (failure !== undefined) {
      advanceLeasedAgent(agent, 'failed', `the agent session ended after an unrecovered error: ${errorText(failure)}`)
    } else {
      advanceLeasedAgent(agent, 'completed', 'the agent session ended')
    }
    // The RUN's own terminal state, from the same fact. Tracked on `writes` and
    // not awaited here, because `agent/disposed` is emitted synchronously and
    // does not await its listeners — the disposer below awaits what this
    // started, which is how every other durable write this plugin makes is
    // ordered against teardown.
    this.writes.push(this.endRun(agent, failure !== undefined))
    if (agent.runId !== undefined) this.failures.delete(agent.runId)
    const lease = agent.runLease
    if (lease !== undefined) this.ctx.leaseStore.release(lease.token)
  }

  /**
   * Compile the TaskProfile for one agent's first model step, append it to the
   * session log, and name it in the Run's `accepted → planning` transition
   * (first100 registry P4-02 must[1], must[2], validation[2]).
   *
   * **Silent in three cases, each for its own reason.** No Run means no
   * transition to name the profile in — a composition with no Run Service, or a
   * refused lease. No first message means there is no goal yet. And a compile
   * that REFUSES is the ordinary outcome, not a failure: `not-a-task` is what
   * every injected-context message produces, and nothing should be recorded for
   * it.
   *
   * **Ordering: the body first, the reference second.** The append is
   * synchronous and validates at the append site, while `advance` is
   * asynchronous and can be refused. Appending first can leave a profile no
   * Run event names — inert, and self-describing to anyone reading the log.
   * Advancing first could leave a Run event naming a digest whose body never
   * landed, which makes a later resolver fail on a record that looks complete.
   * Recorded rather than assumed: the trade is in
   * `open-questions-lane-b.md` and the delegate has not ruled it.
   * @param agent - the agent taking its first model step.
   * @param messages - the messages this step was given, whose first entry is the goal.
   */
  private async recordTaskProfile(agent: Agent, messages: readonly UserMessage[]): Promise<void> {
    const runId = agent.runId
    const first = messages[0]
    if (runId === undefined || first === undefined) return
    const goal = goalOf(first)
    const goalRound = goalRoundOf(first.source)
    const compiled = compileTaskProfile({
      goalRef: {
        sessionId: agent.session.id,
        messageId: first.id,
        ...goalRound === undefined ? {} : { goalRound },
      },
      goalText: goal.text,
      origin: taskOriginOf(first.source),
      identityKnown: agent.identity !== undefined,
      ...agent.options.budget === undefined ? {} : { budget: agent.options.budget },
      ...goal.unread.length === 0 ? {} : { unreadGoalContent: goal.unread },
    })
    if (!compiled.compiled) return
    const ref = taskProfileRef(compiled.profile)
    const previousRef = lastTaskProfileRef(agent.session)
    // The condition is the thing being avoided -- an unchanged PROFILE --
    // rather than a proxy for it like the session-start reason, which would
    // also skip a resume that carries a new goal.
    //
    // **What it actually catches is narrower than "a resume", and measuring
    // that is what settled the shape.** A profile's `goalRef` names the message
    // it was compiled from, so an ordinary resume claims a NEW message, yields
    // a new digest, and writes -- correctly, because a new goal is a new task.
    // The byte-identical case is a session whose step did not finish: its
    // pending message is durable, the resumed agent re-claims the same message
    // with the same id, and the compile returns exactly what is already in the
    // log. That duplicate is what stays out.
    //
    // The Run still advances either way: this mount opened a new Run, and that
    // Run has not named the profile yet.
    if (previousRef !== ref) {
      agent.session.append('run/task-profile', {
        ref,
        profile: compiled.profile,
        ...previousRef === undefined ? {} : { previousRef },
      })
    }
    agent.taskProfile = ref
    await this.service.advance(runId, 'planning', [{ kind: 'task-profile', id: ref }], Date.now())
  }

  /**
   * Move the Run itself to `running` once its first model step is planned
   * (must[0]: the states are occupied, not merely declared).
   *
   * From `planning`, which is the state P4-02's profile transition leaves it
   * in, and from `paused`, which is where a clean unload parked it — a
   * continued Run takes its next step out of the state that said it was
   * resumable. Later steps find it already `running` and ask for nothing, so
   * the log gains one entry for the Run starting work rather than one per step.
   * @param agent - the agent whose Run is starting work.
   */
  private async startRun(agent: Agent): Promise<void> {
    const runId = agent.runId
    if (runId === undefined) return
    const state = this.service.get(runId)?.state
    if (state !== 'planning' && state !== 'paused') return
    await this.service.advance(runId, 'running', [], Date.now())
  }

  /**
   * Take the Run to a terminal state when its agent session ends
   * (must[0], must[1], acceptance[0]).
   *
   * **`verifying` here is the END DECISION over this plugin's failure ledger,
   * and it is NOT output verification.** What the step actually does is read
   * whether an unrecovered `agent/error` was recorded for this Run and has not
   * been cleared by a later admitted step — the same fact {@link RunPlugin.finish}
   * uses to choose the agent's own terminal lifecycle state. It inspects no
   * artifact, consults no contract, and proves nothing about what the run
   * produced. Epic P7-05 owns that meaning: its must[0] adds `accepted`,
   * `rejected`, `needs-human` and `compensating` beside this state and its
   * AcceptanceGate decides between them from a frozen VerificationContract and
   * a VerificationReport. The transition shape survives that; the decision
   * inside it is replaced. Recorded in this epic's evidence as a readiness note
   * against P7-05 rather than left for a reader to infer from the state name.
   *
   * The path is `running → verifying → succeeded | failed`, one log entry per
   * step, because the table admits no shortcut: `succeeded` is reachable only
   * from `verifying` or `reconciling`. A Run that never reached `running` —
   * a session that started and was disposed without a model step — is
   * `cancelled` instead, which is what `accepted` and `planning` both admit.
   * @param agent - the agent whose session has ended.
   * @param failed - whether an unrecovered error is this run's last reported activity.
   */
  private async endRun(agent: Agent, failed: boolean): Promise<void> {
    const runId = agent.runId
    if (runId === undefined) return
    const state = this.service.get(runId)?.state
    if (state === undefined || TERMINAL_RUN_STATES.has(state)) return
    if (state === 'accepted' || state === 'planning') {
      await this.service.advance(runId, 'cancelled', [], Date.now())
      return
    }
    if (state !== 'running') return
    await this.service.advance(runId, 'verifying', [], Date.now())
    await this.service.advance(runId, failed ? 'failed' : 'succeeded', [], Date.now())
  }

  /**
   * Park one agent's Run when this mount unloads cleanly, and give its lease
   * back (acceptance[0]).
   *
   * Only from `running`, because only a Run that had started work has work to
   * park. The lease is released whatever state the Run is in: an unloaded host
   * asserts ownership of nothing, and holding it would make the next boot wait
   * out the expiry for a work item nobody is doing.
   * @param agent - a live agent this mount still holds a Run for.
   */
  private async pauseRun(agent: Agent): Promise<void> {
    const runId = agent.runId
    if (runId !== undefined && this.service.get(runId)?.state === 'running') {
      await this.service.advance(runId, 'paused', [], Date.now())
    }
    // **The lease is NOT handed back here, and it cannot be.** Measured:
    // `release` finds no open database — the provider cleared its handle
    // synchronously while this disposer was awaiting the transition above, and
    // fiber unload gives the two no order to rely on. A released lease on clean
    // shutdown therefore needs a hand-back at a point where the store is still
    // open, which this disposer is not. Recorded in BLOCKED-197; until then a
    // cleanly unloaded host's work item stays held until it lapses, exactly as
    // a crashed one's does.
  }

  /**
   * Bring an agent that is about to take a model step to `running`.
   *
   * The lifecycle needs a driver or it stays `queued` forever and the fenced
   * transitions at tool dispatch are unreachable — a state machine nothing
   * moves refuses nothing, the same defect one level up from the one this
   * epic is fixing. `agent/pre-step` is the honest point: it fires when the
   * run is actually about to do work, and again after every tool result, so
   * the return from `waiting_tool` needs no second subscription.
   *
   * Silent when the agent has no lifecycle: a composition with no Run Service
   * mounted, or a Run whose lease was refused, has nothing to advance.
   * @param agent - the agent about to step.
   */
  private ensureRunning(agent: Agent): void {
    const state = agent.lifecycle?.state
    if (state === 'queued') {
      this.advance(agent, 'starting', 'the run is taking its first model step')
      this.advance(agent, 'running', 'the run started')
      return
    }
    if (state === 'waiting_tool') this.advance(agent, 'running', 'the tool calls settled')
  }

  /**
   * Advance one agent's lifecycle under the Run's lease (P4-05 must[1], P4-07
   * must[1]).
   *
   * The production caller `advanceAgentLifecycleFenced` did not have. The
   * token and the current lease both come from the lease this plugin took, so
   * a caller cannot present authority it was not granted, and an agent whose
   * Run was reclaimed by another host is refused here rather than allowed to
   * write on a stale epoch.
   * @param agent - the agent whose lifecycle is proposed to move.
   * @param to - the state proposed.
   * @param reason - why, recorded on the transition (must[1] requires it non-empty).
   * @returns the refusal, or `undefined` when the agent advanced. `lease-refused`
   *   names an agent this plugin declined to open a Run for, which is a
   *   different fact from `no-run`: a live store said no, rather than nothing
   *   tracking ownership at all.
   */
  advance(
    agent: Agent,
    to: AgentLifecycleState,
    reason: string,
  ): TransitionDenialReason | 'fenced' | 'lease-refused' | 'no-run' | undefined {
    return advanceLeasedAgent(agent, to, reason)
  }

  /**
   * Restore the durable registry and subscribe to the agent registry's
   * session and workflow extension points, yielding the disposer that
   * unsubscribes them.
   * @returns the plugin's own teardown steps, in Cordis's `Service.init` protocol.
   */
  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    this.restored = await RunService.restore(createFileRunStore(this.config.storePath))
    // acceptance[0]'s enumerate half, and the only place it can be taken: the
    // registry has just come back and nothing has opened or continued anything
    // yet. What to DO with each is decided per session in `open`.
    this.restoredAtMount = this.restored.listNonTerminal()
    if (this.restoredAtMount.length > 0) {
      this.ctx.logger.info(
        'run: restored %d non-terminal Run(s) from %s',
        this.restoredAtMount.length,
        this.config.storePath,
      )
    }
    // `agent/session-start` is emitted synchronously and does not await its
    // listeners, so each Run is registered in memory on the spot and its
    // durable write tracked on `writes` for the disposer below to await.
    const unsubscribe = this.ctx.on('agent/session-start', ({ agent }) => {
      this.open(agent)
    })
    const undispose = this.ctx.on('agent/disposed', ({ agent }) => {
      this.finish(agent)
    })
    const unfail = this.ctx.on('agent/error', ({ agent, error }) => {
      if (agent.runId !== undefined) this.failures.set(agent.runId, error)
    })
    const unstep = this.ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
      // Captured BEFORE `ensureRunning`, which is what turns `queued` into
      // `starting`: after that call the marker for "this is the first model
      // step" is gone. P4-02's compile happens exactly once per agent and this
      // is the only place that can tell.
      const firstStep = agent.lifecycle?.state === 'queued'
      this.ensureRunning(agent)
      // P4-05 acceptance[1], §12.60: a run that is not holding a dispatch slot
      // does not begin a model step. `ensureRunning` has already returned the
      // ordinary waits — `queued` and `waiting_tool` — to `running`, so what
      // reaches this check is a run that is orphaned, terminal, or paused, and
      // a model step from any of those spends an LLM call on work this host no
      // longer owns or has already finished.
      //
      // This is the deliberate short-circuit the waterfall contract describes:
      // refusing IS an opinion about the step, so `next()` is not called.
      // `queued` is excluded deliberately. It is in `NON_CONSUMING_STATES`
      // because a queued run has NOT STARTED, not because it released a slot,
      // and it is also where a fenced host stays when `ensureRunning`'s
      // `queued → starting` is refused. P4-07 owns that case and answers it
      // downstream, by refusing each tool call so the model is told its calls
      // did not run; rejecting the step here would replace that frozen,
      // model-visible behavior with silence.
      const lifecycle = agent.lifecycle
      if (lifecycle !== undefined && lifecycle.state !== 'queued' && !holdsDispatchSlot(lifecycle)) {
        this.ctx.logger.warn(
          'run: refused a model step for agent %s — its lifecycle is %s, which holds no dispatch slot',
          agent.id,
          lifecycle.state,
        )
        return Promise.resolve({ kind: 'reject' as const })
      }
      // Cleared only once the step is actually admitted: a refused step means
      // the agent did NOT carry on, so an unrecovered failure is still how
      // this run ends.
      if (agent.runId !== undefined) this.failures.delete(agent.runId)
      // P4-02: compile the profile before the step it plans, not after. An
      // awaited call here delays the first model request by one durable append
      // and one Run transition, which is the point — a profile recorded after
      // the request it was supposed to plan would describe a decision already
      // taken.
      if (firstStep) {
        await this.recordTaskProfile(agent, messages)
        // After the profile's `accepted -> planning`, so the Run is in the one
        // state `running` is legal from. A session whose first message is not a
        // task has no profile and stays in `accepted`, and `startRun` asks for
        // nothing — which is why this is not an unconditional advance.
        await this.startRun(agent)
      }
      // Waterfall: delegating is mandatory for a step this listener admits.
      return next()
    })
    // Agents a profile configures are created inside the agent loop's own
    // constructor, which may run before this plugin mounts — Cordis load
    // order follows service availability, not `cordis.yml` row order. Their
    // `agent/session-start` is already past, so they are adopted here rather
    // than left as the one kind of agent session that silently gets no Run.
    for (const agent of this.ctx.agents.list()) this.open(agent)
    yield async () => {
      unsubscribe()
      unstep()
      undispose()
      unfail()
      // Renewal stops FIRST, then the work is parked and the lease handed back.
      // The other order leaves a timer that can renew the very lease the next
      // line released, which would hand the item back and immediately take it
      // again — measured: the next mount was refused its own session's work
      // item and opened no Run at all.
      for (const runId of [...this.heartbeats.keys()]) this.stopHeartbeat(runId)
      // **A clean unload PAUSES the work it was doing.** `agent/disposed` cannot
      // reach this plugin any more: the listener above is torn down with the
      // mount, and fiber unload runs every disposer concurrently
      // (`vendor/cordis/src/fiber.ts` awaits them as one `Promise.all`), so
      // there is no order to rely on either. Left alone, every boot leaked a
      // non-terminal Run and a held lease: the next boot enumerated a Run it
      // could not acquire, and `listNonTerminal` grew once per boot forever.
      // The lease is NOT handed back — see `pauseRun` and BLOCKED-197.
      //
      // `paused` and not a terminal state, which is the whole decision. A run
      // that was half-way through when the operator closed the app did not
      // succeed and was not cancelled; reporting either would be a claim about
      // work that is simply unfinished. `paused` is the state that says "not
      // crashed, not finished, resumable", and until now it was the one legal
      // Run state nothing reached. A Run still in `accepted` or `planning` is
      // left alone: it never started, so there is nothing to pause.
      //
      // The registry is still mounted here (it unloads after), so `list()` is
      // the same accessor the mount-time adoption above uses.
      for (const agent of this.ctx.agents.list()) await this.pauseRun(agent)
      // Every Run this mount opened is durable before the fiber finishes
      // unloading, so a boot that ends immediately after starting an agent
      // still leaves that agent's Run in the store.
      await Promise.all(this.writes.splice(0))
    }
  }
}

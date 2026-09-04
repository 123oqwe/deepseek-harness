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

import { readFile, rename, writeFile } from 'node:fs/promises'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { WorkflowRunId } from '@deepseek-ai/dsh-workflow/types'
import z from '@deepseek-ai/schemastery'
import type { RunId } from '@deepseek-ai/dsh-principal/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  attachSessionToRun,
  createRun,
  listNonTerminalRuns,
  resumeRun,
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
  /**
   * Every read and write of `path` is chained onto this promise, so a `put`
   * never interleaves its read-modify-write with another one and loses a Run.
   */
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation)
    queue = next.then(
      () => undefined,
      () => undefined,
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
    return [...document.runs]
  }

  const write = async (runs: readonly Run[]): Promise<void> => {
    const document: RunStoreDocument = { version: RUN_STORE_FORMAT_VERSION, runs }
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

/** The on-disk format version {@link createFileRunStore} reads and writes. */
const RUN_STORE_FORMAT_VERSION = 1

/** The JSON document {@link createFileRunStore} keeps at its path. */
interface RunStoreDocument {
  readonly version: number
  readonly runs: readonly Run[]
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
  async advance(
    id: RunId,
    to: RunState,
    references: readonly RunEntityReference[],
    occurredAt: number,
  ): Promise<RunTransitionDecision> {
    const decision = transition(this.registered(id), to, references, occurredAt)
    if (!decision.accepted) return decision
    await this.store.put(decision.run)
    this.runs.set(id, decision.run)
    return decision
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
  async attachSession(id: RunId, sessionId: SessionId): Promise<Run> {
    const run = attachSessionToRun(this.registered(id), sessionId)
    await this.store.put(run)
    this.runs.set(id, run)
    return run
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
  throw new Error(`not implemented: workflowRefOf does not yet reconcile WorkflowRunId ${id} with WorkflowRef`)
}

/** Deployment-varying configuration of {@link RunPlugin}. */
export interface Config {
  /**
   * Filesystem path of the durable Run store document this plugin's
   * {@link RunService} reads and writes (see {@link createFileRunStore}).
   */
  readonly storePath: string
}

/**
 * Epic P4-01's Run Service as a mounted Cordis plugin: the one place a real
 * harness run becomes a Run.
 *
 * On mount it restores the durable registry from {@link Config.storePath}
 * (acceptance[0]'s restart path, executed on every boot including the first),
 * then subscribes to the agent registry's own extension points. Every agent
 * session the harness starts opens a Run owned by `RUN_SERVICE_OWNER_ID`
 * (must[2]) whose `sessionIds` begins with that session (acceptance[2]), and
 * every workflow execution that session runs is referenced in that Run's
 * append-only log (must[1]).
 *
 * `inject` names the agent registry, so the plugin activates only where the
 * events it subscribes to are actually emitted rather than sitting inert.
 */
export default class RunPlugin extends Service {
  /** Cordis service dependencies; the plugin activates once these are available. */
  static inject = ['agents']

  /** Runtime configuration schema, validated at mount from the profile's `cordis.yml` row. */
  static Config = z.object({
    storePath: z.string().required(),
  }) as z<Config>

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.runs`.
   * @param config - the validated configuration, naming the durable store's path.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'runs')
  }

  /**
   * The durable registry this plugin restored at mount, for a caller that
   * needs the Run Service's full surface rather than this plugin's
   * agent-shaped lookups.
   * @returns the mounted {@link RunService}.
   */
  get service(): RunService {
    throw new Error('not implemented: RunPlugin does not yet restore a RunService at mount')
  }

  /**
   * The Run the harness opened for `agent`'s session.
   * @param agent - a live agent handle from the agent registry.
   * @returns the {@link Run} that agent's session is doing work inside, or
   * `undefined` when this plugin mounted after that session started.
   */
  runFor(agent: Agent): Run | undefined {
    throw new Error(`not implemented: RunPlugin does not yet open a Run for agent session ${agent.id}`)
  }

  /**
   * Restore the durable registry and subscribe to the agent registry's
   * session and workflow extension points, yielding the disposer that
   * unsubscribes them.
   * @returns the plugin's own teardown steps, in Cordis's `Service.init` protocol.
   */
  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    throw new Error('not implemented: RunPlugin does not yet open a Run for a real agent session')
  }
}

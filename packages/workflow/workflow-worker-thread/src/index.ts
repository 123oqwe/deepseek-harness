/**
 * Worker-thread workflow engine. Each run executes its model-written script in
 * an escapable vm context on a fresh worker and bridges `agent()` calls to host
 * subagents. The thread prevents synchronous script work from blocking the host
 * and permits forced termination, but it is containment rather than a security boundary.
 * @module @deepseek-ai/dsh-workflow-worker-thread
 */

import { randomUUID } from 'node:crypto'
import { availableParallelism } from 'node:os'
import * as vm from 'node:vm'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import WorkflowEngine, { WorkflowError, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { LeaseStoreContract, WorkItemId, WorkerId } from '@deepseek-ai/dsh-lease-contract'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DefinitionRegistry, planNestedRun } from '@deepseek-ai/dsh-workflow-registry'
import type {
  ChildFailurePolicy,
  InheritedWorkerLimits,
  DefinitionDigest,
  DefinitionName,
  RegisteredDefinition,
  RunBudget,
} from '@deepseek-ai/dsh-workflow-registry'
import type { RunNesting } from '@deepseek-ai/dsh-workflow-journal'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { currentPrincipal } from '@deepseek-ai/dsh-principal'
import type { NestedStartRequest } from './types.ts'
import { reusableSteps } from './resume.ts'
import type { EffectStateLookup, Reconciled } from './resume.ts'
import { acquireRunLease } from '@deepseek-ai/dsh-lease-contract'
import type { WorkflowRun, WorkflowRunInfo, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import { WorkerRun } from './host.ts'
import { validateMeta } from './meta.ts'
import type { WorkerInit, WorkerLimits } from './types.ts'

export { validateMeta } from './meta.ts'
export { materializeFromRealm, MaterializeError } from './realm.ts'
export type {
  ChildHandle,
  ChildPort,
  ChildResult,
  ChildStartRequest,
  WorkerInit,
  WorkerLimits,
} from './types.ts'

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** The `ctx.subagents` provider children run on (default `spawn`). */
  provider?: string
  /** Concurrent `agent()` ceiling; `0` (the default) auto-resolves to `min(16, max(1, cores - 2))`. */
  maxConcurrentAgents?: number
  /** Total `agent()` calls one run may start — the runaway-loop backstop (default 1000). */
  maxTotalAgents?: number
  /** Items accepted by a single `parallel()`/`pipeline()` call (default 4096). */
  maxItemsPerCall?: number
  /** vm timeout for the script's initial synchronous slice, inside the worker (default 5000 ms). */
  syncTimeoutMs?: number
  /**
   * How long after a cancellation an unsettled script may keep running before
   * the run force-settles `cancelled` and its worker is TERMINATED (default
   * 5000 ms); also bounds `dispose()`.
   */
  disposeGraceMs?: number
  /**
   * How long a run's lease is granted for, in milliseconds (default 30000).
   *
   * A deployment choice rather than a constant: the right value is a function
   * of how long a host may be paused before another may take its work, which
   * differs between a laptop and a scheduler with tight failover. `leaseMs`
   * must exceed `heartbeatMs` by enough to survive one missed beat.
   */
  leaseMs?: number
  /** How often a live run renews its lease, in milliseconds (default 10000). */
  heartbeatMs?: number
  /**
   * How deep nested workflows may go (default 3; P4-09 acceptance[3]).
   *
   * Deployment-varying: a composition that nests three definitions is ordinary
   * and one that nests thirty is a runaway, and only the profile knows which
   * it is running. Recursion is caught structurally by the ancestor chain, not
   * by this — the depth limit bounds a large composition, not a self-calling
   * one, and an operator needs those reported differently.
   */
  maxNestingDepth?: number
  /**
   * The token allowance a root run shares with everything it nests
   * (default 1000000; P4-09 acceptance[3]).
   */
  maxNestedTokens?: number
}

type ResolvedConfig = Required<Config>

/** A body that still carries the Claude Code-style meta header (meta rides the seam as data here). */
const META_STATEMENT = /^\s*export\s+const\s+meta\b/

/**
 * Parse-check the body with the SAME wrapper the worker-side runtime
 * compiles, so `start()` keeps the seam's synchronous `SCRIPT_PARSE` throw
 * (the worker's own compile happens a thread away, after `start()` returned).
 * One redundant parse per run, bought deliberately for the contract. A body
 * opening with `export const meta` gets a pointed message instead of the
 * wrapper's bare SyntaxError — the model's likeliest authoring slip.
 */
function assertBodyParses(body: string, name: string): void {
  if (META_STATEMENT.test(body)) {
    throw new WorkflowError('workflow meta rides the `meta` request field, not the script: remove the `export const meta = {...}` statement from the body', 'SCRIPT_PARSE')
  }
  try {
    // Parse only — the script object is discarded, nothing executes.
    void new vm.Script(`(async () => {\n${body}\n})()`, { filename: `workflow:${name}`, lineOffset: -1 })
  } catch (error: unknown) {
    throw new WorkflowError(`workflow script does not parse: ${String(error)}`, 'SCRIPT_PARSE', { cause: error })
  }
}

/** Resolve one run's provider route before publishing work. */
function resolveSubagentProvider(ctx: Context, configured: string, override: string | undefined): string {
  const provider = override ?? configured
  if (provider.length === 0 || provider !== provider.trim()) {
    throw new WorkflowError(
      'workflow subagentProvider must be a non-empty normalized string',
      'INVALID_ARGUMENT',
    )
  }
  if (ctx.subagents.getProvider(provider) === undefined) {
    throw new WorkflowError(`no subagent provider registered for "${provider}"`, 'AGENT_START')
  }
  return provider
}

/** Resolve one run's total-child cap against the engine deployment ceiling. */
function resolveMaxTotalAgents(requested: number | undefined, ceiling: number): number {
  if (requested === undefined) return ceiling
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new WorkflowError('workflow maxTotalAgents must be a positive safe integer', 'INVALID_ARGUMENT')
  }
  if (requested > ceiling) {
    throw new WorkflowError(
      `workflow maxTotalAgents ${requested} exceeds the engine ceiling ${ceiling}`,
      'INVALID_ARGUMENT',
    )
  }
  return requested
}

/**
 * The worker-thread engine service. `start()` validates the script up front
 * (meta + a host-side body parse) and returns a {@link WorkflowRun} whose
 * `result` never rejects; the `workflow/*` events fire around the run per
 * the seam contract.
 */
class WorkerThreadWorkflowEngine extends WorkflowEngine {
  static inject = ['subagents', 'leaseStore']

  static Config: z<Config> = z.object({
    provider: z.string().default('spawn'),
    maxConcurrentAgents: z.natural().default(0),
    maxTotalAgents: z.natural().min(1).default(1000),
    maxItemsPerCall: z.natural().min(1).default(4096),
    syncTimeoutMs: z.natural().min(1).default(5000),
    disposeGraceMs: z.natural().default(5000),
    leaseMs: z.natural().min(1).default(30_000),
    heartbeatMs: z.natural().min(1).default(10_000),
    maxNestingDepth: z.natural().min(1).default(3),
    maxNestedTokens: z.natural().min(1).default(1_000_000),
  })

  private readonly config: ResolvedConfig
  /**
   * The lease store this engine takes work items from (P4-07 must[0]).
   *
   * DURABLE and shared, and INJECTED rather than constructed. An earlier
   * version `new`'d an in-memory store per engine instance, which made
   * "another host cannot take this item" true only between two runs inside one
   * process — two real processes each held their own map and both won, and the
   * case asserting otherwise ran in a single process. Replacing that `new` with
   * a different `new` would only move the mistake: an engine that opens its own
   * store still decides for its deployment where leases live, and two hosts
   * meant to contend can still be pointed at different files. `leaseStore` is
   * injected, so the profile answers that and every host mounted against one
   * store contends over the same rows.
   */
  private readonly leases: LeaseStoreContract
  /** Directory holding one journal file per run (P4-08 must[1]). */
  private readonly journalDirectory: string
  /**
   * Registered definitions a nested run may name (P4-09 must[0], §12.48-A).
   *
   * The registry, not a bare `Map`. A map stores whatever digest the caller
   * hands over, so a registration could claim one identity and carry another
   * and a run pinned to that digest would execute a body nobody attested. The
   * registry recomputes the digest from the body, refuses a mismatch, refuses
   * a self-recursive definition before it can ever be started, and keeps the
   * per-name version history `current()` answers from.
   */
  private readonly definitions = new DefinitionRegistry()
  /**
   * Each live run's remaining budget and ancestor chain (P4-09 must[3]).
   *
   * Held by the ENGINE rather than by the run, because admission compares a
   * child against its parent's allowance and the ancestor chain above it —
   * neither of which a single run can see.
   */
  private readonly budgets = new Map<WorkflowRunId, {
    budget: RunBudget
    ancestors: readonly DefinitionDigest[]
    toolBound: readonly string[] | undefined
  }>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // schemastery (static Config) has already filled the defaulted fields;
    // the assertion records that resolution, not a hidden fallback.
    this.config = config as ResolvedConfig
    this.leases = ctx.leaseStore
    // Derived from the profile's configured harness home, not a Config field:
    // where a run's recovery record lives is not a deployment CHOICE, it
    // follows the storage root the profile already set (§12.22-2).
    this.journalDirectory = dshHomePath('journals')
  }

  /**
   * Validate and execute a workflow script in a fresh worker thread. Throws
   * {@link WorkflowError} synchronously (`META_INVALID` for a malformed meta
   * block, `SCRIPT_PARSE` for a body that does not compile) for a request
   * that cannot begin; once a run is returned, every failure resolves through
   * `result.stopReason` instead.
   * @param request - the script body, its meta data and `args`, the parent
   *   agent, and an optional cancel signal.
   * @returns the live run (its `result` resolves when the script settles).
   */
  /**
   * Whether one child session's own log shows it finished work.
   *
   * The external check a resume reconciles against (P4-08 must[2]). Asked of
   * the SESSION rather than of the journal, because the journal is the
   * interrupted process's account of itself and the question is whether that
   * account is true.
   * @param childId - the child session recorded on a journal entry.
   * @returns whether that session exists and closed a turn.
   */
  private async childFinished(childId: string): Promise<boolean> {
    const id = brandString<SessionId>(childId)
    // The DURABLE log first: a settled run disposes its children, so the live
    // registry is empty exactly when a resume needs an answer. The live
    // session is the fallback for a composition with no persistence mounted,
    // where nothing outlives the process anyway.
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence !== undefined) {
      try {
        const loaded = await persistence.load(id)
        return loaded.events.some((event: { type: string }) => event.type === 'turn/end')
      } catch {
        // A session the backend has never heard of is not an error here: it is
        // the answer. Anything else it throws is also a refusal to confirm,
        // and a resume that cannot confirm reruns, which is the safe side.
        return false
      }
    }
    return this.ctx.sessions.get(id)?.snapshotEvents().some(event => event.type === 'turn/end') ?? false
  }

  /**
   * How this run asks the effect ledger about a recorded side-effect receipt
   * (P4-08 must[2]).
   *
   * Absent — not a function answering "no row" — when there is no ledger
   * mounted or the parent carries no identity, because a receipt's state and
   * the inability to look one up authorize opposite decisions: the first can
   * clear a step to rerun, the second never can. The scope is the parent's own
   * principal, the same scope the ledger reserved the effect under; a resume
   * that queried some other scope would be reading another principal's keys.
   * @param parent - the agent the resumed run executes on behalf of.
   * @returns the lookup, or undefined when no ledger can be queried for it.
   */
  /**
   * The concurrency a worker is actually started with.
   *
   * `maxConcurrentAgents: 0` is a SENTINEL meaning "derive it from the host",
   * never a limit of zero. It is resolved here, once, because a caller that
   * passes the raw configuration on is passing a sentinel where a number is
   * expected: `inheritWorkerLimits` copied the parent's concurrency unchanged,
   * `??` does not rescue `0` because zero is not nullish, and the nested worker
   * started with a concurrency of zero -- so it announced ready and then waited
   * forever for a slot that could not exist. Nothing failed; the run simply
   * never produced a child.
   * @returns the resolved per-worker concurrency, always at least 1.
   */
  private resolvedConcurrency(): number {
    return this.config.maxConcurrentAgents === 0
      ? Math.min(16, Math.max(1, availableParallelism() - 2))
      : this.config.maxConcurrentAgents
  }

  private effectStateLookup(parent: Agent): EffectStateLookup | undefined {
    const ledger = this.ctx.get('actionLedger')
    const chain = parent.identity?.chain
    if (ledger === undefined || chain === undefined) return undefined
    const scope = currentPrincipal(chain).id
    return receipt => ledger.entry(scope, receipt)?.state
  }

  /**
   * Continue an interrupted run from its journal (§12.23).
   *
   * The asynchronous step is the reconciliation: each recorded step's children
   * are checked against their own DURABLE sessions, because the question a
   * resume asks is whether the interrupted process's account of itself is
   * true, and the live registry cannot answer it — a settled run disposes its
   * children, so after a restart it answers "no" for everything and the resume
   * would degrade to never reusing anything.
   * @param runId - the interrupted run; its journal is read by this id.
   * @param request - the same fields `start` takes.
   * @returns the live run.
   */
  async resume(runId: WorkflowRunId, request: WorkflowStartRequest): Promise<WorkflowRun> {
    const reconciled = await reusableSteps(
      this.journalDirectory,
      runId,
      request.script,
      childId => this.childFinished(childId),
      this.effectStateLookup(request.parent),
    )
    return this.launch(request, runId, reconciled)
  }

  start(request: WorkflowStartRequest): WorkflowRun {
    return this.launch(request, undefined, { reusable: {}, journal: undefined })
  }

  /**
   * Register a workflow definition so a nested run can name it (P4-09 must[0]).
   *
   * On the CONCRETE engine, not on `WorkflowEngine`. The abstract seam cannot
   * carry it: `RegisteredDefinition` lives in `@deepseek-ai/dsh-workflow-registry`,
   * which already depends on `@deepseek-ai/dsh-workflow` for `WorkflowRunId`,
   * so declaring it upstream is a project-reference cycle — measured, not
   * assumed. A second engine that wants nesting implements this method under
   * the same name; nothing in the seam forces it to, and that gap is stated
   * in this package's Known Limitations rather than left for a reader to find.
   *
   * The digest is the caller's, not computed here: must[0] calls a definition a
   * signed artifact, and a registry that derived the digest itself would be
   * attesting the bytes rather than recording an attestation. `signer` is
   * recorded and NOT verified — this build has no signature root to verify it
   * against, which is stated rather than implied by the field's presence.
   * @param definition - the definition to register, keyed by its digest.
   */
  registerDefinition(definition: RegisteredDefinition): void {
    const outcome = this.definitions.register(definition)
    if (!outcome.registered) {
      throw new WorkflowError(
        `workflow definition "${definition.name}" was not registered: ${outcome.reason} (${outcome.detail})`,
        'INVALID_ARGUMENT',
      )
    }
  }

  /**
   * Resolve, admit and start one nested run ({@link NestingPort}).
   *
   * acceptance[0]'s "loading does not execute unverified code" is the resolve
   * step and nothing more elaborate: a digest that is not registered, or that
   * resolves under another name, produces a refusal and no worker is spawned.
   * @param request - the definition to nest and its `args`.
   * @param parent - the run asking; its budget and ancestry bound the child.
   * @returns the started run and its failure policy, or the refusal.
   */
  startNested(request: NestedStartRequest, parent: WorkerRun): Promise<
    | { readonly started: true; readonly run: WorkflowRun; readonly failurePolicy: ChildFailurePolicy }
    | { readonly started: false; readonly rendered: string }> {
    const digest = brandString<DefinitionDigest>(request.digest)
    const resolved = this.definitions.resolve(
      { runId: parent.id, digest, name: brandString<DefinitionName>(request.name), version: 0 },
    )
    if (!resolved.resolved) {
      return Promise.resolve({ started: false, rendered: `nested workflow "${request.name}" was not started: ${resolved.reason}` })
    }
    const budget = this.budgets.get(parent.id)
    if (budget === undefined) {
      return Promise.resolve({ started: false, rendered: `nested workflow "${request.name}" was not started: its parent holds no budget` })
    }
    const planned = planNestedRun(
      budget.budget,
      digest,
      budget.ancestors,
      { maxDepth: this.config.maxNestingDepth, maxTotalAgents: this.config.maxTotalAgents, maxTotalTokens: this.config.maxNestedTokens },
      { maxConcurrentAgents: this.resolvedConcurrency(), maxTotalAgents: this.config.maxTotalAgents },
      budget.toolBound,
      // The DEFINITION's declaration, resolved from the digest -- never the
      // worker's request. A script naming its own bound would be choosing its
      // own authority, which is why `NestedStartRequest` carries no such field.
      resolved.definition.tools,
    )
    if (!planned.admitted) {
      return Promise.resolve({ started: false, rendered: `nested workflow "${request.name}" was refused: ${planned.reason}` })
    }
    // The child's meta is the definition's own name, and its body is the
    // registered source: a nested run executes what the digest resolved to,
    // never what the caller passed alongside it.
    const run = this.launch({
      script: resolved.definition.body,
      meta: { name: resolved.definition.name, description: `nested run of ${resolved.definition.name}`, phases: [] },
      parent: parent.parentAgent,
      ...request.args === undefined ? {} : { args: request.args },
    }, undefined, { reusable: {}, journal: undefined }, {
      budget: planned.budget,
      ancestors: [...budget.ancestors, digest],
      limits: planned.workerLimits,
      toolBound: planned.toolBound,
    })
    return Promise.resolve({ started: true, run, failurePolicy: 'fail-parent' as const })
  }

  /**
   * Start or resume one run.
   *
   * One body for both entry points, so a resumed run cannot drift from a fresh
   * one in lease acquisition, limits, or teardown — the two differ only in
   * their id and in what they may reuse.
   * @param request - the caller's start request.
   * @param resumeRunId - the run being continued, or `undefined` for a fresh one.
   * @param reconciled - what a resume concluded: reusable outputs and the journal to continue; empty for a fresh run.
   * @returns the live run.
   */
  private launch(
    request: WorkflowStartRequest,
    resumeRunId: WorkflowRunId | undefined,
    reconciled: Reconciled,
    nested?: {
      budget: RunBudget
      ancestors: readonly DefinitionDigest[]
      limits: InheritedWorkerLimits
      toolBound: readonly string[] | undefined
    },
  ): WorkflowRun {
    const meta = validateMeta(request.meta)
    assertBodyParses(request.script, meta.name)
    const subagentProvider = resolveSubagentProvider(this.ctx, this.config.provider, request.subagentProvider)
    const maxTotalAgents = resolveMaxTotalAgents(request.maxTotalAgents, this.config.maxTotalAgents)
    const id = resumeRunId ?? WorkflowRunId(randomUUID())
    const info: WorkflowRunInfo = { id, meta }
    const limits: WorkerLimits = {
      // A nested run's limits are its DECAYED ones (P4-09 must[3]): starting it
      // with the deployment ceiling would let every run in a tree claim the
      // full allowance, and the total would be bounded by nothing.
      maxConcurrentAgents: nested?.limits.maxConcurrentAgents ?? this.resolvedConcurrency(),
      maxTotalAgents: nested?.limits.maxTotalAgents ?? maxTotalAgents,
      maxItemsPerCall: this.config.maxItemsPerCall,
      syncTimeoutMs: this.config.syncTimeoutMs,
    }
    // A root run's budget is the deployment's; a nested one carries what its
    // admission decayed to, and its ancestor chain is what makes a recursive
    // definition detectable at all.
    // What this run inherited: given by the admission for a fresh nested run,
    // and READ BACK from its own journal for a resume. A resume that started
    // from `undefined` restarted an interrupted nested run as a ROOT — with the
    // deployment's full budget, an empty ancestor chain, and no bound at all.
    // For budget and ancestors that was a long-standing looseness; for the
    // bound it is a widening, because the run comes back able to use tools its
    // definition excluded. One record fixes all three, because all three were
    // missing for the same reason: nothing persisted them.
    const nesting: RunNesting | undefined = nested === undefined
      ? reconciled.journal?.nesting
      : {
        ancestors: [...nested.ancestors],
        budget: nested.budget,
        ...nested.toolBound === undefined ? {} : { toolBound: [...nested.toolBound] },
      }
    this.budgets.set(id, nesting === undefined
      ? {
        budget: { depth: 0, agentsRemaining: limits.maxTotalAgents, tokensRemaining: this.config.maxNestedTokens },
        ancestors: [],
        // A root run is UNBOUNDED: its authority is its session's, and the
        // first declaration on a nesting chain is what first bounds it.
        toolBound: undefined,
      }
      : {
        budget: nesting.budget,
        ancestors: nesting.ancestors.map(digest => brandString<DefinitionDigest>(digest)),
        toolBound: nesting.toolBound,
      })
    const init: WorkerInit = {
      meta,
      body: request.script,
      ...request.args !== undefined ? { args: request.args } : {},
      limits,
      ...Object.keys(reconciled.reusable).length === 0 ? {} : { reusable: reconciled.reusable },
    }
    // Capture the dependency while this service call is still traced through
    // the start() holder. Cordis strips the engine-provider shadow when it
    // returns the SubagentRuntime handle, so an already-returned run can keep
    // starting children after an engine HMR unload removes ctx.workflowEngine.
    // Re-resolving `this.ctx.subagents` later from WorkerRun would instead walk
    // the now-inactive engine fiber and break the seam's holder-owned lifetime.
    const runCtx = this.ctx
    const subagents = runCtx.subagents
    // must[0]: the run takes its lease BEFORE a worker exists. Acquiring after
    // the thread starts would leave a window in which two hosts are both
    // running the script, which no later fencing check can undo -- a refused
    // WRITE does not un-send whatever the worker already did.
    //
    // acceptance[2]: a store that cannot answer stops new work. The denial is
    // reported as a WorkflowError rather than by settling the run, because the
    // run never began: there is nothing to settle.
    const holder = brandString<WorkerId>(`workflow-engine:${process.pid}`)
    const taken = acquireRunLease(this.leases, brandString<WorkItemId>(id), holder, Date.now(), this.config.leaseMs)
    if ('denied' in taken) {
      throw new WorkflowError(
        taken.denied.reason === 'store-unavailable'
          ? 'the lease store could not be reached, so no new workflow run may start'
          : `workflow run ${id} is held by another host`,
        taken.denied.reason === 'store-unavailable' ? 'LEASE_STORE_UNAVAILABLE' : 'RUN_HELD_BY_ANOTHER_HOST',
      )
    }
    const { lease } = taken

    const workerRun = new WorkerRun(
      runCtx,
      subagents,
      id,
      meta,
      request.parent,
      init,
      subagentProvider,
      this.config.disposeGraceMs,
      {
        phase: (title) => { this.emitWorkflowEvent('workflow/phase', info, title) },
        log: (message) => { this.emitWorkflowEvent('workflow/log', info, message) },
        agentStart: (agent) => { this.emitWorkflowEvent('workflow/agent-start', info, agent) },
        agentEnd: (agent) => { this.emitWorkflowEvent('workflow/agent-end', info, agent) },
      },
      request.signal,
      lease,
      this.journalDirectory,
      this,
      nesting?.toolBound,
      nested === undefined ? undefined : nesting,
      reconciled,
    )
    // must[2]/acceptance[0] live with the RUN, not with the engine: the lease's
    // lifetime is the run's, and an engine-side timer would outlive the thing
    // it describes.
    workerRun.startHeartbeat(this.config.heartbeatMs)

    this.emitWorkflowEvent('workflow/start', info)

    // `workflow/end` fires as the (never-rejecting) result settles, with the
    // outcome DATA only — the value stays with the run's holder.
    void workerRun.result.then((settled) => {
      // must[1]: the terminal state write carries the fencing token. A run
      // reclaimed mid-flight must not report a result under an authority it no
      // longer holds -- the reclaiming host owns that item's outcome now, and
      // two `workflow/end` events for one run is the two-masters state this
      // epic exists to prevent.
      if (!workerRun.mayReportOutcome(Date.now())) return
      this.emitWorkflowEvent('workflow/end', info, {
        stopReason: settled.stopReason,
        ...settled.error !== undefined ? { error: settled.error } : {},
        agentsStarted: settled.agentsStarted,
      })
    })

    return workerRun
  }
}

export default WorkerThreadWorkflowEngine

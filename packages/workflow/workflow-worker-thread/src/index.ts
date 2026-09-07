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
import { LeaseStore } from '@deepseek-ai/dsh-lease'
import type { WorkItemId, WorkerId } from '@deepseek-ai/dsh-lease'
import { acquireRunLease } from './run-lease.ts'
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
  static inject = ['subagents']

  static Config: z<Config> = z.object({
    provider: z.string().default('spawn'),
    maxConcurrentAgents: z.natural().default(0),
    maxTotalAgents: z.natural().min(1).default(1000),
    maxItemsPerCall: z.natural().min(1).default(4096),
    syncTimeoutMs: z.natural().min(1).default(5000),
    disposeGraceMs: z.natural().default(5000),
    leaseMs: z.natural().min(1).default(30_000),
    heartbeatMs: z.natural().min(1).default(10_000),
  })

  private readonly config: ResolvedConfig
  /**
   * The lease store this engine owns work items in (P4-07 must[0]).
   *
   * One per engine instance: a store shared across engines would let two
   * hosts in one process believe they hold the same run, which is the state a
   * lease exists to make impossible. A deployment with two real hosts gives
   * them two stores over shared durable state; that provider is not this
   * epic's, and the seam is the same either way.
   */
  private readonly leases = new LeaseStore()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // schemastery (static Config) has already filled the defaulted fields;
    // the assertion records that resolution, not a hidden fallback.
    this.config = config as ResolvedConfig
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
  start(request: WorkflowStartRequest): WorkflowRun {
    const meta = validateMeta(request.meta)
    assertBodyParses(request.script, meta.name)
    const subagentProvider = resolveSubagentProvider(this.ctx, this.config.provider, request.subagentProvider)
    const maxTotalAgents = resolveMaxTotalAgents(request.maxTotalAgents, this.config.maxTotalAgents)
    const id = WorkflowRunId(randomUUID())
    const info: WorkflowRunInfo = { id, meta }
    const limits: WorkerLimits = {
      maxConcurrentAgents: this.config.maxConcurrentAgents === 0
        ? Math.min(16, Math.max(1, availableParallelism() - 2))
        : this.config.maxConcurrentAgents,
      maxTotalAgents,
      maxItemsPerCall: this.config.maxItemsPerCall,
      syncTimeoutMs: this.config.syncTimeoutMs,
    }
    const init: WorkerInit = {
      meta,
      body: request.script,
      ...request.args !== undefined ? { args: request.args } : {},
      limits,
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

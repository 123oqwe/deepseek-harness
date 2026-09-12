/**
 * The in-process SPAWN subagent backend: registers a {@link SubagentProvider} on
 * `ctx.subagents` that runs each child as a fresh child {@link Agent} on the same cordis
 * context (its own session, own system prompt, zero parent context). The cheapest transport,
 * reusing the agent factory's quiescent teardown.
 * @module @deepseek-ai/dsh-subagent-spawn-in-process
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  ContinuableCreateSpec,
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'

export const name = 'subagent-spawn-in-process'
// `tools` is deliberately not injected: the child factory already provides it during setup,
// and adding it here would unnecessarily change this provider's apply timing.
export const inject = ['subagents']

/** Config: the registry name to register the provider under. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `spawn`). */
  providerName: string
  /**
   * How long a child's run waits, in milliseconds, for background jobs it
   * started that have not settled when it goes idle (default 30s; `0` does not
   * wait).
   *
   * Resolved here rather than in the shared driver: the driver is a library and
   * defaults nothing a deployment should choose, on the same
   * request/spec split the `dsh-shell` seam uses (BLOCKED-220).
   */
  waitForJobsMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('spawn'),
  waitForJobsMs: z.number().min(0).default(30_000),
})

/**
 * The spawn provider. Supports every start-time capability: `depthLimit` (it
 * constructs the child, so it can enforce a recursion cap), `outputSchema`
 * (the scoped structured runtime), `agentOptions` (merged over the parent
 * route), and `toolFilter`/`persona` (scoped `restrict()` and a scoped
 * shadowing persona section, applied in the child's creation window).
 */
class SpawnInProcessProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    agentOptions: true,
    outputSchema: true,
    depthLimit: true,
    toolFilter: true,
    persona: true,
  }
  // Context contract: a spawned child starts fresh — it never sees the parent conversation.
  readonly inheritsParentContext = false

  constructor(readonly name: string, private readonly waitForJobsMs: number) {}

  start(request: ResolvedSubagentStartRequest) {
    // Fresh child: no seed. The shared driver mints ids, stamps cwd/lineage/
    // depth, drives the one-shot (including the structured capture when the
    // request carries an outputSchema), and maps the result.
    return startInProcessRun(request, { waitForJobsMs: this.waitForJobsMs })
  }

  prepareContinuable(): Promise<ContinuableCreateSpec> {
    // A spawned child starts fresh, so it contributes no seed; the continuation
    // manager owns every later operation on it.
    return Promise.resolve({})
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.subagents.registerProvider(new SpawnInProcessProvider(config.providerName, config.waitForJobsMs ?? 30_000))
}

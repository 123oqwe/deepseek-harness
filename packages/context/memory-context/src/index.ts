/**
 * Opt-in durable memory recall context: the Consumer role of the
 * provider-neutral Memory capability seam (first100 registry P6-01, Usage
 * stage). On each eligible step it reads the open turn's user text, asks
 * `ctx.memory` — the Service Definition, never an imported provider or
 * runtime class (`must[2]`) — for the records that text recalls, appends them
 * to the request as a durable, source-attributed user message, and records
 * one `memory/access` event for that read.
 *
 * Model-visible and logged are one act here, never two: the injection and its
 * `memory/access` event are produced from the same read result on the same
 * path, so a memory record the model saw is always reconstructable from the
 * session log alone (registry P6-01 validation[3]).
 *
 * @module @deepseek-ai/dsh-memory-context
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { MemoryAccessContext, MemoryRecordView } from '@deepseek-ai/dsh-memory'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** Cordis plugin name used by loader diagnostics and as this plugin's `user/message` source attribution. */
export const name = 'memory-context'

/** The Memory Service Definition and the agent registry that owns pre-step processing. */
export const inject = ['agents', 'memory']

/**
 * Read scoping this consumer applies to every memory read it performs. Every
 * field is required: `must[3]` puts `principal`, `purpose`, `scope`, and
 * `contextBudget` on every read, so a composition that omits one is a
 * misconfiguration and fails loud at load rather than silently reading
 * unscoped.
 */
export interface Config {
  /** Tenant this consumer reads within; becomes `MemoryScope.tenantId`. */
  tenantId: string
  /** Principal id used when the agent carries no attached `IdentityContext`; see {@link resolveMemoryAccessContext}. */
  principalId: string
  /** Why this consumer reads, recorded on every `memory/access` event. */
  purpose: string
  /** Upper bound on recalled records; becomes `MemoryContextBudget.maxRecords`. */
  maxRecords: number
}

/** Schemastery validation for {@link Config}. Every field is required. */
export const Config: z<Config> = z.object({
  tenantId: z.string().required(),
  principalId: z.string().required(),
  purpose: z.string().required(),
  maxRecords: z.number().required(),
})

/**
 * Build the complete {@link MemoryAccessContext} this consumer reads under.
 *
 * The principal is the agent's own when a prior run durably attached an
 * `IdentityContext` to the session (first100 registry P2-01); otherwise it is
 * an `anonymous-dev` principal built from `config.principalId` and
 * `config.tenantId`. That fallback is an explicit resolve step over declared
 * config, never a hidden default: nothing in a shipped profile attaches an
 * `IdentityContext` today, so a consumer that simply required one could never
 * read at all.
 * @param agent - the agent whose step is being prepared; supplies the attached identity when it has one.
 * @param config - this plugin's validated configuration.
 * @returns the access context every read this consumer performs is scoped by.
 */
export function resolveMemoryAccessContext(agent: Agent, config: Config): MemoryAccessContext {
  void agent
  void config
  throw new Error('memory-context: resolveMemoryAccessContext is not implemented')
}

/**
 * Render recalled records as the exact text the model reads.
 * @param records - the records the memory read returned, already capped to the caller's budget.
 * @param truncated - whether the seam cut the result down to `contextBudget.maxRecords`.
 * @returns the model-visible snapshot text, or `undefined` when there is nothing to recall.
 */
export function renderMemoryContext(records: readonly MemoryRecordView[], truncated: boolean): string | undefined {
  void records
  void truncated
  throw new Error('memory-context: renderMemoryContext is not implemented')
}

/**
 * Collect the text of the open turn's user messages — the query this
 * consumer recalls against.
 * @param agent - the agent whose open turn is being prepared.
 * @param turn - the open turn number.
 * @param proposed - user messages this step has proposed but not yet entered.
 * @returns the concatenated user text of the open turn.
 */
export function openTurnQuery(agent: Agent, turn: number, proposed: readonly UserMessage[]): string {
  void agent
  void turn
  void proposed
  throw new Error('memory-context: openTurnQuery is not implemented')
}

/**
 * Register the prepended pre-step listener for the lifetime of `ctx`.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param config - the read scoping this consumer applies to every memory read.
 * @returns Nothing.
 */
export function apply(ctx: Context, config: Config): void {
  void ctx
  void config
  void ((): PreStepDecision | undefined => undefined)
  throw new Error('memory-context: apply is not implemented')
}

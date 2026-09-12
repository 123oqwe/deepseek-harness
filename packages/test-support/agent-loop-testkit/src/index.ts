/**
 * Shared mounting for the services required before tests load the concrete
 * agent loop. The caller retains ownership of the context, loop, adapters,
 * optional plugins, and teardown.
 * @module @deepseek-ai/dsh-agent-loop-testkit
 */

import type { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Config as SystemPromptConfig } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config as ToolRuntimeConfig } from '@deepseek-ai/dsh-tools'

/** Configuration forwarded to the prerequisite service plugins. */
export interface AgentLoopTestDependenciesOptions {
  /** Configuration for the system-prompt registry. */
  readonly systemPrompt?: SystemPromptConfig
  /** Configuration for the tool registry. */
  readonly tools?: ToolRuntimeConfig
}

/**
 * Mount the standard prerequisite services for an AgentLoop test.
 *
 * The function deliberately does not mount AgentLoop or register an adapter,
 * so tests retain control of load order and the topology under test. The
 * context owns every mounted service and remains responsible for disposal. A
 * plugin-load failure rejects the promise; services activated earlier in the
 * sequence remain context-owned and unwind with that context.
 * @param ctx - test context that owns the mounted services.
 * @param options - optional service configuration forwarded without mutation.
 * @returns after every prerequisite service has activated.
 */
export async function mountAgentLoopTestDependencies(
  ctx: Context,
  options: AgentLoopTestDependenciesOptions = {},
): Promise<void> {
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, options.systemPrompt ?? {})
  await ctx.plugin(ToolRuntime, options.tools ?? {})
  await ctx.plugin(AgentRegistry)
}

/**
 * Track Contexts a spec creates so its teardown can dispose every one, not
 * only the ones a case remembered.
 *
 * A Context that is discarded without being disposed runs no disposer
 * (BLOCKED-230), so a mount inside it never tears down: an in-flight durable
 * write is never awaited, and if the test then removes the directory it was
 * writing to, the failure reaches no caller at all (BLOCKED-229). The spec that
 * exposed this made four Contexts and disposed two.
 *
 * Ownership is unchanged — the caller still creates and mounts. What this adds
 * is that forgetting to dispose is no longer silent.
 */
/**
 * Read the service names this Context currently provides.
 * @param ctx - the Context to inspect.
 * @returns every provided service name, in registration order.
 */
function providedServices(ctx: Context): readonly string[] {
  const store = ctx.reflect.store
  return Object.getOwnPropertySymbols(store).flatMap(key => store[key]?.name ?? [])
}

/**
 * The Contexts one spec file built, so its teardown can dispose them all before
 * removing any directory their mounts write to.
 *
 * A spec that drops a Context without disposing it leaves every mount on that
 * Context live for the rest of the worker's life: timers keep firing, and a
 * session store keeps writing into a directory the next case is about to
 * remove. Registering at construction keeps that out of each case's hands.
 */
export class TrackedContexts {
  private readonly contexts: Context[] = []

  /**
   * Register a Context for teardown and return it, so a harness can wrap its
   * construction in one expression.
   * @param ctx - the Context this spec just created.
   * @returns the same Context.
   */
  track<T extends Context>(ctx: T): T {
    this.contexts.push(ctx)
    return ctx
  }

  /**
   * Dispose every tracked Context, forget them, and report what survived.
   *
   * Call this BEFORE removing any directory a mount writes to: a live mount
   * whose store directory has already gone finishes its write against a path
   * that no longer exists. Disposal is sequential so one Context's teardown
   * cannot observe another half-torn-down.
   * @returns the names of services still readable after their Context was
   * disposed, which is empty when every mount unwound. Assert on it: without
   * that assertion the call only hides an incomplete teardown.
   */
  async disposeAll(): Promise<readonly string[]> {
    const torn = this.contexts.splice(0)
    const residue: string[] = []
    for (const ctx of torn) {
      const provided = providedServices(ctx)
      await ctx.fiber.dispose()
      residue.push(...provided.filter(name => ctx.get(name) !== undefined))
    }
    return residue
  }

  /** How many Contexts are currently tracked and not yet disposed. */
  get size(): number {
    return this.contexts.length
  }
}

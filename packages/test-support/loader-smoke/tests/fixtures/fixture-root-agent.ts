/**
 * Creates the one root agent a loader-smoke fixture drives, after the tree has
 * settled.
 *
 * A configured `agent-loop` row starts its agent inside the loop's constructor,
 * before `sessionPersistence` is visible, so that session never receives a write
 * handle and its log is never written. Fixtures that read the session back from
 * disk therefore create the root agent here, after boot, the way the headless
 * runner does. The caller supplies the host-user identity, so this module stays
 * free of agent-loop and principal imports.
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'

/** The model route, working directory, and identity of a fixture's root agent. */
export interface FixtureRootAgentOptions {
  /** Mock provider name the fixture registers. */
  readonly provider: string
  /** Model name routed to that provider. */
  readonly model: string
  /** Absolute working directory recorded on the session. */
  readonly cwd: string
  /** The launcher's host-user identity for this run, when one is provided. */
  readonly identity?: unknown
}

/**
 * Create the fixture's root agent on a fresh persisted session.
 * @param ctx - the settled Loader context.
 * @param options - provider, model, session working directory, and optional identity.
 * @returns after the agent is published.
 */
export async function createFixtureRootAgent(ctx: Context, options: FixtureRootAgentOptions): Promise<void> {
  await ctx.agents.create({
    sessionId: SessionId(`fixture-${randomUUID()}`),
    meta: { cwd: options.cwd },
    agentOptions: {
      provider: options.provider,
      model: options.model,
      ...options.identity === undefined ? {} : { identity: options.identity as never },
    },
  })
}

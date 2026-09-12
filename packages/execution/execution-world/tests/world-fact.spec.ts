/**
 * P3-01 Usage: the reader both dispatch paths use, and the one event that
 * records where a session's actions ran.
 *
 * `world` was the LAST input to the enforcement point still supplied by the
 * enforcement point itself — hardcoded `{ kind: 'absent' }`, so every policy
 * question a shipped composition asked said the world was unknown even where one
 * was mounted. These cases pin the two answers the reader can give and the fact
 * that the recording happens once.
 *
 * The reader lives in `@deepseek-ai/dsh-tools` and is exercised from here
 * because this is the package that owns the registry it reads: a case in
 * `core/tools` would have to build a world registry to say anything, and that
 * registry is this package's.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { readExecutionWorldFact } from '@deepseek-ai/dsh-tools/external-effect'
import ExecutionWorldService, { digestWorldSpec } from '../src/plugin.ts'
import { createLocalWorldProvider, LOCAL_WORLD_PROVIDER } from '../src/local-provider.ts'
import type { WorldId } from '../src/types.ts'

const HOST_TENANT = brandString<TenantId>('local-host')

let minted = 0
function ids(): WorldId {
  minted += 1
  return brandString<WorldId>(`world-${String(minted)}`)
}

/**
 * A composition with real sessions, and optionally a world registry.
 * @param options - whether to mount the registry and register the local provider.
 * @returns the context and one agent over a real session.
 */
async function mounted(options: { registry?: boolean; provider?: boolean } = {}): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/workspace' }) } as never)
  if (options.registry === true) {
    await ctx.plugin(ExecutionWorldService, {
      tenant: 'local-host',
      request: { network: 'unrestricted', spawn: true, ipc: 'unrestricted', secrets: 'inherited' },
    })
    if (options.provider === true) {
      ctx.get('executionWorlds')?.register(createLocalWorldProvider({
        tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0,
      }))
    }
  }
  const session = ctx.sessions.create(SessionId(`world-fact-${String(minted)}`))
  return { ctx, agent: { id: session.id, session } as unknown as Agent }
}

/** Every `action/world-bound` event in one session's log. */
function boundEvents(agent: Agent): unknown[] {
  const events: unknown[] = []
  for (let index = 0; index < agent.session.seq; index += 1) {
    const event = agent.session.eventAt(index as never)
    if (event?.type === 'action/world-bound') events.push(event.data)
  }
  return events
}

describe('P3-01 acceptance[1]: an unanswerable world reads as absent, which is the value a policy may refuse on', () => {
  it('reads absent when no registry is mounted, so a composition without worlds asks the same question it always did', async () => {
    const { ctx, agent } = await mounted()
    expect(await readExecutionWorldFact(ctx, agent)).toEqual({ kind: 'absent' })
  })

  it('reads absent when the registry has no provider, rather than inventing one', async () => {
    const { ctx, agent } = await mounted({ registry: true })
    expect(await readExecutionWorldFact(ctx, agent)).toEqual({ kind: 'absent' })
  })

  it('records NO world-bound event when it reads absent, so the log never claims a world that does not exist', async () => {
    const { ctx, agent } = await mounted({ registry: true })
    await readExecutionWorldFact(ctx, agent)
    expect(boundEvents(agent)).toEqual([])
  })
})

describe('P3-01 acceptance[0]: the bound world reaches the policy question and the audit', () => {
  it('reads the bound world, naming the provider that minted it', async () => {
    const { ctx, agent } = await mounted({ registry: true, provider: true })
    expect(await readExecutionWorldFact(ctx, agent)).toMatchObject({
      kind: 'bound',
      provider: LOCAL_WORLD_PROVIDER,
    })
  })

  it('records the binding ONCE, however many dispatches ask', async () => {
    // "This session's actions run in world W" is one fact. Appending it per
    // dispatch would put the same sentence in the log N times and make a
    // provider swap harder to see, not easier.
    const { ctx, agent } = await mounted({ registry: true, provider: true })
    await readExecutionWorldFact(ctx, agent)
    await readExecutionWorldFact(ctx, agent)
    await readExecutionWorldFact(ctx, agent)
    expect(boundEvents(agent)).toHaveLength(1)
  })

  it('records the world, the provider and the confinement digest, which is what makes a swap auditable', async () => {
    const { ctx, agent } = await mounted({ registry: true, provider: true })
    const fact = await readExecutionWorldFact(ctx, agent)
    expect(boundEvents(agent)).toEqual([
      { world: (fact as { world: string }).world, provider: LOCAL_WORLD_PROVIDER, spec: (fact as { spec: string }).spec },
    ])
  })
})

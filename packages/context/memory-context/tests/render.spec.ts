/**
 * Focused regressions for the pure parts of the memory recall consumer: the
 * access context it reads under (`must[3]`) and the exact text it puts in
 * front of the model. These run without a composition; the product-visible
 * behavior is owned by `./memory-context.spec.ts`.
 */

import { describe, expect, it } from 'vitest'
import { createAnonymousDevPrincipal, createChain, createUserPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { MemoryAccessContext, MemoryRecordView } from '@deepseek-ai/dsh-memory'
import { MemoryRecordId } from '@deepseek-ai/dsh-memory'
import { announceRebuiltWorkspace, type Config, renderMemoryContext, resolveMemoryAccessContext } from '@deepseek-ai/dsh-memory-context'

const config: Config = { tenantId: 't-1', principalId: 'p-1', purpose: 'recall', maxRecords: 3 }

function recordOf(content: unknown): MemoryRecordView {
  return {
    id: MemoryRecordId('local-reference-1'),
    principal: createAnonymousDevPrincipal(PrincipalId('p-1'), TenantId('t-1')),
    content,
    updatedAt: '2026-09-04T00:00:00.000Z',
  }
}


/**
 * A stub agent carrying the session a real one always has.
 *
 * `session.header.cwd` is read when the workspace scope is observed; a stub
 * that omitted it compiled only because of the cast and then failed at the
 * call. `cwd: undefined` is a real state — a session with no working directory
 * — and resolves to no workspace scope rather than to a crash.
 */
function stubAgent(identity: unknown, cwd?: string): Agent {
  return { identity, session: { header: cwd === undefined ? {} : { cwd } } } as unknown as Agent
}

describe('resolveMemoryAccessContext', () => {
  it('carries all four read-scoping dimensions from config when the agent has no attached identity', async () => {
    const context = await resolveMemoryAccessContext(stubAgent(undefined), config)
    expect(context.purpose).toBe('recall')
    expect(context.scope).toEqual({ tenantId: TenantId('t-1') })
    expect(context.contextBudget).toEqual({ maxRecords: 3 })
    expect(context.principal).toMatchObject({ kind: 'anonymous-dev', id: 'p-1', tenantId: 't-1' })
  })

  it('prefers the agent\'s durably attached principal over the configured fallback id', async () => {
    const attached = createUserPrincipal(PrincipalId('real-user'), TenantId('t-1'))
    const agent = stubAgent({ chain: createChain(attached, 0) })
    const context = await resolveMemoryAccessContext(agent, config)
    expect(context.principal).toMatchObject({ kind: 'user', id: 'real-user' })
  })

  it('never reads across tenants: the scope tenant is the configured one, not the attached principal\'s', async () => {
    const attached = createUserPrincipal(PrincipalId('real-user'), TenantId('t-other'))
    const agent = stubAgent({ chain: createChain(attached, 0) })
    await expect(resolveMemoryAccessContext(agent, config)).rejects.toThrow(/tenant/i)
  })
})

describe('renderMemoryContext', () => {
  it('returns undefined for an empty recall so no empty snapshot is ever injected', () => {
    expect(renderMemoryContext([], false)).toBeUndefined()
  })

  it('renders each recalled record\'s content as text the model can read', () => {
    const text = renderMemoryContext([recordOf({ note: 'oxidized-kingfisher' })], false)
    expect(text).toContain('oxidized-kingfisher')
  })

  it('states that the recall was cut to the caller\'s budget when the seam truncated it', () => {
    const text = renderMemoryContext([recordOf({ note: 'a' })], true)
    expect(text).toMatch(/truncat/i)
  })
})

describe('announceRebuiltWorkspace', () => {
  const workspace = { canonicalPath: '/projects/alpha', identity: 'dev-1:ino-99:1800000000000' }

  /** A context whose memory seam answers one count, recording how often it was asked. */
  function stubCtx(count: number): { ctx: Context; asked: () => number } {
    let asked = 0
    const ctx = {
      memory: {
        countRebuiltAt: () => {
          asked += 1
          return Promise.resolve(count)
        },
      },
    } as unknown as Context
    return { ctx, asked: () => asked }
  }

  /** An agent recording what its session was told. */
  function stubSessionAgent(id: string): { agent: Agent; events: { type: string; data: unknown }[] } {
    const events: { type: string; data: unknown }[] = []
    const agent = {
      session: { id, append: (type: string, data: unknown) => { events.push({ type, data }) } },
    } as unknown as Agent
    return { agent, events }
  }

  const contextWith = (scope: object): MemoryAccessContext => ({
    principal: createAnonymousDevPrincipal(PrincipalId('p-1'), TenantId('t-1')),
    purpose: 'recall',
    scope: { tenantId: TenantId('t-1'), ...scope },
    contextBudget: { maxRecords: 3 },
  })

  it('tells the session once that its workspace path holds an earlier occupant\'s memory', async () => {
    const { ctx } = stubCtx(2)
    const { agent, events } = stubSessionAgent('session-1')

    await announceRebuiltWorkspace(ctx, agent, contextWith({ workspace }), new Set())

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('memory/workspace-rebuilt')
    expect(events[0]?.data).toEqual({ canonicalPath: '/projects/alpha', count: 2 })
  })

  it('does not repeat itself on a later recall in the same session', async () => {
    // A fact about storage is worth saying once; saying it every step is noise
    // in the durable log a person reads.
    const { ctx } = stubCtx(2)
    const { agent, events } = stubSessionAgent('session-1')
    const announced = new Set<string>()

    await announceRebuiltWorkspace(ctx, agent, contextWith({ workspace }), announced)
    await announceRebuiltWorkspace(ctx, agent, contextWith({ workspace }), announced)

    expect(events).toHaveLength(1)
  })

  it('stays silent when nothing was displaced, so a session does not claim a rebuild it never had', async () => {
    const { ctx } = stubCtx(0)
    const { agent, events } = stubSessionAgent('session-2')

    await announceRebuiltWorkspace(ctx, agent, contextWith({ workspace }), new Set())

    expect(events).toEqual([])
  })

  it('carries a count and a path and no record content, so it is not a read of what it reports', async () => {
    const { ctx } = stubCtx(3)
    const { agent, events } = stubSessionAgent('session-3')

    await announceRebuiltWorkspace(ctx, agent, contextWith({ workspace }), new Set())

    expect(Object.keys(events[0]?.data as object).sort()).toEqual(['canonicalPath', 'count'])
  })

  it('says nothing at all when the session has no workspace to compare', async () => {
    const { ctx, asked } = stubCtx(5)
    const { agent, events } = stubSessionAgent('session-4')

    await announceRebuiltWorkspace(ctx, agent, contextWith({}), new Set())

    expect(events).toEqual([])
    expect(asked()).toBe(0)
  })
})

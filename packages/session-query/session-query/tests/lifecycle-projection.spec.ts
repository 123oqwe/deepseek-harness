/**
 * Epic P6-07 Usage stage: the tenant/workspace projection the logical session
 * corpus performs, and the filter clauses that page over it (must[0]).
 *
 * Every assertion here is on a projected value — a tenant id, a workspace id,
 * an admitted record, a thrown filter code. None depends on a filesystem
 * behavior, a byte offset, a newline convention, or a rename's atomicity, so a
 * case that is true on one platform is true on every platform this repository
 * builds for.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createUserPrincipal, createChain } from '@deepseek-ai/dsh-principal'
import { PrincipalId, RunId, TenantId } from '@deepseek-ai/dsh-principal/types'
import type { IdentityContext } from '@deepseek-ai/dsh-principal/types'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { filterSessionResults, materializeSessionResultFilters } from '@deepseek-ai/dsh-session-query'
import type { SessionQueryErrorCode, SessionRecord } from '@deepseek-ai/dsh-session-query'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { TestSessionQueryEngine } from './test-service.ts'

const ACME = TenantId('acme')
const GLOBEX = TenantId('globex')

const WORKSPACE_A = WorkspaceId('workspace-a')
const WORKSPACE_B = WorkspaceId('workspace-b')

/** A minimal registry double: the corpus reads membership through `list()` alone. */
class TestWorkspaceRegistry extends Service {
  static workspaces: Workspace[] = []

  constructor(ctx: Context) {
    super(ctx, 'workspaceRegistry')
  }

  list(): Workspace[] {
    return [...TestWorkspaceRegistry.workspaces]
  }
}

/**
 * A membership record. `Workspace` also declares durable mutators
 * (`attachSession`, `setTitle`, …) that a read-only membership projection
 * never calls, so the double carries only the fields the projection reads.
 */
function workspace(id: ReturnType<typeof WorkspaceId>, sessionIds: readonly SessionIdType[]): Workspace {
  return {
    id,
    path: `/work/${id}`,
    title: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sessionIds,
  } as unknown as Workspace
}

function identity(tenantId: ReturnType<typeof TenantId>, principal: string): IdentityContext {
  const root = createUserPrincipal(PrincipalId(principal), tenantId)
  return { principal: root, runId: RunId(`run-${principal}`), chain: createChain(root, 1) }
}

function header(value: string, createdAt: number): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(value), createdAt, isSeeded: false }
}

function record(value: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return { header: header(value, 1), live: true, persisted: false, ...extra }
}

async function liveContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TestSessionQueryEngine)
  return ctx
}

function expectCode(code: SessionQueryErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

beforeEach(() => {
  TestWorkspaceRegistry.workspaces = []
})

describe('session corpus tenant projection (P6-07 must[0])', () => {
  it('projects tenantId from a live session\'s identity/attached event', async () => {
    const ctx = await liveContext()
    const session = ctx.sessions.create(SessionId('tenanted'))
    session.append('identity/attached', { identity: identity(ACME, 'alice') })

    const records = await ctx.sessionQuery.listSessions()
    expect(records.map(entry => [entry.header.id, entry.tenantId])).toEqual([[session.id, ACME]])
  })

  it('takes the LAST identity/attached event, so a re-attached identity supersedes an earlier one', async () => {
    const ctx = await liveContext()
    const session = ctx.sessions.create(SessionId('re-attached'))
    session.append('identity/attached', { identity: identity(ACME, 'alice') })
    session.append('identity/attached', { identity: identity(GLOBEX, 'bob') })

    const records = await ctx.sessionQuery.listSessions()
    expect(records[0]?.tenantId).toBe(GLOBEX)
  })

  it('omits the tenantId property entirely for a session with no identity/attached event, while projecting its attributed sibling', async () => {
    const ctx = await liveContext()
    ctx.sessions.create(SessionId('anonymous'))
    const attributed = ctx.sessions.create(SessionId('attributed'), { meta: { createdAt: 2 } })
    attributed.append('identity/attached', { identity: identity(ACME, 'alice') })

    const records = await ctx.sessionQuery.listSessions()
    const byId = new Map(records.map(entry => [entry.header.id, entry]))
    // The property is absent, not present-and-undefined: an existing landed
    // case asserts this exact key set for an unattributed session.
    expect(Object.keys(byId.get(SessionId('anonymous')) as object)).toEqual(['header', 'live', 'persisted'])
    expect(Object.keys(byId.get(attributed.id) as object)).toEqual(['header', 'live', 'persisted', 'tenantId'])
  })

  it('never derives a tenant from user/message content (P2-01 must[2])', async () => {
    const ctx = await liveContext()
    const session = ctx.sessions.create(SessionId('prompt-claim'))
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: `tenantId: ${ACME}` }],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )

    const attached = ctx.sessions.create(SessionId('really-attached'), { meta: { createdAt: 2 } })
    attached.append('identity/attached', { identity: identity(ACME, 'alice') })

    const records = await ctx.sessionQuery.listSessions()
    const byId = new Map(records.map(entry => [entry.header.id, entry]))
    // The same tenant string is claimed in prompt text and durably attached to
    // a sibling: only the durably attached one is projected.
    expect(byId.get(attached.id)?.tenantId).toBe(ACME)
    expect(byId.get(session.id)).not.toHaveProperty('tenantId')
  })
})

describe('session corpus workspace projection (P6-07 must[0])', () => {
  it('projects workspaceId from the mounted workspace registry', async () => {
    const ctx = await liveContext()
    const member = ctx.sessions.create(SessionId('member'))
    const outsider = ctx.sessions.create(SessionId('outsider'), { meta: { createdAt: 2 } })
    TestWorkspaceRegistry.workspaces = [workspace(WORKSPACE_A, [member.id])]
    await ctx.plugin(TestWorkspaceRegistry)

    const records = await ctx.sessionQuery.listSessions()
    const byId = new Map(records.map(entry => [entry.header.id, entry]))
    expect(byId.get(member.id)?.workspaceId).toBe(WORKSPACE_A)
    expect(byId.get(outsider.id)).not.toHaveProperty('workspaceId')
  })

  it('omits workspaceId entirely when no workspace registry is mounted, while still projecting the tenant', async () => {
    const ctx = await liveContext()
    const session = ctx.sessions.create(SessionId('registry-less'))
    session.append('identity/attached', { identity: identity(ACME, 'alice') })

    const records = await ctx.sessionQuery.listSessions()
    expect(records[0]?.tenantId).toBe(ACME)
    expect(records[0]).not.toHaveProperty('workspaceId')
  })
})

describe('tenant and workspace filter clauses (P6-07 must[0])', () => {
  it('admits only records whose projected tenant matches a tenant clause', () => {
    const records = [
      record('acme-one', { tenantId: ACME }),
      record('globex-one', { tenantId: GLOBEX }),
      record('acme-two', { tenantId: ACME }),
    ]
    expect(filterSessionResults(records, [{ kind: 'tenant', values: [ACME] }]).map(entry => entry.header.id))
      .toEqual([SessionId('acme-one'), SessionId('acme-two')])
  })

  it('never admits a record with no projected tenant into a tenant clause', () => {
    const records = [record('unattributed'), record('acme-one', { tenantId: ACME })]
    expect(filterSessionResults(records, [{ kind: 'tenant', values: [ACME] }]).map(entry => entry.header.id))
      .toEqual([SessionId('acme-one')])
  })

  it('admits only workspace members, and never a record with no projected workspace', () => {
    const records = [
      record('in-a', { workspaceId: WORKSPACE_A }),
      record('in-b', { workspaceId: WORKSPACE_B }),
      record('in-none'),
    ]
    expect(filterSessionResults(records, [{ kind: 'workspace', values: [WORKSPACE_A] }]).map(entry => entry.header.id))
      .toEqual([SessionId('in-a')])
  })

  it('ANDs a tenant clause with a workspace clause', () => {
    const records = [
      record('both', { tenantId: ACME, workspaceId: WORKSPACE_A }),
      record('tenant-only', { tenantId: ACME }),
      record('workspace-only', { workspaceId: WORKSPACE_A }),
      record('other-tenant', { tenantId: GLOBEX, workspaceId: WORKSPACE_A }),
    ]
    const filtered = filterSessionResults(records, [
      { kind: 'tenant', values: [ACME] },
      { kind: 'workspace', values: [WORKSPACE_A] },
    ])
    expect(filtered.map(entry => entry.header.id)).toEqual([SessionId('both')])
  })

  it('ORs the values within one tenant clause', () => {
    const records = [record('a', { tenantId: ACME }), record('g', { tenantId: GLOBEX })]
    expect(filterSessionResults(records, [{ kind: 'tenant', values: [ACME, GLOBEX] }])).toHaveLength(2)
  })

  it('copies tenant and workspace clause values immediately, so a later caller mutation cannot change the filter', () => {
    const tenants = [ACME]
    const workspaces = [WORKSPACE_A]
    const materialized = materializeSessionResultFilters([
      { kind: 'tenant', values: tenants },
      { kind: 'workspace', values: workspaces },
    ])
    tenants[0] = GLOBEX
    workspaces[0] = WORKSPACE_B
    expect(materialized).toEqual([
      { kind: 'tenant', values: [ACME] },
      { kind: 'workspace', values: [WORKSPACE_A] },
    ])
  })

  it('rejects a tenant or workspace clause whose values are not an array of strings', () => {
    expect(() => materializeSessionResultFilters([{ kind: 'tenant', values: 'acme' } as never]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    expect(() => materializeSessionResultFilters([{ kind: 'workspace', values: [7] } as never]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
  })

  it('filters the real corpus by tenant end to end through filterSessions', async () => {
    const ctx = await liveContext()
    const mine = ctx.sessions.create(SessionId('mine'))
    mine.append('identity/attached', { identity: identity(ACME, 'alice') })
    const theirs = ctx.sessions.create(SessionId('theirs'), { meta: { createdAt: 2 } })
    theirs.append('identity/attached', { identity: identity(GLOBEX, 'bob') })
    ctx.sessions.create(SessionId('nobodys'), { meta: { createdAt: 3 } })

    const filtered = await ctx.sessionQuery.filterSessions([{ kind: 'tenant', values: [ACME] }])
    expect(filtered.map(entry => entry.header.id)).toEqual([mine.id])
  })
})

/**
 * Epic P2-07 U1c validation[2] over the SDK: a client lists the pending
 * approvals of the tenant its connection acts as, decides one from the
 * revision it read, and, having declared `approval`, is told of every
 * approval of that tenant this runtime records or moves, and of no other.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop, { HOST_USER_IDENTITY_KEY } from '@deepseek-ai/dsh-agent-loop'
import { TrackedContexts, mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { ApprovalRequestId, ApprovalRequestInput, ApprovalStoreContract, PrincipalId, SessionId, TenantId } from '@deepseek-ai/dsh-approval-store'
import ApprovalStoreSqlitePlugin from '@deepseek-ai/dsh-approval-store/sqlite'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createAnonymousDevPrincipal, createChain, type IdentityContext, type RunId } from '@deepseek-ai/dsh-principal'
import type { JsonRpcTransportPeer } from '@deepseek-ai/dsh-sdk-protocol'
import { HarnessSdkJsonRpcServer } from '../src/index.ts'

class FakeTransport implements JsonRpcTransportPeer {
  notifications: { method: string; params?: Record<string, unknown> }[] = []

  async request(method: string): Promise<unknown> {
    throw new Error(`the SDK server should not call host JSON-RPC method ${method}`)
  }

  notify(method: string, params?: object): void {
    this.notifications.push(params === undefined ? { method } : { method, params: params as Record<string, unknown> })
  }
}

const contexts = new TrackedContexts()
const dirs: string[] = []
afterEach(async () => {
  expect(await contexts.disposeAll()).toEqual([])
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

const local = brandString<TenantId>('local')
const sessionId = brandString<SessionId>('session-a')

/**
 * One turn-scoped approval of `tenant`.
 * @param id - the approval id.
 * @param tenant - its tenant.
 * @param session - the session it was asked in.
 * @returns the request input.
 */
function ask(id: string, tenant: TenantId = local, session: SessionId = sessionId): ApprovalRequestInput {
  return {
    id: brandString<ApprovalRequestId>(id),
    tenant,
    actor: brandString<PrincipalId>('agent'),
    scope: { kind: 'turn', sessionId: session },
    toolName: 'bash',
    requestDigest: `sha256:${id}`,
    deadlineMs: Date.now() + 60_000,
  }
}

/**
 * A server over a context with the SQLite approval store mounted (unless `store` is false), initialized.
 * @param options - `store: false` mounts no store; `capabilities` the client declares; `hostUser` the factory a launcher provides.
 * @returns the server, its transport, and the store.
 */
async function connected(options: {
  store?: boolean
  capabilities?: string[]
  hostUser?: (runId: RunId) => IdentityContext
} = {}): Promise<{ server: HarnessSdkJsonRpcServer; transport: FakeTransport; store: ApprovalStoreContract | undefined }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sdk-approvals-'))
  dirs.push(dir)
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
  const ctx = contexts.track(new Context())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.store !== false) await ctx.plugin(ApprovalStoreSqlitePlugin, { directory: dir, busyTimeoutMs: 1000 })
  if (options.hostUser !== undefined) ctx.provide(HOST_USER_IDENTITY_KEY, options.hostUser)
  const transport = new FakeTransport()
  const server = new HarnessSdkJsonRpcServer(ctx, transport)
  await server.initialize({
    cwd: dir,
    provider: 'deepseek-official',
    model: 'approvals-model',
    capabilities: (options.capabilities ?? []).map(id => ({ id, mandatory: false })),
  })
  return { server, transport, store: ctx.get('approvalStore') }
}

/**
 * The identity of a host user in `tenant`.
 * @param tenant - the user's tenant.
 * @returns a factory minting that identity for any run.
 */
function hostUserOf(tenant: string): (runId: RunId) => IdentityContext {
  const principal = createAnonymousDevPrincipal(brandString<PrincipalId>('host-user'), brandString<TenantId>(tenant))
  return runId => ({ principal, runId, chain: createChain(principal, Date.now()) })
}

describe('P2-07 U1c validation[2]: approval/list and approval/decide', () => {
  it('lists the pending approvals of the connection\'s tenant, oldest first, narrowed to a session on request', async () => {
    const { server, store } = await connected()
    store?.request(ask('a-1'), Date.now())
    store?.request(ask('a-2', local, brandString<SessionId>('session-b')), Date.now())
    store?.request(ask('elsewhere', brandString<TenantId>('tenant-b')), Date.now())
    store?.request(ask('decided'), Date.now())
    store?.decide(brandString<ApprovalRequestId>('decided'), 0, 'denied', { tenant: local, principal: brandString<PrincipalId>('u') }, Date.now())

    const all = await server.handleRequest('approval/list', {}) as { approvals: { id: string; sessionId: string; state: string }[] }
    expect(all.approvals.map(approval => [approval.id, approval.sessionId, approval.state])).toEqual([
      ['a-1', 'session-a', 'requested'],
      ['a-2', 'session-b', 'requested'],
    ])
    const narrowed = await server.handleRequest('approval/list', { sessionId: 'session-b' }) as { approvals: { id: string }[] }
    expect(narrowed.approvals.map(approval => approval.id)).toEqual(['a-2'])
    expect(await server.handleRequest('approval/list', undefined)).toMatchObject({ approvals: [{ id: 'a-1' }, { id: 'a-2' }] })
  })

  it('decides from the revision the client read, and refuses a second decision from the same read', async () => {
    const { server, store } = await connected()
    store?.request(ask('a-1'), Date.now())

    expect(await server.handleRequest('approval/decide', { id: 'a-1', revision: 0, decision: 'approved' }))
      .toMatchObject({ ok: true, approval: { id: 'a-1', state: 'approved', revision: 1 } })
    expect(await server.handleRequest('approval/decide', { id: 'a-1', revision: 0, decision: 'denied' }))
      .toMatchObject({ ok: false, conflict: 'stale-revision', approval: { state: 'approved', revision: 1 } })
  })

  it('answers another tenant\'s approval as not-found, as it does one that does not exist', async () => {
    const { server, store } = await connected()
    store?.request(ask('elsewhere', brandString<TenantId>('tenant-b')), Date.now())

    expect(await server.handleRequest('approval/decide', { id: 'elsewhere', revision: 0, decision: 'approved' }))
      .toEqual({ ok: false, conflict: 'not-found' })
    expect(await server.handleRequest('approval/decide', { id: 'missing', revision: 0, decision: 'approved' }))
      .toEqual({ ok: false, conflict: 'not-found' })
  })

  it('acts as the host user the launcher provides, so it sees that user\'s tenant and not local', async () => {
    const { server, store } = await connected({ hostUser: hostUserOf('tenant-b') })
    store?.request(ask('local-one'), Date.now())
    store?.request(ask('theirs', brandString<TenantId>('tenant-b')), Date.now())

    const listed = await server.handleRequest('approval/list', {}) as { approvals: { id: string }[] }
    expect(listed.approvals.map(approval => approval.id)).toEqual(['theirs'])
    expect(await server.handleRequest('approval/decide', { id: 'theirs', revision: 0, decision: 'approved' })).toMatchObject({ ok: true })
    expect(store?.get(brandString<ApprovalRequestId>('theirs'), { tenant: brandString<TenantId>('tenant-b'), principal: brandString<PrincipalId>('x') }, Date.now()))
      .toMatchObject({ decidedBy: 'host-user' })
  })

  it('holds no approvals where no store is mounted', async () => {
    const { server } = await connected({ store: false })
    expect(await server.handleRequest('approval/list', {})).toEqual({ approvals: [] })
    expect(await server.handleRequest('approval/decide', { id: 'a-1', revision: 0, decision: 'approved' })).toEqual({ ok: false, conflict: 'not-found' })
  })

  it('refuses params that are not what the method takes, and a call before initialize', async () => {
    const { server } = await connected()
    const refusals: [string, unknown, string][] = [
      ['approval/list', [], 'approval/list params must be an object'],
      ['approval/list', { sessionId: '' }, 'approval/list sessionId must be a non-empty string'],
      ['approval/decide', null, 'approval/decide params must be an object'],
      ['approval/decide', { revision: 0, decision: 'approved' }, 'approval/decide id must be a non-empty string'],
      ['approval/decide', { id: 'a', revision: -1, decision: 'approved' }, 'approval/decide revision must be a non-negative safe integer'],
      ['approval/decide', { id: 'a', revision: 0.5, decision: 'approved' }, 'approval/decide revision must be a non-negative safe integer'],
      ['approval/decide', { id: 'a', revision: '0', decision: 'approved' }, 'approval/decide revision must be a non-negative safe integer'],
      ['approval/decide', { id: 'a', revision: 0, decision: 'consumed' }, 'approval/decide decision must be "approved" or "denied"'],
    ]
    for (const [method, params, message] of refusals) {
      await expect(server.handleRequest(method, params as Record<string, unknown>)).rejects.toThrow(message)
    }
    const fresh = new HarnessSdkJsonRpcServer(contexts.track(new Context()), new FakeTransport())
    await expect(fresh.handleRequest('approval/list', {})).rejects.toThrow('SDK server is not initialized')
  })
})

describe('P2-07 U1c validation[2]: approval.changed', () => {
  it('tells a client that declared approval of each approval of its tenant recorded or moved, with its session at the top level', async () => {
    const { transport, store } = await connected({ capabilities: ['approval'] })
    store?.request(ask('a-1'), Date.now())
    store?.request(ask('elsewhere', brandString<TenantId>('tenant-b')), Date.now())
    store?.decide(brandString<ApprovalRequestId>('a-1'), 0, 'approved', { tenant: local, principal: brandString<PrincipalId>('u') }, Date.now())

    const changed = transport.notifications
      .filter(notification => notification.method === 'approval.changed')
      .map(notification => notification.params as { sessionId: string; approval: { id: string; state: string; revision: number } })
    expect(changed.map(({ sessionId: session, approval }) => [session, approval.id, approval.state, approval.revision])).toEqual([
      ['session-a', 'a-1', 'requested', 0],
      ['session-a', 'a-1', 'approved', 1],
    ])
  })

  it('carries a run-scoped approval\'s run', async () => {
    const { transport, store } = await connected({ capabilities: ['approval'] })
    store?.request({ ...ask('run-1'), scope: { kind: 'run', runId: brandString<RunId>('run-x'), sessionId } }, Date.now())
    expect(transport.notifications.find(notification => notification.method === 'approval.changed')?.params)
      .toMatchObject({ approval: { id: 'run-1', runId: 'run-x', sessionId: 'session-a' } })
  })

  it('sends a client that did not declare approval nothing', async () => {
    const { transport, store } = await connected()
    store?.request(ask('a-1'), Date.now())
    expect(transport.notifications.filter(notification => notification.method === 'approval.changed')).toEqual([])
  })
})

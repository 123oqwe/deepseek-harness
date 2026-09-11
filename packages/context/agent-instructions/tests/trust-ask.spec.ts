/**
 * P1-07 must[2]'s host-user interaction, at the point it fires.
 *
 * The question is put when a session would first load an untrusted
 * workspace's own instruction files — not at boot, because launching `dsh` in
 * a directory is not the user's act of trusting it, and because
 * `approval.request()` is turn-bound and a question asked between turns
 * cannot produce the audit pair that makes it readable.
 *
 * Every case drives the real `ApprovalService` over a real `Session` with an
 * open turn, and the real host-local trust provider over real storage, so
 * what is proven is the composition rather than a stub agreeing with itself.
 * @module
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import * as WorkspaceTrustLocal from '@deepseek-ai/dsh-workspace-trust-local'
import ApprovalService, { type ApprovalOutcome, type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { createUserPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import SessionStore, { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry, { agentEvents, Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as workspaceContext from '@deepseek-ai/dsh-agent-instructions'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trust-ask-'))
  roots.push(root)
  return root
}

/**
 * A session with a cwd, an open turn, and a host user attached — the trust
 * question's three preconditions: something to resolve trust for, a turn the
 * audit pair can be enclosed in, and a principal whose authority a grant can
 * be recorded against.
 */
function hostSession(cwd: string): { agent: Agent; session: Session } {
  const id = SessionId('trust-ask')
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false })
  session.append('turn/start', { turn: 1 })
  session.append('identity/attached', {
    identity: { principal: createUserPrincipal(PrincipalId('host-1'), TenantId('t-1')) },
  } as never)
  const agent = {
    ctx: new Context(),
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('the trust ask must not inject') },
    cancel() {},
    runMaintenance: (task: (signal: AbortSignal) => unknown) => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } as unknown as Agent
  return { agent, session }
}

/** Drive one real pre-step through the mounted plugin, which is where the question is put. */
async function preStep(ctx: Context, agent: Agent): Promise<void> {
  await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
}

/** The real stack a shipped profile composes for this question. */
async function stack(answer: ApprovalOutcome | undefined): Promise<Context> {
  const storageRoot = await makeRoot()
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(
    { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
    { root: storageRoot },
  )
  await ctx.plugin(
    { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
    { backend: 'json' },
  )
  await ctx.plugin(WorkspaceTrustLocal, { grants: [] })
  await ctx.plugin(ApprovalService, {})
  await ctx.plugin(LocalFileSystem, { cwd: '/' })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(workspaceContext, { maxBytes: 65536 })
  if (answer !== undefined) {
    ctx.on('approval/request', (_request: ApprovalRequest) => Promise.resolve(answer))
  }
  return ctx
}

describe('P1-07 must[2]: the host user is asked before an untrusted workspace is read', () => {
  it('raises the workspace to trusted-read when the host user accepts, driven by a real pre-step', async () => {
    // The load-bearing case: the question is put BY THE PLUGIN, on the path a
    // shipped profile takes, rather than by the test calling approval and the
    // provider in the order it wishes they were called.
    const project = await makeRoot()
    await writeFile(join(project, 'AGENTS.md'), '# project instructions\n', 'utf8')
    const ctx = await stack('allowed-once')
    const { agent } = hostSession(project)

    expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
    await preStep(ctx, agent)

    expect(await ctx.workspaceTrust.stateFor(project)).toBe('trusted-read')
    await ctx.fiber.dispose()
  })

  it('asks once per session: a refusal is not re-put on the next step', async () => {
    const project = await makeRoot()
    await writeFile(join(project, 'AGENTS.md'), '# project instructions\n', 'utf8')
    const asks: string[] = []
    const ctx = await stack(undefined)
    ctx.on('approval/request', (request: ApprovalRequest) => {
      asks.push(request.subject ?? request.toolName)
      return Promise.resolve<ApprovalOutcome>('rejected')
    })
    const { agent } = hostSession(project)

    await preStep(ctx, agent)
    await preStep(ctx, agent)
    await preStep(ctx, agent)

    expect(asks).toHaveLength(1)
    expect(asks[0]).toBe(`${project}: trusted-read`)
    expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
    await ctx.fiber.dispose()
  })

  it('does not ask at all once the workspace is already trusted', async () => {
    const project = await makeRoot()
    await writeFile(join(project, 'AGENTS.md'), '# project instructions\n', 'utf8')
    const asks: string[] = []
    const ctx = await stack(undefined)
    ctx.on('approval/request', (request: ApprovalRequest) => {
      asks.push(request.subject ?? request.toolName)
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    await ctx.workspaceTrust.grantTrust(
      project, 'trusted-read', createUserPrincipal(PrincipalId('host-1'), TenantId('t-1')),
    )
    const { agent } = hostSession(project)

    await preStep(ctx, agent)

    expect(asks).toStrictEqual([])
    await ctx.fiber.dispose()
  })

  it('leaves the workspace untrusted when the host user refuses', async () => {
    const project = await makeRoot()
    const ctx = await stack('rejected')
    const { agent } = hostSession(project)

    const outcome = await ctx.approval.request({
      agent, toolName: 'workspace-trust', subject: `${project}: trusted-read`,
    })
    expect(outcome).toBe('rejected')
    expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
    await ctx.fiber.dispose()
  })

  it('leaves the workspace untrusted on a non-interactive profile, where there is nobody to ask', async () => {
    // No answerer is mounted, so the seam settles 'unavailable' — fail closed,
    // and the state a CI agent runs in rather than an edge case.
    const project = await makeRoot()
    const ctx = await stack(undefined)
    const { agent } = hostSession(project)

    const outcome = await ctx.approval.request({
      agent, toolName: 'workspace-trust', subject: `${project}: trusted-read`,
    })
    expect(outcome).toBe('unavailable')
    expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
    await ctx.fiber.dispose()
  })

  it('refuses a grant authorized by a principal that is not the host user', async () => {
    // must[2] names the HOST user. An agent or service principal answering its
    // own trust question is the shape this refuses.
    const project = await makeRoot()
    const ctx = await stack('allowed-once')

    const result = await ctx.workspaceTrust.grantTrust(
      project,
      'trusted-read',
      { kind: 'agent', id: PrincipalId('agent-1'), tenantId: TenantId('t-1') } as never,
    )
    expect(result.upgraded).toBe(false)
    expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
    await ctx.fiber.dispose()
  })

  it('records the question and its outcome as an auditable pair naming the subject', async () => {
    const project = await makeRoot()
    const ctx = await stack('allowed-once')
    const { agent, session } = hostSession(project)

    await ctx.approval.request({
      agent, toolName: 'workspace-trust', subject: `${project}: trusted-read`,
    })

    const events = session.snapshotEvents()
    const asked = events.find(event => event.type === 'approval/asked')
    const decided = events.find(event => event.type === 'approval/decided')
    expect(asked?.data).toMatchObject({ toolName: 'workspace-trust', subject: `${project}: trusted-read` })
    expect(decided?.data).toMatchObject({ outcome: 'allowed-once' })
    await ctx.fiber.dispose()
  })
})

/**
 * `/trust-skills`: the host-user-initiated half of P1-07 must[2].
 *
 * Every case drives the registered command through the real `commands`
 * registry, over the real approval service and the real host-local trust
 * provider on real storage — so what is proven is the path a user takes, not
 * a handler called directly with arguments a test chose.
 * @module
 */

import { mkdtemp, rm } from 'node:fs/promises'
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
import CommandRegistry from '@deepseek-ai/dsh-commands'
import { createUserPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as CommandWorkspaceTrust from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trust-cmd-'))
  roots.push(root)
  return root
}

/** A session with a cwd, an open turn, and a host user attached. */
function hostAgent(cwd: string): Agent {
  const id = SessionId('trust-cmd')
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false })
  session.append('turn/start', { turn: 1 })
  session.append('identity/attached', {
    identity: { principal: createUserPrincipal(PrincipalId('host-1'), TenantId('t-1')) },
  } as never)
  return { id, session, options: {}, ctx: new Context() } as unknown as Agent
}

async function stack(answer?: ApprovalOutcome): Promise<Context> {
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
  await ctx.plugin(CommandRegistry)
  await ctx.plugin(CommandWorkspaceTrust)
  if (answer !== undefined) {
    ctx.on('approval/request', (_request: ApprovalRequest) => Promise.resolve(answer))
  }
  return ctx
}

/** Run the command exactly as a dispatching surface does: a slash line, not a handler call. */
async function runCommand(ctx: Context, agent: Agent) {
  const execution = await ctx.commands.execute(agent, '/trust-skills', [], new AbortController().signal)
  if (execution === undefined) throw new Error('the command did not resolve — it is not registered')
  return execution
}

describe('/trust-skills raises this workspace to trusted-execute, on the host user\'s say-so', () => {
  it('grants trusted-execute once the host user confirms', async () => {
    const project = await makeRoot()
    const ctx = await stack('allowed-once')
    const agent = hostAgent(project)

    expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
    const execution = await runCommand(ctx, agent)

    expect(execution.result.kind).toBe('success')
    expect(await ctx.workspaceTrust.stateFor(project)).toBe('trusted-execute')
    await ctx.fiber.dispose()
  })

  it('leaves the workspace untrusted when the confirmation is refused, and says so', async () => {
    const project = await makeRoot()
    const ctx = await stack('rejected')
    const agent = hostAgent(project)

    const execution = await runCommand(ctx, agent)

    expect(execution.result).toMatchObject({ kind: 'error' })
    expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
    await ctx.fiber.dispose()
  })

  it('leaves the workspace untrusted where there is nobody to confirm with', async () => {
    // A non-interactive profile: no answerer, so the seam settles
    // 'unavailable'. Typing the command is not itself the confirmation.
    const project = await makeRoot()
    const ctx = await stack()
    const agent = hostAgent(project)

    const execution = await runCommand(ctx, agent)

    expect(execution.result).toMatchObject({ kind: 'error' })
    expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
    await ctx.fiber.dispose()
  })

  it('records the confirmation as an auditable pair naming the workspace and the state', async () => {
    const project = await makeRoot()
    const ctx = await stack('allowed-once')
    const agent = hostAgent(project)

    await runCommand(ctx, agent)

    const events = agent.session.snapshotEvents()
    expect(events.find(event => event.type === 'approval/asked')?.data)
      .toMatchObject({ toolName: 'workspace-trust', subject: `${project}: trusted-execute` })
    expect(events.find(event => event.type === 'approval/decided')?.data)
      .toMatchObject({ outcome: 'allowed-once' })
    await ctx.fiber.dispose()
  })

  it('reports an already-trusted workspace without asking again', async () => {
    const project = await makeRoot()
    const asks: string[] = []
    const ctx = await stack()
    ctx.on('approval/request', (request: ApprovalRequest) => {
      asks.push(request.subject ?? request.toolName)
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    const agent = hostAgent(project)
    await runCommand(ctx, agent)
    expect(asks).toHaveLength(1)

    const second = await runCommand(ctx, agent)

    expect(second.result.kind).toBe('success')
    expect(asks).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})

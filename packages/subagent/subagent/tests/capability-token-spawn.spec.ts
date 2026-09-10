/**
 * Delegated capability tokens on a REAL spawn (Epic P2-02 acceptance[0],
 * acceptance[2]; P2-02.U).
 *
 * The sibling `capability-token-delegation.spec.ts` proves the DECISIONS —
 * `delegatedChildResources`, the widening refusals, the depth and digest a
 * child records — against tokens built in the case. Every one of those passed
 * in the world P2-02's sign-off was withdrawn for, because nothing in the
 * harness derived a token at all. These cases exist to be false in that world:
 * they start a child through the spawn provider and read the token the harness
 * actually gave it.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import CapabilityTokenFilePlugin from '@deepseek-ai/dsh-capability-token-file'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Boot the spawn stack over a real Trust Kernel and a mounted token provider. */
async function setup(requireForTools = true) {
  const ctx = new Context()
  contexts.push(ctx)
  pinTrustKernel(ctx, createTrustKernel())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  const root = mkdtempSync(join(tmpdir(), 'dsh-cap-spawn-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: root })
  await ctx.plugin(ApprovalService)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(MessageBusPlugin)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  for (const name of ['read_file', 'write_file', 'run_shell']) {
    ctx.tools.register(defineContentToolFixture({
      name,
      description: `${name} fixture`,
      parameters: {},
      async execute() { return [{ type: 'text', text: 'ok' }] },
    }))
  }
  await ctx.plugin(CapabilityTokenFilePlugin, { directory: join(root, 'tokens'), requireForTools, sessionTokenTtlMs: 60_000 })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
  const parent = ctx.agentLoop.create(SessionId('spawn-parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, root }
}

/**
 * Start one CONTINUABLE child and return its session id.
 *
 * Continuable rather than one-shot because a one-shot child has already run to
 * completion and disposed by the time `start` resolves, and `agent/disposed`
 * drops its token — so a one-shot harness observes `undefined` and would read
 * as "delegation does not happen" when what it measured was a dead session.
 */
async function spawnChild(ctx: Context, parent: Agent, toolFilter?: { allow?: string[]; deny?: string[] }) {
  const started = await ctx.subagents.startContinuable({
    provider: 'spawn',
    label: 'child task',
    request: {
      prompt: [{ type: 'text' as const, text: 'child task' }],
      parent,
      ...toolFilter === undefined ? {} : { toolFilter },
    },
    signal: new AbortController().signal,
  })
  return started
}

describe('P2-02 acceptance[0] on a real spawn: a child is never wider than its parent', () => {
  it('derives the child token from the parent, not a root of its own', async () => {
    const { ctx, parent } = await setup()
    const parentToken = await ctx.capabilityTokens.whenSessionToken(parent.id)
    expect(parentToken, 'the parent must hold a token to delegate from').toBeDefined()

    const run = await spawnChild(ctx, parent)
    const childToken = await ctx.capabilityTokens.whenSessionToken(run.childId)
    expect(childToken, 'a spawned child must hold a DERIVED token').toBeDefined()

    // Derived, not minted: a root has no parent digest, and a child's lineage
    // is what makes revoking the parent reach it.
    expect(childToken?.token.parentDigest).not.toBeNull()
    for (const resource of childToken?.token.resources ?? []) {
      expect(parentToken?.token.resources).toContain(resource)
    }
  })

  it('narrows the child to the parent filter, and the filter is what decides', async () => {
    const { ctx, parent } = await setup()
    await ctx.capabilityTokens.whenSessionToken(parent.id)
    const run = await spawnChild(ctx, parent, { allow: ['read_file'] })
    const childToken = await ctx.capabilityTokens.whenSessionToken(run.childId)

    expect(childToken?.token.resources).toContain('read_file')
    // The negative half: a name the parent HELD and the filter excluded is the
    // one that proves the filter narrowed rather than the parent being narrow.
    expect(childToken?.token.resources).not.toContain('write_file')
    expect(childToken?.token.resources).not.toContain('run_shell')
  })

  it('refuses a filtered-out tool at the CALL, not merely in the token list', async () => {
    // A token that omits the name would still pass a list assertion while the
    // dispatch admitted it, which is the gap between a recorded decision and an
    // enforced one.
    const { ctx, parent } = await setup()
    await ctx.capabilityTokens.whenSessionToken(parent.id)
    const run = await spawnChild(ctx, parent, { allow: ['read_file'] })
    const child = ctx.agents.get(run.childId)
    const childToken = await ctx.capabilityTokens.whenSessionToken(run.childId)

    const refused = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'child-denied' as never,
      name: 'write_file',
      arguments: {},
      ...child === undefined ? {} : { agent: child },
      ...childToken === undefined ? {} : { capabilityToken: childToken },
    })
    expect(refused.isError).toBe(true)
    expect(JSON.stringify(refused.content)).toContain('does not authorize')
  })
})

describe('P2-02 acceptance[2] on a real spawn: no token body escapes', () => {
  it('keeps the token out of the child session log and out of tool results', async () => {
    const { ctx, parent } = await setup()
    await ctx.capabilityTokens.whenSessionToken(parent.id)
    const run = await spawnChild(ctx, parent)
    const childToken = await ctx.capabilityTokens.whenSessionToken(run.childId)
    expect(childToken).toBeDefined()

    const signature = Buffer.from(childToken?.signature ?? new Uint8Array()).toString('base64')
    const child = ctx.agents.get(run.childId)
    const logged = JSON.stringify(child?.session.snapshotEvents() ?? [])
    expect(logged).not.toContain(signature)
    expect(logged).not.toContain('"signature"')
  })
})

describe('P2-02 acceptance[1]: a cancelled turn does not revoke delegated authority', () => {
  it('keeps a continuable child able to act after its parent turn is cancelled', async () => {
    // Measured before anything was wired, because the alternative was to wire
    // revocation into the cancel path and discover afterwards that it had
    // either reached nothing or broken the parent. The measurement decided:
    // this is the delegated lifetime working, not a hole.
    const { ctx, parent } = await setup()
    await ctx.capabilityTokens.whenSessionToken(parent.id)
    const run = await spawnChild(ctx, parent)
    const child = ctx.agents.get(run.childId)
    expect(child, 'the continuable child must be resident before cancelling its parent').toBeDefined()
    const childToken = await ctx.capabilityTokens.whenSessionToken(run.childId)
    expect(childToken).toBeDefined()

    parent.cancel({ kind: 'user' })

    // The observation: with the parent cancelled, does the child's own token
    // still admit a tool call?
    const afterCancel = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'orphan-call' as never,
      name: 'read_file',
      arguments: {},
      ...child === undefined ? {} : { agent: child },
      ...childToken === undefined ? {} : { capabilityToken: childToken },
    })

    const stillActs = !afterCancel.isError
    // Cancel is NOT revocation, and this pins that on purpose. A token carries
    // the authority a SESSION delegated; `Agent.cancel` is turn-scoped
    // (`agent-loop/src/agent.ts:171` aborts the phase and returns the agent to
    // use), and P5-10's own semantics are that cancelling is not disconnecting.
    // A continuable child outlives the turn by definition, so its authority
    // outliving one cancelled turn is the correct lifetime, not a leak.
    //
    // What DOES withdraw it: expiry — bounded by `min(parent expiry, child
    // TTL)` — and explicit revocation, whose production owner is P2-12's
    // emergency stop (revoke the run's session roots, cascading through the
    // lineage). Wiring `revokeSession(parent)` here would instead refuse the
    // parent's own next turn, turning a correct lifetime into a fail-closed bug.
    expect(stillActs, 'a cancelled TURN does not revoke delegated authority').toBe(true)
  })
})

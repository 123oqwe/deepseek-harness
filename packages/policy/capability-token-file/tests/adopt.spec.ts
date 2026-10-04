/**
 * Epic P2-07 D8 on the mounted provider: a delegated session resumed after its
 * process ended (a waiting workflow run woken once its approval is decided)
 * holds the token delegated to it before, the same token, so its authority
 * cannot widen; it is never issued a root, and when that token lapsed or was
 * revoked it holds nothing and its calls are refused.
 *
 * Only `Date` is faked; the store's file I/O and the Trust Kernel's signing
 * run for real. A restart is a second mount over the same store directory.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { digestToken } from '@deepseek-ai/dsh-capability-token'
import type { SignedCapabilityToken } from '@deepseek-ai/dsh-capability-token'
import CapabilityTokenFilePlugin from '@deepseek-ai/dsh-capability-token-file/src/index.ts'

/** A policy that permits every action, so a refusal observed here is the token's. */
const PERMIT_ALL_POLICY = {
  digest: 'permit-all',
  evaluate: () => ({ decision: { effect: 'permit', policySet: 'permit-all' }, explain: { matched: [], diagnostics: [] } }),
}

const roots: string[] = []
const mounted: Context[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(async () => {
  vi.useRealTimers()
  for (const ctx of mounted.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/**
 * Register a tool that any token naming it authorizes.
 * @param ctx - the mount.
 * @param name - the tool's name.
 */
function registerTool(ctx: Context, name: string): void {
  ctx.tools.register(defineContentToolFixture({
    name,
    description: `the ${name} tool`,
    parameters: {},
    async execute() { return [{ type: 'text', text: 'ok' }] },
  }))
}

/**
 * Mount the provider with `read_file` and `write_file` visible and the tool requirement armed.
 * @param reuseDirectory - an existing store directory; a second mount over it is a restart.
 * @returns the mounted context and its store directory.
 */
async function mount(reuseDirectory?: string): Promise<{ ctx: Context; directory: string }> {
  const directory = reuseDirectory ?? await mkdtemp(join(tmpdir(), 'dsh-cap-token-adopt-'))
  if (reuseDirectory === undefined) roots.push(directory)
  const ctx = new Context()
  pinTrustKernel(ctx, createTrustKernel({ policyDecider: endorseComposedDecision }))
  ctx.provide('policy', PERMIT_ALL_POLICY)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  registerTool(ctx, 'read_file')
  registerTool(ctx, 'write_file')
  await ctx.plugin(CapabilityTokenFilePlugin, { directory, requireForTools: true, sessionTokenTtlMs: 60_000 })
  mounted.push(ctx)
  return { ctx, directory }
}

/**
 * End a mount, as its process ending would: nothing it held in memory survives.
 * @param ctx - the mount.
 */
async function end(ctx: Context): Promise<void> {
  mounted.splice(mounted.indexOf(ctx), 1)
  await ctx.fiber.dispose()
}

/**
 * The token, failing the case when the session holds none.
 * @param token - what the provider answered.
 * @returns the token.
 */
function held(token: SignedCapabilityToken | undefined): SignedCapabilityToken {
  if (token === undefined) throw new Error('expected the session to hold a token')
  return token
}

/**
 * One call to `name` on behalf of `agent`, presenting `token` when there is one.
 * @param ctx - the mount.
 * @param agent - the calling session.
 * @param name - the tool.
 * @param token - the token the call presents.
 * @returns `ran` when the tool ran, otherwise the refusal as the model would read it.
 */
async function call(ctx: Context, agent: Agent, name: string, token: SignedCapabilityToken | undefined): Promise<string> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('adopt-call'),
    name,
    arguments: {},
    agent,
    ...token === undefined ? {} : { capabilityToken: token },
  })
  return result.isError ? JSON.stringify(result.content) : 'ran'
}

/**
 * A launcher and a run session delegated from it with only `read_file`, as a
 * filtered launcher starts a detached workflow run.
 * @param ctx - the mount.
 * @returns the launcher's root and the run session's delegated token.
 */
async function delegate(ctx: Context): Promise<{ root: SignedCapabilityToken; delegated: SignedCapabilityToken }> {
  const launcher = await ctx.agents.create({ sessionId: SessionId('launcher') })
  const root = held(await ctx.capabilityTokens.whenSessionToken(launcher.agent.id))
  const run = await ctx.agents.create({ sessionId: SessionId('run-session') })
  ctx.capabilityTokens.deriveChild(launcher.agent.id, run.agent.id, { allow: ['read_file'] })
  return { root, delegated: held(await ctx.capabilityTokens.whenSessionToken(run.agent.id)) }
}

describe('P2-07 D8: a delegated session resumed after a restart holds the token delegated to it before', () => {
  it('holds that same token, which still refuses what its launcher filtered out, even once the visible tools grow', async () => {
    const first = await mount()
    const { root, delegated } = await delegate(first.ctx)
    expect(root.token.resources).toContain('write_file')
    expect(delegated.token.resources).toEqual(['read_file'])
    await end(first.ctx)

    const { ctx } = await mount(first.directory)
    expect(ctx.capabilityTokens.adoptDelegatedToken(SessionId('run-session'))).toBe(true)
    const resumed = await ctx.agents.create({ sessionId: SessionId('run-session') })
    const adopted = held(await ctx.capabilityTokens.whenSessionToken(resumed.agent.id))
    expect(digestToken(adopted.token)).toBe(digestToken(delegated.token))
    expect(await call(ctx, resumed.agent, 'read_file', adopted)).toBe('ran')
    expect(await call(ctx, resumed.agent, 'write_file', adopted)).not.toBe('ran')

    registerTool(ctx, 'list_dir')
    const afterGrowth = held(await ctx.capabilityTokens.whenSessionToken(resumed.agent.id))
    expect(digestToken(afterGrowth.token)).toBe(digestToken(delegated.token))
    expect(ctx.capabilityTokens.issuanceError(resumed.agent.id)).toBeUndefined()
  })

  it('holds nothing, and its calls are refused, when that token has expired, rather than being issued a root', async () => {
    const first = await mount()
    const { delegated } = await delegate(first.ctx)
    await end(first.ctx)
    vi.setSystemTime(delegated.token.expiresAt)

    const { ctx } = await mount(first.directory)
    expect(ctx.capabilityTokens.adoptDelegatedToken(SessionId('run-session'))).toBe(false)
    const resumed = await ctx.agents.create({ sessionId: SessionId('run-session') })
    expect(await ctx.capabilityTokens.whenSessionToken(resumed.agent.id)).toBeUndefined()
    expect(ctx.capabilityTokens.issuanceError(resumed.agent.id)).toContain('expired, was revoked, or was never recorded')
    expect(await call(ctx, resumed.agent, 'read_file', undefined)).not.toBe('ran')
  })

  it('holds nothing when its launcher was revoked, which revokes the token delegated from it', async () => {
    const first = await mount()
    await delegate(first.ctx)
    expect(await first.ctx.capabilityTokens.revokeSession(SessionId('launcher'))).toBe('revoked')
    await end(first.ctx)

    const { ctx } = await mount(first.directory)
    expect(ctx.capabilityTokens.adoptDelegatedToken(SessionId('run-session'))).toBe(false)
    const resumed = await ctx.agents.create({ sessionId: SessionId('run-session') })
    expect(await ctx.capabilityTokens.whenSessionToken(resumed.agent.id)).toBeUndefined()
  })

  it('holds nothing for a session no token was ever delegated to, rather than issuing it a root', async () => {
    const { ctx } = await mount()
    expect(ctx.capabilityTokens.adoptDelegatedToken(SessionId('never-delegated'))).toBe(false)
    const resumed = await ctx.agents.create({ sessionId: SessionId('never-delegated') })
    expect(await ctx.capabilityTokens.whenSessionToken(resumed.agent.id)).toBeUndefined()
  })
})

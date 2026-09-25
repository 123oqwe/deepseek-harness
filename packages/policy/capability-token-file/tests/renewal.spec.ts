/**
 * BLOCKED-331 on the mounted provider: a session token past its expiry is
 * re-issued under the same policy, a revoked session is never issued another,
 * and a delegated token is derived from its parent's current token and
 * re-derived when it expires.
 *
 * Only `Date` is faked, so a case moves the clock past a token's `expiresAt`
 * without waiting; the store's file I/O and the Trust Kernel's signing run for
 * real. Every mount arms the tool requirement, so a case can observe the call a
 * token authorizes or refuses as well as the token itself.
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
import { digestToken } from '@deepseek-ai/dsh-capability-token'
import type { SignedCapabilityToken } from '@deepseek-ai/dsh-capability-token'
import CapabilityTokenFilePlugin from '@deepseek-ai/dsh-capability-token-file/src/index.ts'

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

const testSignal = new AbortController().signal

/** How long a session token issued by these mounts lives. */
const TTL_MS = 60_000

/**
 * Mount the provider over a real Trust Kernel and tool runtime, with the tool requirement armed.
 * @param reuseDirectory - an existing store directory; a second mount over it is how a restart is observed.
 * @returns the mounted context and its store directory.
 */
async function mount(reuseDirectory?: string): Promise<{ ctx: Context; directory: string }> {
  const directory = reuseDirectory ?? await mkdtemp(join(tmpdir(), 'dsh-cap-token-renewal-'))
  if (reuseDirectory === undefined) roots.push(directory)
  const ctx = new Context()
  pinTrustKernel(ctx, createTrustKernel())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.tools.register(defineContentToolFixture({
    name: 'read_file',
    description: 'a tool the session token authorizes',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'ok' }] },
  }))
  await ctx.plugin(CapabilityTokenFilePlugin, { directory, requireForTools: true, sessionTokenTtlMs: TTL_MS })
  mounted.push(ctx)
  return { ctx, directory }
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
 * One call to `read_file` on behalf of `agent`, presenting `token` when there is one.
 * @param ctx - the mount.
 * @param agent - the calling session.
 * @param token - the token the call presents.
 * @returns `ran` when the tool ran, otherwise the refusal as the model would read it.
 */
async function callReadFile(ctx: Context, agent: Agent, token: SignedCapabilityToken | undefined): Promise<string> {
  const result = await ctx.tools.execute({
    signal: testSignal,
    callId: ToolCallId('renewal-call'),
    name: 'read_file',
    arguments: {},
    agent,
    ...token === undefined ? {} : { capabilityToken: token },
  })
  return result.isError ? JSON.stringify(result.content) : 'ran'
}

describe('BLOCKED-331 condition 1: a root token past its expiry is re-issued under the same policy', () => {
  it('re-issues the root at the session\'s next request once it has expired, and the call the new root authorizes runs', async () => {
    const { ctx } = await mount()
    const handle = await ctx.agents.create({ sessionId: SessionId('renew-root') })
    const first = held(await ctx.capabilityTokens.whenSessionToken(handle.agent.id))

    vi.setSystemTime(first.token.expiresAt)
    const renewed = held(await ctx.capabilityTokens.whenSessionToken(handle.agent.id))

    expect(digestToken(renewed.token)).not.toBe(digestToken(first.token))
    expect(renewed.token.parentDigest).toBeNull()
    expect(renewed.token.expiresAt).toBeGreaterThan(Date.now())
    const { subject, tenant, capability, verbs } = renewed.token
    expect({ subject, tenant, capability, verbs }).toStrictEqual({
      subject: first.token.subject,
      tenant: first.token.tenant,
      capability: first.token.capability,
      verbs: first.token.verbs,
    })
    expect(await callReadFile(ctx, handle.agent, renewed)).toBe('ran')
    await handle.dispose()
  })

  it('control: keeps the same root until the moment it expires', async () => {
    const { ctx } = await mount()
    const handle = await ctx.agents.create({ sessionId: SessionId('renew-before-expiry') })
    const first = held(await ctx.capabilityTokens.whenSessionToken(handle.agent.id))

    vi.setSystemTime(first.token.expiresAt - 1)

    expect(await ctx.capabilityTokens.whenSessionToken(handle.agent.id)).toBe(first)
    await handle.dispose()
  })
})

describe('BLOCKED-331 condition 2: a revoked session is never issued another token', () => {
  it('keeps presenting the revoked root, refused as revoked, right after the revocation, once it has expired and after its tools grow', async () => {
    const { ctx } = await mount()
    const handle = await ctx.agents.create({ sessionId: SessionId('withdrawn-session') })
    const first = held(await ctx.capabilityTokens.whenSessionToken(handle.agent.id))
    expect(await ctx.capabilityTokens.revokeSession(handle.agent.id)).toBe('revoked')

    const afterRevocation = await ctx.capabilityTokens.whenSessionToken(handle.agent.id)
    expect(afterRevocation === undefined ? undefined : digestToken(afterRevocation.token)).toBe(digestToken(first.token))
    expect(await callReadFile(ctx, handle.agent, afterRevocation)).toContain('has been revoked')

    vi.setSystemTime(first.token.expiresAt + 1)
    ctx.tools.register(defineContentToolFixture({
      name: 'grown_tool',
      description: 'registered after the revocation',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'ok' }] },
    }))
    const later = await ctx.capabilityTokens.whenSessionToken(handle.agent.id)

    expect(later === undefined ? undefined : digestToken(later.token)).toBe(digestToken(first.token))
    expect(await callReadFile(ctx, handle.agent, later)).toContain('has been revoked')
    const provider = ctx.get('capabilityTokens') as CapabilityTokenFilePlugin
    expect(provider.service.digestsIssuedFor(handle.agent.id)).toStrictEqual([digestToken(first.token)])
    await handle.dispose()
  })

  it('does not re-issue a revoked session from a restarted mount over the same store', async () => {
    const { ctx, directory } = await mount()
    const handle = await ctx.agents.create({ sessionId: SessionId('withdrawn-restart') })
    const first = held(await ctx.capabilityTokens.whenSessionToken(handle.agent.id))
    expect(await ctx.capabilityTokens.revokeSession(handle.agent.id)).toBe('revoked')
    await handle.dispose()
    await ctx.fiber.dispose()

    const { ctx: restarted } = await mount(directory)
    const continued = await restarted.agents.create({ sessionId: SessionId('withdrawn-restart') })

    expect(await restarted.capabilityTokens.whenSessionToken(continued.agent.id)).toBeUndefined()
    expect(restarted.capabilityTokens.issuanceError(continued.agent.id)).toContain('revoked')
    const provider = restarted.get('capabilityTokens') as CapabilityTokenFilePlugin
    expect(provider.service.digestsIssuedFor(continued.agent.id)).toStrictEqual([digestToken(first.token)])
    await continued.dispose()
  })
})

describe('BLOCKED-331 condition 3: a delegated token is derived from its parent\'s current token and re-derived when it expires', () => {
  it('re-derives an expired child from its parent\'s current token, re-issued first, and the child never outlives it', async () => {
    const { ctx } = await mount()
    const parent = await ctx.agents.create({ sessionId: SessionId('delegating-parent') })
    const parentFirst = held(await ctx.capabilityTokens.whenSessionToken(parent.agent.id))
    const child = await ctx.agents.create({ sessionId: SessionId('delegated-child') })
    ctx.capabilityTokens.deriveChild(parent.agent.id, child.agent.id)
    const childFirst = held(await ctx.capabilityTokens.whenSessionToken(child.agent.id))
    expect(childFirst.token.parentDigest).toBe(digestToken(parentFirst.token))

    vi.setSystemTime(parentFirst.token.expiresAt)
    const childRenewed = held(await ctx.capabilityTokens.whenSessionToken(child.agent.id))
    const parentRenewed = held(ctx.capabilityTokens.sessionToken(parent.agent.id))

    expect(digestToken(parentRenewed.token)).not.toBe(digestToken(parentFirst.token))
    expect(childRenewed.token.parentDigest).toBe(digestToken(parentRenewed.token))
    expect(childRenewed.token.delegationDepth).toBe(parentRenewed.token.delegationDepth + 1)
    expect(childRenewed.token.expiresAt).toBeGreaterThan(Date.now())
    expect(childRenewed.token.expiresAt).toBeLessThanOrEqual(parentRenewed.token.expiresAt)
    expect(await callReadFile(ctx, child.agent, childRenewed)).toBe('ran')
    await child.dispose()
    await parent.dispose()
  })

  it('derives a child started after its parent\'s token expired from the parent\'s re-issued token, so the child is not born expired', async () => {
    const { ctx } = await mount()
    const parent = await ctx.agents.create({ sessionId: SessionId('expired-parent') })
    const parentFirst = held(await ctx.capabilityTokens.whenSessionToken(parent.agent.id))
    vi.setSystemTime(parentFirst.token.expiresAt + 1)

    const child = await ctx.agents.create({ sessionId: SessionId('late-child') })
    ctx.capabilityTokens.deriveChild(parent.agent.id, child.agent.id)
    const childToken = held(await ctx.capabilityTokens.whenSessionToken(child.agent.id))

    expect(childToken.token.expiresAt).toBeGreaterThan(Date.now())
    expect(childToken.token.parentDigest).not.toBe(digestToken(parentFirst.token))
    expect(childToken.token.parentDigest).toBe(digestToken(held(ctx.capabilityTokens.sessionToken(parent.agent.id)).token))
    await child.dispose()
    await parent.dispose()
  })

  it('derives nothing from a revoked parent, and says the parent was revoked', async () => {
    const { ctx } = await mount()
    const parent = await ctx.agents.create({ sessionId: SessionId('withdrawn-parent') })
    held(await ctx.capabilityTokens.whenSessionToken(parent.agent.id))
    expect(await ctx.capabilityTokens.revokeSession(parent.agent.id)).toBe('revoked')

    const child = await ctx.agents.create({ sessionId: SessionId('child-of-withdrawn') })
    ctx.capabilityTokens.deriveChild(parent.agent.id, child.agent.id)

    expect(await ctx.capabilityTokens.whenSessionToken(child.agent.id)).toBeUndefined()
    expect(ctx.capabilityTokens.issuanceError(child.agent.id)).toContain('revoked')
    await child.dispose()
    await parent.dispose()
  })

  it('does not re-derive a child revoked through its parent, which stays refused as revoked once its token has expired', async () => {
    const { ctx } = await mount()
    const parent = await ctx.agents.create({ sessionId: SessionId('withdrawn-lineage-parent') })
    held(await ctx.capabilityTokens.whenSessionToken(parent.agent.id))
    const child = await ctx.agents.create({ sessionId: SessionId('withdrawn-lineage-child') })
    ctx.capabilityTokens.deriveChild(parent.agent.id, child.agent.id)
    const childFirst = held(await ctx.capabilityTokens.whenSessionToken(child.agent.id))
    expect(await ctx.capabilityTokens.revokeSession(parent.agent.id)).toBe('revoked')

    vi.setSystemTime(childFirst.token.expiresAt + 1)
    const later = await ctx.capabilityTokens.whenSessionToken(child.agent.id)

    expect(later === undefined ? undefined : digestToken(later.token)).toBe(digestToken(childFirst.token))
    expect(await callReadFile(ctx, child.agent, later)).toContain('has been revoked')
    await child.dispose()
    await parent.dispose()
  })
})

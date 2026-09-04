/**
 * Epic P2-02 must[3] at the tool surface: a scope that registered
 * `tools.requireCapabilityToken()` executes no tool body without a presented
 * Capability Token authorizing that tool.
 *
 * Every case drives the REAL `ToolRuntime.execute` pipeline on a mounted
 * registry — never the pure predicate directly — because the clause is about
 * what the executor does, not about what a helper would have returned. Tokens
 * are real `issueToken`/`attenuateToken` outputs signed under a real
 * `createTrustKernel().signatureRoots` handle.
 *
 * Two controls run alongside the refusals, because a gate that refuses
 * everything satisfies every refusal case: an authorized call must still reach
 * its tool body, and an agent whose scope registered nothing must be unaffected.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_CAPABILITY_VERB } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecutionResult, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import { CapabilityName, CapabilityTokenNonce, issueToken } from '@deepseek-ai/dsh-capability-token'
import type { SignedCapabilityToken } from '@deepseek-ai/dsh-capability-token'

const trustRoot = createTrustKernel().signatureRoots
const testToolSignal = new AbortController().signal

const FAR_FUTURE = Date.now() + 3_600_000
const ALREADY_PAST = Date.now() - 1

let nonceCounter = 0

/** A real root token over the given tool names and verbs. */
function tokenFor(
  resources: readonly string[],
  verbs: readonly string[] = [TOOL_CAPABILITY_VERB],
  expiresAt: number = FAR_FUTURE,
): SignedCapabilityToken {
  nonceCounter += 1
  return issueToken(
    trustRoot,
    {
      subject: PrincipalId('agent-a'),
      tenant: TenantId('tenant-fixture'),
      capability: CapabilityName('tool'),
      verbs: [...verbs],
      resources: [...resources],
      constraints: {},
      expiresAt,
    },
    CapabilityTokenNonce(`nonce-${nonceCounter}`),
  )
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  return ctx
}

async function mintAgentScope(ctx: Context, name: string): Promise<{ scope: Scope; key: Agent }> {
  const key = { id: name as SessionId } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) },
    { inject: ['tools', 'systemPrompt'] }))
  return { scope, key }
}

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: (): Promise<string> => Promise.resolve(`ran:${name}`),
  }
}

interface RunOptions {
  readonly agent?: Agent
  readonly capabilityToken?: SignedCapabilityToken
  readonly parent?: ToolExecutionToken
}

async function run(ctx: Context, name: string, options: RunOptions = {}): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId('c1'),
    name,
    arguments: {},
    ...options.agent === undefined ? {} : { agent: options.agent },
    ...options.capabilityToken === undefined ? {} : { capabilityToken: options.capabilityToken },
    ...options.parent === undefined ? {} : { parent: options.parent },
  })
}

/** The rendered text of a settled execution, whatever branch produced it. */
function textOf(result: ToolExecutionResult): string {
  const first = result.content[0]
  return first?.type === 'text' ? first.text : JSON.stringify(result.content)
}

describe('tool-surface capability token gate (P2-02 must[3])', () => {
  it('must[3]: a scope requiring a capability token refuses a call that presents none, before the tool body runs', async () => {
    const ctx = await mount()
    const { scope, key } = await mintAgentScope(ctx, 'a')
    let bodyRuns = 0
    ctx.tools.register({ ...tool('read_file'), execute: (): Promise<string> => { bodyRuns += 1; return Promise.resolve('ran') } })
    scope.ctx.tools.requireCapabilityToken()

    const result = await run(ctx, 'read_file', { agent: key })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('requires a capability token and none was presented')
    expect(bodyRuns).toBe(0)
  })

  it('control: the same call succeeds and reaches the tool body when an authorizing token is presented', async () => {
    const ctx = await mount()
    const { scope, key } = await mintAgentScope(ctx, 'a')
    ctx.tools.register(tool('read_file'))
    scope.ctx.tools.requireCapabilityToken()

    const result = await run(ctx, 'read_file', { agent: key, capabilityToken: tokenFor(['read_file']) })

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toBe('ran:read_file')
  })

  it('must[3]: a token that does not name the called tool among its resources is refused', async () => {
    const ctx = await mount()
    const { scope, key } = await mintAgentScope(ctx, 'a')
    ctx.tools.register(tool('read_file'))
    ctx.tools.register(tool('write_file'))
    scope.ctx.tools.requireCapabilityToken()

    const token = tokenFor(['read_file'])
    expect(textOf(await run(ctx, 'write_file', { agent: key, capabilityToken: token })))
      .toContain('does not authorize this tool')
    // Control on the same token: the tool it DOES name still runs.
    expect(textOf(await run(ctx, 'read_file', { agent: key, capabilityToken: token }))).toBe('ran:read_file')
  })

  it('must[3]: a token lacking the tool-invocation verb is refused even for a tool it names', async () => {
    const ctx = await mount()
    const { scope, key } = await mintAgentScope(ctx, 'a')
    ctx.tools.register(tool('read_file'))
    scope.ctx.tools.requireCapabilityToken()

    const result = await run(ctx, 'read_file', { agent: key, capabilityToken: tokenFor(['read_file'], ['inspect']) })

    expect(textOf(result)).toContain(`does not carry the "${TOOL_CAPABILITY_VERB}" verb`)
  })

  it('validation (过期): an expired token is refused for a tool it otherwise authorizes', async () => {
    const ctx = await mount()
    const { scope, key } = await mintAgentScope(ctx, 'a')
    ctx.tools.register(tool('read_file'))
    scope.ctx.tools.requireCapabilityToken()

    const result = await run(ctx, 'read_file', {
      agent: key,
      capabilityToken: tokenFor(['read_file'], [TOOL_CAPABILITY_VERB], ALREADY_PAST),
    })

    expect(textOf(result)).toContain('has expired')
  })

  it('must[3]: a transport sub-dispatch (a `parent` token set) is gated too, so PTC is not a bypass', async () => {
    const ctx = await mount()
    const { scope, key } = await mintAgentScope(ctx, 'a')
    let bodyRuns = 0
    ctx.tools.register({ ...tool('read_file'), execute: (): Promise<string> => { bodyRuns += 1; return Promise.resolve('ran') } })
    scope.ctx.tools.requireCapabilityToken()

    const nested = Symbol('outer-run_code') as ToolExecutionToken
    const result = await run(ctx, 'read_file', { agent: key, parent: nested })

    expect(textOf(result)).toContain('requires a capability token and none was presented')
    expect(bodyRuns).toBe(0)
  })

  it('must[3]: no `tools/pre-execute` listener observes an unauthorized call, so none can approve it', async () => {
    const ctx = await mount()
    const { scope, key } = await mintAgentScope(ctx, 'a')
    ctx.tools.register(tool('read_file'))
    scope.ctx.tools.requireCapabilityToken()
    const seen: string[] = []
    ctx.on('tools/pre-execute', (exec, next) => {
      seen.push(exec.name)
      return next()
    })

    await run(ctx, 'read_file', { agent: key })
    expect(seen).toEqual([])

    // Control: the listener DOES observe the same call once it is authorized,
    // so the empty list above is the gate, not a mis-wired listener.
    await run(ctx, 'read_file', { agent: key, capabilityToken: tokenFor(['read_file']) })
    expect(seen).toEqual(['read_file'])
  })

  it('control: an agent whose scope registered no requirement is unaffected', async () => {
    const ctx = await mount()
    const { scope } = await mintAgentScope(ctx, 'a')
    const { key: other } = await mintAgentScope(ctx, 'b')
    ctx.tools.register(tool('read_file'))
    scope.ctx.tools.requireCapabilityToken()

    expect(textOf(await run(ctx, 'read_file', { agent: other }))).toBe('ran:read_file')
    expect(textOf(await run(ctx, 'read_file'))).toBe('ran:read_file')
  })

  it('must[3]: the requirement lifts only when its own disposer runs, and a global registration gates every scope', async () => {
    const ctx = await mount()
    const { key } = await mintAgentScope(ctx, 'a')
    ctx.tools.register(tool('read_file'))
    const first = ctx.tools.requireCapabilityToken()
    const second = ctx.tools.requireCapabilityToken()

    expect(textOf(await run(ctx, 'read_file', { agent: key }))).toContain('none was presented')
    first()
    expect(textOf(await run(ctx, 'read_file', { agent: key }))).toContain('none was presented')
    second()
    expect(textOf(await run(ctx, 'read_file', { agent: key }))).toBe('ran:read_file')
  })

  it('acceptance[2]: a refusal reaching the model quotes no token material', async () => {
    const ctx = await mount()
    const { scope, key } = await mintAgentScope(ctx, 'a')
    ctx.tools.register(tool('read_file'))
    ctx.tools.register(tool('write_file'))
    scope.ctx.tools.requireCapabilityToken()

    const token = tokenFor(['read_file'])
    const message = textOf(await run(ctx, 'write_file', { agent: key, capabilityToken: token }))

    expect(message).not.toContain(token.token.nonce)
    expect(message).not.toContain(token.token.subject)
    expect(message).not.toContain(token.token.tenant)
    expect(message).not.toContain('read_file')
  })
})

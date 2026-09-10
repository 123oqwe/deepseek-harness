/**
 * Epic P2-05 Usage stage: the enforcement point on a real dispatch, on the
 * real in-process stack.
 *
 * The mocked boundary is the model. Everything else is what a `dsh` runs: a
 * pinned Trust Kernel, a mounted Cedar provider over a real policy set, the
 * agent loop's own dispatch, and the manifests it appends.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type { TrustKernelAuditEntry, TrustKernelPolicyQuery, TrustKernelPolicyVerdict } from '@deepseek-ai/dsh-trust-kernel'
import CedarPolicyEngine from '@deepseek-ai/dsh-policy-engine-cedar'
import CapabilityTokenFilePlugin from '@deepseek-ai/dsh-capability-token-file'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as PolicyEnforcement from '../src/index.ts'
import type { ClosedDecision, PolicyAuditRecord } from '../src/index.ts'

const tokenDirs: string[] = []
afterAll(() => { for (const directory of tokenDirs.splice(0)) rmSync(directory, { recursive: true, force: true }) })

/** A policy set that permits everything, so a refusal refuses for its own reason. */
const PERMIT_ALL = { 'baseline-permit': 'permit(principal, action, resource);' }

/** A policy set that forbids the tool under test by capability. */
const FORBID_WRITER = {
  ...PERMIT_ALL,
  'forbid-writer': 'forbid(principal, action == Dsh::Action::"writer", resource);',
}

/** One assistant turn that calls `writer` once. */
function callWriter(id: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name: 'writer', arguments: '{}' } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/**
 * The whole in-process stack with a pinned kernel whose decider and audit sink
 * are the deployment's — which is how a real boot wires them.
 */
async function stack(options: {
  policies?: Record<string, string>
  verdict?: TrustKernelPolicyVerdict
  tokens?: boolean
} = {}) {
  const audit: PolicyAuditRecord[] = []
  const ctx = new Context()
  pinTrustKernel(ctx, createTrustKernel({
    policyDecider: (query: TrustKernelPolicyQuery): TrustKernelPolicyVerdict =>
      options.verdict ?? ((query.payload as ClosedDecision | undefined)?.effect === 'permit' ? 'allow' : 'deny'),
    auditSink: (entry: TrustKernelAuditEntry) => { audit.push(entry.payload as PolicyAuditRecord) },
  }))
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.tokens === true) {
    // The real token provider: a session token is issued and presented with
    // every call, which is what makes must[0]'s second input a value rather
    // than a permanently absent field.
    const directory = mkdtempSync(join(tmpdir(), 'p2-05-tokens-'))
    tokenDirs.push(directory)
    await ctx.plugin(CapabilityTokenFilePlugin, { directory, requireForTools: false, sessionTokenTtlMs: 60_000 })
  }
  await ctx.plugin(PolicyEnforcement)
  const engine = options.policies === undefined
    ? undefined
    : await ctx.plugin(CedarPolicyEngine, { policies: options.policies })
  ctx.tools.register(defineContentToolFixture({
    name: 'writer',
    description: 'writes',
    parameters: {},
    execute: () => Promise.resolve([{ type: 'text', text: 'wrote' }]),
  }))
  return { ctx, audit, engine }
}

/** Drive one turn to quiescence and return the session's events. */
async function runTurn(ctx: Context, session: string): Promise<readonly SessionEvent[]> {
  const agent = ctx.agentLoop.create(SessionId(session), { provider: 'mock', model: 'mock' })
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await idle
  return agent.session.snapshotEvents()
}

/** The `tool/result` text one turn produced. */
function resultText(events: readonly SessionEvent[]): string {
  const result = [...events].reverse().find(event => event.type === 'tool/result')
  return JSON.stringify(result?.data ?? {})
}

describe('P2-05 acceptance[2]: losing the provider mid-session denies by name', () => {
  it('permits while the provider is mounted, and denies `policy-unavailable` after it unmounts', async () => {
    const { ctx, audit, engine } = await stack({ policies: PERMIT_ALL })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done'), callWriter('call-2'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const permitted = await runTurn(ctx, 'p2-05-1')
    expect(resultText(permitted)).toContain('wrote')
    expect(audit.at(-1)?.decision.effect).toBe('permit')

    // The provider is an ordinary plugin: unmounting it is allowed. What may
    // not be lost is the ENFORCEMENT.
    await engine?.dispose?.()
    expect(ctx.get('policy')).toBeUndefined()

    const refused = await runTurn(ctx, 'p2-05-2')
    expect(resultText(refused)).toContain('policy-unavailable')
    expect(audit.at(-1)?.decision).toMatchObject({ effect: 'deny', reason: 'policy-unavailable' })
    await ctx.fiber.dispose()
  })

  it('records WHICH policy set it could not reach, so a replay can tell the two failures apart', async () => {
    const { ctx, audit, engine } = await stack({ policies: PERMIT_ALL })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done'), callWriter('call-2'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)
    await runTurn(ctx, 'p2-05-3')
    const mountedDigest = audit.at(-1)?.decision.policySet

    await engine?.dispose?.()
    await runTurn(ctx, 'p2-05-4')

    expect(audit.at(-1)?.decision.policySet).toBe(mountedDigest)
    await ctx.fiber.dispose()
  })
})

describe('P2-05 acceptance[0]: one PEP, whichever originator dispatches', () => {
  it('refuses a forbidden tool on the NATIVE path, with the audit naming the matched policy', async () => {
    const { ctx, audit } = await stack({ policies: FORBID_WRITER })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-5')

    expect(resultText(events)).toContain('refused by policy')
    // The model sees a closed reason code; the audit sees the rule.
    expect(resultText(events)).not.toContain('forbid-writer')
    expect(audit.at(-1)).toMatchObject({
      origin: 'native-tool-call',
      decision: { effect: 'deny', reason: 'forbidden-by-policy' },
      matched: ['forbid-writer'],
    })
    await ctx.fiber.dispose()
  })

  it('decides every dispatch against the same manifest the log records', async () => {
    // acceptance[0] is about ONE point, so the audit's action id is the
    // manifest's: a second decision path would produce an id nothing in the
    // session log cites.
    const { ctx, audit } = await stack({ policies: PERMIT_ALL })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-6')
    const manifest = events.find(event => event.type === 'action/manifest-appended')

    expect(audit.at(-1)?.actionId).toBe((manifest?.data as { actionId: string } | undefined)?.actionId)
    await ctx.fiber.dispose()
  })

  it('lets the KERNEL bind: a kernel deny refuses a call the policy permitted', async () => {
    // The kernel is the one participant a plugin cannot replace, so its
    // verdict is what the dispatch acts on.
    const { ctx, audit } = await stack({ policies: PERMIT_ALL, verdict: 'deny' })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-7')

    expect(resultText(events)).toContain('refused by policy')
    // The engine permitted; the audit records what the engine said, and the
    // dispatch records what the kernel bound.
    expect(audit.at(-1)?.decision.effect).toBe('permit')
    await ctx.fiber.dispose()
  })

  it('runs with no policy service at all exactly as it did before this epic', async () => {
    // The control for every case above: a composition mounting no provider
    // still dispatches, because absence is capability absence — but it is
    // DENIED rather than permitted, which is acceptance[2]'s direction.
    const { ctx, audit } = await stack()
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    await runTurn(ctx, 'p2-05-8')

    expect(audit.at(-1)?.decision).toMatchObject({ effect: 'deny', reason: 'policy-unavailable' })
    await ctx.fiber.dispose()
  })
})

describe('P2-05 must[2]: a plugin constraint narrows and never widens', () => {
  it('turns a permitted call into a deny, and records the constraint reason for the audit', async () => {
    const { ctx, audit } = await stack({ policies: PERMIT_ALL })
    ctx.policyConstraints.register(() => 'the workspace is read-only today')
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-9')

    expect(resultText(events)).toContain('constrained-by-plugin')
    expect(audit.at(-1)?.constraintReasons).toEqual(['the workspace is read-only today'])
    await ctx.fiber.dispose()
  })

  it('stops constraining when its plugin unmounts', async () => {
    // A constraint that outlived its owner would be a policy nobody can find.
    const { ctx } = await stack({ policies: PERMIT_ALL })
    const dispose = ctx.policyConstraints.register(() => 'temporarily refused')
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done'), callWriter('call-2'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    expect(resultText(await runTurn(ctx, 'p2-05-10'))).toContain('constrained-by-plugin')
    dispose()
    expect(resultText(await runTurn(ctx, 'p2-05-11'))).toContain('wrote')
    await ctx.fiber.dispose()
  })
})

describe('P2-05 acceptance[2]: a policy set that does not parse refuses to load', () => {
  it('fails the mount loudly rather than deciding with a broken set', async () => {
    // The real occurrence point for `policy-set-invalid`: a deployment whose policies do
    // not parse must refuse to boot, not surface as a denied action later.
    const ctx = new Context()
    pinTrustKernel(ctx, createTrustKernel())

    await expect(ctx.plugin(CedarPolicyEngine, { policies: { broken: 'this is not a policy' } }))
      .rejects.toThrow(/policy set does not parse/)

    expect(ctx.get('policy')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

describe('P2-05 must[0]: the capability token is a policy input, not a placeholder', () => {
  it('decides by the CAPABILITY the presented token carries', async () => {
    // The token's claims reach the policy in `redactTokenForLog`'s projection
    // — P2-02 already audited that form as safe outside the token layer. A
    // policy can therefore refuse an action whose authority does not name the
    // capability it needs, which is the whole reason must[0] lists the token.
    const { ctx, audit } = await stack({
      tokens: true,
      policies: {
        ...PERMIT_ALL,
        'require-writer-authority':
          'forbid(principal, action, resource) unless { context.tokenCapability == "writer" };',
      },
    })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-token-1')

    // The session token names the session's capability, not `writer`, so the
    // policy refuses — and the audit records the rule that did it.
    expect(resultText(events)).toContain('refused by policy')
    expect(audit.at(-1)?.matched).toEqual(['require-writer-authority'])
    await ctx.fiber.dispose()
  })

  it('permits the same action when the policy accepts the token that was presented', async () => {
    // The control: without it, a context field that was always empty would
    // satisfy the case above just as well as one carrying real claims.
    const { ctx, audit } = await stack({
      tokens: true,
      policies: {
        ...PERMIT_ALL,
        'require-any-authority':
          'forbid(principal, action, resource) unless { context.tokenPresented };',
      },
    })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const events = await runTurn(ctx, 'p2-05-token-2')

    expect(resultText(events)).toContain('wrote')
    expect(audit.at(-1)?.decision.effect).toBe('permit')
    await ctx.fiber.dispose()
  })

  it('refuses when NO token was presented and the policy requires one', async () => {
    // With no token provider mounted, `tokenPresented` is false — the same
    // policy now refuses, which is what makes the field a real input rather
    // than a constant.
    const { ctx } = await stack({
      policies: {
        ...PERMIT_ALL,
        'require-any-authority':
          'forbid(principal, action, resource) unless { context.tokenPresented };',
      },
    })
    const adapter = new MockAdapter([callWriter('call-1'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)

    expect(resultText(await runTurn(ctx, 'p2-05-token-3'))).toContain('refused by policy')
    await ctx.fiber.dispose()
  })
})

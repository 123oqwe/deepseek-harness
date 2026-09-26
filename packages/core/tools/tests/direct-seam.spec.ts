/**
 * BLOCKED-294: a call through the public `ToolRuntime.execute` seam appends its
 * manifest to the calling agent's session and is decided by the enforcement
 * point before it runs, in a composition that pins the Trust Kernel. The token
 * gate comes after, so a call it refuses still leaves both.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CapabilityName, CapabilityTokenNonce, issueToken } from '@deepseek-ai/dsh-capability-token'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { PolicyRequest } from '@deepseek-ai/dsh-policy-engine'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import type { PolicyAuditRecord } from '@deepseek-ai/dsh-policy-enforcement'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import ToolRuntime, { TOOL_CAPABILITY_VERB, defineContentToolFixture } from '@deepseek-ai/dsh-tools'

/** One composition and what it observed. */
interface Composed {
  readonly ctx: Context
  readonly agent: Agent
  /** Every decision the kernel audited. */
  readonly audit: PolicyAuditRecord[]
  /** Every request the policy was asked. */
  readonly requests: PolicyRequest[]
  /** Per run of the probe tool, whether its manifest was already in the session. */
  readonly bodies: string[]
  /** The Trust Kernel's signature roots, when one is pinned. */
  readonly roots: ReturnType<typeof createTrustKernel>['signatureRoots'] | undefined
}

/**
 * Mount the tool runtime with a probe tool, optionally over a pinned Trust
 * Kernel whose decider is the shipped one, and a policy that answers `effect`.
 * @param options - whether to pin the kernel, and the policy's answer.
 * @returns the composition and its observations.
 */
async function compose(options: { readonly kernel: boolean; readonly effect?: 'permit' | 'deny' }): Promise<Composed> {
  const ctx = new Context()
  const audit: PolicyAuditRecord[] = []
  const kernel = options.kernel
    ? createTrustKernel({
      policyDecider: endorseComposedDecision,
      auditSink: (entry) => { audit.push(entry.payload as PolicyAuditRecord) },
    })
    : undefined
  if (kernel !== undefined) pinTrustKernel(ctx, kernel)
  const requests: PolicyRequest[] = []
  const effect = options.effect ?? 'permit'
  ctx.provide('policy', {
    digest: 'direct-seam-policy',
    evaluate(request: PolicyRequest) {
      requests.push(request)
      return {
        decision: { effect, policySet: 'direct-seam-policy', ...effect === 'deny' ? { reason: 'forbidden-by-policy' } : {} },
        explain: { matched: [], diagnostics: [] },
      }
    },
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(ToolRuntime)
  const session = ctx.sessions.create(SessionId('direct-seam'))
  session.append('turn/start', { turn: 1 })
  const bodies: string[] = []
  ctx.tools.register(defineContentToolFixture({
    name: 'probe',
    description: 'records whether its manifest preceded it',
    parameters: {},
    async execute(_args, exec) {
      const manifested = session.snapshotEvents()
        .some(event => event.type === 'action/manifest-appended' && event.data.actionId === exec.callId)
      bodies.push(manifested ? 'manifested' : 'unmanifested')
      return [{ type: 'text', text: 'ran' }]
    },
  }))
  return { ctx, agent: { id: session.id, session } as unknown as Agent, audit, requests, bodies, roots: kernel?.signatureRoots }
}

/**
 * The manifests one session appended, as [actionId, origin, capability].
 * @param agent - the agent whose session is read.
 * @returns one triple per manifest, in order.
 */
function manifestsOf(agent: Agent): readonly (readonly string[])[] {
  return agent.session.snapshotEvents().flatMap(event => event.type === 'action/manifest-appended'
    ? [[event.data.actionId, event.data.origin, event.data.capability]]
    : [])
}

const signal = new AbortController().signal

describe('BLOCKED-294: the public seam appends a manifest and passes the enforcement point', () => {
  it('records a direct call on behalf of an agent before the tool runs, and decides it once', async () => {
    const { ctx, agent, audit, bodies } = await compose({ kernel: true })
    const result = await ctx.tools.execute({ callId: ToolCallId('direct-agent'), name: 'probe', arguments: {}, agent, signal })

    expect(result.isError).toBe(false)
    expect(bodies).toEqual(['manifested'])
    expect(manifestsOf(agent)).toEqual([['direct-agent', 'plugin-rpc', 'probe']])
    expect(audit.map(record => [record.actionId, record.origin, record.decision.effect])).toEqual([['direct-agent', 'plugin-rpc', 'permit']])
    await ctx.fiber.dispose()
  })

  it('leaves the manifest and the decision when the policy refuses a direct call, and does not run it', async () => {
    const { ctx, agent, audit, bodies } = await compose({ kernel: true, effect: 'deny' })
    const result = await ctx.tools.execute({ callId: ToolCallId('direct-denied'), name: 'probe', arguments: {}, agent, signal })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('was refused by policy (forbidden-by-policy)')
    expect(bodies).toEqual([])
    expect(manifestsOf(agent)).toEqual([['direct-denied', 'plugin-rpc', 'probe']])
    expect(audit.map(record => [record.actionId, record.decision.effect])).toEqual([['direct-denied', 'deny']])
    await ctx.fiber.dispose()
  })

  it('decides a direct call with no agent and refuses it, because no session can record its manifest', async () => {
    const { ctx, audit, bodies } = await compose({ kernel: true })
    const result = await ctx.tools.execute({ callId: ToolCallId('direct-plain'), name: 'probe', arguments: {}, signal })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('a direct call must name the agent whose session records its manifest')
    expect(bodies).toEqual([])
    expect(audit.map(record => [record.actionId, record.origin])).toEqual([['direct-plain', 'plugin-rpc']])
    await ctx.fiber.dispose()
  })

  it('shows the enforcement point the token a call presents, and none when it presents none', async () => {
    const { ctx, agent, requests, roots } = await compose({ kernel: true })
    if (roots === undefined) throw new Error('the kernel is pinned in this composition')
    const presented = issueToken(roots, {
      subject: PrincipalId('direct-seam-agent'),
      tenant: TenantId('direct-seam-tenant'),
      capability: CapabilityName('tool'),
      verbs: [TOOL_CAPABILITY_VERB],
      resources: ['probe'],
      constraints: {},
      expiresAt: Date.now() + 600_000,
    }, CapabilityTokenNonce('direct-seam'))
    await ctx.tools.execute({ callId: ToolCallId('with-token'), name: 'probe', arguments: {}, agent, capabilityToken: presented, signal })
    await ctx.tools.execute({ callId: ToolCallId('without-token'), name: 'probe', arguments: {}, agent, signal })

    expect(requests.map(request => request.token?.capability)).toEqual(['tool', undefined])
    await ctx.fiber.dispose()
  })

  it('leaves the seam unchanged in a composition that pins no Trust Kernel: no manifest, no decision', async () => {
    const { ctx, agent, requests, bodies } = await compose({ kernel: false })
    const result = await ctx.tools.execute({ callId: ToolCallId('no-kernel'), name: 'probe', arguments: {}, agent, signal })

    expect(result.isError).toBe(false)
    expect(bodies).toEqual(['unmanifested'])
    expect(manifestsOf(agent)).toEqual([])
    expect(requests).toEqual([])
    await ctx.fiber.dispose()
  })
})

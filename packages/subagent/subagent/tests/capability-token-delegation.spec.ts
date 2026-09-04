/**
 * Epic P2-02 acceptance[0] at the delegation boundary: the token a parent
 * agent hands a child is minted by attenuating the parent's own, so a child's
 * authority is never wider than its parent's on any dimension — including the
 * dimension this seam owns, WHICH TOOLS the child may call.
 *
 * The final case is an end-to-end control across both U-stage surfaces: a
 * legitimately delegated child token, fed to the real `ToolRuntime`, still
 * executes the tool it kept and is refused the tool it gave up.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_CAPABILITY_VERB } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import {
  CapabilityName,
  CapabilityTokenNonce,
  TokenBudget,
  digestToken,
  issueToken,
} from '@deepseek-ai/dsh-capability-token'
import type { SignedCapabilityToken } from '@deepseek-ai/dsh-capability-token'
import {
  DelegatedCapabilityError,
  attenuateDelegatedToken,
  delegatedChildResources,
  delegationParentDigest,
} from '../src/child-agent.ts'
import { snapshotSubagentDescriptor } from '../src/descriptor.ts'

const trustRoot = createTrustKernel().signatureRoots
const testToolSignal = new AbortController().signal

const PARENT_EXPIRES_AT = Date.now() + 3_600_000
const PARENT_RESOURCES = ['read_file', 'write_file', 'run_shell'] as const

let nonceCounter = 0
function nextNonce(): CapabilityTokenNonce {
  nonceCounter += 1
  return CapabilityTokenNonce(`child-nonce-${nonceCounter}`)
}

function parentToken(budget?: number): SignedCapabilityToken {
  return issueToken(
    trustRoot,
    {
      subject: PrincipalId('parent-agent'),
      tenant: TenantId('tenant-fixture'),
      capability: CapabilityName('tool'),
      verbs: [TOOL_CAPABILITY_VERB],
      resources: [...PARENT_RESOURCES],
      constraints: budget === undefined ? {} : { budget: TokenBudget(budget) },
      expiresAt: PARENT_EXPIRES_AT,
    },
    CapabilityTokenNonce('parent-nonce'),
  )
}

function childRequest(overrides: { expiresAt?: number; budget?: number } = {}): {
  subject: PrincipalId
  nonce: CapabilityTokenNonce
  expiresAt: number
  constraints: { budget?: TokenBudget }
} {
  return {
    subject: PrincipalId('child-agent'),
    nonce: nextNonce(),
    expiresAt: overrides.expiresAt ?? PARENT_EXPIRES_AT,
    constraints: overrides.budget === undefined ? {} : { budget: TokenBudget(overrides.budget) },
  }
}

describe('sub-agent delegation carries a strictly-narrowing capability token (P2-02)', () => {
  it('acceptance[0]: a child `allow` filter naming a tool the parent never held gains nothing', () => {
    const parent = parentToken()
    const child = attenuateDelegatedToken(
      trustRoot,
      parent,
      { toolFilter: { allow: ['read_file', 'delete_everything'] } },
      childRequest(),
    )

    expect([...child.token.resources]).toEqual(['read_file'])
    expect(child.token.resources.every(name => parent.token.resources.includes(name))).toBe(true)
  })

  it('acceptance[0]: `delegatedChildResources` never returns a name outside the parent set, for allow, deny, and none', () => {
    expect(delegatedChildResources(PARENT_RESOURCES, undefined)).toEqual([...PARENT_RESOURCES])
    expect(delegatedChildResources(PARENT_RESOURCES, { allow: ['run_shell', 'not_a_parent_tool'] })).toEqual(['run_shell'])
    expect(delegatedChildResources(PARENT_RESOURCES, { deny: ['run_shell'] })).toEqual(['read_file', 'write_file'])
    expect(delegatedChildResources(PARENT_RESOURCES, { allow: ['read_file', 'write_file'], deny: ['write_file'] })).toEqual(['read_file'])
    expect(delegatedChildResources(PARENT_RESOURCES, { allow: ['not_a_parent_tool'] })).toEqual([])
  })

  it('acceptance[0]: a delegation requesting an expiry past the parent\'s is refused, not clamped', () => {
    const parent = parentToken()
    let thrown: unknown
    try {
      attenuateDelegatedToken(trustRoot, parent, {}, childRequest({ expiresAt: PARENT_EXPIRES_AT + 1 }))
    } catch (error: unknown) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(DelegatedCapabilityError)
    expect((thrown as DelegatedCapabilityError).reason).toBe('expiry-exceeds-parent')
  })

  it('acceptance[0]: a delegation requesting a budget above the parent\'s is refused', () => {
    const parent = parentToken(1000)
    expect(() => attenuateDelegatedToken(trustRoot, parent, {}, childRequest({ budget: 1001 })))
      .toThrow(DelegatedCapabilityError)
    // Control at the exact boundary: equal to the parent's ceiling is legal.
    const equal = attenuateDelegatedToken(trustRoot, parent, {}, childRequest({ budget: 1000 }))
    expect(equal.token.constraints.budget).toBe(1000)
  })

  it('acceptance[0]: dropping a budget-constrained parent\'s ceiling entirely is refused as a widening', () => {
    const parent = parentToken(1000)
    let thrown: unknown
    try {
      attenuateDelegatedToken(trustRoot, parent, {}, childRequest())
    } catch (error: unknown) {
      thrown = error
    }
    expect((thrown as DelegatedCapabilityError).reason).toBe('budget-exceeds-parent')
  })

  it('must[0]: the child token records its own delegation hop — depth+1 and the parent\'s digest', () => {
    const parent = parentToken()
    const child = attenuateDelegatedToken(trustRoot, parent, { toolFilter: { deny: ['run_shell'] } }, childRequest())

    expect(child.token.delegationDepth).toBe(parent.token.delegationDepth + 1)
    expect(child.token.parentDigest).toBe(digestToken(parent.token))
    expect(delegationParentDigest(parent)).toBe(digestToken(parent.token))
    // Tenant and capability are inherited verbatim, never taken from the request.
    expect(child.token.tenant).toBe(parent.token.tenant)
    expect(child.token.capability).toBe(parent.token.capability)
  })

  it('acceptance[2]: the durable descriptor records the delegation digest and no other token material', () => {
    const parent = parentToken()
    const descriptor = snapshotSubagentDescriptor({
      mode: 'one-shot',
      provider: 'spawn',
      label: 'child work',
      parentTokenDigest: delegationParentDigest(parent),
    })

    expect(descriptor.parentTokenDigest).toBe(digestToken(parent.token))
    const serialized = JSON.stringify(descriptor)
    expect(serialized).not.toContain(parent.token.nonce)
    expect(serialized).not.toContain('run_shell')
    expect(Object.keys(descriptor).sort()).toEqual(['label', 'mode', 'parentTokenDigest', 'provider', 'version'])
  })

  it('control: a legitimately delegated child token still executes the tools it kept, and only those', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    const key = { id: 'child' as SessionId } as Agent
    await ctx.plugin(Object.assign((inner: Context) => {
      const scope = createScope(inner, key)
      scope.ctx.tools.requireCapabilityToken()
    }, { inject: ['tools', 'systemPrompt'] }))
    for (const name of PARENT_RESOURCES) {
      const definition: ToolDefinition = {
        name,
        description: `tool ${name}`,
        parameters: { type: 'object', properties: {} },
        output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v as string }] },
        execute: (): Promise<string> => Promise.resolve(`ran:${name}`),
      }
      ctx.tools.register(definition)
    }

    const child = attenuateDelegatedToken(
      trustRoot,
      parentToken(),
      { toolFilter: { deny: ['run_shell'] } },
      childRequest(),
    )
    const call = async (name: string): Promise<string> => {
      const result = await ctx.tools.execute({
        signal: testToolSignal,
        callId: ToolCallId('c1'),
        name,
        arguments: {},
        agent: key,
        capabilityToken: child,
      })
      const first = result.content[0]
      return first?.type === 'text' ? first.text : JSON.stringify(result.content)
    }

    expect(await call('read_file')).toBe('ran:read_file')
    expect(await call('write_file')).toBe('ran:write_file')
    expect(await call('run_shell')).toContain('does not authorize this tool')
  })
})

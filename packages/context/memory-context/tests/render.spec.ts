/**
 * Focused regressions for the pure parts of the memory recall consumer: the
 * access context it reads under (`must[3]`) and the exact text it puts in
 * front of the model. These run without a composition; the product-visible
 * behavior is owned by `./memory-context.spec.ts`.
 */

import { describe, expect, it } from 'vitest'
import { createAnonymousDevPrincipal, createChain, createUserPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MemoryRecordView } from '@deepseek-ai/dsh-memory'
import { MemoryRecordId } from '@deepseek-ai/dsh-memory'
import { type Config, renderMemoryContext, resolveMemoryAccessContext } from '@deepseek-ai/dsh-memory-context'

const config: Config = { tenantId: 't-1', principalId: 'p-1', purpose: 'recall', maxRecords: 3 }

function recordOf(content: unknown): MemoryRecordView {
  return {
    id: MemoryRecordId('local-reference-1'),
    principal: createAnonymousDevPrincipal(PrincipalId('p-1'), TenantId('t-1')),
    content,
    updatedAt: '2026-09-04T00:00:00.000Z',
  }
}

describe('resolveMemoryAccessContext', () => {
  it('carries all four read-scoping dimensions from config when the agent has no attached identity', () => {
    const context = resolveMemoryAccessContext({ identity: undefined } as Agent, config)
    expect(context.purpose).toBe('recall')
    expect(context.scope).toEqual({ tenantId: TenantId('t-1') })
    expect(context.contextBudget).toEqual({ maxRecords: 3 })
    expect(context.principal).toMatchObject({ kind: 'anonymous-dev', id: 'p-1', tenantId: 't-1' })
  })

  it('prefers the agent\'s durably attached principal over the configured fallback id', () => {
    const attached = createUserPrincipal(PrincipalId('real-user'), TenantId('t-1'))
    const agent = { identity: { chain: createChain(attached, 0) } } as Agent
    const context = resolveMemoryAccessContext(agent, config)
    expect(context.principal).toMatchObject({ kind: 'user', id: 'real-user' })
  })

  it('never reads across tenants: the scope tenant is the configured one, not the attached principal\'s', () => {
    const attached = createUserPrincipal(PrincipalId('real-user'), TenantId('t-other'))
    const agent = { identity: { chain: createChain(attached, 0) } } as Agent
    expect(() => resolveMemoryAccessContext(agent, config)).toThrow(/tenant/i)
  })
})

describe('renderMemoryContext', () => {
  it('returns undefined for an empty recall so no empty snapshot is ever injected', () => {
    expect(renderMemoryContext([], false)).toBeUndefined()
  })

  it('renders each recalled record\'s content as text the model can read', () => {
    const text = renderMemoryContext([recordOf({ note: 'oxidized-kingfisher' })], false)
    expect(text).toContain('oxidized-kingfisher')
  })

  it('states that the recall was cut to the caller\'s budget when the seam truncated it', () => {
    const text = renderMemoryContext([recordOf({ note: 'a' })], true)
    expect(text).toMatch(/truncat/i)
  })
})

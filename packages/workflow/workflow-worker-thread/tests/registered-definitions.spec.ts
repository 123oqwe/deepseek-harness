/**
 * B-729: the engine lists the definitions a nested `workflow({ name, digest })`
 * call can name, without their bodies or signers.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import type { DefinitionName, SignerIdentity } from '@deepseek-ai/dsh-workflow-registry'
import WorkerThreadWorkflowEngine from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

/**
 * Mount the engine over the services it injects.
 * @returns the mounted engine.
 */
async function engine(): Promise<WorkerThreadWorkflowEngine> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessageBusPlugin)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(WorkerThreadWorkflowEngine, {})
  return ctx.workflowEngine as WorkerThreadWorkflowEngine
}

/**
 * Register one definition.
 * @param target - the engine.
 * @param name - the definition's name.
 * @param body - its script body.
 * @param version - its version.
 * @returns the digest it was registered under.
 */
function register(target: WorkerThreadWorkflowEngine, name: string, body: string, version: number): string {
  const digest = computeDefinitionDigest(body)
  target.registerDefinition({
    digest,
    name: brandString<DefinitionName>(name),
    version,
    body,
    signer: brandString<SignerIdentity>('test-signer'),
  })
  return digest
}

describe('B-729: the engine lists the definitions a nested run can name', () => {
  it('lists each name once, at its highest version, with its digest and nothing else', async () => {
    const target = await engine()
    expect(target.registeredDefinitions()).toEqual([])
    register(target, 'alpha', "return 'a1'", 1)
    const beta = register(target, 'beta', "return 'b'", 1)
    const alpha = register(target, 'alpha', "return 'a2'", 2)

    expect(target.registeredDefinitions()).toEqual([
      { name: 'alpha', digest: alpha, version: 2 },
      { name: 'beta', digest: beta, version: 1 },
    ])
  })
})

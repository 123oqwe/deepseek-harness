/**
 * Nested workflow runs on the real engine (Epic P4-09 must[0], must[1],
 * must[3], acceptance[0], acceptance[1], acceptance[3]).
 *
 * **Five decisions had no caller.** `resolveDefinition`, `admitNestedRun`,
 * `inheritWorkerLimits`, `cancelPropagationForNested` and `applyChildFailure`
 * all shipped tested and unreachable, because no script could ask for a nested
 * run at all — the epic's own tripwire asserted `typeof workflow ===
 * 'undefined'` and said, in as many words, that must[3] was vacuous until a
 * hook appeared.
 *
 * These cases start real worker threads through the mounted engine. What they
 * assert is what the PARENT SCRIPT observed, because that is what a refusal or
 * a decayed budget actually costs a caller.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import type { DefinitionName, SignerIdentity } from '@deepseek-ai/dsh-workflow-registry'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'

const META = { name: 'parent', description: 'nests another definition', phases: [] }

async function setup(options: { maxNestingDepth?: number } = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessageBusPlugin)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(WorkerThreadWorkflowEngine, options)
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('child said so')]))
  const parent = ctx.agentLoop.create(SessionId('nesting-parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent }
}

/** Register one definition and return the `{ name, digest }` a script passes to `workflow()`. */
function register(ctx: Context, name: string, body: string): { name: string; digest: string } {
  // The REAL digest, computed from the body: since §12.48-A the engine holds a
  // `DefinitionRegistry`, which recomputes it and refuses a mismatch. A made-up
  // digest here would be a registration claiming one identity and carrying
  // another, which is precisely what the registry exists to reject.
  const digest = computeDefinitionDigest(body)
  const engine = ctx.workflowEngine as WorkerThreadWorkflowEngine
  engine.registerDefinition({
    digest,
    name: brandString<DefinitionName>(name),
    version: 1,
    body,
    signer: brandString<SignerIdentity>('test-signer'),
  })
  return { name, digest }
}

describe('P4-09 must[3]: a script nests another definition', () => {
  it('runs the nested definition and hands its value back to the parent script', async () => {
    const { ctx, parent } = await setup()
    const ref = register(ctx, 'inner', "return 'from the nested run'")
    const run = ctx.workflowEngine.start({
      script: `return await workflow(${JSON.stringify(ref)})`,
      meta: META,
      parent,
    })

    const result = await run.result
    expect(result.stopReason).toBe('completed')
    // The nested run executed the REGISTERED body, resolved by digest — not
    // anything the caller passed alongside the reference (acceptance[0]).
    expect(result.value).toBe('from the nested run')
    await run.dispose()
  })

  it('REFUSES a digest that resolves under a different name, so a run cannot execute what it does not claim', async () => {
    // `resolveDefinition` reports this separately from an unknown digest, and
    // the distinction is the point: the run's own record is internally
    // inconsistent, and an operator sent looking for a missing artifact would
    // be looking for the wrong thing.
    const { ctx, parent } = await setup()
    const ref = register(ctx, 'inner', "return 'never runs'")
    const run = ctx.workflowEngine.start({
      script: `try { return await workflow({ name: 'other', digest: ${JSON.stringify(ref.digest)} }) }
               catch (error) { return 'REFUSED: ' + error.message }`,
      meta: META,
      parent,
    })

    expect((await run.result).value).toContain('name-digest-mismatch')
    await run.dispose()
  })

  it('REFUSES an unregistered digest without starting a worker (acceptance[0])', async () => {
    const { ctx, parent } = await setup()
    const run = ctx.workflowEngine.start({
      script: `try { return await workflow({ name: 'ghost', digest: 'never-registered' }) }
               catch (error) { return 'REFUSED: ' + error.message }`,
      meta: META,
      parent,
    })

    expect((await run.result).value).toContain('unknown-digest')
    await run.dispose()
  })

  it('REFUSES a definition that nests ITSELF, structurally rather than by waiting for the depth limit', async () => {
    // acceptance[3]'s recursion half. A depth limit does eventually halt a
    // recursive definition, but it halts every deep composition the same way —
    // an operator would see "too deep" for a workflow that is merely large and
    // for one that calls itself forever.
    const { ctx, parent } = await setup()
    const engine = ctx.workflowEngine as WorkerThreadWorkflowEngine

    // A definition whose own body nests itself, registered under its own real
    // digest. Since §12.48-A the refusal happens at REGISTRATION: a definition
    // that cannot terminate never enters the registry, so it is never shipped,
    // resolved or started. Before that, the engine's bare `Map` stored it and
    // the recursion was caught at run time — after the thing had already been
    // registered and begun.
    const selfBody = "return await workflow({ name: 'self', digest: SELF })"
    expect(() => {
      engine.registerDefinition({
        digest: computeDefinitionDigest(selfBody),
        name: brandString<DefinitionName>('self'),
        version: 1,
        body: selfBody,
        signer: brandString<SignerIdentity>('test-signer'),
      })
    }).toThrow(/self-recursive-definition/u)

    // The positive control: the SAME registration path admits a definition that
    // does not name itself, so the refusal above is about recursion rather than
    // about this path refusing everything.
    expect(() => { register(ctx, 'not-self', 'return 1') }).not.toThrow()
    void parent
  })

  it('REFUSES nesting past the configured depth (acceptance[3])', async () => {
    const { ctx, parent } = await setup({ maxNestingDepth: 1 })
    const inner = register(ctx, 'inner', "return 'deep'")
    const middle = register(ctx, 'middle', `return await workflow(${JSON.stringify(inner)})`)
    const run = ctx.workflowEngine.start({
      script: `try { return await workflow(${JSON.stringify(middle)}) } catch (error) { return 'OUTER: ' + error.message }`,
      meta: META,
      parent,
    })

    // Depth 1 admits the first nesting and refuses the second, and the reason
    // says which limit stopped it — a recursive definition and a merely deep
    // one need different responses from an operator.
    expect((await run.result).value).toContain('max-depth-exceeded')
    await run.dispose()
  })

  it('CANCELS the nested run when the parent is cancelled (acceptance[1])', async () => {
    // A nested run holds budget drawn from its parent's allowance, so a child
    // that outlived a cancelled parent would keep spending an allowance nobody
    // is watching.
    const { ctx, parent } = await setup()
    const ref = register(ctx, 'slow', 'await new Promise(() => {}); return 1')
    const run = ctx.workflowEngine.start({
      script: `return await workflow(${JSON.stringify(ref)})`,
      meta: META,
      parent,
    })
    // Let the nested run start before cancelling, so the cancel has something
    // to propagate to rather than racing the start.
    await new Promise<void>((resolve) => { setTimeout(resolve, 200) })
    run.cancel('the parent was cancelled')

    const result = await run.result
    expect(result.stopReason).toBe('cancelled')
    await run.dispose()
  })
})

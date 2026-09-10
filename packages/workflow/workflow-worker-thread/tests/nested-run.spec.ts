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
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import CapabilityTokenFilePlugin from '@deepseek-ai/dsh-capability-token-file'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
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

const tokenRoots: string[] = []
const tokenContexts: Context[] = []
afterEach(async () => {
  for (const ctx of tokenContexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of tokenRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

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
function register(
  ctx: Context,
  name: string,
  body: string,
  tools?: { allow: readonly string[] },
): { name: string; digest: string } {
  // The REAL digest, computed from the body: since §12.48-A the engine holds a
  // `DefinitionRegistry`, which recomputes it and refuses a mismatch. A made-up
  // digest here would be a registration claiming one identity and carrying
  // another, which is precisely what the registry exists to reject.
  const digest = computeDefinitionDigest(body, tools)
  const engine = ctx.workflowEngine as WorkerThreadWorkflowEngine
  engine.registerDefinition({
    digest,
    name: brandString<DefinitionName>(name),
    version: 1,
    body,
    signer: brandString<SignerIdentity>('test-signer'),
    ...tools === undefined ? {} : { tools },
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

describe('P4-09 must[3]: a nested run can spawn an agent at all', () => {
  it('runs an agent INSIDE a nested run and settles, which no case asked before', async () => {
    // The property every other nesting clause rests on, and it was false. A
    // nested worker was started with `maxConcurrentAgents: 0` -- the sentinel
    // meaning "derive it from the host", passed on unresolved by `startNested`
    // and copied through `inheritWorkerLimits`, where `??` could not rescue it
    // because zero is not nullish. The worker announced ready and then waited
    // forever for a slot that could not exist: no error, no child, no result.
    //
    // Six nesting cases passed throughout, because not one of them spawned an
    // agent inside a nested run.
    const { ctx, parent } = await setup()
    const ref = register(ctx, 'inner', "return await agent('x')")
    const run = ctx.workflowEngine.start({
      script: `return await workflow(${JSON.stringify(ref)})`,
      meta: META,
      parent,
    })

    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.value).toBe('child said so')
    await run.dispose()
  })
})

describe('P4-09 must[3]: a nested run\'s children inherit its DECAYED capability token', () => {
  // The bound reaches a child's token through the host's `toolFilter`, which
  // the subagent provider both applies as a tool restriction and passes to
  // `deriveChild`. These cases start a REAL nested run whose script spawns a
  // REAL child, then ask what that child may do -- a bound that narrowed the
  // token list while dispatch admitted the call would be a recorded decision
  // rather than an enforced one.
  const CHILD_SCRIPT = "return await agent('do the work')"

  /** The nesting setup plus the token provider and the tools a bound names. */
  async function tokenSetup() {
    const ctx = new Context()
    pinTrustKernel(ctx, createTrustKernel())
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    const root = mkdtempSync(join(tmpdir(), 'dsh-nested-token-'))
    tokenRoots.push(root)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(MessageBusPlugin)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(InMemoryLeaseStorePlugin)
    await ctx.plugin(WorkerThreadWorkflowEngine, {})
    for (const name of ['read_file', 'write_file']) {
      ctx.tools.register(defineContentToolFixture({
        name,
        description: `${name} fixture`,
        parameters: {},
        async execute() { return [{ type: 'text', text: 'ok' }] },
      }))
    }
    await ctx.plugin(CapabilityTokenFilePlugin, {
      directory: join(root, 'tokens'),
      requireForTools: true,
      sessionTokenTtlMs: 60_000,
    })
    // One response per agent() the scripts below reach: the parent run's child,
    // and the nested run's. A starved adapter hangs rather than failing, which
    // reads as a bound that never applied.
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      textResponse('child said so'),
      textResponse('child said so'),
      textResponse('child said so'),
    ]))
    // Created through the REGISTRY, not `agentLoop.create`, because the handle
    // is what carries `dispose()` — the capability its creator holds. The
    // detached cases need the launching session to actually END, and only the
    // handle can end it.
    const handle = await ctx.agents.create({ sessionId: SessionId('nesting-token-parent') })
    tokenContexts.push(ctx)
    return { ctx, parent: handle.agent, disposeLauncher: () => handle.dispose() }
  }

  /**
   * Every child session started under `ctx`, captured as it starts.
   *
   * A child spawned inside a worker is DISPOSED before the run settles -- the
   * message trace is `child-start, agent-start, agent-end, child-dispose,
   * result` -- so reading the agent registry afterwards finds only the parent.
   * The token has to be taken while the child is alive, which is also the only
   * moment its authority means anything.
   */
  function captureChildTokens(ctx: Context, parentId: string) {
    const pending: Promise<readonly string[] | undefined>[] = []
    ctx.on('agent/session-start', ({ agent }) => {
      if (agent.id === parentId) return
      // Awaited, not read synchronously: issuance is asynchronous, which is why
      // `whenSessionToken` exists at all -- the synchronous read at session
      // start returns undefined and would report "no authority" for a child
      // that is about to hold one. The promise is created here, while the child
      // lives, because the provider drops the token on `agent/disposed`.
      pending.push(ctx.capabilityTokens.whenSessionToken(agent.id).then(token => token?.token.resources))
    })
    return pending
  }

  it('narrows a child of a nested run to the definition\'s declaration', async () => {
    const { ctx, parent } = await tokenSetup()
    await ctx.capabilityTokens.whenSessionToken(parent.id)
    const children = captureChildTokens(ctx, parent.id)
    const ref = register(ctx, 'inner', CHILD_SCRIPT, { allow: ['read_file'] })
    const run = ctx.workflowEngine.start({
      script: `return await workflow(${JSON.stringify(ref)})`,
      meta: META,
      parent,
    })
    await run.result

    const resources = await Promise.all(children)
    expect(resources).toHaveLength(1)
    expect(resources[0]).toContain('read_file')
    // The negative half: `write_file` is a tool the PARENT holds, so its
    // absence is the declaration narrowing rather than the parent being narrow.
    expect(resources[0]).not.toContain('write_file')

    await run.dispose()
    // Three worker threads start in this file's token cases (root, nested, and
    // at depth 2 a second nested), so the default 5s is not a safety margin but
    // a coin flip under load: this case passes alone and timed out at 5830ms in
    // a full-file run. The limit is raised rather than the work reduced,
    // because the depth is the point.
  }, 30_000)

  it('grants nothing a nested declaration names beyond the run above it', async () => {
    // A declaration only narrows. If naming a tool could add it, a nested
    // definition would re-authorize itself and the decay would be decoration.
    // Depth 2 is what shows it: at depth 1 an intersection and an assignment
    // are indistinguishable.
    const { ctx, parent } = await tokenSetup()
    await ctx.capabilityTokens.whenSessionToken(parent.id)
    const children = captureChildTokens(ctx, parent.id)
    const inner = register(ctx, 'inner', CHILD_SCRIPT, { allow: ['read_file', 'write_file'] })
    const outer = register(
      ctx,
      'outer',
      `return await workflow(${JSON.stringify(inner)})`,
      { allow: ['read_file'] },
    )
    const run = ctx.workflowEngine.start({
      script: `return await workflow(${JSON.stringify(outer)})`,
      meta: META,
      parent,
    })
    await run.result

    const resources = await Promise.all(children)
    expect(resources).toHaveLength(1)
    expect(resources[0]).toContain('read_file')
    expect(resources[0]).not.toContain('write_file')

    await run.dispose()
  }, 30_000)

  // The detached cases share this block's `tokenSetup` and `captureChildTokens`
  // rather than duplicating a composition: what they add is the launcher ENDING
  // while the run continues, not a different harness.
  it('spawns a child that still gets a derived token after the launcher session ended', async () => {
    // The property that makes "detached" more than "still in memory". A child
    // derived from the LAUNCHER would fail here — `deriveFromParent` refuses a
    // parent holding no token, and `agent/disposed` drops it — so a detached
    // run would stay alive and be unable to do the work it stayed alive for.
    const { ctx, parent, disposeLauncher } = await tokenSetup()
    await ctx.capabilityTokens.whenSessionToken(parent.id)
    const children = captureChildTokens(ctx, parent.id)

    // The launcher ENDS BEFORE the run's only child starts. Sequenced through
    // the run's own `workflow/agent-start` rather than a timer, because the vm
    // context has none and a sleep would be racing the thread either way.
    const launcherGone = new Promise<void>((resolve) => {
      ctx.on('workflow/agent-start', () => { void disposeLauncher().then(resolve) })
    })
    // The launcher's SESSION ends: `agent/disposed` is what drops its token,
    // and that is the event this case is about.


    const run = await ctx.workflowEngine.startDetached({
      script: "await agent('while the turn lives'); return await agent('after the turn')",
      meta: META,
      parent,
    })
    await launcherGone

    const settled = await run.result
    expect(`${settled.stopReason}: ${settled.error ?? ''}`).toBe('completed: ')

    const resources = await Promise.all(children)
    // The detached run's own session is one of the captured children (derived
    // from the launcher at start); its agent is the other, derived from the RUN.
    expect(resources.length).toBeGreaterThanOrEqual(2)
    expect(resources.every(list => list !== undefined)).toBe(true)

    await run.dispose()
  }, 30_000)

  it('is NOT cancelled when the launching run is, while a nested sibling IS', async () => {
    // The negative control that makes "detached" more than a word. Cancellation
    // reaches `nestedRuns`, and a detached run is deliberately not a member:
    // the launcher is who started it, and the Run service is who owns it.
    const { ctx, parent } = await tokenSetup()
    await ctx.capabilityTokens.whenSessionToken(parent.id)

    const detached = await ctx.workflowEngine.startDetached({
      script: "return await agent('detached work')",
      meta: META,
      parent,
    })
    const launcher = ctx.workflowEngine.start({
      script: "return await agent('launcher work')",
      meta: META,
      parent,
    })

    launcher.cancel('operator cancelled the launching run')
    const launcherSettled = await launcher.result
    expect(launcherSettled.stopReason).toBe('cancelled')

    // The detached run neither settles as cancelled nor is disturbed by it.
    const detachedSettled = await detached.result
    expect(detachedSettled.stopReason).toBe('completed')

    await launcher.dispose()
    await detached.dispose()
  }, 30_000)

  it('IS terminated by an explicit cancel of its own id', async () => {
    // Disconnect is not cancellation; an explicit cancel still is. Without this
    // the first case would be indistinguishable from "detached runs cannot be
    // cancelled at all".
    const { ctx, parent } = await tokenSetup()
    await ctx.capabilityTokens.whenSessionToken(parent.id)

    const detached = await ctx.workflowEngine.startDetached({
      script: "await agent('one'); return await agent('two')",
      meta: META,
      parent,
    })
    detached.cancel('operator cancelled the detached run')

    expect((await detached.result).stopReason).toBe('cancelled')
    await detached.dispose()
  }, 30_000)

  it('DISPOSES its own agent once it reaches a terminal state, leaking no session', async () => {
    // A detached run owns its agent, so nothing else can tear it down: the
    // launching turn never held the handle. Without this the process leaks one
    // live session per detached run for as long as it runs.
    const { ctx, parent } = await tokenSetup()
    await ctx.capabilityTokens.whenSessionToken(parent.id)

    const before = ctx.agents.list().length
    const run = await ctx.workflowEngine.startDetached({ script: "return 'done'", meta: META, parent })
    expect(ctx.agents.list().length).toBe(before + 1)

    await run.result
    // Settled through the same promise the disposal is chained to, so a poll
    // is not racing it: awaiting the result orders this read after the tear-down.
    await Promise.resolve()
    await new Promise(resolve => setImmediate(resolve))

    expect(ctx.agents.list().length).toBe(before)
    await run.dispose()
  }, 30_000)

  it('REFUSES to start when the launcher cannot delegate, rather than starting without authority', async () => {
    // A run that started anyway would be a detached run with no answer to what
    // authorizes it — worse than not starting, because it looks complete.
    const { ctx, parent } = await tokenSetup()
    const orphan = { ...parent, id: SessionId('never-issued-a-token') } as typeof parent

    await expect(ctx.workflowEngine.startDetached({ script: "return 'x'", meta: META, parent: orphan }))
      .rejects.toThrow(/detached workflow was not started/u)
  }, 30_000)
})

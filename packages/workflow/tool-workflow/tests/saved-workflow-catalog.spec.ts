/**
 * B-729 (P4-09, question 31 (a)): an agent that can call the workflow tool is
 * told which saved workflows it can nest, in a durable catalog message, and
 * only once the saved-workflow loader has settled.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { WorkflowEngine } from '@deepseek-ai/dsh-workflow'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import * as toolWorkflow from '../src/index.ts'

/** An engine that lists a fixed set of registered definitions and runs nothing. */
class ListingEngine extends WorkflowEngine {
  entries: { name: string; digest: string }[] = []
  registeredDefinitions(): readonly { readonly name: string; readonly digest: string }[] { return this.entries }
  start(): WorkflowRun { throw new Error('not under test') }
  startDetached(): Promise<WorkflowRun> { throw new Error('not under test') }
  attach(): WorkflowRun | undefined { throw new Error('not under test') }
  resume(): Promise<WorkflowRun> { throw new Error('not under test') }
}

/** An engine that registers no definitions, so it has nothing to list. */
class PlainEngine extends WorkflowEngine {
  start(): WorkflowRun { throw new Error('not under test') }
  startDetached(): Promise<WorkflowRun> { throw new Error('not under test') }
  attach(): WorkflowRun | undefined { throw new Error('not under test') }
  resume(): Promise<WorkflowRun> { throw new Error('not under test') }
}

const ENTRY = { name: 'release-notes', digest: 'sha256-1234' }

/**
 * Mount the tool on an engine and create one agent whose session records through the store.
 * @param engine - the engine plugin to mount.
 * @returns the context and the agent.
 */
async function setup(engine: typeof ListingEngine | typeof PlainEngine = ListingEngine) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(engine)
  await ctx.plugin(toolWorkflow, {})
  const session = ctx.sessions.create(SessionId('catalog'))
  const agent = { id: session.id, options: {}, session } as unknown as Agent
  return { ctx, agent }
}

/**
 * Run one pre-step through the tool's listener.
 * @param ctx - the context.
 * @param agent - the agent taking the step.
 * @param decided - what the rest of the chain decides.
 * @returns the decision.
 */
function step(ctx: Context, agent: Agent, decided: PreStepDecision = { kind: 'enter', messages: [] }): Promise<PreStepDecision> {
  return agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages: [], turn: 1, step: 1, signal: new AbortController().signal,
  }, () => Promise.resolve(decided))
}

/**
 * The catalog messages a decision adds.
 * @param decision - the pre-step decision.
 * @returns the messages carrying the tool's catalog source.
 */
function catalogs(decision: PreStepDecision): UserMessage[] {
  return decision.kind === 'enter' ? decision.messages.filter(message => message.source.kind === 'plugin') : []
}

/**
 * A message's text.
 * @param message - a catalog message.
 * @returns its one text block.
 */
function textOf(message: UserMessage | undefined): string {
  return JSON.stringify(message?.content ?? [])
}

describe('B-729: the saved-workflow catalog reaches the model through a durable message', () => {
  it('waits for the loader to settle, then lists each saved workflow with its digest', async () => {
    const { ctx, agent } = await setup()
    ;(ctx.workflowEngine as ListingEngine).entries = [ENTRY]
    const loading = Promise.withResolvers<{ readonly failure?: string }>()
    ctx.provide('savedWorkflows', { settled: loading.promise })
    let decided = false
    const pending = step(ctx, agent).then((decision) => { decided = true; return decision })

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(decided, 'the step waits for the load rather than listing an unfinished one').toBe(false)
    loading.resolve({})
    const [catalog, ...more] = catalogs(await pending)

    expect(more).toEqual([])
    expect(catalog?.source).toEqual({ kind: 'plugin', plugin: 'tool-workflow', form: 'catalog' })
    expect(textOf(catalog)).toContain('- name: release-notes, digest: sha256-1234')
    expect(textOf(catalog)).toContain('await workflow({ name, digest }, args)')
  })

  it('publishes again only when the catalog changed or the last one left the surface', async () => {
    const { ctx, agent } = await setup()
    const engine = ctx.workflowEngine as ListingEngine
    engine.entries = [ENTRY]
    const [first] = catalogs(await step(ctx, agent))
    if (first === undefined) throw new Error('the first step publishes the catalog')
    agent.session.append('user/message', first, { surfaceOp: 'append' })

    expect(catalogs(await step(ctx, agent))).toEqual([])

    engine.entries = [ENTRY, { name: 'triage', digest: 'sha256-5678' }]
    const [changed] = catalogs(await step(ctx, agent))
    expect(textOf(changed)).toContain('- name: triage, digest: sha256-5678')
  })

  it('publishes nothing with nothing to list, no loader and no earlier catalog', async () => {
    const { ctx, agent } = await setup()
    expect(catalogs(await step(ctx, agent))).toEqual([])
  })

  it('names a failed load, even with nothing to list', async () => {
    const { ctx, agent } = await setup()
    ctx.provide('savedWorkflows', { settled: Promise.resolve({ failure: 'Error: EACCES' }) })
    const [catalog] = catalogs(await step(ctx, agent))
    expect(textOf(catalog)).toContain('No saved workflows are available in this session')
    expect(textOf(catalog)).toContain('Loading the saved workflows failed: Error: EACCES')
  })

  it('leaves a rejected step, and an engine that registers no definitions, without a catalog', async () => {
    const listing = await setup()
    ;(listing.ctx.workflowEngine as ListingEngine).entries = [ENTRY]
    expect(await step(listing.ctx, listing.agent, { kind: 'reject' })).toEqual({ kind: 'reject' })
    const plain = await setup(PlainEngine)
    expect(catalogs(await step(plain.ctx, plain.agent))).toEqual([])
  })
})

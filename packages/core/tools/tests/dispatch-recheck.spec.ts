/**
 * BLOCKED-334 sites 1 to 3: the tool runtime asks once more whether this host
 * may still act after every wait on the way to a tool body, so an emergency
 * stop or a lost lease that arrives while an operator decides refuses the call
 * instead of running it. The wait here is a pre-execute listener that changes
 * the agent's standing before it answers, standing in for any ask.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { refusalToAct } from '../src/external-effect.ts'

/** The fields of an agent's standing a test changes while the call waits. */
interface Standing {
  controlState?: { stopped: boolean }
  runLease?: { mayWrite(nowMs: number): boolean }
  leaseRefused?: boolean
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const signal = new AbortController().signal

/**
 * Mount the tool runtime with a probe tool and an agent whose standing
 * `during` changes while its call waits in the pre-execute waterfall.
 * @param standing - the agent's standing when the call starts.
 * @param during - what changes while the call waits.
 * @returns the runtime, the agent, and the probe's recorded runs.
 */
async function compose(standing: Standing, during: (standing: Standing) => void) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(ToolRuntime)
  const session = ctx.sessions.create(SessionId('dispatch-recheck'))
  const bodies: string[] = []
  ctx.tools.register(defineContentToolFixture({
    name: 'probe',
    description: 'records that its body ran',
    parameters: {},
    async execute() {
      bodies.push('ran')
      return [{ type: 'text', text: 'ran' }]
    },
  }))
  ctx.on('tools/pre-execute', async (_exec, next) => {
    during(standing)
    return next()
  })
  const agent = Object.assign(standing, { id: session.id, session }) as unknown as Agent
  return { ctx, agent, bodies }
}

describe('BLOCKED-334: the runtime asks again, after the waits, whether this host may act', () => {
  it('runs the body when nothing changes while the call waits', async () => {
    const { ctx, agent, bodies } = await compose({ controlState: { stopped: false } }, () => {})
    const result = await ctx.tools.execute({ callId: ToolCallId('control'), name: 'probe', arguments: {}, agent, signal })

    expect(result.isError).toBe(false)
    expect(bodies).toEqual(['ran'])
  })

  it('refuses the body when an emergency stop is raised while the call waits', async () => {
    const { ctx, agent, bodies } = await compose({ controlState: { stopped: false } }, (standing) => {
      standing.controlState = { stopped: true }
    })
    const result = await ctx.tools.execute({ callId: ToolCallId('stopped'), name: 'probe', arguments: {}, agent, signal })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('an emergency stop is in force')
    expect(bodies).toEqual([])
  })

  it('refuses the body when another host takes the run over while the call waits', async () => {
    let writable = true
    const { ctx, agent, bodies } = await compose({ runLease: { mayWrite: () => writable } }, () => {
      writable = false
    })
    const result = await ctx.tools.execute({ callId: ToolCallId('fenced'), name: 'probe', arguments: {}, agent, signal })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('another host took it over')
    expect(bodies).toEqual([])
  })

  it('refuses the body when the lease is refused while the call waits', async () => {
    const { ctx, agent, bodies } = await compose({}, (standing) => {
      standing.leaseRefused = true
    })
    const result = await ctx.tools.execute({ callId: ToolCallId('refused'), name: 'probe', arguments: {}, agent, signal })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('never held its work item')
    expect(bodies).toEqual([])
  })
})

describe('refusalToAct', () => {
  it('answers with the refusal text for an agent that may not act, and nothing for one that may', () => {
    const stopped = { controlState: { stopped: true } } as unknown as Agent
    const free = { controlState: { stopped: false } } as unknown as Agent
    expect(refusalToAct(stopped, 'write', 0)).toBe(
      'The action "write" was not performed: an emergency stop is in force, so this run may take no new action until it is resumed.',
    )
    expect(refusalToAct(free, 'write', 0)).toBeUndefined()
  })
})

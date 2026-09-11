/**
 * The TaskProfile compiled for a real agent's first model step (Epic P4-02
 * must[1], validation[2]) — the Usage stage of an epic whose Contract and
 * Provider stages produced a vocabulary and a compiler with no caller.
 *
 * **Every case drives a real turn.** The profile is never built here: a mounted
 * `RunPlugin` sees `agent/pre-step`, compiles from the messages that step was
 * given, appends the body to the session log, and names its digest in the Run's
 * `accepted → planning` transition. A case that hand-called the compiler would
 * observe the Provider stage again and say nothing about whether anything calls
 * it.
 *
 * **One ordering is NOT asserted here, deliberately.** The profile is compiled
 * inside the `agent/pre-step` waterfall, and the loop appends `step/start` and
 * the step's claimed `user/message` events only after that waterfall resolves
 * (`agent-loop/src/agent.ts`). So the profile event precedes both — including
 * the very message its `goalRef` names — wherever inside the listener the
 * compile happens, and no log observation distinguishes compiling before
 * `next()` from compiling after it. Measured: moving the call after `next()`
 * reddens nothing.
 *
 * The compiler's own arithmetic — what a profile contains, which inputs change
 * its reference — is frozen in `packages/run/task-profile`. What this file owns
 * is the wiring: when the compile happens, where the body lands, that the Run
 * log's digest resolves to that body, and that a message which is not a task
 * produces neither.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import RunPlugin, { referencesByKind } from '../src/index.ts'

const roots: string[] = []
const mounted: Context[] = []

// Dispose before removing the root: `RunPlugin`'s disposer awaits the durable
// writes it started, and a case that only removed the directory raced them.
afterEach(async () => {
  for (const ctx of mounted.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A real Context carrying the agent loop, one lease store, and the Run plugin. */
async function harness(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-run-profile-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(RunPlugin, { storePath: join(root, 'runs.json') })
  mounted.push(ctx)
  return ctx
}

/** Run one turn on a fresh session and return the agent that ran it. */
async function turn(
  ctx: Context,
  sessionId: string,
  message: Parameters<Agent['followup']>[0],
  replies = 1,
): Promise<Agent> {
  ctx.llm.registerAdapter(['mock'], new MockAdapter(Array.from({ length: replies }, () => textResponse('done'))))
  const { agent } = await ctx.agents.create({
    sessionId: SessionId(sessionId),
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  agent.followup(message)
  await agent.whenIdle()
  return agent
}

/** The `run/task-profile` events one session's log accepted, in log order. */
function profileEvents(agent: Agent): readonly SessionEvent[] {
  return agent.session.snapshotEvents().filter(event => event.type === 'run/task-profile')
}

/** One plain human goal, the ordinary first message of a task. */
function goal(text: string): ReturnType<typeof createUserMessage> {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('P4-02 must[1]: a profile is compiled for the first model step, from that step\'s own messages', () => {
  it('appends exactly one run/task-profile event and names it on the Agent handle', async () => {
    const ctx = await harness()
    const agent = await turn(ctx, 'session-goal', goal('rename the widget to gadget across the repo'))

    const events = profileEvents(agent)
    expect(events).toHaveLength(1)
    // The handle carries the digest, not the body (P4-02 acceptance[1]): one
    // durable home, and a field whose movement is itself the revision signal.
    expect(agent.taskProfile).toBe((events[0]?.data as { ref: string }).ref)
  })

  it('compiles the objective from the goal the human actually sent, and keeps the reference beside it', async () => {
    const ctx = await harness()
    const agent = await turn(ctx, 'session-objective', goal('rename the widget to gadget'))

    const { profile } = profileEvents(agent)[0]?.data as {
      profile: { objective: string; goalRef: { sessionId: string; messageId: string } }
    }
    expect(profile.objective).toBe('rename the widget to gadget')
    // The reference is to the message in THIS session, which is what makes the
    // profile re-derivable from the log rather than a second copy of the goal.
    expect(profile.goalRef.sessionId).toBe(agent.id)
    const first = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    expect(profile.goalRef.messageId).toBe((first?.data as { id: string }).id)
  })
})

describe('P4-02 validation[2]: the Run log names the profile, and the digest resolves to the body', () => {
  it('moves the Run accepted → planning carrying the profile as a task-profile reference', async () => {
    const ctx = await harness()
    const agent = await turn(ctx, 'session-planning', goal('draft the release notes'))

    const [run] = ctx.runs.service.runsForSession(agent.id)
    expect(run?.state).toBe('planning')
    const references = referencesByKind(run?.events ?? [], 'task-profile')
    expect(references).toStrictEqual([{ kind: 'task-profile', id: agent.taskProfile }])
  })

  it('references a digest whose body is in the session log, so the reference is resolvable', async () => {
    // The half that a dangling digest would break. A Run event naming a profile
    // no log carries looks complete and fails at the resolver.
    const ctx = await harness()
    const agent = await turn(ctx, 'session-resolvable', goal('bump the dependency'))

    const [run] = ctx.runs.service.runsForSession(agent.id)
    const [reference] = referencesByKind(run?.events ?? [], 'task-profile')
    const bodies = profileEvents(agent).map(event => (event.data as { ref: string }).ref)
    expect(bodies).toContain(reference?.id)
  })
})

describe('P4-02 must[1]: the compile happens once per agent, and only for a task', () => {
  it('appends no second profile for a second goal in the same session', async () => {
    // The first-step marker is `lifecycle.state === 'queued'`, which a later
    // turn in the same session never re-enters. A case that only ran one turn
    // would pass against a compile on every step.
    const ctx = await harness()
    const agent = await turn(ctx, 'session-two-turns', goal('first goal'), 2)
    agent.followup(goal('second goal, unrelated to the first'))
    await agent.whenIdle()

    expect(profileEvents(agent)).toHaveLength(1)
  })

  it('compiles NOTHING for a first message that is injected plugin context, and leaves the Run accepted', async () => {
    // `taskOriginOf` maps a plugin source to `injected-context` and the
    // compiler refuses `not-a-task`. A refusal is the ordinary outcome, so
    // neither a profile event nor a transition may appear — an empty profile
    // would be a record of a task nobody asked for.
    const ctx = await harness()
    const agent = await turn(ctx, 'session-injected', createUserMessage({
      content: [{ type: 'text', text: 'the workspace has 41 uncommitted files' }],
      source: { kind: 'plugin', plugin: 'dsh-context-workspace', form: 'instructions' },
    }))

    expect(profileEvents(agent)).toStrictEqual([])
    expect(agent.taskProfile).toBeUndefined()
    const [run] = ctx.runs.service.runsForSession(agent.id)
    expect(run?.state).toBe('accepted')
    expect(referencesByKind(run?.events ?? [], 'task-profile')).toStrictEqual([])
  })
})

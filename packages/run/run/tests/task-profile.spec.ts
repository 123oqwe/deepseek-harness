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
import type { AttachmentId } from '@deepseek-ai/dsh-attachment/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
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

/**
 * A real Context carrying the agent loop, one lease store, and the Run plugin,
 * with one mock adapter good for `replies` model turns.
 *
 * The adapter is registered HERE and not per turn: `registerAdapter` refuses a
 * provider that is already registered, and the cases that drive two agents over
 * one session need two turns from one Context.
 * @param replies - how many model turns this Context must serve.
 * @returns the mounted Context, disposed in `afterEach`.
 */
async function harness(replies = 2): Promise<Context> {
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
  ctx.llm.registerAdapter(['mock'], new MockAdapter(Array.from({ length: replies }, () => textResponse('done'))))
  mounted.push(ctx)
  return ctx
}

/**
 * Run one turn on a session and return the agent that ran it.
 * @param ctx - the mounted Context.
 * @param sessionId - the session to run in; reusing one drives a second agent over the same log.
 * @param message - the message to send.
 * @returns the agent, idle.
 */
async function turn(
  ctx: Context,
  sessionId: string,
  message: Parameters<Agent['followup']>[0],
): Promise<Agent> {
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
    // The ENTRY, not the state afterwards. Reading `run.state` was an incidental
    // assertion: it was `planning` only because nothing advanced the Run past
    // it, and P4-01's U2 slice drives `planning -> running` at this same step.
    // Pinning the entry is also the stronger claim — it fixes the `accepted ->
    // planning` pair AND that the reference is on that transition, rather than
    // anywhere in the log.
    const planning = run?.events.find(event => event.toState === 'planning')
    expect(planning?.fromState).toBe('accepted')
    expect(planning?.references).toStrictEqual([{ kind: 'task-profile', id: agent.taskProfile }])
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
    const agent = await turn(ctx, 'session-two-turns', goal('first goal'))
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

describe('P4-02 must[2] over a partially read goal (delegate ruling, OQ2)', () => {
  it('compiles a profile for an image-led first message and asks what the image asks for', async () => {
    // Before the ruling this message produced NO profile: the loop's
    // flattening idiom yields `undefined` for anything but a single text
    // block, and the compiler refused `empty-goal`. Six recorded snapshot
    // sessions sat on that, `sdk/inline-image-prompt` among them — a fixture
    // written to exercise an image-led prompt was the one real task shape
    // that had no profile.
    const ctx = await harness()
    const agent = await turn(ctx, 'session-image', createUserMessage({
      content: [
        { type: 'text', text: 'make the layout match this' },
        {
          type: 'image',
          attachment: {
            attachmentId: brandString<AttachmentId>('attachment-1'),
            mediaType: 'image/png',
            bytes: 128,
            width: 64,
            height: 64,
          },
        },
      ],
      source: { kind: 'user' },
    }))

    const events = profileEvents(agent)
    expect(events).toHaveLength(1)
    const { profile } = events[0]?.data as {
      profile: { objective: string; questions: readonly { field: string; prompt: string }[] }
    }
    // The text that WAS there is the objective; the part that was not is a
    // question rather than a silent omission or an invented description.
    expect(profile.objective).toBe('make the layout match this')
    const asked = profile.questions.find(entry => entry.field === 'unreadGoalContent')
    expect(asked?.prompt).toContain('1 image block')
  })
})

describe('P4-02 validation[2]: a recompile that revises nothing writes nothing (delegate ruling, OQ3)', () => {
  it('appends no second profile when a resumed session re-claims the SAME pending message', async () => {
    // **This is the one reachable shape, and finding that out changed the
    // case.** The skip is keyed on the profile digest, and a profile's
    // `goalRef` names the message it was compiled from — so an ordinary resume
    // that carries a NEW message produces a new digest and SHOULD write. What
    // produces a byte-identical profile is a session whose step did not finish:
    // its pending message is durable, the resumed agent claims the same message
    // with the same id, and compiling it again yields the same reference. That
    // is the duplicate OQ3 exists to keep out of the log, and passing the same
    // message object here is what a re-claimed inbox entry is.
    const pending = goal('tidy the imports')
    const ctx = await harness(1)
    const before = await turn(ctx, 'session-interrupted', pending)
    expect(profileEvents(before)).toHaveLength(1)

    // A second Context is a second process: the first store still holds the
    // session, and a restore into the same store is refused by design.
    const resumed = await harness(1)
    const { agent } = await resumed.agents.create({
      sessionId: SessionId('session-interrupted'),
      seed: before.session.snapshotEvents(),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    agent.followup(pending)
    await agent.whenIdle()

    // The seeded log's one profile, and no second copy of it.
    expect(profileEvents(agent)).toHaveLength(1)
    expect(agent.taskProfile).toBe(before.taskProfile)
  })

  it('DOES append a second profile when the resumed session carries a different goal', async () => {
    // The positive control. Without it, a skip that fired unconditionally
    // would pass the case above.
    const ctx = await harness(1)
    const before = await turn(ctx, 'session-revised', goal('tidy the imports'))

    const resumed = await harness(1)
    const { agent } = await resumed.agents.create({
      sessionId: SessionId('session-revised'),
      seed: before.session.snapshotEvents(),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    agent.followup(goal('tidy the imports and sort them'))
    await agent.whenIdle()

    const events = profileEvents(agent)
    expect(events).toHaveLength(2)
    // The second names the first as the profile it revises, which is what makes
    // the chain readable by reading the log in order.
    expect((events[1]?.data as { previousRef?: string }).previousRef).toBe(before.taskProfile)
  })
})

describe('P4-02 must[2]: an entered goal\'s continuation round is a task (delegate ruling, OQ4(b))', () => {
  it('compiles a profile for a goal continuation round and carries the round into the reference', async () => {
    // The fail-closed default excluded these, and one recorded session sat on
    // it. The round reaches the profile rather than being discarded, because a
    // round of a revised goal and a first prompt are not the same task even
    // when their text is identical.
    const ctx = await harness()
    const agent = await turn(ctx, 'session-goal-round', createUserMessage({
      content: [{ type: 'text', text: 'keep going on the migration' }],
      source: { kind: 'goal', goalId: brandString<GoalId>('goal-11'), revision: 2, round: 3 },
    }))

    const events = profileEvents(agent)
    expect(events).toHaveLength(1)
    const { profile } = events[0]?.data as {
      profile: { goalRef: { goalRound?: { goalId: string; revision: number; round: number } } }
    }
    expect(profile.goalRef.goalRound).toStrictEqual({ goalId: 'goal-11', revision: 2, round: 3 })
  })

  it('carries no round for a direct human prompt, so absence stays the ordinary case', async () => {
    const ctx = await harness()
    const agent = await turn(ctx, 'session-direct-prompt', goal('start the migration'))

    const { profile } = profileEvents(agent)[0]?.data as { profile: { goalRef: { goalRound?: unknown } } }
    expect(profile.goalRef.goalRound).toBeUndefined()
  })
})

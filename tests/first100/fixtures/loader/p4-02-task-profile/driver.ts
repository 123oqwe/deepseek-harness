#!/usr/bin/env node
/**
 * Test driver for P4-02.composition.spec.ts: boot a real Loader composition
 * through `@deepseek-ai/dsh-app-boot`, register a mock LLM adapter on the
 * booted context, run ONE turn whose first message is a plain human goal, and
 * write what the session log and the Run store hold to `P4_02_OBSERVATION`.
 *
 * The mock adapter is registered here rather than mounted from the config
 * because no plugin publishes one: the testing policy allows mocking an
 * external service, and the model provider is the only thing mocked. Every
 * other part of the path — the Loader tree, `dsh-app-boot`, the agent
 * registry, the agent loop, and the Run Service's `agent/pre-step` listener —
 * is the shipped code.
 *
 * The spec reads a JSON observation rather than the live objects because the
 * boot happens in a child process: what crosses is what this driver writes.
 */

import { writeFileSync } from 'node:fs'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { taskProfileRef } from '@deepseek-ai/dsh-task-profile/validate'
import { MockAdapter, textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('p4-02-task-profile driver requires a config path')
const observationPath = process.env['P4_02_OBSERVATION']
if (observationPath === undefined) throw new Error('p4-02-task-profile driver requires P4_02_OBSERVATION')

const ctx = await boot('p4-02-task-profile-loader-smoke', resolveConfigPath(configPath, undefined))
ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))

const { agent } = await ctx.agents.create({
  sessionId: SessionId('p4-02-composition'),
  agentOptions: { provider: 'mock', model: 'mock' },
})
agent.followup(createUserMessage({
  content: [{ type: 'text', text: 'rename the widget to gadget across the repo' }],
  source: { kind: 'user' },
}))
await agent.whenIdle()

const profileEvents = agent.session.snapshotEvents().filter(event => event.type === 'run/task-profile')
const [run] = ctx.runs.service.runsForSession(agent.id)

writeFileSync(observationPath, JSON.stringify({
  // How many `run/task-profile` events one real boot of one goal produced.
  profileEventCount: profileEvents.length,
  // The payload keys, so the spec can pin that the event carries the body and
  // no digest on the production path too (BLOCKED-211).
  payloadKeys: profileEvents.map(event => Object.keys(event.data as object).sort()),
  // The digest DERIVED from each logged body, never read out of the event.
  derivedRefs: profileEvents.map(event => taskProfileRef((event.data as { profile: Parameters<typeof taskProfileRef>[0] }).profile)),
  // What the Run's own log names, which must be the same value.
  runTaskProfileRefs: (run?.events ?? [])
    .flatMap(event => event.references)
    .filter(reference => reference.kind === 'task-profile')
    .map(reference => reference.id),
  // The handle's field, the third record of one fact.
  handleTaskProfile: agent.taskProfile ?? null,
  runStates: (run?.events ?? []).map(event => `${String(event.fromState)}->${event.toState}`),
}, null, 2), 'utf8')

await ctx.fiber.dispose()

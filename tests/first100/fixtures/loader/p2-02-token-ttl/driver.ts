/**
 * Driver for BLOCKED-331's measurement: what a session does once its
 * capability token expires.
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * `./base.patch.yml` (the shipped `capability-tokens` row with a 1.5-second
 * session-token TTL) under `workspace-write`, the Trust Kernel pinned the way
 * `apps/cli/src/profile-boot.ts` pins it, registers a read-only probe tool,
 * and creates the root agent after boot. It then runs four turns, each of
 * which the scripted model opens with one probe call: one before the first
 * token expires, two after it, and one after a second tool has been
 * registered, which grows the registry.
 *
 * After each turn it reads whether the probe ran, that turn's tool results,
 * whether the session's token is still the first one (compared, never
 * printed), whether it had expired when the turn started, whether the session
 * could then see a tool the token does not name (the growth that re-issues a
 * token), and whether the agent is still there. It prints one
 * `P2-02-TTL <json>` line.
 * @module tests/first100/fixtures/loader/p2-02-token-ttl/driver
 */

import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-capability-token'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const overlay = fileURLToPath(new URL('./base.patch.yml', import.meta.url))

/** The route the scripted model registers. */
const PROVIDER = 'p2-02-token-ttl-mock'
/** The probe tool the model calls in every turn. */
const PROBE_TOOL = 'p2_02_probe'
/** The tool registered before the last turn, so the registry grows. */
const GROWTH_TOOL = 'p2_02_growth'
/** How long after the first token's expiry the second turn starts. */
const PAST_EXPIRY_MS = 300

/** What the driver read after one turn. */
interface TurnReading {
  readonly label: string
  readonly probeRan: boolean
  readonly results: readonly string[]
  readonly tokenExpiredAtTurnStart: boolean | null
  readonly toolBeyondTokenAtTurnStart: boolean | null
  readonly sameTokenAsFirst: boolean | null
  readonly turnEnds: number
  readonly agentPresent: boolean
  readonly lifecycleState: string | null
}

process.env.DSH_PERMISSION_MODE = 'workspace-write'

const ctx = await bootProductionProfile({
  binName: 'p2-02-token-ttl',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(overlay, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({
      policyDecider: endorseComposedDecision,
      auditSink: () => undefined,
    }))
  },
})
try {
  let probeRuns = 0
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a read-only probe that records that it ran',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: () => {
      probeRuns += 1
      return Promise.resolve([{ type: 'text' as const, text: 'probe ran' }])
    },
  }))
  // Created after boot, as a shipped launcher creates its root agent, so its
  // session starts once the capability-token service is listening.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const [agent] = ctx.agents.roots()
  if (agent === undefined) throw new Error('p2-02 token-ttl driver: no root agent after creation')
  const tokens = ctx.get('capabilityTokens')

  let firstNonce: string | undefined
  let resultsSeen = 0
  const turns: TurnReading[] = []

  /**
   * Run one turn and read what it did.
   * @param label - the turn's name in the report.
   */
  const turn = async (label: string): Promise<void> => {
    const before = tokens?.sessionToken(agent.id)
    const tokenExpiredAtTurnStart = before === undefined ? null : before.token.expiresAt <= Date.now()
    const toolBeyondTokenAtTurnStart = before === undefined ? null
      : ctx.tools.schemas(agent).some(schema => !before.token.resources.includes(schema.name))
    const runsBefore = probeRuns
    await runFixtureTurn(ctx, { task: `BLOCKED-331 measurement: ${label}` })
    const events = agent.session.snapshotEvents()
    const results = events.flatMap(event => event.type !== 'tool/result' ? [] : [
      event.data.message.content.flatMap(block =>
        block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
    ])
    const after = tokens?.sessionToken(agent.id)
    firstNonce ??= after?.token.nonce
    turns.push({
      label,
      probeRan: probeRuns > runsBefore,
      results: results.slice(resultsSeen),
      tokenExpiredAtTurnStart,
      toolBeyondTokenAtTurnStart,
      sameTokenAsFirst: after === undefined || firstNonce === undefined ? null : after.token.nonce === firstNonce,
      turnEnds: events.filter(event => event.type === 'turn/end').length,
      agentPresent: ctx.agents.roots().includes(agent),
      lifecycleState: agent.lifecycle?.state ?? null,
    })
    resultsSeen = results.length
  }

  await turn('1: before the first token expires')
  const first = tokens?.sessionToken(agent.id)
  await delay(Math.max(0, (first?.token.expiresAt ?? Date.now()) - Date.now()) + PAST_EXPIRY_MS)
  await turn('2: after expiry')
  await turn('3: after expiry, again')
  ctx.tools.register(defineContentToolFixture({
    name: GROWTH_TOOL,
    description: 'a tool registered after expiry, so the registry grows',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: () => Promise.resolve([{ type: 'text' as const, text: 'growth' }]),
  }))
  await turn('4: after the registry grew')

  process.stdout.write(`P2-02-TTL ${JSON.stringify({ tokenServiceMounted: tokens !== undefined, turns })}\n`)
} finally {
  await ctx.fiber.dispose()
}

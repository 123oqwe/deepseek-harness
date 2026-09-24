/**
 * Driver for A-379's measurement: what a live agent dispatches once its Run
 * has been advanced to `failed` through the shipped advance path.
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * `./base.patch.yml` under `workspace-write`, the Trust Kernel pinned the way
 * `apps/cli/src/profile-boot.ts` pins it, registers two read-only tools, and
 * creates the root agent after boot:
 *
 * - `p4_05_fail_run` advances the calling agent's Run to `failed` through
 *   `ctx.runs.advance` and records what the advance returned;
 * - `p4_05_probe` records that it ran.
 *
 * It then runs three turns: the first calls the probe; the second calls
 * `p4_05_fail_run` and then the probe in one step; the third calls the probe.
 * After each turn it reads whether the probe ran, that turn's step starts,
 * turn-end reasons and tool results, the agent's lifecycle state, and whether
 * the agent is still there. It prints one `P4-05-TERMINAL <json>` line.
 * @module tests/first100/fixtures/loader/p4-05-terminal/driver
 */

import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import type {} from '@deepseek-ai/dsh-run'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const overlay = fileURLToPath(new URL('./base.patch.yml', import.meta.url))

/** The route the scripted model registers. */
const PROVIDER = 'p4-05-terminal-mock'
/** The reason the fail-run tool records on the transition. */
const FAIL_REASON = 'A-379: the run is advanced to failed from inside a tool call'

/** What the driver read after one turn. */
interface TurnReading {
  readonly label: string
  readonly probeRan: boolean
  readonly stepStarts: number
  readonly turnEndReasons: readonly string[]
  readonly results: readonly string[]
  readonly lifecycleState: string | null
  readonly agentPresent: boolean
}

process.env.DSH_PERMISSION_MODE = 'workspace-write'

const ctx = await bootProductionProfile({
  binName: 'p4-05-terminal',
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
  const advances: string[] = []
  ctx.tools.register(defineContentToolFixture({
    name: 'p4_05_fail_run',
    description: 'advances the calling agent\'s Run to failed',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: (_args, exec) => {
      const runs = ctx.get('runs')
      const decision = exec.agent === undefined || runs === undefined
        ? 'no-agent-or-run-service'
        : runs.advance(exec.agent, 'failed', FAIL_REASON) ?? 'advanced'
      advances.push(decision)
      return Promise.resolve([{ type: 'text' as const, text: `advance: ${decision}` }])
    },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'p4_05_probe',
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
  if (agent === undefined) throw new Error('p4-05 terminal driver: no root agent after creation')

  let eventsSeen = 0
  const turns: TurnReading[] = []

  /**
   * Run one turn and read what it did.
   * @param label - the turn's name in the report.
   * @param task - the turn's task text, which carries the model's turn marker.
   */
  const turn = async (label: string, task: string): Promise<void> => {
    const runsBefore = probeRuns
    await runFixtureTurn(ctx, { task })
    const events = agent.session.snapshotEvents().slice(eventsSeen)
    eventsSeen += events.length
    turns.push({
      label,
      probeRan: probeRuns > runsBefore,
      stepStarts: events.filter(event => event.type === 'step/start').length,
      turnEndReasons: events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : []),
      results: events.flatMap(event => event.type !== 'tool/result' ? [] : [
        event.data.message.content.flatMap(block =>
          block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
      ]),
      lifecycleState: agent.lifecycle?.state ?? null,
      agentPresent: ctx.agents.roots().includes(agent),
    })
  }

  await turn('1: the probe alone', 'A-379 TURN-1: call the probe.')
  await turn('2: fail the run, then the probe, in one step', 'A-379 TURN-2: fail the run, then call the probe.')
  await turn('3: the probe again', 'A-379 TURN-3: call the probe.')

  process.stdout.write(`P4-05-TERMINAL ${JSON.stringify({ runService: ctx.get('runs') !== undefined, advances, turns })}\n`)
} finally {
  await ctx.fiber.dispose()
}

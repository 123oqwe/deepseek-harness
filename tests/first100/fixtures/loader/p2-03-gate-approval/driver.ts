/**
 * Driver for A-442's cases under P2-03 acceptance[2]: a tool call the risk gate
 * cannot classify, on the SHIPPED headless profile at its shipped default
 * preset, beside a classified control.
 *
 * It boots headless through `bootProductionProfile` with the originator cases'
 * overlay, leaves `DSH_PERMISSION_MODE` unset so the base layer's default
 * preset applies, pins the Trust Kernel the way `apps/cli/src/profile-boot.ts:577`
 * does, registers two probe tools that differ only in whether they declare
 * `riskDomainTags`, and answers every approval request `rejected` after
 * recording which tool it was about. The root agent is created after boot; one
 * turn calls the unclassified probe and a second calls the control. It prints
 * one `P2-03-GATE <json>` line read from the root session's log.
 * @module tests/first100/fixtures/loader/p2-03-gate-approval/driver
 */

import { randomUUID } from 'node:crypto'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import {
  CLASSIFIED_CALL,
  CLASSIFIED_TOOL,
  type GateApprovalReport,
  PROBE_RAN,
  UNCLASSIFIED_CALL,
  UNCLASSIFIED_TOOL,
} from './shared.ts'

const PROVIDER = 'p2-03-gate-approval-mock'

/** Text only the turns' tasks carry, followed by the probe the turn calls. */
const TASK_MARKER = 'A442-CALL'

/**
 * One scripted model answer. A turn's opening request calls the probe its task
 * names, the latest task deciding because both turns share one session; any
 * request after a tool result, and a request made for another purpose (a
 * session title), gets text.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  if (!opensTurn) return textResponse('done')
  const task = options.messages.flatMap(message => message.role !== 'user' ? [] : message.content.flatMap(block =>
    block.type === 'text' && block.text.includes(TASK_MARKER) ? [block.text] : [])).at(-1)
  if (task?.includes(`${TASK_MARKER} unclassified`) === true) return toolCallResponse(UNCLASSIFIED_CALL, UNCLASSIFIED_TOOL, {})
  if (task?.includes(`${TASK_MARKER} classified`) === true) return toolCallResponse(CLASSIFIED_CALL, CLASSIFIED_TOOL, {})
  return textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p2-03 gate-approval driver requires the overlay path')

const ctx = await bootProductionProfile({
  binName: 'p2-03-gate-approval',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  const runs = { unclassified: 0, classified: 0 }
  ctx.tools.register(defineContentToolFixture({
    name: UNCLASSIFIED_TOOL,
    description: 'a probe that declares nothing it touches and records that it ran',
    parameters: {},
    execute: () => {
      runs.unclassified += 1
      return Promise.resolve([{ type: 'text' as const, text: PROBE_RAN }])
    },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: CLASSIFIED_TOOL,
    description: 'a probe that reads the filesystem and records that it ran',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: () => {
      runs.classified += 1
      return Promise.resolve([{ type: 'text' as const, text: PROBE_RAN }])
    },
  }))

  const operatorAsked: string[] = []
  ctx.on('approval/request', (request) => {
    // The operator reads every request and rejects it. The shipped headless
    // profile's workspace-trust question arrives here too.
    operatorAsked.push(request.toolName)
    return Promise.resolve('rejected' as const)
  })

  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
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
  const root = ctx.agents.list()[0]
  if (root === undefined) throw new Error('p2-03 gate-approval driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: `${TASK_MARKER} unclassified: call ${UNCLASSIFIED_TOOL} once.` })
  await runFixtureTurn(ctx, { task: `${TASK_MARKER} classified: call ${CLASSIFIED_TOOL} once.` })

  const events = root.session.snapshotEvents()
  const outcomes = new Map(events.flatMap(event => event.type === 'approval/decided' ? [[event.data.id, event.data.outcome] as const] : []))
  const report: GateApprovalReport = {
    riskGated: events.flatMap(event => event.type !== 'action/risk-gated' ? [] : [{
      actionId: event.data.actionId,
      riskClass: event.data.riskClass,
      preset: event.data.preset,
      decision: event.data.decision,
    }]),
    asked: events.flatMap(event => event.type !== 'approval/asked' ? [] : [{
      toolName: event.data.toolName,
      reason: event.data.reason ?? null,
      outcome: outcomes.get(event.data.id) ?? null,
    }]),
    results: events.flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
      block.type !== 'tool-result' ? [] : [{
        callId: block.toolCallId,
        isError: block.isError ?? false,
        text: block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(''),
      }])),
    runs,
    operatorAsked,
  }
  process.stdout.write(`P2-03-GATE ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

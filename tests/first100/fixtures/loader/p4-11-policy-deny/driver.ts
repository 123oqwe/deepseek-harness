#!/usr/bin/env node
/**
 * Driver for P4-11 acceptance[0]'s policy-deny kind (A-423): boot the SHIPPED
 * headless profile over the overlay named on the command line, with the Trust
 * Kernel pinned as `apps/cli/src/profile-boot.ts` pins it, drive one call of a
 * probe tool tagged `a423-probe`, and report one `A423-RESULT` line: whether
 * the kernel is pinned, how many times the probe's body ran, every policy
 * decision the kernel audited for the probe call, what each agent's Run was
 * charged, and how many `llm/retry` and `llm/retry-started` events the
 * sessions hold.
 *
 * Built as the P2-05 unmount driver (`tests/first100/fixtures/P2-05.unmount-driver.ts`)
 * is: the root agent is created after boot, the model is a scripted adapter
 * registered here, and a request made for another purpose (a session title) is
 * answered with text so it cannot take the turn's tool call.
 * @module tests/first100/fixtures/loader/p4-11-policy-deny/driver
 */

import { randomUUID } from 'node:crypto'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('a423 driver requires an overlay path')

const PROVIDER = 'a423-mock'
const PROBE_TOOL = 'a423_probe'
const PROBE_CALL = 'a423-1'

/** The session events `llm-retry` appends when it retries (`packages/llm/llm-retry/src/index.ts:191`, `:193`). */
const RETRY_EVENTS: ReadonlySet<string> = new Set(['llm/retry', 'llm/retry-started'])

/** Every audit payload the kernel was handed, in order. */
const auditEntries: unknown[] = []

/** How many times the probe tool's own body ran. */
let probeRuns = 0

/**
 * One scripted model answer: the probe call for the turn's opening request,
 * text after the tool result and for any request made for another purpose.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions) {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn ? toolCallResponse(PROBE_CALL, PROBE_TOOL, {}) : textResponse('done')
}

/**
 * The probe call's audited policy decisions, in order.
 * @returns one entry per audit record whose `actionId` is the probe call.
 */
function probeDecisions(): { effect: unknown, reason: unknown, matched: unknown }[] {
  return auditEntries.flatMap((payload) => {
    const record = payload as { actionId?: unknown, decision?: { effect?: unknown, reason?: unknown }, matched?: unknown }
    return record.actionId === PROBE_CALL ? [{ effect: record.decision?.effect, reason: record.decision?.reason, matched: record.matched }] : []
  })
}

const ctx = await bootProductionProfile({
  binName: 'a423-policy-deny',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  // The real launcher's own two lines, with this observation's audit sink.
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({
      policyDecider: endorseComposedDecision,
      auditSink: (entry) => { auditEntries.push(entry.payload) },
    }))
  },
})
try {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a harmless probe that records that it ran',
    parameters: {},
    riskDomainTags: ['a423-probe'],
    execute: () => {
      probeRuns += 1
      return Promise.resolve([{ type: 'text' as const, text: 'probe ran' }])
    },
  }))
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  let turnError: string | null = null
  try {
    await runFixtureTurn(ctx, { task: 'run the probe' })
  } catch (error: unknown) {
    // Reported rather than rethrown, so the counts below are still read.
    turnError = error instanceof Error ? error.message : String(error)
  }
  const usage = ctx.get('runRetryUsage')
  const charged = ctx.agents.list().map((agent) => {
    const run = ctx.get('runs')?.runFor(agent)
    return { run: String(run?.id ?? 'none'), retriesUsed: run === undefined ? null : usage?.usageOf(run.id).retriesUsed ?? null }
  })
  const retryEvents = ctx.agents.list().flatMap(agent => agent.session.snapshotEvents())
    .filter(event => RETRY_EVENTS.has(event.type)).length
  process.stdout.write(`A423-RESULT ${JSON.stringify({
    trustKernel: ctx.get('trustKernel') !== undefined,
    probeRuns,
    decisions: probeDecisions(),
    charged,
    retryEvents,
    turnError,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}

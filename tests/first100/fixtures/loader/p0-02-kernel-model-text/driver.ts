/**
 * Driver for B-682, the model-visible half of P0-02 acceptance[1] (gate3
 * 2026-09-27T16:13:16Z): the Trust Kernel writes no text that a model request
 * carries.
 *
 * It boots the SHIPPED headless profile in-process through
 * `bootProductionProfile` over the P4-11 policy-deny overlay
 * (`../p4-11-policy-deny/deny.patch.yml`), which ships the permission row with
 * one deployment rule added: the `a423-probe` tag is `safety-critical`, so the
 * shipped `kernel-hard-deny` policy refuses it. It pins the kernel as
 * `apps/cli/src/profile-boot.ts` does, with an audit sink of its own, and
 * registers two probes: one declaring `filesystem-read`, which the kernel
 * allows, and one declaring `a423-probe`, which the kernel denies. The scripted
 * model calls the first, then the second, then answers with text; a request
 * made for another purpose (a session title) is answered with text.
 *
 * Every request the scripted adapter receives is reported with the fields the
 * model sees: the system prompt, each message's role and content blocks, and
 * the tool schemas. In the `control` run the literal named on the command line
 * follows {@link CONTROL_MARKER} in the task, in the permitted probe's
 * description and in its result, so the spec can show that its search finds a
 * kernel literal in each of those places. It prints one `P0-02-KERNEL-TEXT <json>` line.
 * @module tests/first100/fixtures/loader/p0-02-kernel-model-text/driver
 */

import { randomUUID } from 'node:crypto'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import {
  type AuditedDecision,
  CONTROL_MARKER,
  DENIED_CALL_ID,
  DENIED_TOOL,
  type KernelTextReport,
  PERMITTED_CALL_ID,
  PERMITTED_TOOL,
  RUN_KINDS,
  type RunKind,
} from './shared.ts'

const PROVIDER = 'b682-kernel-model-text-mock'

/**
 * Whether a command-line word names a run.
 * @param value - the word.
 * @returns true for a run.
 */
function isRunKind(value: string | undefined): value is RunKind {
  return RUN_KINDS.some(kind => kind === value)
}

const [configPath, run, literal] = process.argv.slice(2)
if (configPath === undefined || !isRunKind(run)) {
  throw new Error('p0-02 kernel model-text driver requires the overlay path and a run kind')
}
if (run === 'control' && (literal === undefined || literal === '')) {
  throw new Error('p0-02 kernel model-text driver: the control run requires the kernel literal to inject')
}
/** What the control appends to the task, the permitted probe's description and its result; empty when observing. */
const injected = run === 'control' ? ` ${CONTROL_MARKER}${literal ?? ''}` : ''

/** Every audit payload the kernel was handed, in order. */
const auditEntries: unknown[] = []

/** The call ids whose probe body ran. */
const ran: string[] = []

/**
 * One scripted model answer: the permitted probe before any tool result, the
 * denied probe after the first, text after the second and for any request made
 * for another purpose.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const results = options.messages.flatMap(message => message.content).filter(block => block.type === 'tool-result').length
  if (results === 0) return toolCallResponse(PERMITTED_CALL_ID, PERMITTED_TOOL, { note: 'from the model' })
  if (results === 1) return toolCallResponse(DENIED_CALL_ID, DENIED_TOOL, {})
  return textResponse('done')
}

/**
 * The policy decisions the kernel audited for the two probe calls, in order.
 * @returns one entry per audit record whose `actionId` is a probe call.
 */
function probeDecisions(): AuditedDecision[] {
  return auditEntries.flatMap((payload) => {
    const record = payload as { actionId?: unknown, decision?: { effect?: unknown, reason?: unknown } }
    const actionId = record.actionId
    return typeof actionId === 'string' && (actionId === PERMITTED_CALL_ID || actionId === DENIED_CALL_ID)
      ? [{ actionId, effect: record.decision?.effect, reason: record.decision?.reason }]
      : []
  })
}

const ctx = await bootProductionProfile({
  binName: 'b682-kernel-model-text',
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
  const adapter = new MockAdapter(Array.from({ length: 16 }, () => answer))
  ctx.llm.registerAdapter([PROVIDER], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: PERMITTED_TOOL,
    description: `a probe that reads nothing and records that it ran${injected}`,
    riskDomainTags: ['filesystem-read'],
    parameters: {
      note: { type: 'string', required: true, description: 'Free text; the probe ignores it.' },
    },
    execute: (_args, exec) => {
      ran.push(String(exec.callId))
      return Promise.resolve([{ type: 'text' as const, text: `probe ran${injected}` }])
    },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: DENIED_TOOL,
    description: 'a harmless probe that records that it ran',
    riskDomainTags: ['a423-probe'],
    parameters: {},
    execute: (_args, exec) => {
      ran.push(String(exec.callId))
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
  const root = ctx.agents.list()[0]
  if (root === undefined) throw new Error('p0-02 kernel model-text driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: `B682: call ${PERMITTED_TOOL}, then ${DENIED_TOOL}.${injected}` })

  const report: KernelTextReport = {
    run,
    kernelPinned: ctx.get('trustKernel') !== undefined,
    ran,
    decisions: probeDecisions(),
    results: root.session.snapshotEvents().flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
      block.type !== 'tool-result' ? [] : [{
        callId: String(block.toolCallId),
        isError: block.isError ?? false,
        text: block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(''),
      }])),
    requests: adapter.requests.map(options => ({
      purpose: options.purpose ?? null,
      system: options.system ?? null,
      messages: options.messages.map(message => ({ role: message.role, content: message.content })),
      tools: options.tools ?? [],
    })),
  }
  process.stdout.write(`P0-02-KERNEL-TEXT ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

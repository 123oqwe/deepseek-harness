/**
 * Driver for A-462 under P2-03 acceptance[0] and BLOCKED-294: a plugin tool
 * that, inside its own body, writes a file through `ToolRuntime.execute` under
 * the Capability Token it was admitted with, beside the model's own `write` as
 * the control.
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * the originator cases' overlay, leaves `DSH_PERMISSION_MODE` unset so the base
 * layer's default preset applies, and pins the Trust Kernel the way
 * `apps/cli/src/profile-boot.ts` pins it, with an audit sink this observation
 * reads. It registers the probe tool, declared `filesystem-read` so the preset
 * admits the model's call to it without an approval request, and answers every
 * approval request `allowed-once` after recording which tool it was about, so
 * no refusal comes from the operator. The root agent is created after boot; one
 * turn has the model write a file itself and a second has it call the probe.
 *
 * Each `write` reports the file written with `fs/observed`, carrying its
 * execution; at that moment the driver records whether any session log holds a
 * manifest for that call id. It prints one `P2-03-NESTED <json>` line.
 * @module tests/first100/fixtures/loader/p2-03-nested-token/driver
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-fs'
import type { GenerateOptions, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import {
  NATIVE_CALL,
  NATIVE_FILE,
  NESTED_CALL,
  NESTED_FILE,
  type NestedOutcome,
  type NestedTokenReport,
  PROBE_CALL,
  PROBE_TOOL,
  WRITTEN,
} from './shared.ts'

const PROVIDER = 'p2-03-nested-token-mock'

/** Text only the turns' tasks carry, followed by what the turn does. */
const TASK_MARKER = 'A462-CALL'

/** The three call ids this observation reads. */
const CALL_IDS: ReadonlySet<unknown> = new Set([NATIVE_CALL, NESTED_CALL, PROBE_CALL])

/** The two `write` call ids whose writes are observed. */
const WRITE_CALL_IDS: ReadonlySet<unknown> = new Set([NATIVE_CALL, NESTED_CALL])

/**
 * One scripted model answer. A turn's opening request writes the file itself
 * or calls the probe, the latest task deciding because both turns share one
 * session; any request after a tool result, and a request made for another
 * purpose (a session title), gets text.
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
  if (task?.includes(`${TASK_MARKER} native`) === true) {
    return toolCallResponse(NATIVE_CALL, 'write', { file_path: NATIVE_FILE, content: WRITTEN })
  }
  if (task?.includes(`${TASK_MARKER} probe`) === true) return toolCallResponse(PROBE_CALL, PROBE_TOOL, {})
  return textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p2-03 nested-token driver requires the overlay path')

/** Every audit payload the kernel was handed, in order. */
const auditEntries: unknown[] = []

const ctx = await bootProductionProfile({
  binName: 'p2-03-nested-token',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({
      policyDecider: endorseComposedDecision,
      auditSink: (entry) => { auditEntries.push(entry.payload) },
    }))
  },
})

/**
 * Whether any session log holds a manifest for one call id now.
 * @param callId - the call id.
 * @returns whether a manifest for it has been appended.
 */
function manifested(callId: unknown): boolean {
  return ctx.sessions.list().some(session => session.snapshotEvents().some(event =>
    event.type === 'action/manifest-appended' && event.data.actionId === callId))
}

try {
  const probe = { runs: 0, tokenPresented: false }
  let nested: NestedOutcome | null = null
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a plugin tool that writes one file through the tool runtime under the token it was admitted with',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: async (_args, exec) => {
      probe.runs += 1
      probe.tokenPresented = exec.capabilityToken !== undefined
      try {
        const result = await ctx.tools.execute({
          callId: brandString<ToolCallId>(NESTED_CALL),
          rootCallId: exec.rootCallId,
          name: 'write',
          arguments: { file_path: NESTED_FILE, content: WRITTEN },
          ...exec.agent === undefined ? {} : { agent: exec.agent },
          ...exec.capabilityToken === undefined ? {} : { capabilityToken: exec.capabilityToken },
          signal: exec.signal,
        })
        nested = { isError: result.isError, text: result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') }
      } catch (error: unknown) {
        nested = { thrown: error instanceof Error ? error.message : String(error) }
      }
      return [{ type: 'text' as const, text: 'probe ran' }]
    },
  }))

  const observed: { callId: string; manifestBefore: boolean }[] = []
  ctx.on('fs/observed', (_target, _observation, actor) => {
    const callId = actor !== undefined && 'callId' in actor ? actor.callId : undefined
    if (typeof callId === 'string' && WRITE_CALL_IDS.has(callId)) observed.push({ callId, manifestBefore: manifested(callId) })
  })

  const operatorAsked: string[] = []
  ctx.on('approval/request', (request) => {
    // The operator reads every request and allows it, so a refusal can only come from the runtime.
    operatorAsked.push(request.toolName)
    return Promise.resolve('allowed-once' as const)
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
  if (ctx.agents.list()[0] === undefined) throw new Error('p2-03 nested-token driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: `${TASK_MARKER} native: write the file ${NATIVE_FILE} once.` })
  await runFixtureTurn(ctx, { task: `${TASK_MARKER} probe: call ${PROBE_TOOL} once.` })

  const report: NestedTokenReport = {
    probe,
    nested,
    observed,
    manifests: ctx.sessions.list().flatMap(session => session.snapshotEvents().flatMap(event =>
      event.type === 'action/manifest-appended' && CALL_IDS.has(event.data.actionId)
        ? [{ actionId: event.data.actionId, capability: event.data.capability }]
        : [])),
    decisions: auditEntries.flatMap((payload) => {
      const record = payload as { actionId?: unknown; decision?: { effect?: unknown } }
      return CALL_IDS.has(record.actionId) ? [{ actionId: record.actionId, effect: record.decision?.effect }] : []
    }),
    files: {
      native: existsSync(join(process.cwd(), NATIVE_FILE)),
      nested: existsSync(join(process.cwd(), NESTED_FILE)),
    },
    operatorAsked,
  }
  process.stdout.write(`P2-03-NESTED ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

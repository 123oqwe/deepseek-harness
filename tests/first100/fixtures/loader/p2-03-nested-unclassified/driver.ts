/**
 * Driver for A-471 under P2-03 acceptance[2] and BLOCKED-294: on the SHIPPED
 * headless profile at its default preset, a tool call the risk gate cannot
 * classify, made by the model itself (the control) and nested by a plugin tool
 * through `ToolRuntime.execute` under the Capability Token it was admitted
 * with.
 *
 * It boots headless through `bootProductionProfile` with the originator cases'
 * overlay, leaves `DSH_PERMISSION_MODE` unset so the base layer's default
 * preset applies, and pins the Trust Kernel the way `apps/cli/src/profile-boot.ts`
 * pins it. It registers the writer (no risk domain tags; its body writes one
 * file) and the probe (declared `filesystem-read`, so the preset admits the
 * model's call to it without an approval request) before the root agent is
 * created, and answers every approval request `rejected` after recording the
 * turn and the tool. One turn has the model call the writer, a second has it
 * call the probe. It prints one `P2-03-NESTED-UNCLASSIFIED <json>` line.
 * @module tests/first100/fixtures/loader/p2-03-nested-unclassified/driver
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
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
  DIRECT_CALL,
  NESTED_CALL,
  type NestedUnclassifiedReport,
  type Phase,
  PROBE_CALL,
  PROBE_TOOL,
  WRITER_TOOL,
} from './shared.ts'

const PROVIDER = 'p2-03-nested-unclassified-mock'

/** Text only the turns' tasks carry, followed by the call the turn makes. */
const TASK_MARKER = 'A471-CALL'

/**
 * One scripted model answer. A turn's opening request calls the tool its task
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
  if (task?.includes(`${TASK_MARKER} direct`) === true) return toolCallResponse(DIRECT_CALL, WRITER_TOOL, {})
  if (task?.includes(`${TASK_MARKER} probe`) === true) return toolCallResponse(PROBE_CALL, PROBE_TOOL, {})
  return textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p2-03 nested-unclassified driver requires the overlay path')

const ctx = await bootProductionProfile({
  binName: 'p2-03-nested-unclassified',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  let phase: Phase = 'direct'
  const runs: { phase: Phase; callId: string }[] = []
  const probe: { tokenPresented: boolean; nested: NestedUnclassifiedReport['probe']['nested'] } = { tokenPresented: false, nested: null }
  ctx.tools.register(defineContentToolFixture({
    name: WRITER_TOOL,
    description: 'a tool that declares nothing it touches and writes one file',
    parameters: {},
    execute: (_args, exec) => {
      runs.push({ phase, callId: String(exec.callId) })
      writeFileSync(join(process.cwd(), `a471-written-${phase}.txt`), 'written\n')
      return Promise.resolve([{ type: 'text' as const, text: 'writer ran' }])
    },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a plugin tool that calls the writer through the tool runtime under the token it was admitted with',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: async (_args, exec) => {
      probe.tokenPresented = exec.capabilityToken !== undefined
      try {
        const result = await ctx.tools.execute({
          callId: brandString<ToolCallId>(NESTED_CALL),
          rootCallId: exec.rootCallId,
          name: WRITER_TOOL,
          arguments: {},
          ...exec.agent === undefined ? {} : { agent: exec.agent },
          ...exec.capabilityToken === undefined ? {} : { capabilityToken: exec.capabilityToken },
          signal: exec.signal,
        })
        probe.nested = { isError: result.isError, text: result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') }
      } catch (error: unknown) {
        probe.nested = { thrown: error instanceof Error ? error.message : String(error) }
      }
      return [{ type: 'text' as const, text: 'probe ran' }]
    },
  }))

  const operatorAsked: { phase: Phase; toolName: string }[] = []
  ctx.on('approval/request', (request) => {
    // The operator reads every request and rejects it.
    operatorAsked.push({ phase, toolName: request.toolName })
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
  if (root === undefined) throw new Error('p2-03 nested-unclassified driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: `${TASK_MARKER} direct: call ${WRITER_TOOL} once.` })
  phase = 'nested'
  await runFixtureTurn(ctx, { task: `${TASK_MARKER} probe: call ${PROBE_TOOL} once.` })

  const events = root.session.snapshotEvents()
  const outcomes = new Map(events.flatMap(event => event.type === 'approval/decided' ? [[event.data.id, event.data.outcome] as const] : []))
  const report: NestedUnclassifiedReport = {
    runs,
    operatorAsked,
    asked: events.flatMap(event => event.type !== 'approval/asked' ? [] : [{
      toolName: event.data.toolName,
      outcome: outcomes.get(event.data.id) ?? null,
    }]),
    riskGated: events.flatMap(event => event.type !== 'action/risk-gated' ? [] : [{
      actionId: event.data.actionId,
      riskClass: event.data.riskClass,
      decision: event.data.decision,
    }]),
    probe,
  }
  process.stdout.write(`P2-03-NESTED-UNCLASSIFIED ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

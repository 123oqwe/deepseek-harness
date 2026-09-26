/**
 * Driver for A-472 under P4-07 and BLOCKED-334: on the SHIPPED headless
 * profile at its default preset, an emergency stop raised while a plugin tool
 * is executing, then a `write` that tool nests through `ToolRuntime.execute`
 * under its inherited Capability Token, beside the model's own `write` after
 * the stop as the control.
 *
 * It boots headless through `bootProductionProfile` with the originator cases'
 * overlay, leaves `DSH_PERMISSION_MODE` unset so the base layer's default
 * preset applies, and pins the Trust Kernel the way `apps/cli/src/profile-boot.ts`
 * pins it. The probe tool is declared `filesystem-read`, so the preset admits
 * the model's call to it. Inside its body it asks the shipped control plane for
 * `pause-new-actions` as an operator, then nests the `write`. In the same turn
 * the model calls `write` itself once it has the probe's result. It prints one
 * `P4-07-NESTED-AFTER-STOP <json>` line.
 * @module tests/first100/fixtures/loader/p4-07-nested-after-stop/driver
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { stopGateFor } from '@deepseek-ai/dsh-agent'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-control-plane/plugin'
import type { GenerateOptions, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import {
  NATIVE_CALL,
  NATIVE_FILE,
  NESTED_CALL,
  NESTED_FILE,
  type NestedAfterStopReport,
  PROBE_CALL,
  PROBE_TOOL,
} from './shared.ts'

const PROVIDER = 'p4-07-nested-after-stop-mock'

/**
 * One scripted model answer: the turn's opening request calls the probe; the
 * request after the probe's result calls `write`; any other request, a session
 * title's among them, gets text.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  if (last?.role !== 'user') return textResponse('done')
  const results = last.content.flatMap(block => block.type === 'tool-result' ? [block.toolCallId] : [])
  if (results.length === 0) return toolCallResponse(PROBE_CALL, PROBE_TOOL, {})
  if (results.some(id => id === PROBE_CALL)) return toolCallResponse(NATIVE_CALL, 'write', { file_path: NATIVE_FILE, content: 'A-472\n' })
  return textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p4-07 nested-after-stop driver requires the overlay path')

const ctx = await bootProductionProfile({
  binName: 'p4-07-nested-after-stop',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  let stopDecision: string | null = null
  let nested: NestedAfterStopReport['nested'] = null
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a plugin tool that raises the emergency stop and then writes one file through the tool runtime',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: async (_args, exec) => {
      // An operator stops the run while this tool is executing.
      stopDecision = JSON.stringify(ctx.controlPlane.control('pause-new-actions', {
        requestedBy: brandString<PrincipalId>('a472-operator'),
        reason: 'human-requested',
        requestedAtMs: Date.now(),
      }))
      try {
        const result = await ctx.tools.execute({
          callId: brandString<ToolCallId>(NESTED_CALL),
          rootCallId: exec.rootCallId,
          name: 'write',
          arguments: { file_path: NESTED_FILE, content: 'A-472\n' },
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
  if (root === undefined) throw new Error('p4-07 nested-after-stop driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: 'A472: call the probe, then write the file.' })

  const report: NestedAfterStopReport = {
    stopDecision,
    stopGate: stopGateFor(root),
    nested,
    results: root.session.snapshotEvents().flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
      block.type !== 'tool-result' ? [] : [{
        callId: block.toolCallId,
        isError: block.isError ?? false,
        text: block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(''),
      }])),
    files: {
      nested: existsSync(join(process.cwd(), NESTED_FILE)),
      native: existsSync(join(process.cwd(), NATIVE_FILE)),
    },
  }
  process.stdout.write(`P4-07-NESTED-AFTER-STOP ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

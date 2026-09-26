/**
 * Driver for A-473 under P4-07 and BLOCKED-334: on the SHIPPED headless
 * profile at its default preset, the Run's lease taken by another worker while
 * a plugin tool is executing, then a `write` that tool nests through
 * `ToolRuntime.execute` under its inherited Capability Token, beside the
 * model's own `write` after the takeover as the control.
 *
 * It boots headless through `bootProductionProfile` with the originator cases'
 * overlay, leaves `DSH_PERMISSION_MODE` unset so the base layer's default
 * preset applies, and pins the Trust Kernel the way `apps/cli/src/profile-boot.ts`
 * pins it. The probe tool is declared `filesystem-read`, so the preset admits
 * the model's call to it. Inside its body it acquires the Run's work item in
 * the shipped lease store as another worker, at a time past the current lease,
 * the store call a second host's scheduler makes, then nests the `write`. In
 * the same turn the model calls `write` itself once it has the probe's result.
 * It prints one `P4-07-NESTED-AFTER-TAKEOVER <json>` line.
 * @module tests/first100/fixtures/loader/p4-07-nested-after-takeover/driver
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkerId, WorkItemId } from '@deepseek-ai/dsh-lease-contract'
import type { GenerateOptions, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
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
  type NestedAfterTakeoverReport,
  PROBE_CALL,
  PROBE_TOOL,
} from './shared.ts'

const PROVIDER = 'p4-07-nested-after-takeover-mock'

/** The lease term the other worker takes, long enough to outlast the turn. */
const TAKEOVER_LEASE_MS = 60_000

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
  if (results.some(id => id === PROBE_CALL)) return toolCallResponse(NATIVE_CALL, 'write', { file_path: NATIVE_FILE, content: 'A-473\n' })
  return textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p4-07 nested-after-takeover driver requires the overlay path')

const ctx = await bootProductionProfile({
  binName: 'p4-07-nested-after-takeover',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  let takeover: NestedAfterTakeoverReport['takeover'] = null
  let nested: NestedAfterTakeoverReport['nested'] = null
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a plugin tool that lets another worker take the run and then writes one file through the tool runtime',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: async (_args, exec) => {
      if (exec.agent === undefined) throw new Error('the probe ran with no agent')
      // A second host's scheduler takes the Run's work item once its lease has lapsed.
      const workItem = brandString<WorkItemId>(exec.agent.id)
      const held = ctx.leaseStore.get(workItem)
      const stolen = ctx.leaseStore.acquire(workItem, brandString<WorkerId>('a473-second-host'), (held?.expiresAtMs ?? Date.now()) + 1, TAKEOVER_LEASE_MS)
      takeover = { held: held !== undefined, acquired: stolen.acquired }
      try {
        const result = await ctx.tools.execute({
          callId: brandString<ToolCallId>(NESTED_CALL),
          rootCallId: exec.rootCallId,
          name: 'write',
          arguments: { file_path: NESTED_FILE, content: 'A-473\n' },
          agent: exec.agent,
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
  if (root === undefined) throw new Error('p4-07 nested-after-takeover driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: 'A473: call the probe, then write the file.' })

  const report: NestedAfterTakeoverReport = {
    takeover,
    mayWrite: root.runLease === undefined ? null : root.runLease.mayWrite(Date.now()),
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
  process.stdout.write(`P4-07-NESTED-AFTER-TAKEOVER ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

/**
 * Driver for A-443's cases under BLOCKED-315 closing condition 1: how the
 * manifest classifies a probe call, and whether the risk gate asks about it,
 * on the SHIPPED headless profile at its shipped default preset, through the
 * native path or the code-mode path.
 *
 * It boots headless through `bootProductionProfile` with the originator cases'
 * overlay, leaves `DSH_PERMISSION_MODE` unset so the base layer's default
 * preset applies, sets `DSH_TOOLS_MODE=ptc` first in code mode, pins the Trust
 * Kernel the way `apps/cli/src/profile-boot.ts:577` does, and registers two
 * probe tools that differ only in whether they declare `riskDomainTags`. The
 * operator allows `run_code` and rejects every other question. `native` runs
 * one turn per probe; `code-mode` runs one turn whose `run_code` program calls
 * both. It prints one `P2-03-MANIFEST <json>` line read from the root session's
 * log.
 * @module tests/first100/fixtures/loader/p2-03-manifest-class/driver
 */

import { randomUUID } from 'node:crypto'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import {
  CLASSIFIED_TOOL,
  MANIFEST_CLASS_MODES,
  type ManifestClassMode,
  type ManifestClassReport,
  UNCLASSIFIED_TOOL,
} from './shared.ts'

const PROVIDER = 'p2-03-manifest-class-mock'

/** Text only the turns' tasks carry, followed by what the turn calls. */
const TASK_MARKER = 'A443-CALL'

/** The code-mode program: call each probe once, the unclassified one first, and report what happened. */
const PROGRAM = [
  'const outcomes = []',
  `try { await tools.${UNCLASSIFIED_TOOL}({}); outcomes.push('unclassified: ran') }`,
  "catch (error) { outcomes.push('unclassified: ' + (error instanceof Error ? error.message : String(error))) }",
  `try { await tools.${CLASSIFIED_TOOL}({}); outcomes.push('classified: ran') }`,
  "catch (error) { outcomes.push('classified: ' + (error instanceof Error ? error.message : String(error))) }",
  "return outcomes.join('\\n')",
].join('\n')

/**
 * One scripted model answer. A turn's opening request calls what its task
 * names, the latest task deciding because every turn shares one session; any
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
  if (task?.includes(`${TASK_MARKER} unclassified`) === true) return toolCallResponse('a443-unclassified-call', UNCLASSIFIED_TOOL, {})
  if (task?.includes(`${TASK_MARKER} classified`) === true) return toolCallResponse('a443-classified-call', CLASSIFIED_TOOL, {})
  if (task?.includes(`${TASK_MARKER} program`) === true) {
    return toolCallResponse('a443-run-code', RUN_CODE_NAME, { code: PROGRAM, description: 'call each probe once' })
  }
  return textResponse('done')
}

/**
 * Whether a command-line word names a mode.
 * @param value - the word.
 * @returns true for a mode.
 */
function isMode(value: string | undefined): value is ManifestClassMode {
  return MANIFEST_CLASS_MODES.some(mode => mode === value)
}

const [configPath, mode] = process.argv.slice(2)
if (configPath === undefined || !isMode(mode)) throw new Error('p2-03 manifest-class driver requires the overlay path and a mode')
if (mode === 'code-mode') process.env.DSH_TOOLS_MODE = 'ptc'

const ctx = await bootProductionProfile({
  binName: 'p2-03-manifest-class',
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
      return Promise.resolve([{ type: 'text' as const, text: 'probe ran' }])
    },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: CLASSIFIED_TOOL,
    description: 'a probe that reads the filesystem and records that it ran',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: () => {
      runs.classified += 1
      return Promise.resolve([{ type: 'text' as const, text: 'probe ran' }])
    },
  }))

  const operatorAsked: string[] = []
  ctx.on('approval/request', (request) => {
    // The operator allows `run_code`, which declares no risk domain tags, so
    // the program can reach the probes, and rejects every other question,
    // including the shipped headless profile's workspace-trust question.
    operatorAsked.push(request.toolName)
    return Promise.resolve(request.toolName === RUN_CODE_NAME ? 'allowed-once' as const : 'rejected' as const)
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
  if (root === undefined) throw new Error('p2-03 manifest-class driver: no root agent after creation')
  if (mode === 'native') {
    await runFixtureTurn(ctx, { task: `${TASK_MARKER} unclassified: call ${UNCLASSIFIED_TOOL} once.` })
    await runFixtureTurn(ctx, { task: `${TASK_MARKER} classified: call ${CLASSIFIED_TOOL} once.` })
  } else {
    await runFixtureTurn(ctx, { task: `${TASK_MARKER} program: call each probe once from one program.` })
  }

  const probes: ReadonlySet<string> = new Set([UNCLASSIFIED_TOOL, CLASSIFIED_TOOL])
  const events = root.session.snapshotEvents()
  const outcomes = new Map(events.flatMap(event => event.type === 'approval/decided' ? [[event.data.id, event.data.outcome] as const] : []))
  const report: ManifestClassReport = {
    mode,
    manifests: events.flatMap(event => event.type !== 'action/manifest-appended' || !probes.has(event.data.capability) ? [] : [{
      capability: event.data.capability,
      origin: event.data.origin,
      sideEffectClass: event.data.sideEffectClass,
      classified: event.data.classified,
      requiresApproval: event.data.requiresApproval,
    }]),
    riskGated: events.flatMap(event => event.type !== 'action/risk-gated' ? [] : [{
      actionId: event.data.actionId,
      riskClass: event.data.riskClass,
      preset: event.data.preset,
      decision: event.data.decision,
    }]),
    asked: events.flatMap(event => event.type !== 'approval/asked' ? [] : [{
      toolName: event.data.toolName,
      outcome: outcomes.get(event.data.id) ?? null,
    }]),
    runs,
    operatorAsked,
  }
  process.stdout.write(`P2-03-MANIFEST ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

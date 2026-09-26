/**
 * Driver for BLOCKED-294's cases under P2-05 acceptance[0]: the public
 * `ToolRuntime.execute` seam, called directly the way a plugin would call it,
 * beside the model's own call as the control.
 *
 * It writes one file into its working directory, boots the SHIPPED headless
 * profile through `bootProductionProfile` with the originator cases' overlay
 * under `danger-full-access`, pins the Trust Kernel the way
 * `apps/cli/src/profile-boot.ts` pins it with an audit sink this observation
 * reads, registers a keyless scripted model, and creates the root agent after
 * boot. Then, in one process:
 * 1. the model reads the file through the agent loop (the control);
 * 2. a direct `ctx.tools.execute` reads it on behalf of the root agent;
 * 3. a direct `ctx.tools.execute` reads it with no agent, as
 *    `docs/cordis-tutorial/07-into-the-harness.md` teaches.
 *
 * It prints one `P2-05-DIRECT <json>` line: every manifest the session appended
 * for the three call ids, every decision the kernel audited for them, and what
 * each direct call returned or threw.
 * @module tests/first100/fixtures/loader/p2-05-direct-seam/driver
 */

import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GenerateOptions, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { DIRECT_AGENT_CALL, DIRECT_PLAIN_CALL, NATIVE_CALL, READ_FILE, READ_LINE } from './shared.ts'

const PROVIDER = 'p2-05-direct-seam-mock'

/** The three call ids this observation reads. */
const CALL_IDS: ReadonlySet<unknown> = new Set([NATIVE_CALL, DIRECT_AGENT_CALL, DIRECT_PLAIN_CALL])

/** What one direct call returned, or the message it threw. */
interface DirectOutcome {
  readonly callId: string
  readonly isError?: boolean
  readonly text?: string
  readonly thrown?: string
}

/** What the driver prints. */
interface Report {
  readonly manifests: readonly { readonly actionId: string; readonly capability: string }[]
  readonly decisions: readonly { readonly actionId: unknown; readonly effect: unknown }[]
  readonly direct: readonly DirectOutcome[]
}

/**
 * One scripted model answer: the root turn's opening request reads the file,
 * and every other request, a session title's among them, gets text.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn ? toolCallResponse(NATIVE_CALL, 'read', { file_path: READ_FILE }) : textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p2-05 direct-seam driver requires the overlay path')

await writeFile(join(process.cwd(), READ_FILE), `${READ_LINE}\n`)
process.env.DSH_PERMISSION_MODE = 'danger-full-access'

/** Every audit payload the kernel was handed, in order. */
const auditEntries: unknown[] = []

const ctx = await bootProductionProfile({
  binName: 'p2-05-direct-seam',
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
 * Read the file through the direct seam.
 * @param callId - the call id to issue.
 * @param agent - the agent the call runs on behalf of, or none, as the tutorial calls it.
 * @returns what the call returned, or the message it threw.
 */
async function direct(callId: string, agent: Agent | undefined): Promise<DirectOutcome> {
  try {
    const result = await ctx.tools.execute({
      callId: brandString<ToolCallId>(callId),
      name: 'read',
      arguments: { file_path: READ_FILE },
      ...agent === undefined ? {} : { agent },
      signal: new AbortController().signal,
    })
    return { callId, isError: result.isError, text: result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') }
  } catch (error: unknown) {
    return { callId, thrown: error instanceof Error ? error.message : String(error) }
  }
}

try {
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
  if (root === undefined) throw new Error('p2-05 direct-seam driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: `Read the file ${READ_FILE} once.` })
  const outcomes = [await direct(DIRECT_AGENT_CALL, root), await direct(DIRECT_PLAIN_CALL, undefined)]
  const report: Report = {
    manifests: ctx.sessions.list().flatMap(session => session.snapshotEvents().flatMap(event =>
      event.type === 'action/manifest-appended' && CALL_IDS.has(event.data.actionId)
        ? [{ actionId: event.data.actionId, capability: event.data.capability }]
        : [])),
    decisions: auditEntries.flatMap((payload) => {
      const record = payload as { actionId?: unknown; decision?: { effect?: unknown } }
      return CALL_IDS.has(record.actionId) ? [{ actionId: record.actionId, effect: record.decision?.effect }] : []
    }),
    direct: outcomes,
  }
  process.stdout.write(`P2-05-DIRECT ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

/**
 * Driver for B-672's dispatch cases, the P0-02 red first (BLOCKED-306
 * condition [2], C19 §2): with no Trust Kernel pinned and no insecure opt-in,
 * a tool dispatch is refused on the native path and from a `run_code` program.
 *
 * It boots the SHIPPED headless profile in-process through
 * `bootProductionProfile` with the originator cases' overlay, which turns off
 * the rows that would run a task of their own. `runProfile` is not used: the
 * launcher always pins a kernel and refuses to start when it cannot, so no
 * launch ever dispatches without one. The refusal this driver observes is the
 * dispatch paths' own, which an embedder that calls `boot()` directly relies
 * on. The driver deletes `DSH_TRUST_KERNEL_INSECURE`, pins a kernel only in the
 * `pinned` state (as `apps/cli/src/profile-boot.ts` does), and sets
 * `DSH_TOOLS_MODE=ptc` in code mode.
 *
 * It registers a probe that declares `filesystem-read`, which the shipped risk
 * rules classify `read`, so the preset asks no approval for it. The operator
 * allows `run_code`, which declares no tag, and rejects every other question,
 * the shipped headless profile's workspace-trust question among them. The
 * scripted model calls the probe directly in native mode, and from one
 * `run_code` program in code mode. It prints one `P0-02-NO-KERNEL <json>` line.
 *
 * In direct mode (B-675) no turn runs: the driver, holding the context as a
 * plugin does, calls the probe through the public `ToolRuntime.execute` seam
 * twice, once on behalf of the root agent and once with no agent. The call on
 * behalf of the agent presents the session's capability token when a token
 * service issued one, which only happens with a kernel pinned: the shipped
 * token service signs with the kernel and arms the token requirement only then.
 * @module tests/first100/fixtures/loader/p0-02-no-kernel-dispatch/driver
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-capability-token'
import type { GenerateOptions, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture, RUN_CODE_NAME, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import {
  DIRECT_AGENT_CALL_ID,
  DIRECT_PLAIN_CALL_ID,
  type DirectOutcome,
  DISPATCH_MODES,
  type DispatchMode,
  KERNEL_STATES,
  type KernelState,
  NATIVE_CALL_ID,
  type NoKernelReport,
  PROBE_TOOL,
  RUN_CODE_CALL_ID,
} from './shared.ts'

const PROVIDER = 'p0-02-no-kernel-dispatch-mock'

/**
 * Whether a command-line word names a dispatch mode.
 * @param value - the word.
 * @returns true for a mode.
 */
function isMode(value: string | undefined): value is DispatchMode {
  return DISPATCH_MODES.some(mode => mode === value)
}

/**
 * Whether a command-line word names a kernel state.
 * @param value - the word.
 * @returns true for a kernel state.
 */
function isKernelState(value: string | undefined): value is KernelState {
  return KERNEL_STATES.some(state => state === value)
}

const [configPath, mode, kernel] = process.argv.slice(2)
if (configPath === undefined || !isMode(mode) || !isKernelState(kernel)) {
  throw new Error('p0-02 no-kernel dispatch driver requires the overlay path, a dispatch mode, and a kernel state')
}
// Outside the explicit opt-in whatever the parent environment says.
delete process.env.DSH_TRUST_KERNEL_INSECURE
if (mode === 'code-mode') process.env.DSH_TOOLS_MODE = 'ptc'

/** The code-mode program: call the probe once and report how the call ended. */
const PROGRAM = [
  `try { await tools.${PROBE_TOOL}({ note: 'from a program' }); return 'ran' }`,
  'catch (error) { return error instanceof Error ? error.message : String(error) }',
].join('\n')

/**
 * One scripted model answer: a turn's opening request calls the probe (native)
 * or `run_code` (code mode); any request after a tool result, and a request
 * made for another purpose (a session title), gets text.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  if (!opensTurn) return textResponse('done')
  return mode === 'native'
    ? toolCallResponse(NATIVE_CALL_ID, PROBE_TOOL, { note: 'from the model' })
    : toolCallResponse(RUN_CODE_CALL_ID, RUN_CODE_NAME, { code: PROGRAM, description: 'call the probe once' })
}

/**
 * Pin a kernel as the launcher does, before any entry mounts.
 * @param prepared - the context `boot()` is about to mount the tree on.
 */
function pinKernel(prepared: Context): void {
  pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
}

const ctx = await bootProductionProfile({
  binName: 'p0-02-no-kernel-dispatch',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  ...kernel === 'pinned' ? { prepare: pinKernel } : {},
})

/**
 * Call the probe through the public seam, as a plugin holding the context does.
 * @param callId - the call id to issue.
 * @param agent - the agent the call runs on behalf of, or none.
 * @param capabilityToken - the token the call presents, or none.
 * @returns what the call returned, or the message it threw.
 */
async function callDirectly(
  callId: string,
  agent: Agent | undefined,
  capabilityToken: ToolExecutionInput['capabilityToken'],
): Promise<DirectOutcome> {
  try {
    const result = await ctx.tools.execute({
      callId: brandString<ToolCallId>(callId),
      name: PROBE_TOOL,
      arguments: { note: 'from a plugin' },
      ...agent === undefined ? {} : { agent },
      ...capabilityToken === undefined ? {} : { capabilityToken },
      signal: new AbortController().signal,
    })
    return { callId, isError: result.isError, text: result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') }
  } catch (error: unknown) {
    return { callId, thrown: error instanceof Error ? error.message : String(error) }
  }
}

try {
  const runs: string[] = []
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a probe that reads nothing and records that it ran',
    riskDomainTags: ['filesystem-read'],
    parameters: {
      note: { type: 'string', required: true, description: 'Free text; the probe ignores it.' },
    },
    execute: (_args, exec) => {
      runs.push(String(exec.callId))
      return Promise.resolve([{ type: 'text' as const, text: 'probe ran' }])
    },
  }))

  ctx.on('approval/request', (request) => {
    if (request.toolName === RUN_CODE_NAME) return Promise.resolve('allowed-once' as const)
    return Promise.resolve('rejected' as const)
  })

  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 8 }, () => answer)))
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
  if (root === undefined) throw new Error('p0-02 no-kernel dispatch driver: no root agent after creation')
  const direct: DirectOutcome[] = []
  if (mode === 'direct') {
    const tokens = ctx.get('capabilityTokens')
    const capabilityToken = tokens === undefined ? undefined : await tokens.whenSessionToken(root.id)
    direct.push(await callDirectly(DIRECT_AGENT_CALL_ID, root, capabilityToken))
    direct.push(await callDirectly(DIRECT_PLAIN_CALL_ID, undefined, undefined))
  } else {
    await runFixtureTurn(ctx, { task: `B672-CALL: call ${PROBE_TOOL} once.` })
  }

  const report: NoKernelReport = {
    mode,
    kernel,
    runs,
    results: root.session.snapshotEvents().flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
      block.type !== 'tool-result' ? [] : [{
        callId: String(block.toolCallId),
        isError: block.isError ?? false,
        text: block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(''),
      }])),
    direct,
  }
  process.stdout.write(`P0-02-NO-KERNEL ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

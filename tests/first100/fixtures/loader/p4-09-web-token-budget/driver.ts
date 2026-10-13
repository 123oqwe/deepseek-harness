/**
 * Driver for the P4-09 Web token-budget case (blind review U-2; acceptance[3]
 * "total budget is bounded" on the Web app). It boots the SHIPPED `web` profile
 * (dsh-base + dsh-web-app) in process, with only the port-binding host rows off,
 * and composes one agent from the shipped `standard` preset the way the Web
 * session controller does (`ctx.agents.create({ setup: agentPresets.mount })`).
 * That preset runs the workflow engine and the `workflow` tool inside its
 * `isolate: { workflowEngine, savedWorkflows }` delegation group; the engine keeps
 * its shipped default tree allowance (`maxNestedTokens`, 1,000,000).
 *
 * The agent calls the `workflow` tool with a script that starts two in-process
 * children one after the other. Each child's single response reports
 * {@link CHILD_INPUT_TOKENS} input tokens, more than the tree allowance. When the
 * preset engine meters its children, the first child's usage spends the tree's
 * allowance and the second start is refused `token-budget-exhausted`; when it
 * cannot read token-meter's `tokenUsage` projection, it warns once, meters
 * nothing, and both children run.
 * @module tests/first100/fixtures/loader/p4-09-web-token-budget/driver
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-workflow'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { CHILD_INPUT_TOKENS, CHILD_SENTINEL, REPORT_PREFIX, WORKFLOW_TOOL, type WebTokenBudgetReport } from './shared.ts'

const PROVIDER = 'p409u2-mock'
const WF_CALL_ID = 'p409u2-wf-call'
const ROUTE = `{ provider: ${JSON.stringify(PROVIDER)}, model: ${JSON.stringify(PROVIDER)} }`

/** Two children in sequence; a refused start is returned, not thrown, so the result carries its reason. */
const SCRIPT = [
  'const ran = []',
  "for (const label of ['first', 'second']) {",
  `  try { await agent(label + ' ${CHILD_SENTINEL}', ${ROUTE}); ran.push(label) }`,
  "  catch (error) { return 'refused at ' + label + ': ' + String(error) }",
  '}',
  "return 'all ran: ' + ran.join(',')",
].join('\n')

/** Model requests served to each child, by label. */
const served = { first: 0, second: 0 }

/**
 * The text of every text block in `blocks`.
 * @param blocks - message content blocks.
 * @returns the texts, in order.
 */
function textsIn(blocks: readonly unknown[]): string[] {
  return (blocks as readonly { readonly type: string; readonly text?: string }[])
    .flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : [])
}

/**
 * One child response whose usage reports {@link CHILD_INPUT_TOKENS} input tokens.
 * @param text - the response text.
 * @returns the scripted chunks.
 */
function spendingResponse(text: string): StreamChunk[] {
  return textResponse(text).map((chunk): StreamChunk => chunk.type === 'usage'
    ? { type: 'usage', usage: { inputTokens: CHILD_INPUT_TOKENS, outputTokens: text.length } }
    : chunk)
}

/**
 * The scripted model: a child (its prompt carries {@link CHILD_SENTINEL}) answers
 * once with a spending response; the agent opens its turn with the `workflow`
 * call and ends it once the call has a result.
 * @param options - the generate request.
 * @returns the scripted chunks.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const texts = options.messages.flatMap(message => textsIn(message.content))
  const child = texts.find(text => text.includes(CHILD_SENTINEL))
  if (child !== undefined) {
    if (child.includes(`second ${CHILD_SENTINEL}`)) served.second += 1
    else served.first += 1
    return spendingResponse('child done')
  }
  const last = options.messages.at(-1)
  if (last?.role !== 'user' || last.content.some(block => block.type === 'tool-result')) return textResponse('done')
  return toolCallResponse(WF_CALL_ID, WORKFLOW_TOOL, {
    script: SCRIPT,
    meta: { name: 'p409u2-two-children', description: 'two children that each spend the tree token allowance', phases: [] },
  })
}

/** The tool result texts the log recorded for `callId`, in order. */
function resultTextsFor(events: readonly SessionEvent[], callId: string): string[] {
  return events.flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
    block.type === 'tool-result' && String(block.toolCallId) === callId
      ? [block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('')]
      : []))
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p4-09-web-token-budget driver requires a config path')

// Settings, storages and sessions stay under the run's temporary directory.
process.env.DSH_HOME = join(process.cwd(), '.dsh')

const ctx: Context = await bootProductionProfile({
  binName: 'p4-09-web-token-budget',
  profile: 'web',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
    // The disabled `connection` row owns the HTTP server; its in-process
    // registries are what the host rows need (as web-agent-presets.e2e.ts does).
    prepared.provide('connection', { fetch: { register: () => () => {} }, rpc: { intercept: () => () => {} } } as never)
    provideCmdline(prepared, { args: [], exit: () => {} })
  },
})

try {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 40 }, () => answer)))
  const identity = (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
    `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
  )
  let presetComposed = false
  const handle = await ctx.agents.create({
    sessionId: SessionId(`p409u2-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: {
      provider: PROVIDER,
      model: PROVIDER,
      ...identity === undefined ? {} : { identity },
    },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => { presetComposed = true }),
  })
  const workflowToolOffered = ctx.tools.schemas(handle.agent).some(schema => schema.name === WORKFLOW_TOOL)
  await runFixtureTurn(ctx, { task: 'P4-09 U-2: run the two-child workflow.' })
  const texts = resultTextsFor(handle.agent.session.snapshotEvents(), WF_CALL_ID)
  const report: WebTokenBudgetReport = {
    presetComposed,
    workflowToolOffered,
    rootEngineAbsent: ctx.get('workflowEngine') === undefined,
    workflowDispatched: texts.length > 0,
    resultText: (texts.at(-1) ?? '').slice(0, 1500),
    firstServed: served.first,
    secondServed: served.second,
  }
  process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

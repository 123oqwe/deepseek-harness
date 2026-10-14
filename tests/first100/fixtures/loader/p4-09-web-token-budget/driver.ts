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
 *
 * Progress lines go to stderr (`P4-09-WEB-TOKBUD-PHASE`): boot, the preset mount
 * and whether its saved-workflow loader settled, every session event and model
 * request, and the turn's end. runLoaderSmoke puts the whole stderr in its
 * timeout error, so a run that hangs shows where.
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

/** When the driver started; each progress line carries the time since. */
const startedAt = Date.now()

/**
 * Write one progress line to stderr. runLoaderSmoke puts the driver's whole
 * stderr in its timeout error, so a run that hangs shows the last line it reached.
 * @param what - the step reached.
 */
function phase(what: string): void {
  process.stderr.write(`${REPORT_PREFIX}-PHASE +${String(Date.now() - startedAt)}ms ${what}\n`)
}

/**
 * Resolve to `promise`'s value, or to `fallback` once `ms` passed, without holding the process open.
 * @param promise - what to wait for.
 * @param ms - the bound.
 * @param fallback - the value when the bound passes first.
 * @returns the first of the two.
 */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => { setTimeout(() => { resolve(fallback) }, ms).unref() })])
}

/**
 * The `settled` promise of a saved-workflow loader, when `loader` carries one.
 * @param loader - what the agent's context resolved for `savedWorkflows`.
 * @returns the promise, or `undefined` when there is no loader or it has none.
 */
function settledOf(loader: unknown): Promise<unknown> | undefined {
  if (typeof loader !== 'object' || loader === null || !('settled' in loader)) return undefined
  return loader.settled instanceof Promise ? loader.settled : undefined
}

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

/**
 * {@link answer}, writing each request and the scripted answer as a progress line.
 * @param options - the generate request.
 * @returns what {@link answer} returns.
 */
function answerAndLog(options: GenerateOptions): StreamChunk[] {
  const chunks = answer(options)
  const answered = chunks.flatMap(chunk => chunk.type === 'block-end' ? [chunk.block] : [])
    .map(block => block.type === 'tool-call' ? `tool-call ${block.name}` : block.type === 'text' ? block.text : block.type)
    .join(' | ')
  phase(`model request purpose=${options.purpose ?? '-'} messages=${String(options.messages.length)} answered=${answered}`)
  return chunks
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

phase('driver started; boot start')
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
phase('booted')

try {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 40 }, () => answerAndLog)))
  // Every session event, tagged by session, so a run that hangs shows the last event it reached.
  const sessionTags = new Map<string, string>()
  ctx.on('session/event', (session, event) => {
    const id = String(session.id)
    const tag = sessionTags.get(id) ?? `s${String(sessionTags.size)}`
    sessionTags.set(id, tag)
    phase(`event ${tag} ${event.type}`)
  })
  const identity = (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
    `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
  )
  let presetComposed = false
  phase('agent create start')
  const handle = await ctx.agents.create({
    sessionId: SessionId(`p409u2-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: {
      provider: PROVIDER,
      model: PROVIDER,
      ...identity === undefined ? {} : { identity },
    },
    setup: async (agentCtx) => {
      phase('preset mount start')
      await ctx.agentPresets.mount(agentCtx, 'standard')
      presetComposed = true
      // The workflow tool's pre-step waits for the saved-workflow loader to settle.
      const settled = settledOf(agentCtx.get('savedWorkflows', false))
      const state = settled === undefined
        ? 'absent from the agent context'
        : await within(settled.then(() => 'settled', () => 'rejected'), 5_000, 'pending after 5s')
      phase(`preset mounted; savedWorkflows ${state}`)
    },
  })
  const workflowToolOffered = ctx.tools.schemas(handle.agent).some(schema => schema.name === WORKFLOW_TOOL)
  phase(`agent created; workflow tool offered=${String(workflowToolOffered)}; turn start`)
  await runFixtureTurn(ctx, { task: 'P4-09 U-2: run the two-child workflow.' })
  phase('turn idle')
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
  phase('report written')
} finally {
  phase('dispose start')
  await ctx.fiber.dispose()
  phase('disposed')
}

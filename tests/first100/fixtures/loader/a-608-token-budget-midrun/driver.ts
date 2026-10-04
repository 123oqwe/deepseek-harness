/**
 * Driver for A-608 (B-714 red first) under P4-09 acceptance[3] on the SHIPPED
 * headless composition: a RUNNING in-process nested child that overspends its
 * tree's token allowance must be aborted mid-run with `token-budget-exhausted`.
 *
 * The root agent calls the shipped `workflow` tool with a script that nests one
 * `agent()` child. The child runs in-process (so its token usage is metered) and
 * calls a low-risk burn tool across MULTIPLE steps; each model response reports
 * usage, and the tree allowance (`maxNestedTokens`, set to {@link MAX_NESTED_TOKENS}
 * by the overlay) is smaller than a single response's usage. The script captures
 * the child's outcome and returns it as the `workflow` tool result.
 *
 * Today the host checks the token budget only when a child STARTS (host.ts:520)
 * and debits it only AFTER the child settles (host.ts:667), so the overspending
 * child runs to completion — the result is `{ ok: true }` and the burn tool ran
 * both steps. RED today. After B-714 the running child is aborted the step it
 * overspends: the result carries `token-budget-exhausted` and the burn tool ran
 * once. §21.4: the fix is not read.
 * @module tests/first100/fixtures/loader/a-608-token-budget-midrun/driver
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { BURN_TOOL, CHILD_BURN_PROMPT, REPORT_PREFIX, WORKFLOW_TOOL, type TokenBudgetReport } from './shared.ts'

const PROVIDER = 'a608-mock'
const WF_CALL_ID = 'a608-wf-call'
const BURN_META = { name: 'a608-burn', description: 'burns tree tokens in a nested agent', phases: [] }

/** The burn log: the burn tool appends one line per run; its line count is how many steps ran. */
const burnLog = (): string => join(process.cwd(), 'a608-burn.log')

/** The workflow script: nest one child that burns tokens, and return its outcome serialized. */
const BURN_SCRIPT = [
  'let out',
  'try {',
  `  const r = await agent(${JSON.stringify(CHILD_BURN_PROMPT)}, { provider: ${JSON.stringify(PROVIDER)}, model: ${JSON.stringify(PROVIDER)} })`,
  '  out = JSON.stringify({ ok: true, out: r })',
  '} catch (e) {',
  '  out = JSON.stringify({ ok: false, err: String((e && e.message) || e) })',
  '}',
  'return out',
].join('\n')

/** Every block across all messages, for counting the child's prior burn tool-results. */
function blocksOf(options: GenerateOptions): { type: string; text?: string }[] {
  return (options.messages ?? []).flatMap(message => (message.content ?? []) as { type: string; text?: string }[])
}

/**
 * The dual-context scripted model: the CHILD turn (its prompt carries the burn
 * sentinel) calls the burn tool twice then ends; the ROOT turn calls the
 * `workflow` tool once with the burn script, then ends.
 * @param options - the generate request.
 * @returns the scripted chunks.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const blocks = blocksOf(options)
  const isChild = blocks.some(block => block.type === 'text' && (block.text ?? '').includes('A608_CHILD_BURN'))
  if (isChild) {
    const priorBurns = blocks.filter(block => block.type === 'tool-result').length
    return priorBurns < 2
      ? toolCallResponse(`a608-burn-${priorBurns}`, BURN_TOOL, {})
      : textResponse('child finished burning')
  }
  const last = options.messages?.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn
    ? toolCallResponse(WF_CALL_ID, WORKFLOW_TOOL, { script: BURN_SCRIPT, meta: BURN_META })
    : textResponse('done')
}

/** The tool result texts the log recorded for `callId`, in order. */
function resultTextsFor(events: readonly SessionEvent[], callId: string): string[] {
  return events.flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
    block.type === 'tool-result' && String(block.toolCallId) === callId
      ? [block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('')]
      : []))
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('a-608 driver requires a config path')

const ctx: Context = await bootProductionProfile({
  binName: 'a-608-token-budget-midrun',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 12 }, () => answer)))
  ctx.tools.register(defineContentToolFixture({
    name: BURN_TOOL,
    description: 'a low-risk step the burning child calls once per step',
    // `filesystem-read` maps to the `read` class (shipped riskRules), so the
    // child's call needs no approval — the budget, not the risk gate, decides.
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: () => {
      appendFileSync(burnLog(), 'burn\n')
      return Promise.resolve([{ type: 'text' as const, text: 'burned' }])
    },
  }))
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  await runFixtureTurn(ctx, { task: 'A-608: run the token-burning workflow.' })
  const agent = ctx.agents.list()[0]
  if (agent === undefined) throw new Error('a-608 driver: no root agent after the turn')
  const events = agent.session.snapshotEvents()
  const workflowResultText = resultTextsFor(events, WF_CALL_ID).at(-1) ?? ''
  const burnRuns = existsSync(burnLog()) ? readFileSync(burnLog(), 'utf8').split('\n').filter(line => line === 'burn').length : 0
  const report: TokenBudgetReport = {
    workflowDispatched: events.some(event => event.type === 'tool/result'
      && event.data.message.content.some(block => block.type === 'tool-result' && String(block.toolCallId) === WF_CALL_ID)),
    workflowResultText: workflowResultText.slice(0, 1000),
    childTokenBudgetExhausted: /token-budget-exhausted/u.test(workflowResultText),
    burnRuns,
  }
  process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

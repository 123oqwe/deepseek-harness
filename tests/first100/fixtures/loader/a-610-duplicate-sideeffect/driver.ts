/**
 * Driver for A-610 (B-726 red-first) under P4-12 acceptance[0] ("zero duplicate
 * external effects") and acceptance[1] ("an ambiguous entry is not blindly
 * retried; it enters reconciliation"). It reuses the A-600 crash harness
 * (orchestrate/before/after over `spawnSync` with a shared `DSH_HOME` and
 * `./.sessions`, resume through `ctx.agents.resume`) and adds three modes, each
 * launched by the spec in its OWN temp `DSH_HOME` so one red does not mask another:
 *
 * - `resend-newid` (cases ① + ②): `before` reserves + marks `sent` an external
 *   effect and hangs its body, then is SIGKILLed (the entry is stuck `sent`).
 *   `after` resumes, and — as the HOST USER through the `/resolve-effect` command,
 *   not the ledger's private getter — reads whether the stuck key is waiting for
 *   reconciliation (②). It then re-issues the SAME action under a DIFFERENT call
 *   id (a new idempotency key), and reads how many times the body ran and what
 *   result the model got (①). A second body run is a duplicate external effect.
 * - `settle` (the `/resolve-effect` settle + ③-a): the same crash, then `after`
 *   settles the ambiguous entry as `confirmed` through `/resolve-effect` (a stub
 *   answerer approves), confirms it no longer waits, and re-issues the same action
 *   under a new id — which, the settled entry being done, executes as a new action.
 * - `different-params` (③-b, no crash): one launch whose model calls the tool with
 *   unrelated arguments; it executes normally. A liveness control, green always.
 *
 * `before`'s body hangs so the kill lands on a `sent` entry; `after`'s body never
 * hangs, so a re-send that is NOT held completes rather than stalling the phase
 * (the A-588c lesson). Red first for B-726 (§21.4: the fix is not read).
 * @module tests/first100/fixtures/loader/a-610-duplicate-sideeffect/driver
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-action-ledger'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { CHARGE_TOOL, CONTROL_CALL_ID, ORIGINAL_CALL_ID, REPORT_PREFIX, RESEND_CALL_ID, type ControlReport, type ResendReport, type SettleReport } from './shared.ts'

const PROVIDER = 'p4-12-dup-mock'
/** The line prefix one phase reports under. */
const PHASE_TAG = 'P4-12-DUP-PHASE'
/** The shipped Run lease (`run` row default) plus two seconds, so a killed process's lease lapses before the resume. */
const CRASH_RESTART_DELAY_MS = 32_000
/** Longest wait for the tool body to be reached in `before`. */
const TOOL_REACH_MS = 30_000
/** Polling interval. */
const POLL_MS = 25
/** Deadline for one phase process. */
const PHASE_TIMEOUT_MS = 120_000
/** Deadline for a host command dispatched from `after`. */
const COMMAND_TIMEOUT_MS = 20_000

/** The file the tool body appends one line to per run; its line count is how many times the body ran across the whole run. */
const runsFile = (): string => join(process.cwd(), 'tool-runs.log')

/** The host `/resolve-effect` command surface, as far as this driver dispatches it. */
interface CommandPort {
  execute(
    agent: unknown,
    line: string,
    attachments: readonly unknown[],
    signal: AbortSignal,
  ): Promise<{ readonly result: { readonly kind: string; readonly text?: string } } | undefined>
}

/**
 * Poll until `done` holds or `timeoutMs` passes.
 * @param done - the condition.
 * @param timeoutMs - the longest wait.
 * @returns whether the condition held.
 */
async function until(done: () => boolean, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
    if (done()) return true
    await delay(POLL_MS)
  }
  return done()
}

/**
 * One scripted model answer: open a turn with the charge call under `callId` and
 * `args`, and give text once a tool result has come back.
 * @param callId - the call id this phase's opening charge uses.
 * @param args - the charge arguments.
 * @returns the stub answer function.
 */
function answerWith(callId: string, args: Record<string, string>): (options: GenerateOptions) => StreamChunk[] {
  return (options: GenerateOptions): StreamChunk[] => {
    if (options.purpose !== undefined) return textResponse('ok')
    const last = options.messages.at(-1)
    const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
    return opensTurn ? toolCallResponse(callId, CHARGE_TOOL, args) : textResponse('done')
  }
}

/**
 * Register the scripted model and the external-effect fixture tool.
 * @param ctx - the booted root context.
 * @param callId - the call id the model's opening charge uses.
 * @param args - the charge arguments.
 * @param hang - whether the body hangs after recording its run (only `before` hangs).
 */
function registerModelAndTool(ctx: Context, callId: string, args: Record<string, string>, hang: boolean): void {
  const answer = answerWith(callId, args)
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 8 }, () => answer)))
  ctx.tools.register(defineContentToolFixture({
    name: CHARGE_TOOL,
    description: 'an external effect the ledger reserves',
    // `network-fetch` classifies to `external-communication` (base cordis.patch.yml:368),
    // a real external effect the ledger reserves, below workspace-write's ask threshold.
    riskDomainTags: ['network-fetch'],
    parameters: { amount: { type: 'string', required: true, description: 'The amount to charge.' } },
    execute: async () => {
      appendFileSync(runsFile(), 'run\n')
      if (hang) await new Promise<never>(() => {})
      return [{ type: 'text' as const, text: 'charged' }]
    },
  }))
}

/** The appended manifest's ledger scope and key for the earliest call, or null before it appends. */
function firstScopeKey(events: readonly SessionEvent[]): { scope: string | null; key: string | null } {
  const data = events.find(event => event.type === 'action/manifest-appended')?.data as { actor?: unknown; idempotencyKey?: unknown } | undefined
  return {
    scope: typeof data?.actor === 'string' ? data.actor : null,
    key: typeof data?.idempotencyKey === 'string' ? data.idempotencyKey : null,
  }
}

/** Every appended manifest's idempotency key, in order. */
function manifestKeys(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type === 'action/manifest-appended'
    && typeof (event.data as { idempotencyKey?: unknown }).idempotencyKey === 'string'
    ? [(event.data as { idempotencyKey: string }).idempotencyKey] : [])
}

/** The tool result texts the log recorded for `callId`, in order. */
function resultTextsFor(events: readonly SessionEvent[], callId: string): string[] {
  return events.flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
    block.type === 'tool-result' && String(block.toolCallId) === callId
      ? [block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('')]
      : []))
}

/** The tool body's run count on disk. */
function toolRuns(): number {
  return existsSync(runsFile()) ? readFileSync(runsFile(), 'utf8').split('\n').filter(line => line === 'run').length : 0
}

/** The resumed host-user agent, or throw when no root agent is present. */
function hostAgent(ctx: Context): { id: unknown; identity?: unknown; session: { snapshotEvents(): readonly SessionEvent[] } } {
  const agent = ctx.agents.list()[0]
  if (agent === undefined) throw new Error('a-610 driver: no root agent')
  return agent
}

/** Dispatch `/resolve-effect` as the host user and return its text. */
async function resolveEffect(ctx: Context, agent: unknown, line: string): Promise<{ kind: string; text: string }> {
  const commands = ctx.get('commands') as unknown as CommandPort | undefined
  if (commands === undefined) return { kind: 'error', text: '(no commands service mounted)' }
  const execution = await commands.execute(agent, line, [], AbortSignal.timeout(COMMAND_TIMEOUT_MS))
  return { kind: execution?.result.kind ?? 'error', text: execution?.result.text ?? '(no result)' }
}

/** The `before` phase: reserve + mark `sent`, reach the hanging body, then SIGKILL. */
async function before(ctx: Context): Promise<void> {
  registerModelAndTool(ctx, ORIGINAL_CALL_ID, { amount: '10' }, true)
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const agent = hostAgent(ctx)
  const sessionId = String(agent.id)
  void runFixtureTurn(ctx, { task: `A-610: call ${CHARGE_TOOL} once.` }).catch(() => undefined)
  const toolReached = await until(() => existsSync(runsFile()), TOOL_REACH_MS)
  const { scope, key } = firstScopeKey(agent.session.snapshotEvents())
  writeSync(1, `${PHASE_TAG} ${JSON.stringify({ sessionId, scope, key, entryStateBeforeKill: scope !== null && key !== null ? ctx.actionLedger.entry(scope as never, key)?.state ?? null : null, toolReached })}\n`)
  process.kill(process.pid, 'SIGKILL')
}

/** Resume the crashed session and return its host-user agent. */
async function resume(ctx: Context, sessionId: SessionId, callId: string): Promise<ReturnType<typeof hostAgent>> {
  registerModelAndTool(ctx, callId, { amount: '10' }, false)
  await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: { provider: PROVIDER, model: PROVIDER } })
  return hostAgent(ctx)
}

/** The `resend-newid` after phase: read the ambiguous list, then re-send under a new id (cases ① + ②). */
async function afterResend(ctx: Context, sessionId: SessionId, key: string): Promise<void> {
  const agent = await resume(ctx, sessionId, RESEND_CALL_ID)
  const listed = await resolveEffect(ctx, agent, '/resolve-effect')
  const ambiguousBeforeResend = listed.text.includes(key)
  await runFixtureTurn(ctx, { task: `A-610: call ${CHARGE_TOOL} once more.` })
  const events = agent.session.snapshotEvents()
  const reading: ResendReport['after']['reading'] = {
    ambiguousBeforeResend,
    resolveListText: listed.text,
    resendResultText: resultTextsFor(events, RESEND_CALL_ID).at(-1) ?? '',
    resendKey: manifestKeys(events).find(candidate => candidate !== key) ?? null,
    toolRuns: toolRuns(),
  }
  writeSync(1, `${PHASE_TAG} ${JSON.stringify(reading)}\n`)
}

/** The `settle` after phase: settle the ambiguous entry through `/resolve-effect`, then re-send the same action (settle + ③-a). */
async function afterSettle(ctx: Context, sessionId: SessionId, key: string): Promise<void> {
  // A stub host-user answerer approves the reconciliation prompt; headless mounts none.
  ctx.on('approval/request', () => Promise.resolve<'allowed-once'>('allowed-once'))
  const agent = await resume(ctx, sessionId, RESEND_CALL_ID)
  const settle = await resolveEffect(ctx, agent, `/resolve-effect ${key} confirmed`)
  const listed = await resolveEffect(ctx, agent, '/resolve-effect')
  await runFixtureTurn(ctx, { task: `A-610: call ${CHARGE_TOOL} once more.` })
  const reading: SettleReport['after']['reading'] = {
    settleResultKind: settle.kind,
    settleResultText: settle.text,
    ambiguousAfterSettle: listed.text.includes(key),
    postSettleToolRuns: toolRuns(),
    postSettleResultText: resultTextsFor(agent.session.snapshotEvents(), RESEND_CALL_ID).at(-1) ?? '',
  }
  writeSync(1, `${PHASE_TAG} ${JSON.stringify(reading)}\n`)
}

/** The `different-params` single phase: one unrelated call executes normally (③-b, no crash). */
async function single(ctx: Context): Promise<void> {
  registerModelAndTool(ctx, CONTROL_CALL_ID, { amount: '99' }, false)
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const agent = hostAgent(ctx)
  await runFixtureTurn(ctx, { task: `A-610 control: call ${CHARGE_TOOL} with unrelated arguments.` })
  const reading: ControlReport['single']['reading'] = {
    toolRuns: toolRuns(),
    resultText: resultTextsFor(agent.session.snapshotEvents(), CONTROL_CALL_ID).at(-1) ?? '',
  }
  writeSync(1, `${PHASE_TAG} ${JSON.stringify(reading)}\n`)
}

/**
 * Run one phase in a fresh process launched the way this one was.
 * @param args - the phase's arguments after the script path.
 * @returns how it exited and what it reported.
 */
function runPhase(args: readonly string[]): { status: number | null; signal: string | null; reading: Record<string, unknown> } {
  const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    timeout: PHASE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024 * 1024,
  })
  const json = new RegExp(`${PHASE_TAG} (?<json>.+)`, 'u').exec(result.stdout)?.groups?.json
  if (json === undefined) {
    throw new Error(`a-610 phase ${args.join(' ')} reported nothing (status ${String(result.status)}, signal ${String(result.signal)}); stderr tail:\n${result.stderr.slice(-1500)}`)
  }
  return { status: result.status, signal: result.signal, reading: JSON.parse(json) as Record<string, unknown> }
}

const [configPath, phase, mode, sessionArg, keyArg] = process.argv.slice(2)
if (configPath === undefined) throw new Error('a-610 driver requires a config path')

if (phase === 'orchestrate') {
  if (mode === 'different-params') {
    const only = runPhase([configPath, 'single', mode])
    const report: ControlReport = { mode: 'different-params', single: only as ControlReport['single'] }
    process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify(report)}\n`)
  } else if (mode === 'resend-newid' || mode === 'settle') {
    const first = runPhase([configPath, 'before', mode])
    const reading = first.reading as { sessionId: string; scope: string | null; key: string | null }
    if (reading.scope === null || reading.key === null) {
      throw new Error(`a-610 ${mode}: the before phase did not reserve a ledger entry; reading: ${JSON.stringify(reading)}`)
    }
    await delay(CRASH_RESTART_DELAY_MS)
    const second = runPhase([configPath, 'after', mode, reading.sessionId, reading.key])
    const report = { mode, before: first, after: second } as unknown as ResendReport | SettleReport
    process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify(report)}\n`)
  } else {
    throw new Error(`a-610 driver: unknown mode ${String(mode)}`)
  }
} else if (phase === 'before' || phase === 'after' || phase === 'single') {
  const ctx = await bootProductionProfile({
    binName: 'p4-12-duplicate-sideeffect',
    profile: 'headless',
    overlayPaths: [resolveConfigPath(configPath, undefined)],
    prepare: (prepared) => {
      pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
    },
  })
  try {
    if (phase === 'before') {
      await before(ctx)
    } else if (phase === 'single') {
      await single(ctx)
    } else {
      if (sessionArg === undefined || keyArg === undefined) throw new Error('a-610 driver: `after` requires the session id and key')
      if (mode === 'settle') await afterSettle(ctx, SessionId(sessionArg), keyArg)
      else await afterResend(ctx, SessionId(sessionArg), keyArg)
    }
  } finally {
    await ctx.fiber.dispose()
  }
} else {
  throw new Error(`a-610 driver: unknown phase ${String(phase)}`)
}

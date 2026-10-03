/**
 * Driver for A-600 (第33题, for B-720): P4-12 acceptance[1] — an external effect
 * reserved and marked `sent` but not confirmed when the process is killed must,
 * on a replay by the resumed session, become `ambiguous` and go to reconciliation
 * (`listAmbiguous`), with the model told the outcome is unknown; it must NOT be
 * answered as a plain duplicate ("already sent"). Red first for B-720 (§21.4: the
 * fix is not read).
 *
 * One host restart is two processes, so the driver runs in three phases, modelled
 * on the P4-06 settlement-crash driver (orchestrate/before/after over `spawnSync`
 * with a shared `DSH_HOME` and `./.sessions`, resume through `ctx.agents.resume`):
 *
 * - `before` boots the SHIPPED headless profile, creates the agent after boot, and
 *   drives one turn whose scripted model calls an external-effect fixture tool.
 *   The native dispatch RESERVES and marks the ledger entry `sent` BEFORE the
 *   tool body runs (external-effect.ts:341); the body appends to a runs log and
 *   then HANGS. The driver waits until the body is reached (the entry is now
 *   `sent`), records the ledger scope/key from the appended manifest, writes its
 *   reading synchronously and SIGKILLs — the confirm never runs, so the entry is
 *   stuck `sent`.
 * - `after` boots the same profile over the same `DSH_HOME`, resumes the session
 *   the way the Web host does (crash repair first gives the unresolved call a
 *   synthetic `TOOL_OUTCOME_UNKNOWN` result — recorded as background), and prompts
 *   it so the scripted model re-issues the SAME call id. That re-issue presents the
 *   same idempotency key (session, actionId = call id, argumentsHash), so the
 *   ledger sees the stuck `sent` entry. It reads the entry's state, whether it is
 *   in the ambiguous list, the result the model got for the replay, and how many
 *   times the tool body ran.
 * - `orchestrate` runs `before`, waits past the Run lease, runs `after`, and prints
 *   one `P4-12-REPLAY-CRASH <json>` line.
 * @module tests/first100/fixtures/loader/p4-12-replay-crash/driver
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
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { CALL_ID, CHARGE_TOOL, REPORT_PREFIX, type ReplayReport } from './shared.ts'

const PROVIDER = 'p4-12-replay-crash-mock'
/** The line prefix one phase reports under. */
const PHASE_TAG = 'P4-12-REPLAY-CRASH-PHASE'
/** The shipped Run lease (`run` row default) plus two seconds, so a killed process's lease lapses before the resume. */
const CRASH_RESTART_DELAY_MS = 32_000
/** Longest wait for the tool body to be reached in `before`. */
const TOOL_REACH_MS = 30_000
/** Polling interval. */
const POLL_MS = 25
/** Deadline for one phase process. */
const PHASE_TIMEOUT_MS = 120_000

/** The file the tool body appends one line to per run; its line count is how many times the body ran across the whole run. */
const runsFile = (): string => join(process.cwd(), 'tool-runs.log')

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
 * One scripted model answer: open a turn with the external-effect call (the same
 * call id every time, so the replay presents the same idempotency key), and give
 * text once a tool result has come back.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
const answer = (options: GenerateOptions): StreamChunk[] => {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn ? toolCallResponse(CALL_ID, CHARGE_TOOL, { amount: '10' }) : textResponse('done')
}

/**
 * Register the scripted model and the external-effect fixture tool whose body
 * appends a run line and then hangs (so a kill in `before` leaves the reservation
 * `sent`; in `after` the replay is refused before the body, so it never hangs).
 * @param ctx - the booted root context.
 */
function registerModelAndTool(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 8 }, () => answer)))
  ctx.tools.register(defineContentToolFixture({
    name: CHARGE_TOOL,
    description: 'an external effect whose body hangs',
    parameters: { amount: { type: 'string', required: true, description: 'The amount to charge.' } },
    execute: async () => {
      appendFileSync(runsFile(), 'run\n')
      // Hang: the reservation is `sent` by now (reserve + markSent run before the
      // body), so a SIGKILL here leaves it stuck `sent` with no confirm.
      await new Promise<never>(() => {})
      return [{ type: 'text' as const, text: 'charged' }]
    },
  }))
}

/** The appended manifest's ledger scope and key for the one call, or null before it appends. */
function scopeKeyOf(events: readonly SessionEvent[]): { scope: string | null; key: string | null } {
  const data = events.find(event => event.type === 'action/manifest-appended')?.data as { actor?: unknown; idempotencyKey?: unknown } | undefined
  return {
    scope: typeof data?.actor === 'string' ? data.actor : null,
    key: typeof data?.idempotencyKey === 'string' ? data.idempotencyKey : null,
  }
}

/** The tool result texts the log recorded for `CALL_ID`, in order. */
function resultTextsFor(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
    block.type === 'tool-result' && String(block.toolCallId) === CALL_ID
      ? [block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('')]
      : []))
}

/** This workspace's ledger entry for one scope/key; `scope` is a `PrincipalId` the manifest carries as a plain string. */
function entryState(ctx: Context, scope: string, key: string): string | null {
  return ctx.actionLedger.entry(scope as never, key)?.state ?? null
}

/** Whether the ledger holds an `ambiguous` entry for this scope/key, read through the store the plugin wraps. */
function inAmbiguousList(ctx: Context, scope: string, key: string): boolean {
  const ledger = ctx.get('actionLedger') as unknown as { store?: { listAmbiguous?: (scope: string) => readonly { key: string }[] } } | undefined
  return ledger?.store?.listAmbiguous?.(scope)?.some(entry => entry.key === key) ?? false
}

/** The `before` phase: reserve + mark `sent`, reach the hanging body, then SIGKILL. */
async function before(ctx: Context): Promise<void> {
  registerModelAndTool(ctx)
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const agent = ctx.agents.list()[0]
  if (agent === undefined) throw new Error('p4-12 replay-crash driver: no root agent after creation')
  const sessionId = String(agent.id)
  // Fire the turn without awaiting it: the tool body hangs, so the turn never
  // settles; the process is killed once the body is reached.
  void runFixtureTurn(ctx, { task: `A-600: call ${CHARGE_TOOL} once.` }).catch(() => undefined)
  const toolReached = await until(() => existsSync(runsFile()), TOOL_REACH_MS)
  const { scope, key } = scopeKeyOf(agent.session.snapshotEvents())
  const entryStateBeforeKill = scope !== null && key !== null ? entryState(ctx, scope, key) : null
  writeSync(1, `${PHASE_TAG} ${JSON.stringify({ sessionId, scope, key, entryStateBeforeKill, toolReached })}\n`)
  process.kill(process.pid, 'SIGKILL')
}

/** The `after` phase: resume, replay the same call id, and read the ledger and the result. */
async function after(ctx: Context, sessionId: SessionId, scope: string, key: string): Promise<void> {
  registerModelAndTool(ctx)
  const { agent } = await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: { provider: PROVIDER, model: PROVIDER } })
  // Crash repair gave the unresolved call a synthetic result on resume — read it
  // before the replay as background.
  const syntheticResult = resultTextsFor(agent.session.snapshotEvents()).at(-1) ?? null
  // Prompt the resumed session: the scripted model re-issues the same call id, a
  // replay the ledger meets with the stuck `sent` entry.
  await runFixtureTurn(ctx, { task: `A-600: call ${CHARGE_TOOL} once more.` })
  const replayResultText = resultTextsFor(agent.session.snapshotEvents()).at(-1) ?? ''
  const reading: ReplayReport['after']['reading'] = {
    entryStateAfterReplay: entryState(ctx, scope, key),
    inAmbiguousList: inAmbiguousList(ctx, scope, key),
    replayResultText,
    toolRuns: existsSync(runsFile()) ? readFileSync(runsFile(), 'utf8').split('\n').filter(line => line === 'run').length : 0,
    syntheticResult,
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
    throw new Error(`p4-12 replay-crash phase ${args.join(' ')} reported nothing (status ${String(result.status)}, signal ${String(result.signal)}); stderr tail:\n${result.stderr.slice(-1500)}`)
  }
  return { status: result.status, signal: result.signal, reading: JSON.parse(json) as Record<string, unknown> }
}

const [configPath, phase, sessionArg, scopeArg, keyArg] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p4-12 replay-crash driver requires a config path')

if (phase === 'orchestrate') {
  const first = runPhase([configPath, 'before'])
  const reading = first.reading as { sessionId: string; scope: string | null; key: string | null }
  if (reading.scope === null || reading.key === null) {
    throw new Error(`p4-12 replay-crash: the before phase did not reserve a ledger entry; reading: ${JSON.stringify(reading)}`)
  }
  await delay(CRASH_RESTART_DELAY_MS)
  const second = runPhase([configPath, 'after', reading.sessionId, reading.scope, reading.key])
  const report: ReplayReport = { before: first as ReplayReport['before'], after: second as ReplayReport['after'] }
  process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify(report)}\n`)
} else if (phase === 'before' || phase === 'after') {
  const ctx = await bootProductionProfile({
    binName: 'p4-12-replay-crash',
    profile: 'headless',
    overlayPaths: [resolveConfigPath(configPath, undefined)],
    prepare: (prepared) => {
      pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
    },
  })
  try {
    if (phase === 'before') {
      await before(ctx)
    } else {
      if (sessionArg === undefined || scopeArg === undefined || keyArg === undefined) {
        throw new Error('p4-12 replay-crash driver: `after` requires the session id, scope and key')
      }
      await after(ctx, SessionId(sessionArg), scopeArg, keyArg)
    }
  } finally {
    await ctx.fiber.dispose()
  }
} else {
  throw new Error(`p4-12 replay-crash driver: unknown phase ${String(phase)}`)
}

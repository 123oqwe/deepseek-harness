/**
 * Driver for A-474's P2-07 case under acceptance[0]: a host crash while an
 * approval request is waiting for its answer, then a restart.
 *
 * One restart is two processes, so the driver runs in three phases, as the
 * P5-10 restart driver does:
 *
 * - `orchestrate` launches `before`, waits past the Run lease the killed
 *   process still holds, launches `after` the way it was itself launched (same
 *   Node flags, working directory and environment, so the same `DSH_HOME` and
 *   `./.sessions`), and prints one `P2-07-RESTART <json>` line.
 * - `before` boots the SHIPPED headless profile at its default preset with the
 *   Trust Kernel pinned, registers a probe tool that declares no risk domain
 *   tags (the risk gate asks for approval), and has the model call it. When
 *   the approval request for the probe reaches the operator, the operator does
 *   not answer: the process waits a second for `approval/asked` to reach the
 *   log, reports, and kills itself with SIGKILL.
 * - `after <session>` boots the same profile, registers the same probe
 *   (counting its runs) and an operator that allows the probe and records
 *   every question, resumes the root session the way the Web host does when a
 *   client opens it, waits for the session to go quiet, and reports the
 *   session's approval events.
 * @module tests/first100/fixtures/loader/p2-07-approval-crash/driver
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const PROVIDER = 'p2-07-approval-crash-mock'
/** A tool that declares no risk domain tags, so the risk gate asks for approval before it runs. */
const PROBE_TOOL = 'a474_approval_probe'
const PROBE_CALL = 'a474-approval-call'
/** The line prefix one phase reports under. */
const PHASE_TAG = 'P2-07-PHASE'
/** The shipped Run lease term (`run` row default) plus two seconds. */
const CRASH_RESTART_DELAY_MS = 32_000
/** How long `before` waits after the approval request reaches the operator, so `approval/asked` reaches the log. */
const FLUSH_WAIT_MS = 1_000
/** No session event for this long counts as quiet. */
const QUIET_MS = 1_500
/** Longest wait for a quiet session. */
const SETTLE_LIMIT_MS = 20_000
/** Deadline for one phase process. */
const PHASE_TIMEOUT_MS = 120_000

/**
 * One scripted model answer: a turn's opening request calls the probe; any
 * other request, a session title's among them, gets text.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn ? toolCallResponse(PROBE_CALL, PROBE_TOOL, {}) : textResponse('done')
}

/**
 * Boot the shipped headless profile with the Trust Kernel pinned and the scripted model registered.
 * @param configPath - the overlay.
 * @returns the booted root context.
 */
async function boot(configPath: string): Promise<Context> {
  const ctx = await bootProductionProfile({
    binName: 'p2-07-approval-crash',
    profile: 'headless',
    overlayPaths: [resolveConfigPath(configPath, undefined)],
    prepare: (prepared) => {
      pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
    },
  })
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
  return ctx
}

/**
 * Register the probe, counting its runs.
 * @param ctx - the booted root context.
 * @param runs - the counter its body increments.
 */
function registerProbe(ctx: Context, runs: { count: number }): void {
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a probe that declares nothing it touches and records that it ran',
    parameters: {},
    execute: () => {
      runs.count += 1
      return Promise.resolve([{ type: 'text' as const, text: 'probe ran' }])
    },
  }))
}

/**
 * The phase before the restart: the model calls the probe, and the process dies while its approval waits.
 * @param configPath - the overlay.
 */
async function before(configPath: string): Promise<void> {
  const ctx = await boot(configPath)
  registerProbe(ctx, { count: 0 })
  ctx.on('approval/request', (request) => {
    // Any other question, the headless workspace-trust one among them, is refused.
    if (request.toolName !== PROBE_TOOL) return Promise.resolve('rejected' as const)
    // The operator never answers: the process is killed while the approval waits.
    void delay(FLUSH_WAIT_MS).then(() => {
      // A synchronous write: SIGKILL leaves no later turn in which a buffered stdout could flush.
      writeSync(1, `${PHASE_TAG} ${JSON.stringify({ sessionId: ctx.agents.list()[0]?.id ?? null, asked: request.toolName })}\n`)
      process.kill(process.pid, 'SIGKILL')
    })
    return new Promise<never>(() => { /* never settles: the process dies first */ })
  })
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  await runFixtureTurn(ctx, { task: 'A474 P2-07: call the probe once.' })
  throw new Error('p2-07 approval-crash driver: the turn ended without an approval request for the probe')
}

/**
 * The phase after the restart: resume the root session and read its approval events.
 * @param configPath - the overlay.
 * @param sessionId - the root session from `before`.
 */
async function after(configPath: string, sessionId: SessionId): Promise<void> {
  const ctx = await boot(configPath)
  const runs = { count: 0 }
  registerProbe(ctx, runs)
  const asked: string[] = []
  ctx.on('approval/request', (request) => {
    asked.push(request.toolName)
    return Promise.resolve(request.toolName === PROBE_TOOL ? 'allowed-once' as const : 'rejected' as const)
  })
  let lastEventAt = Date.now()
  ctx.on('session/event', () => { lastEventAt = Date.now() })
  try {
    // What the Web host does when a client opens the session.
    const { agent } = await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: { provider: PROVIDER, model: PROVIDER } })
    for (let waited = 0; waited < SETTLE_LIMIT_MS && Date.now() - lastEventAt < QUIET_MS; waited += 100) await delay(100)
    const events = agent.session.snapshotEvents()
    process.stdout.write(`${PHASE_TAG} ${JSON.stringify({
      asked,
      probeRuns: runs.count,
      approvalsAsked: events.flatMap(event => event.type === 'approval/asked' ? [{ id: event.data.id, toolName: event.data.toolName }] : []),
      approvalsDecided: events.flatMap(event => event.type === 'approval/decided' ? [{ id: event.data.id, outcome: event.data.outcome }] : []),
      turnEnds: events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : []),
    })}\n`)
  } finally {
    await ctx.fiber.dispose()
  }
}

/**
 * Run one phase in a fresh process launched the way this one was.
 * @param args - the phase's arguments after the script path.
 * @returns how it exited and what it reported.
 */
function runPhase(args: readonly string[]): { readonly status: number | null; readonly signal: string | null; readonly reading: unknown } {
  const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    timeout: PHASE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024 * 1024,
  })
  const json = /P2-07-PHASE (?<json>.+)/u.exec(result.stdout)?.groups?.json
  if (json === undefined) {
    throw new Error(`p2-07 approval-crash phase ${args.join(' ')} reported nothing (status ${String(result.status)}, signal ${String(result.signal)}); stderr tail:\n${result.stderr.slice(-1500)}`)
  }
  return { status: result.status, signal: result.signal, reading: JSON.parse(json) as unknown }
}

const [configPath, phase, sessionArg] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p2-07 approval-crash driver requires a config path and a phase')

if (phase === 'orchestrate') {
  const first = runPhase([configPath, 'before'])
  const sessionId = (first.reading as { readonly sessionId?: unknown }).sessionId
  if (typeof sessionId !== 'string') throw new Error(`p2-07 approval-crash driver: \`before\` reported no session id: ${JSON.stringify(first)}`)
  await delay(CRASH_RESTART_DELAY_MS)
  const second = runPhase([configPath, 'after', sessionId])
  process.stdout.write(`P2-07-RESTART ${JSON.stringify({ before: first, after: second })}\n`)
} else if (phase === 'before') {
  await before(configPath)
} else if (phase === 'after') {
  if (sessionArg === undefined) throw new Error('p2-07 approval-crash driver: `after` requires the session id')
  await after(configPath, SessionId(sessionArg))
} else {
  throw new Error(`p2-07 approval-crash driver: unknown phase ${String(phase)}`)
}

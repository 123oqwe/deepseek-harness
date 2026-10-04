/**
 * Driver for A-519's P2-07 case under acceptance[1]: a detached workflow run that
 * consumes its approval and does its post-approval effect, then crashes before its
 * completion is journaled, is not re-run by the next process that scans it.
 *
 * One orchestration is three phase processes sharing one working directory (so one
 * `$DSH_HOME`, `./.sessions`, and `./effect.log`), as the P5-10 restart driver does:
 *
 * - `orchestrate` launches `wait`, waits past the Run lease, launches `resume1`,
 *   waits past the lease, launches `resume2`, and prints one `P2-07-AT-MOST-ONCE <json>`.
 * - `wait` boots the shipped headless profile, launches a detached workflow run whose
 *   script asks for an approval and — once past it — appends one line to `./effect.log`
 *   (the approved action's durable effect), lets it settle `waiting_for_approval`, and
 *   reports the approval id.
 * - `resume1` boots again, monkey-patches `ctx.get('sessions').flush` to reject the run's
 *   session (identified from the approval record's scope), decides the approval
 *   `approved`, and lets the engine wake the run: it consumes the approval (durable in
 *   the sqlite store) and runs the effect, but the completion flush is rejected — a crash
 *   between the consume and the completion journal. It reports how many times that
 *   rejection fired, so a masked seam is seen at once.
 * - `resume2` boots once more; its scan sees the run waiting with its approval consumed.
 *   It reports `./effect.log`'s line count and the approval's state.
 * @module tests/first100/fixtures/loader/p2-07-at-most-once/driver
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { ApprovalRequestId, ApprovalViewer, PrincipalId, TenantId } from '@deepseek-ai/dsh-approval-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { MockAdapter, textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const PROVIDER = 'p2-07-at-most-once-mock'
/** The line prefix each phase reports under. */
const PHASE_TAG = 'P2-07-PHASE'
const META = { name: 'ship', description: 'ships once approved', phases: [] }
const operator: ApprovalViewer = { tenant: brandString<TenantId>('local'), principal: brandString<PrincipalId>('operator') }
/** The approved action's durable effect: one line appended to `args.log`, which outlives the crash. */
const SCRIPT = "await approval({ title: 'ship it' }); require('node:fs').appendFileSync(args.log, 'ran\\n'); return 'shipped'"
/** The shipped Run lease term (`run` row default) plus two seconds. */
const LEASE_DELAY_MS = 32_000
/** No session event for this long counts as quiet. */
const QUIET_MS = 1_500
/** Longest wait for a quiet session. */
const SETTLE_LIMIT_MS = 20_000
/** Deadline for one phase process. */
const PHASE_TIMEOUT_MS = 120_000
/** The approved action's durable effect file, shared across phases by their common working directory. */
const LOG = join(process.cwd(), 'effect.log')

/**
 * The scripted model answer. The run's script never calls `agent()`, but the launcher's
 * route needs a registered provider.
 * @param _options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(_options: GenerateOptions): StreamChunk[] {
  return textResponse('ok')
}

/**
 * Boot the shipped headless profile with the Trust Kernel pinned and the scripted model registered.
 * @param configPath - the overlay.
 * @returns the booted root context.
 */
async function boot(configPath: string): Promise<Context> {
  const ctx = await bootProductionProfile({
    binName: 'p2-07-at-most-once',
    profile: 'headless',
    overlayPaths: [resolveConfigPath(configPath, undefined)],
    prepare: (prepared) => {
      pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
    },
  })
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 8 }, () => answer)))
  return ctx
}

/**
 * Read the run session an approval is scoped to, from the approval record.
 * @param ctx - the booted context.
 * @param approvalId - the pending approval.
 * @returns the run's session id, or null when the record is absent or not run-scoped.
 */
function runSessionOf(ctx: Context, approvalId: ApprovalRequestId): string | null {
  const record = ctx.get('approvalStore')?.get(approvalId, operator, Date.now())
  return record?.scope.kind === 'run' ? String(record.scope.sessionId) : null
}

/**
 * The phase before the resume: launch the detached run and let it settle waiting for its approval.
 * @param configPath - the overlay.
 */
async function wait(configPath: string): Promise<void> {
  const ctx = await boot(configPath)
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const launcher = ctx.agents.list()[0]
  if (launcher === undefined) throw new Error('p2-07 at-most-once: no launcher agent after createFixtureRootAgent')
  const run = await ctx.workflowEngine.startDetached({ script: SCRIPT, meta: META, args: { log: LOG }, parent: launcher })
  const settled = await run.result
  writeSync(1, `${PHASE_TAG} ${JSON.stringify({ phase: 'wait', stopReason: settled.stopReason, approvalId: settled.waitingFor?.approvalId ?? null })}\n`)
  await ctx.fiber.dispose()
}

/**
 * The resuming phase: consume the approval and run the effect, then crash before the completion journal.
 * @param configPath - the overlay.
 * @param approvalId - the approval `wait` left pending.
 */
async function resume1(configPath: string, approvalId: ApprovalRequestId): Promise<void> {
  const ctx = await boot(configPath)
  const runSession = runSessionOf(ctx, approvalId)
  // The crash seam: the run's completion flush is rejected, so the run is consumed on the
  // record but its journal still reads waiting. A count proves the seam fired.
  let flushRejects = 0
  const sessions = ctx.get('sessions')
  if (sessions === undefined) throw new Error('p2-07 at-most-once: no session service')
  const realFlush = sessions.flush.bind(sessions)
  sessions.flush = (session) => {
    if (runSession !== null && String(session.id) === runSession) {
      flushRejects += 1
      return Promise.reject(new Error('crash: the host died before the completion journal'))
    }
    return realFlush(session)
  }
  let lastEventAt = Date.now()
  ctx.on('session/event', () => { lastEventAt = Date.now() })
  // Decide the approval; the engine wakes the run, consumes the approval, runs the effect,
  // and then the completion flush is rejected.
  ctx.get('approvalStore')?.decide(approvalId, 0, 'approved', operator, Date.now())
  for (let waited = 0; waited < SETTLE_LIMIT_MS && Date.now() - lastEventAt < QUIET_MS; waited += 100) await delay(100)
  writeSync(1, `${PHASE_TAG} ${JSON.stringify({ phase: 'resume1', approvalId, flushRejects })}\n`)
  await ctx.fiber.dispose()
}

/**
 * The phase after the crash: scan, let any re-run settle, and read the effect file and approval state.
 * @param configPath - the overlay.
 * @param approvalId - the approval, now consumed.
 */
async function resume2(configPath: string, approvalId: ApprovalRequestId): Promise<void> {
  const ctx = await boot(configPath)
  let lastEventAt = Date.now()
  ctx.on('session/event', () => { lastEventAt = Date.now() })
  // The scan at mount re-wakes the run only under M-519-1; wait for the session to go quiet.
  for (let waited = 0; waited < SETTLE_LIMIT_MS && Date.now() - lastEventAt < QUIET_MS; waited += 100) await delay(100)
  let effectRuns = 0
  try { effectRuns = readFileSync(LOG, 'utf8').split('\n').filter(Boolean).length } catch { effectRuns = 0 }
  const approvalState = ctx.get('approvalStore')?.get(approvalId, operator, Date.now())?.state ?? null
  writeSync(1, `${PHASE_TAG} ${JSON.stringify({ phase: 'resume2', effectRuns, approvalState })}\n`)
  await ctx.fiber.dispose()
}

/**
 * Run one phase in a fresh process launched the way this one was.
 * @param args - the phase's arguments after the script path.
 * @returns what it reported.
 */
function runPhase(args: readonly string[]): Record<string, unknown> {
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
    throw new Error(`p2-07 at-most-once phase ${args.join(' ')} reported nothing (status ${String(result.status)}, signal ${String(result.signal)}); stderr tail:\n${result.stderr.slice(-1500)}`)
  }
  return JSON.parse(json) as Record<string, unknown>
}

const [configPath, phase, approvalArg] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p2-07 at-most-once driver requires a config path and a phase')

if (phase === 'orchestrate') {
  const waited = runPhase([configPath, 'wait'])
  const approvalId = waited.approvalId
  if (typeof approvalId !== 'string') throw new Error(`p2-07 at-most-once: \`wait\` reported no approval id: ${JSON.stringify(waited)}`)
  await delay(LEASE_DELAY_MS)
  const resumed1 = runPhase([configPath, 'resume1', approvalId])
  await delay(LEASE_DELAY_MS)
  const resumed2 = runPhase([configPath, 'resume2', approvalId])
  writeSync(1, `P2-07-AT-MOST-ONCE ${JSON.stringify({ resume1: resumed1, resume2: resumed2 })}\n`)
} else if (phase === 'wait') {
  await wait(configPath)
} else if (phase === 'resume1') {
  if (approvalArg === undefined) throw new Error('p2-07 at-most-once: `resume1` requires the approval id')
  await resume1(configPath, brandString<ApprovalRequestId>(approvalArg))
} else if (phase === 'resume2') {
  if (approvalArg === undefined) throw new Error('p2-07 at-most-once: `resume2` requires the approval id')
  await resume2(configPath, brandString<ApprovalRequestId>(approvalArg))
} else {
  throw new Error(`p2-07 at-most-once driver: unknown phase ${String(phase)}`)
}

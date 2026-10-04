/**
 * Driver for D8 under P2-07 U2 (ruling p2-07-u2-d8-token-ruling.md): a workflow run
 * launched by a FILTERED launcher, resumed after a restart that lost the in-memory
 * delegation record, keeps its ORIGINAL filtered capability — it is not re-signed a
 * broader root token.
 *
 * Two phase processes share one working directory (so one `$DSH_HOME` and
 * `./.sessions`); the restart is the process boundary, which is exactly what loses the
 * in-memory delegation record the ruling's escalation path depends on:
 * - `wait` boots the shipped headless profile, derives a FILTERED child token for a
 *   launcher session (allowing `read`, not `write`), creates that launcher, and launches
 *   a detached run from it. The run's token is derived from the filtered launcher, so it
 *   too allows `read` and not `write`. It settles `waiting_for_approval` and reports the
 *   approval id plus the launcher's and run's token resources (a masked filter shows at
 *   once: a launcher or run that already holds `write` means the filter never applied).
 * - `resume` boots fresh (the in-memory delegation record is gone), decides the approval
 *   `approved`, lets the engine wake the run, and reads the resumed run's token resources.
 *
 * Green on 4844d9919b: resume holds the run's persisted derived token, so its resources
 * still allow `read` and not `write`. Red on M-D8-1 (adopt's empty-claim returns true, so
 * resume re-signs a root token): the resumed run's resources now include `write`. §21.4:
 * derived from the ruling's required observation, independent of lane B's evidence, and
 * hooks only the public approval store and capability-token provider — never the adopt fix.
 * @module tests/first100/fixtures/loader/p2-07-d8-no-escalation/driver
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { ApprovalRequestId, ApprovalViewer, PrincipalId, TenantId } from '@deepseek-ai/dsh-approval-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-capability-token'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-workflow'
import { MockAdapter, textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const PROVIDER = 'p2-07-d8-mock'
const PHASE_TAG = 'P2-07-D8-PHASE'
const META = { name: 'ship', description: 'ships once approved', phases: [] }
const operator: ApprovalViewer = { tenant: brandString<TenantId>('local'), principal: brandString<PrincipalId>('operator') }
const SCRIPT = "await approval({ title: 'ship it' }); return 'shipped'"
/** The tool the filtered launcher keeps; `write` is the one it gives up. Both are shipped tools. */
const KEPT = 'read'
const DROPPED = 'write'
/** The shipped Run lease term (`run` row default) plus two seconds. */
const LEASE_DELAY_MS = 32_000
const QUIET_MS = 1_500
const SETTLE_LIMIT_MS = 20_000
const PHASE_TIMEOUT_MS = 120_000

/**
 * The scripted model answer; the run's script never calls `agent()`, but the launcher's
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
    binName: 'p2-07-d8-no-escalation',
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
 * The resources of a session's capability token, or null when it holds none.
 * @param ctx - the booted context.
 * @param session - the session.
 * @returns the token's resource names, or null.
 */
async function tokenResources(ctx: Context, session: string): Promise<readonly string[] | null> {
  const token = await ctx.get('capabilityTokens')?.whenSessionToken(session)
  return token?.token.resources ?? null
}

/**
 * The run session an approval is scoped to, from the approval record.
 * @param ctx - the booted context.
 * @param approvalId - the pending approval.
 * @returns the run's session id, or null.
 */
function runSessionOf(ctx: Context, approvalId: ApprovalRequestId): string | null {
  const record = ctx.get('approvalStore')?.get(approvalId, operator, Date.now())
  return record?.scope.kind === 'run' ? String(record.scope.sessionId) : null
}

/**
 * The phase before the restart: a filtered launcher launches a run that settles waiting.
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
  const root = ctx.agents.list()[0]
  if (root === undefined) throw new Error('p2-07 d8: no root agent after createFixtureRootAgent')
  // A filtered child launcher: its token is derived from root, narrowed to `read`.
  const launcherSession = SessionId(`d8-launcher-${randomUUID()}`)
  ctx.get('capabilityTokens')?.deriveChild(String(root.id), launcherSession, { allow: [KEPT] })
  const handle = await ctx.agents.create({ sessionId: launcherSession })
  const launcherResources = await tokenResources(ctx, launcherSession)
  const run = await ctx.workflowEngine.startDetached({ script: SCRIPT, meta: META, parent: handle.agent })
  const settled = await run.result
  const approvalId = settled.waitingFor?.approvalId ?? null
  const runSession = approvalId === null ? null : runSessionOf(ctx, brandString<ApprovalRequestId>(String(approvalId)))
  const runResources = runSession === null ? null : await tokenResources(ctx, runSession)
  writeSync(1, `${PHASE_TAG} ${JSON.stringify({
    phase: 'wait',
    stopReason: settled.stopReason,
    approvalId,
    launcherHasKept: launcherResources?.includes(KEPT) ?? false,
    launcherHasDropped: launcherResources?.includes(DROPPED) ?? false,
    runHasKept: runResources?.includes(KEPT) ?? false,
    runHasDropped: runResources?.includes(DROPPED) ?? false,
  })}\n`)
  await ctx.fiber.dispose()
}

/**
 * The phase after the restart: resume the run and read the token it is given.
 * @param configPath - the overlay.
 * @param approvalId - the approval `wait` left pending.
 */
async function resume(configPath: string, approvalId: ApprovalRequestId): Promise<void> {
  const ctx = await boot(configPath)
  const runSession = runSessionOf(ctx, approvalId)
  let lastEventAt = Date.now()
  ctx.on('session/event', () => { lastEventAt = Date.now() })
  ctx.get('approvalStore')?.decide(approvalId, 0, 'approved', operator, Date.now())
  for (let waited = 0; waited < SETTLE_LIMIT_MS && Date.now() - lastEventAt < QUIET_MS; waited += 100) await delay(100)
  const resources = runSession === null ? null : await tokenResources(ctx, runSession)
  writeSync(1, `${PHASE_TAG} ${JSON.stringify({
    phase: 'resume',
    resumeHasKept: resources?.includes(KEPT) ?? false,
    resumeHasDropped: resources?.includes(DROPPED) ?? false,
    hasToken: resources !== null,
  })}\n`)
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
  const json = /P2-07-D8-PHASE (?<json>.+)/u.exec(result.stdout)?.groups?.json
  if (json === undefined) {
    throw new Error(`p2-07 d8 phase ${args.join(' ')} reported nothing (status ${String(result.status)}, signal ${String(result.signal)}); stderr tail:\n${result.stderr.slice(-1500)}`)
  }
  return JSON.parse(json) as Record<string, unknown>
}

const [configPath, phase, approvalArg] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p2-07 d8 driver requires a config path and a phase')

if (phase === 'orchestrate') {
  const waited = runPhase([configPath, 'wait'])
  const approvalId = waited.approvalId
  if (typeof approvalId !== 'string') throw new Error(`p2-07 d8: \`wait\` reported no approval id: ${JSON.stringify(waited)}`)
  await delay(LEASE_DELAY_MS)
  const resumed = runPhase([configPath, 'resume', approvalId])
  writeSync(1, `P2-07-D8 ${JSON.stringify({ wait: waited, resume: resumed })}\n`)
} else if (phase === 'wait') {
  await wait(configPath)
} else if (phase === 'resume') {
  if (approvalArg === undefined) throw new Error('p2-07 d8: `resume` requires the approval id')
  await resume(configPath, brandString<ApprovalRequestId>(approvalArg))
} else {
  throw new Error(`p2-07 d8 driver: unknown phase ${String(phase)}`)
}

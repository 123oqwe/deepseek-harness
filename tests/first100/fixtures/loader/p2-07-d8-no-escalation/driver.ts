/**
 * Driver for D8 under P2-07 U2: a workflow run launched by a FILTERED launcher must not
 * let that launcher — a session derived with `allow: ['read']` — gain `write`. The
 * re-delegation growth path (ruling d8-redelegate-growth-security-finding.md) signs the
 * resources a child sees but does not hold back into the PARENT session, and this
 * launcher's parent is itself a `read`-only derived session, so it is grown past its own
 * boundary. The authoritative test of "can this session write" is not the token's resource
 * list but a REAL dispatch read at the capability gate (§19.3): `tools/src/index.ts`
 * refuses a `write` whose session token's `resources` do not include `write` with a
 * `TOOL_TOKEN_DENIED` / "does not authorize this tool" result.
 *
 * Two phase processes share one working directory (one `$DSH_HOME`, one `./.sessions`); the
 * restart is the process boundary.
 * - `wait` boots the shipped headless profile, derives a FILTERED launcher (`read`, not
 *   `write`, WITH a model route so its turn reaches the scripted model), and launches a
 *   detached run from it whose script spawns a sub-agent FIRST — that derivation is what
 *   triggers the re-delegation growth of the launcher — and only then awaits approval. Once
 *   the run has settled `waiting_for_approval`, it drives ONE real turn on the now-grown
 *   launcher whose scripted model opens with a `write`, and reports whether the gate refused
 *   it (`launcherWriteAllowed`) alongside the launcher's and run's token resources.
 * - `resume` boots fresh (the in-memory delegation record is gone), decides the approval,
 *   waits for the run to complete (`workflow/end`), and reports the resumed run's resources,
 *   `issuanceError(runSession)`, and whether it ended.
 *
 * The load-bearing control is `launcherWriteAllowed`. Red on 4844d9919b: growth grows the
 * launcher to include `write`, the gate lets the dispatch through, so it is `true`. Green
 * on the (B) fix (lane B): growth is bounded by each hop's filter, the launcher keeps only
 * `read`, the gate refuses the write, so it is `false`. §21.4: the observation is derived
 * from the ruling, hashed before reading the (B) fix, and the driver hooks only the public
 * approval store, capability-token provider, and session events — never the growth fix.
 * @module tests/first100/fixtures/loader/p2-07-d8-no-escalation/driver
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { ApprovalRequestId, ApprovalViewer, PrincipalId, TenantId } from '@deepseek-ai/dsh-approval-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-capability-token'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-workflow'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const PROVIDER = 'p2-07-d8-mock'
const PHASE_TAG = 'P2-07-D8-PHASE'
const META = { name: 'ship', description: 'ships once approved', phases: [] }
const operator: ApprovalViewer = { tenant: brandString<TenantId>('local'), principal: brandString<PrincipalId>('operator') }
/**
 * The run spawns a sub-agent FIRST — deriving a child from the run triggers the
 * re-delegation growth that grows the filtered launcher past `read` — and only then
 * awaits approval, so the launcher is already grown when its own write is dispatched.
 */
const SCRIPT = "await agent('D8-WRITE-PROBE write a probe file'); await approval({ title: 'ship it' }); return 'shipped'"
/**
 * The pin-3 (revoke) run: like {@link SCRIPT} but it awaits a SECOND approval after the
 * first, so after the restart decides the first approval the resumed run wakes and parks
 * again — staying ALIVE while its token is read, instead of completing and disposing (which
 * clears the session token and would read `hasToken: false` on every tree).
 */
const REVOKE_SCRIPT = "await agent('D8-WRITE-PROBE write a probe file'); await approval({ title: 'ship it' }); await approval({ title: 'hold open' }); return 'shipped'"
/** The tool the filtered launcher keeps; `write` is the one it gives up. Both are shipped tools. */
const KEPT = 'read'
const DROPPED = 'write'
/** The model-facing wording the capability gate returns for a `tool-not-in-scope` refusal. */
const DENIAL_MARK = 'does not authorize this tool'
/** The shipped Run lease term (`run` row default) plus two seconds. */
const LEASE_DELAY_MS = 32_000
const SETTLE_LIMIT_MS = 20_000
const POLL_MS = 100
const PHASE_TIMEOUT_MS = 120_000

/**
 * The scripted model answer, per turn. The wait phase runs two probe turns (the run's
 * sub-agent, then the launcher), so a shared one-shot flag would starve the second turn;
 * instead each turn opens with a real `write` and closes with text once its own tool result
 * is in that request's history. Keying on in-history tool activity makes this independent of
 * turn order and never loops.
 * @param options - the request the loop sent.
 * @returns a `write` tool call to open a turn, then closing text once it has a tool result.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  const priorToolActivity = options.messages.some(message =>
    Array.isArray(message.content) && message.content.some(block => block.type === 'tool-call' || block.type === 'tool-result'))
  if (priorToolActivity) return textResponse('done')
  return toolCallResponse('d8-write', DROPPED, { file_path: join(process.cwd(), 'd8-write-probe.txt'), content: 'probe' })
}

/** A session's observed tool-result text and its parent, collected as events arrive. */
interface SessionProbe {
  readonly parent: string | null
  readonly results: string[]
}

/**
 * Collect every tool-result text per session, recording each session's parent once. A gate
 * refusal is model-facing text, so a refused `write` shows {@link DENIAL_MARK} in its result.
 * @param ctx - the booted context.
 * @returns the live map, keyed by session id.
 */
function observeToolResults(ctx: Context): Map<string, SessionProbe> {
  const probes = new Map<string, SessionProbe>()
  ctx.on('session/event', (session, event) => {
    const existing = probes.get(session.id) ?? { parent: session.header.parentSession ?? null, results: [] }
    if (event.type === 'tool/result') {
      const text = event.data.message.content.flatMap(block =>
        block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join('')
      existing.results.push(text)
    }
    probes.set(session.id, existing)
  })
  return probes
}

/** Whether a session was observed dispatching a `write` and the gate let it through. */
function writeDecision(results: readonly string[]): { observed: boolean; allowed: boolean } {
  if (results.length === 0) return { observed: false, allowed: false }
  return { observed: true, allowed: !results.some(text => text.includes(DENIAL_MARK)) }
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
 * The phase before the restart: a filtered launcher launches a run that settles waiting,
 * then the launcher attempts a real `write`.
 * @param configPath - the overlay.
 */
async function wait(configPath: string, script: string): Promise<void> {
  const ctx = await boot(configPath)
  const probes = observeToolResults(ctx)
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
  const handle = await ctx.agents.create({ sessionId: launcherSession, agentOptions: { provider: PROVIDER, model: PROVIDER } })
  const run = await ctx.workflowEngine.startDetached({ script, meta: META, parent: handle.agent })
  const settled = await run.result
  const approvalId = settled.waitingFor?.approvalId ?? null
  const runSession = approvalId === null ? null : runSessionOf(ctx, brandString<ApprovalRequestId>(approvalId))
  // The real dispatch: the launcher opens one turn whose model calls `write`. The gate
  // decides allow/refuse against the launcher's (possibly grown) token.
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'D8-WRITE-PROBE write a probe file' }], source: { kind: 'user' } }))
  await handle.agent.whenIdle()
  const launcherResources = await tokenResources(ctx, launcherSession)
  const runResources = runSession === null ? null : await tokenResources(ctx, runSession)
  const launcherWrite = writeDecision(probes.get(launcherSession)?.results ?? [])
  writeSync(1, `${PHASE_TAG} ${JSON.stringify({
    phase: 'wait',
    stopReason: settled.stopReason,
    approvalId,
    launcherHasKept: launcherResources?.includes(KEPT) ?? false,
    launcherHasDropped: launcherResources?.includes(DROPPED) ?? false,
    runHasKept: runResources?.includes(KEPT) ?? false,
    runHasDropped: runResources?.includes(DROPPED) ?? false,
    launcherWriteObserved: launcherWrite.observed,
    launcherWriteAllowed: launcherWrite.allowed,
  })}\n`)
  await ctx.fiber.dispose()
}

/**
 * The phase after the restart: resume the run, which wakes and attempts a real `write`
 * through a sub-agent, and read what the gate decided plus any issuance failure.
 * @param configPath - the overlay.
 * @param approvalId - the approval `wait` left pending.
 */
async function resume(configPath: string, approvalId: ApprovalRequestId): Promise<void> {
  const ctx = await boot(configPath)
  const runSession = runSessionOf(ctx, approvalId)
  // Positive signal: the run completed after the approval, not a fixed quiescence — the only
  // run in this fixture, so any `workflow/end` is its finish past the decided approval.
  let runEnded = false
  ctx.on('workflow/end', () => { runEnded = true })
  ctx.get('approvalStore')?.decide(approvalId, 0, 'approved', operator, Date.now())
  for (let waited = 0; waited < SETTLE_LIMIT_MS && !runEnded; waited += POLL_MS) await delay(POLL_MS)
  const resources = runSession === null ? null : await tokenResources(ctx, runSession)
  writeSync(1, `${PHASE_TAG} ${JSON.stringify({
    phase: 'resume',
    resumeHasKept: resources?.includes(KEPT) ?? false,
    resumeHasDropped: resources?.includes(DROPPED) ?? false,
    hasToken: resources !== null,
    issuanceError: ctx.get('capabilityTokens')?.issuanceError(runSession ?? '') ?? null,
    runEnded,
  })}\n`)
  await ctx.fiber.dispose()
}

/**
 * Between the phases (pin 3, the ruling's expired/revoked observation): revoke the
 * run's capability token. A correct resume refuses to re-sign a revoked session
 * (fail-closed), and `revokeSession` is durable across the restart. Reports what the
 * provider answered, so a run session nothing was recorded against is told apart from
 * one whose grant was withdrawn.
 * @param configPath - the overlay.
 * @param approvalId - the approval `wait` left pending, naming the run session.
 */
async function revoke(configPath: string, approvalId: ApprovalRequestId): Promise<void> {
  const ctx = await boot(configPath)
  const runSession = runSessionOf(ctx, approvalId)
  let revoked: string | null = null
  if (runSession !== null) revoked = (await ctx.get('capabilityTokens')?.revokeSession(runSession)) ?? null
  writeSync(1, `${PHASE_TAG} ${JSON.stringify({ phase: 'revoke', revoked })}\n`)
  await ctx.fiber.dispose()
}

/**
 * The pin-3 resume: decide the first approval, let the run wake (the re-delegation adopt
 * re-signs or fail-closes its token) and park at its SECOND approval, and read the token
 * WHILE the run is still parked — alive, not disposed. A revoked session a correct adopt
 * refuses leaves `whenSessionToken` undefined (`hasToken: false`); a mutation that re-signs
 * a revoked session anyway hands a token back (`hasToken: true`). Polling while the run is
 * parked is what the post-`workflow/end` read could not do: that read fires after the run
 * completes and its session token is cleared, so it reads false on every tree.
 * @param configPath - the overlay.
 * @param approvalId - the first approval `wait-revoke` left pending.
 */
async function resumeRevoke(configPath: string, approvalId: ApprovalRequestId): Promise<void> {
  const ctx = await boot(configPath)
  const runSession = runSessionOf(ctx, approvalId)
  ctx.get('approvalStore')?.decide(approvalId, 0, 'approved', operator, Date.now())
  let resources: readonly string[] | null = null
  for (let waited = 0; waited < SETTLE_LIMIT_MS; waited += POLL_MS) {
    resources = runSession === null ? null : await tokenResources(ctx, runSession)
    if (resources !== null) break
    await delay(POLL_MS)
  }
  writeSync(1, `${PHASE_TAG} ${JSON.stringify({
    phase: 'resume',
    hasToken: resources !== null,
    resources: resources ?? null,
    issuanceError: ctx.get('capabilityTokens')?.issuanceError(runSession ?? '') ?? null,
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
} else if (phase === 'orchestrate-revoke') {
  const waited = runPhase([configPath, 'wait-revoke'])
  const approvalId = waited.approvalId
  if (typeof approvalId !== 'string') throw new Error(`p2-07 d8 revoke: \`wait-revoke\` reported no approval id: ${JSON.stringify(waited)}`)
  const revoked = runPhase([configPath, 'revoke', approvalId])
  await delay(LEASE_DELAY_MS)
  const resumed = runPhase([configPath, 'resume-revoke', approvalId])
  writeSync(1, `P2-07-D8-REVOKE ${JSON.stringify({ wait: waited, revoke: revoked, resume: resumed })}\n`)
} else if (phase === 'wait') {
  await wait(configPath, SCRIPT)
} else if (phase === 'wait-revoke') {
  await wait(configPath, REVOKE_SCRIPT)
} else if (phase === 'revoke') {
  if (approvalArg === undefined) throw new Error('p2-07 d8: `revoke` requires the approval id')
  await revoke(configPath, brandString<ApprovalRequestId>(approvalArg))
} else if (phase === 'resume') {
  if (approvalArg === undefined) throw new Error('p2-07 d8: `resume` requires the approval id')
  await resume(configPath, brandString<ApprovalRequestId>(approvalArg))
} else if (phase === 'resume-revoke') {
  if (approvalArg === undefined) throw new Error('p2-07 d8: `resume-revoke` requires the approval id')
  await resumeRevoke(configPath, brandString<ApprovalRequestId>(approvalArg))
} else {
  throw new Error(`p2-07 d8 driver: unknown phase ${String(phase)}`)
}

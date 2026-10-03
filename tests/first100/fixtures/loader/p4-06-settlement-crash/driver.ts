/**
 * Driver for P4-06 acceptance[0]'s settlement crash-window measurement
 * (BLOCKED-350, blind review F1): a child's settlement, delivered to the parent
 * over the durable bus and acknowledged, must ultimately produce exactly one
 * business effect in the parent even when the host is killed around the ack.
 *
 * One host restart is two processes, so the driver runs in three phases:
 *
 * - `orchestrate <variant>` launches `before` and then `after` the way it was
 *   itself launched (same Node flags, working directory and environment, so the
 *   same `DSH_HOME` and `./.sessions`), and prints one
 *   `P4-06-SETTLEMENT-CRASH <json>` line holding both readings. `before` alone
 *   gets `P4_06_HOLD=1`, so the child's first request is in flight when it is
 *   interrupted. In the `crash-before-flush`/`crash-after-flush` variants the
 *   orchestrator waits {@link CRASH_RESTART_DELAY_MS} between the phases, past
 *   the Run lease the killed process still holds.
 * - `before <variant>` boots the SHIPPED headless profile with `./base.patch.yml`,
 *   creates the parent after boot, lets it take one turn, starts one continuable
 *   child through `ctx.subagents.startContinuable` whose first request the
 *   scripted model holds open, and interrupts it through `interruptByParent`.
 *   The interrupt drives the child to an `aborted` terminal, whose settlement is
 *   committed to the durable bus, delivered to the parent (a `subagent-settled`
 *   notice spliced as a user message, buffered by the live-write batcher) and
 *   then acknowledged (the outbox row goes `acked`, applyReceipt). Then, per variant:
 *   - `crash-before-flush`: a wrap on the bus's `persistOutbox` kills the process
 *     with SIGKILL the instant the settlement row is acked — inside the same
 *     synchronous drain in which the notice was buffered, before the ≤200 ms
 *     batch timer fires, so the ack is durable but the parent's log never
 *     received the notice on disk. RED today.
 *   - `crash-before-ack`: the same wrap kills the instant BEFORE that persist runs,
 *     so the outbox row is left `pending` (never acked) and the buffered notice is
 *     lost too. On restart the ordinary drain redelivers the still-`pending` row.
 *     GREEN today — BLOCKED-350 closing condition 3.
 *   - `crash-after-flush`: waits until the acked notice has flushed to the parent's
 *     durable log, then SIGKILLs. Control: the effect survives.
 *   - `no-crash`: waits for the flush and disposes cleanly. Control.
 * - `after <variant> <parent> <child>` boots the same profile, reads the durable
 *   bus's outbox rows and the parent's persisted log before anything is reopened,
 *   resumes the parent the way the Web host does, prompts it (its next step is
 *   where the pre-step fallback drain would deliver a settlement still owed), and
 *   counts how many times the settlement notice reached the parent's durable
 *   record. P4-06 acceptance[0] requires exactly one.
 * @module tests/first100/fixtures/loader/p4-06-settlement-crash/driver
 */

import { spawnSync } from 'node:child_process'
import { writeSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-message-bus'
import type {} from '@deepseek-ai/dsh-session-query'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** The route the scripted model registers. */
const PROVIDER = 'p4-06-settlement-crash-mock'
/** The marker that makes the scripted model hold the child's first request open. */
const HOLD_MARKER = 'P4-06-HOLD'
/** The line prefix one phase reports under. */
const PHASE_TAG = 'P4-06-SETTLEMENT-CRASH-PHASE'
/** The `subagent-settled` notice's source kind, the parent-log record of a delivered settlement. */
const SETTLED_KIND = 'subagent-settled'
/** The shipped Run lease term (`run` row default) plus two seconds. */
const CRASH_RESTART_DELAY_MS = 32_000
/** How long `after` waits after boot before it reopens anything. */
const BOOT_WAIT_MS = 1_500
/** No session event for this long counts as settled. */
const QUIET_MS = 1_500
/** Longest wait for a settled tree. */
const SETTLE_LIMIT_MS = 20_000
/** Longest wait for the child's first step. */
const FIRST_STEP_MS = 30_000
/** How long the child's held request runs before it is interrupted. */
const IN_FLIGHT_MS = 300
/** Polling interval for the waits. */
const POLL_MS = 25
/** Deadline for one phase process. */
const PHASE_TIMEOUT_MS = 120_000

/** The variants: the acceptance[0] crash-window RED case, the closing-condition-3 before-ack case, and two controls. */
const VARIANTS = ['crash-before-flush', 'crash-before-ack', 'crash-after-flush', 'no-crash'] as const
type Variant = typeof VARIANTS[number]

/** What one phase process left behind. */
interface PhaseResult {
  readonly status: number | null
  readonly signal: string | null
  readonly reading: Record<string, unknown>
}

/**
 * The code a rejection carries, or its text when it carries none.
 * @param error - the thrown value.
 * @returns the `RemoteError` code, or the error's string form.
 */
function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : String(error)
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
 * Poll an async condition until it holds or `timeoutMs` passes.
 * @param done - the async condition.
 * @param timeoutMs - the longest wait.
 * @returns whether the condition held.
 */
async function untilAsync(done: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
    if (await done()) return true
    await delay(POLL_MS)
  }
  return done()
}

/** The driver's view of every session event, to know when the tree is quiet. */
interface Watch {
  stepStarts(id: string): number
  lastEventAt(): number
}

/**
 * Start counting the session events the waits below depend on.
 * @param ctx - the booted root context.
 * @returns the running tally.
 */
function watchSessions(ctx: Context): Watch {
  const steps = new Map<string, number>()
  let lastEventAt = Date.now()
  ctx.on('session/event', (session, event) => {
    lastEventAt = Date.now()
    if (event.type === 'step/start') steps.set(session.id, (steps.get(session.id) ?? 0) + 1)
  })
  return { stepStarts: id => steps.get(id) ?? 0, lastEventAt: () => lastEventAt }
}

/**
 * Wait until no session event has arrived for {@link QUIET_MS}.
 * @param watch - the running tally.
 * @returns whether the tree settled within {@link SETTLE_LIMIT_MS}.
 */
function settle(watch: Watch): Promise<boolean> {
  return until(() => Date.now() - watch.lastEventAt() >= QUIET_MS, SETTLE_LIMIT_MS)
}

/**
 * The durable bus's outbox rows, reduced to what locates a settlement and says
 * how far its delivery got.
 * @param ctx - the booted root context.
 * @returns the rows, or `null` when no bus is mounted.
 */
function busRows(ctx: Context): readonly Readonly<Record<string, unknown>>[] | null {
  const bus = ctx.get('messageBus')
  if (bus === undefined) return null
  return bus.outboxRows().map(row => ({
    target: row.target,
    id: row.record.id,
    epoch: row.record.epoch,
    state: row.record.state,
    attempts: row.record.attempts,
  }))
}

/**
 * Whether the durable bus holds an `acked` settlement outbox row for one child —
 * the ack this measurement pins the crash around.
 * @param ctx - the booted root context.
 * @param childId - the settled child's session id (the outbox row's message id).
 * @returns whether that row is present and acked.
 */
function settlementAcked(ctx: Context, childId: string): boolean {
  const bus = ctx.get('messageBus')
  if (bus === undefined) return false
  return bus.outboxRows().some(row => String(row.record.id) === childId && row.record.state === 'acked')
}

/**
 * How many times the settlement notice reached one parent's persisted log — the
 * business effect P4-06 acceptance[0] requires to be exactly one.
 * @param ctx - the booted root context.
 * @param parentId - the parent whose durable log is read.
 * @param childId - the settled child the notice names.
 * @returns the count, or `null` when no session query is mounted.
 */
async function settlementEffectCount(ctx: Context, parentId: SessionId, childId: string): Promise<number | null> {
  const query = ctx.get('sessionQuery')
  if (query === undefined) return null
  using observation = await query.observeSession(parentId)
  return observation.events.filter((event) => {
    if (event.type !== 'user/message') return false
    const source = event.data.source as { readonly kind?: unknown; readonly senderSessionId?: unknown }
    return source.kind === SETTLED_KIND && String(source.senderSessionId) === childId
  }).length
}

/**
 * Send the parent one user task, so its next step runs the pre-step fallback drain.
 * @param ctx - the booted root context.
 * @param task - the task text.
 */
async function speakToParent(ctx: Context, task: string): Promise<void> {
  await runFixtureTurn(ctx, { task })
}

/**
 * Print one phase's reading.
 * @param reading - what the phase observed.
 */
function report(reading: Record<string, unknown>): void {
  process.stdout.write(`${PHASE_TAG} ${JSON.stringify(reading)}\n`)
}

/**
 * Wrap the durable bus's `persistOutbox` so the process is killed with SIGKILL
 * the instant one child's settlement row is acked. The notice was spliced into
 * the parent and buffered by the live-write batcher earlier in the SAME
 * synchronous drain, before its ≤200 ms flush timer fires, so the kill leaves
 * the ack durable and the notice never written to the parent's log on disk.
 * @param ctx - the booted root context.
 * @param childId - the settling child's session id.
 * @param readingAtKill - the reading to write synchronously just before the kill.
 * @returns whether the bus was reachable and the kill is armed.
 */
function killWhenSettlementAcked(ctx: Context, childId: string, readingAtKill: () => Record<string, unknown>): boolean {
  // The continuation registry's own bus is the object `drainSettlements` calls
  // `persistOutbox` on to ack a delivered settlement; reach it the way the P5-10
  // restart driver's shutdown trace reaches this registry's private members, so
  // the wrap sees the same call the product makes rather than a proxied copy.
  const runtime = ctx.get('subagents') as unknown as {
    readonly continuations?: { readonly activations?: { bus?: { persistOutbox: (record: { readonly id: unknown; readonly state: unknown }) => void } } }
  } | undefined
  const bus = runtime?.continuations?.activations?.bus
  if (bus === undefined) return false
  const persistOutbox = bus.persistOutbox.bind(bus)
  bus.persistOutbox = (record) => {
    persistOutbox(record)
    if (String(record.id) === childId && record.state === 'acked') {
      // Synchronous write: SIGKILL leaves no later turn in which a buffered
      // stdout could flush, and no microtask in which the parent's batched
      // session write (armed in this same drain) could run.
      writeSync(1, `${PHASE_TAG} ${JSON.stringify(readingAtKill())}\n`)
      process.kill(process.pid, 'SIGKILL')
    }
  }
  return true
}

/**
 * Like {@link killWhenSettlementAcked}, but kill the instant BEFORE the ack is
 * persisted. `drainSettlements` writes the ack with one `persistOutbox` whose
 * record carries `state: 'acked'` (settlement-outbox.ts applies the receipt to a
 * `sent` row); killing before that real write runs leaves the outbox row at its
 * committed `pending` state, never `acked`. The settlement notice spliced earlier
 * in this same drain is still only buffered, so the crash loses it too. On
 * restart the ordinary drain, which delivers only `pending` rows, redelivers this
 * one — BLOCKED-350 closing condition 3, where no reconciler of acked rows is
 * needed because the row was never acked.
 * @param ctx - the booted root context.
 * @param childId - the settling child's session id.
 * @param readingAtKill - the reading to write synchronously just before the kill.
 * @returns whether the bus was reachable and the kill is armed.
 */
function killBeforeSettlementAck(ctx: Context, childId: string, readingAtKill: () => Record<string, unknown>): boolean {
  const runtime = ctx.get('subagents') as unknown as {
    readonly continuations?: { readonly activations?: { bus?: { persistOutbox: (record: { readonly id: unknown; readonly state: unknown }) => void } } }
  } | undefined
  const bus = runtime?.continuations?.activations?.bus
  if (bus === undefined) return false
  const persistOutbox = bus.persistOutbox.bind(bus)
  bus.persistOutbox = (record) => {
    if (String(record.id) === childId && record.state === 'acked') {
      // Before the real persist: the ack never lands, so the row stays `pending`.
      writeSync(1, `${PHASE_TAG} ${JSON.stringify(readingAtKill())}\n`)
      process.kill(process.pid, 'SIGKILL')
    }
    persistOutbox(record)
  }
  return true
}

/**
 * The phase before the restart: a parent, a child whose first turn is in flight,
 * an interrupt that settles the child, and a kill placed by the variant.
 * @param ctx - the booted root context.
 * @param variant - which crash (or none) follows.
 */
async function before(ctx: Context, variant: Variant): Promise<void> {
  const subagents = ctx.get('subagents')
  if (subagents === undefined) throw new Error('p4-06 settlement-crash driver: the subagent service is not mounted')
  await createFixtureRootAgent(ctx, { provider: PROVIDER, model: PROVIDER, cwd: process.cwd() })
  const [parent] = ctx.agents.roots()
  if (parent === undefined) throw new Error('p4-06 settlement-crash driver: no root agent after creation')
  const watch = watchSessions(ctx)
  await runFixtureTurn(ctx, { task: 'P4-06 settlement crash: the parent takes one turn before it starts a child.' })

  const started = await subagents.startContinuable({
    provider: 'spawn',
    label: 'p4-06 settlement-crash child',
    request: { prompt: [{ type: 'text', text: `${HOLD_MARKER}: the child takes its first turn.` }], parent },
    signal: new AbortController().signal,
  })
  const child = started.childId
  const inFlight = await until(() => watch.stepStarts(child) >= 1, FIRST_STEP_MS)
  await delay(IN_FLIGHT_MS)
  const ids = { parent: parent.id, child }
  const killReading = (): Record<string, unknown> => ({
    ids,
    variant,
    inFlight,
    killedAtSettlementAck: true,
    settlementAcked: settlementAcked(ctx, child),
    busRows: busRows(ctx),
  })
  const armed = variant === 'crash-before-flush' && killWhenSettlementAcked(ctx, child, killReading)
  const armedBeforeAck = variant === 'crash-before-ack' && killBeforeSettlementAck(ctx, child, killReading)

  let interrupt: unknown
  try {
    interrupt = subagents.interruptByParent(child, parent.id, 'continuable')
  } catch (error: unknown) {
    interrupt = { error: errorCode(error) }
  }
  const interruptRequested = !(typeof interrupt === 'object' && interrupt !== null && 'error' in interrupt)

  if (variant === 'crash-before-flush') {
    // Wait for the armed kill to fire on the settlement ack. If it never does,
    // fall through to a reading so the case reports rather than hangs.
    await until(() => false, SETTLE_LIMIT_MS)
    report({ ids, variant, inFlight, interruptRequested, armed, settlementAcked: settlementAcked(ctx, child), note: 'settlement not acked within the limit', busRows: busRows(ctx) })
    return
  }

  if (variant === 'crash-before-ack') {
    // Wait for the armed kill to fire the instant before the ack persists. If it
    // never does, fall through to a reading so the case reports rather than hangs.
    await until(() => false, SETTLE_LIMIT_MS)
    report({ ids, variant, inFlight, interruptRequested, armed: armedBeforeAck, settlementAcked: settlementAcked(ctx, child), note: 'settlement did not reach the ack within the limit', busRows: busRows(ctx) })
    return
  }

  // Both controls let the settlement deliver and flush before ending: wait for
  // the ack (the outbox row goes `acked`) and then for the notice to reach the
  // parent's persisted log (the batch drains to disk).
  const acked = await until(() => settlementAcked(ctx, child), SETTLE_LIMIT_MS)
  const flushed = await untilAsync(async () => ((await settlementEffectCount(ctx, parent.id, child)) ?? 0) >= 1, SETTLE_LIMIT_MS)
  const settled = await settle(watch)

  if (variant === 'crash-after-flush') {
    writeSync(1, `${PHASE_TAG} ${JSON.stringify({ ids, variant, inFlight, interruptRequested, acked, flushed, settled, killedAfterFlush: true, busRows: busRows(ctx) })}\n`)
    process.kill(process.pid, 'SIGKILL')
    return
  }

  // no-crash: report and let the finally-block dispose cleanly.
  report({ ids, variant, inFlight, interruptRequested, acked, flushed, settled, busRows: busRows(ctx) })
}

/**
 * The phase after the restart: read the durable record, resume the parent, prompt
 * it, and count how many times the settlement reached its durable log.
 * @param ctx - the booted root context.
 * @param parentId - the parent's session id from `before`.
 * @param childId - the child's session id from `before`.
 */
async function after(ctx: Context, parentId: SessionId, childId: string): Promise<void> {
  const watch = watchSessions(ctx)
  await delay(BOOT_WAIT_MS)
  const beforeResume = {
    parentLive: ctx.agents.get(parentId) !== undefined,
    busRows: busRows(ctx),
    settlementAcked: settlementAcked(ctx, childId),
    // Read before anything is reopened: the notice is here only if it flushed
    // to disk before the crash.
    effectCount: await settlementEffectCount(ctx, parentId, childId),
  }

  // What the Web host does when a client opens the session.
  const { agent: parent } = await ctx.agents.resume({
    resumeSessionId: parentId,
    agentOptions: { provider: PROVIDER, model: PROVIDER },
  })
  const resumeSettled = await settle(watch)
  const afterResume = { settled: resumeSettled, effectCount: await settlementEffectCount(ctx, parentId, childId), busRows: busRows(ctx) }

  // The user speaks to the parent: its next step is where the pre-step fallback
  // drain would deliver a settlement still owed to it.
  await speakToParent(ctx, 'P4-06 settlement crash: the user speaks to the parent after the restart.')
  const promptSettled = await settle(watch)
  report({
    parentResumed: parent.id === parentId,
    beforeResume,
    afterResume,
    afterPrompt: { settled: promptSettled, effectCount: await settlementEffectCount(ctx, parentId, childId), busRows: busRows(ctx) },
  })
}

/**
 * Run one phase in a fresh process launched the way this one was.
 * @param args - the phase's arguments after the script path.
 * @param env - the phase's environment.
 * @returns how it exited and what it reported.
 */
function runPhase(args: readonly string[], env: NodeJS.ProcessEnv): PhaseResult {
  const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...args], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: PHASE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024 * 1024,
  })
  const json = new RegExp(`${PHASE_TAG} (?<json>.+)`, 'u').exec(result.stdout)?.groups?.json
  if (json === undefined) {
    throw new Error(`p4-06 settlement-crash phase ${args.join(' ')} reported nothing (status ${String(result.status)}, signal ${String(result.signal)}); stderr tail:\n${result.stderr.slice(-1500)}`)
  }
  return { status: result.status, signal: result.signal, reading: JSON.parse(json) as Record<string, unknown> }
}

/**
 * Narrow a command-line word to a variant.
 * @param value - the word.
 * @returns whether it names a variant.
 */
function isVariant(value: string | undefined): value is Variant {
  return VARIANTS.some(variant => variant === value)
}

const [configPath, phase, variant, parentArg, childArg] = process.argv.slice(2)
if (configPath === undefined || !isVariant(variant)) {
  throw new Error('p4-06 settlement-crash driver requires a config path, a phase and a variant')
}

if (phase === 'orchestrate') {
  const first = runPhase([configPath, 'before', variant], { ...process.env, P4_06_HOLD: '1' })
  const ids = first.reading.ids as { readonly parent: string; readonly child: string }
  const restartDelayMs = variant === 'no-crash' ? 0 : CRASH_RESTART_DELAY_MS
  await delay(restartDelayMs)
  const second = runPhase([configPath, 'after', variant, ids.parent, ids.child], process.env)
  process.stdout.write(`P4-06-SETTLEMENT-CRASH ${JSON.stringify({ variant, before: first, restartDelayMs, after: second })}\n`)
} else if (phase === 'before' || phase === 'after') {
  const ctx = await bootProductionProfile({
    binName: 'p4-06-settlement-crash',
    profile: 'headless',
    overlayPaths: [resolveConfigPath(configPath, undefined)],
  })
  try {
    if (phase === 'before') {
      await before(ctx, variant)
    } else {
      if (parentArg === undefined || childArg === undefined) throw new Error('p4-06 settlement-crash driver: `after` requires the parent and child ids')
      await after(ctx, SessionId(parentArg), childArg)
    }
  } finally {
    await ctx.fiber.dispose()
  }
} else {
  throw new Error(`p4-06 settlement-crash driver: unknown phase ${String(phase)}`)
}

/**
 * Driver for P5-10 question 13's measurement: what a host restart does to a
 * continuable child that was being cancelled.
 *
 * One host restart is two processes, so the driver runs in three phases:
 *
 * - `orchestrate <variant>` launches `before` and then `after` the way it was
 *   itself launched (same Node flags, working directory and environment, so
 *   the same `DSH_HOME` and `./.sessions`), and prints one
 *   `P5-10-RESTART <json>` line holding both readings. `before` alone gets
 *   `P5_10_HOLD=1`, and in the two `shutdown-while-cancelling` variants
 *   `P5_10_ABORT_DELAY_MS`, so the child's held request takes that long to
 *   end once cancelled. In the `crash` variant the orchestrator waits
 *   {@link CRASH_RESTART_DELAY_MS} between the phases, past the Run lease the
 *   killed process still holds; in `shutdown-while-cancelling-parent-continues`
 *   it starts `after` with `P5_10_PARENT_CONTINUES=1`, which makes the
 *   scripted parent answer a stopped-child notice with `send_message` to that
 *   child.
 * - `before <variant>` boots the SHIPPED headless profile with
 *   `./base.patch.yml`, creates the parent after boot, lets it take one turn,
 *   starts one continuable child through `ctx.subagents.startContinuable`
 *   whose first request the scripted model holds open, and cancels it through
 *   `interruptByParent`, the call the Web client's Stop makes. Then:
 *   - `graceful` waits for the child to stop and leave residency, sends it one
 *     prompt through `ctx.subagents.prompt`, and disposes the tree;
 *   - `shutdown-while-cancelling*` sends that prompt at once and disposes the
 *     tree while the child's cancelled request is still ending;
 *   - `crash` writes its reading and kills itself with SIGKILL.
 * - `after <variant> <parent> <child>` boots the same profile, reads what the
 *   child did before anything is reopened, resumes the parent the way the Web
 *   host does when a client opens it, reads again, sends the child one prompt,
 *   reads a third time, lets the user send the parent one task, and reads a
 *   fourth time. Every reading includes the durable bus's outbox rows.
 * @module tests/first100/fixtures/loader/p5-10-restart/driver
 */

import { spawnSync } from 'node:child_process'
import { writeSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-message-bus'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SubagentInterruptReceipt, SubagentPromptRequest, SubagentPromptRequestId } from '@deepseek-ai/dsh-subagent'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** The route the scripted model registers. */
const PROVIDER = 'p5-10-restart-mock'
/** The marker that makes the scripted model hold a request open. */
const HOLD_MARKER = 'P5-10-HOLD'
/** The line prefix one phase reports under. */
const PHASE_TAG = 'P5-10-PHASE'
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
/** How long the child's held request runs before it is cancelled. */
const IN_FLIGHT_MS = 300
/** Polling interval for the waits above. */
const POLL_MS = 25
/** Deadline for one phase process. */
const PHASE_TIMEOUT_MS = 120_000

/** How long a cancelled held request takes to end in the `shutdown-while-cancelling` variants. */
const SLOW_ABORT_MS = 3_000

/** The four restarts the measurement covers. */
const VARIANTS = ['graceful', 'shutdown-while-cancelling', 'shutdown-while-cancelling-parent-continues', 'crash'] as const
type Variant = typeof VARIANTS[number]

/** What `interruptByParent` returned, or the code it threw. */
type InterruptReading = SubagentInterruptReceipt | { readonly error: string }

/** How one prompt settled. */
type Outcome = { readonly delivered: string } | { readonly refused: string }

/** What one session did while the driver watched. */
interface Tally {
  turnStarts: number
  turnEnds: number
  stepStarts: number
  readonly turnEndReasons: string[]
  readonly userMessages: { readonly source: string; readonly text: string }[]
  readonly rpcIds: string[]
}

/** The driver's view of every session event and agent status it saw. */
interface Watch {
  tally(id: string): Tally
  statuses(id: string): readonly string[]
  sessionsSeen(): readonly string[]
  lastEventAt(): number
}

/** What one phase process left behind. */
interface PhaseResult {
  readonly status: number | null
  readonly signal: string | null
  readonly reading: Record<string, unknown>
  /** The phase's stderr lines that mention a settlement, the outbox or the bus, at most 20. */
  readonly notes: readonly string[]
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
 * Start counting every session event and agent status in the tree.
 * @param ctx - the booted root context.
 * @returns the running tally.
 */
function watchSessions(ctx: Context): Watch {
  const tallies = new Map<string, Tally>()
  const statuses = new Map<string, string[]>()
  let lastEventAt = Date.now()
  const tally = (id: string): Tally => {
    let entry = tallies.get(id)
    if (entry === undefined) {
      entry = { turnStarts: 0, turnEnds: 0, stepStarts: 0, turnEndReasons: [], userMessages: [], rpcIds: [] }
      tallies.set(id, entry)
    }
    return entry
  }
  ctx.on('session/event', (session, event) => {
    lastEventAt = Date.now()
    const entry = tally(session.id)
    if (event.type === 'turn/start') entry.turnStarts += 1
    if (event.type === 'step/start') entry.stepStarts += 1
    if (event.type === 'turn/end') {
      entry.turnEnds += 1
      entry.turnEndReasons.push(event.data.reason.kind)
    }
    if (event.type === 'user/message') {
      const source = event.data.source as { readonly kind?: unknown; readonly rpcId?: unknown }
      const text = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(' ')
      entry.userMessages.push({ source: typeof source.kind === 'string' ? source.kind : 'unknown', text: text.slice(0, 160) })
      if (typeof source.rpcId === 'string') entry.rpcIds.push(source.rpcId)
    }
  })
  ctx.on('agent/status', ({ agent, status }) => {
    statuses.set(agent.id, [...statuses.get(agent.id) ?? [], status])
  })
  return {
    tally,
    statuses: id => statuses.get(id) ?? [],
    sessionsSeen: () => [...tallies.keys()],
    lastEventAt: () => lastEventAt,
  }
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
 * Send the child one browser-authored prompt through the parent.
 * @param subagents - the subagent service.
 * @param parent - the live parent's session id.
 * @param child - the child's session id.
 * @param requestId - the prompt's request id.
 * @param text - the prompt's text.
 * @returns whether it was delivered, and the refusal code when it was not.
 */
function prompt(subagents: Context['subagents'], parent: SessionId, child: SessionId, requestId: string, text: string): Promise<Outcome> {
  const request: SubagentPromptRequest = {
    requestId: brandString<SubagentPromptRequestId>(requestId),
    parentSessionId: parent,
    childSessionId: child,
    mode: 'continuable',
    delivery: 'queue',
    content: [{ type: 'text', text }],
  }
  return subagents.prompt(request, new AbortController().signal).then(
    (receipt): Outcome => ({ delivered: receipt.messageId }),
    (error: unknown): Outcome => ({ refused: errorCode(error) }),
  )
}

/**
 * Every row the durable bus's outbox holds, reduced to what locates a
 * settlement and says how far its delivery got.
 * @param ctx - the booted root context.
 * @returns the rows, or `null` when no bus is mounted.
 */
function busRows(ctx: Context): readonly Readonly<Record<string, unknown>>[] | null {
  const bus = ctx.get('messageBus')
  if (bus === undefined) return null
  return bus.outboxRows().map((row) => {
    const summary = (row.payload as { readonly summary?: unknown } | null)?.summary
    return {
      target: row.target,
      id: row.record.id,
      epoch: row.record.epoch,
      state: row.record.state,
      attempts: row.record.attempts,
      summary: typeof summary === 'string' ? summary.slice(0, 80) : null,
    }
  })
}

/**
 * Print one phase's reading.
 * @param reading - what the phase observed.
 */
function report(reading: Record<string, unknown>): void {
  process.stdout.write(`${PHASE_TAG} ${JSON.stringify(reading)}\n`)
}

/**
 * The phase before the restart: a parent, a child whose first turn is in
 * flight, and a cancel through `interruptByParent`.
 * @param ctx - the booted root context.
 * @param variant - which restart follows.
 */
async function before(ctx: Context, variant: Variant): Promise<void> {
  const subagents = ctx.get('subagents')
  if (subagents === undefined) throw new Error('p5-10 restart driver: the subagent service is not mounted')
  await createFixtureRootAgent(ctx, { provider: PROVIDER, model: PROVIDER, cwd: process.cwd() })
  const [parent] = ctx.agents.roots()
  if (parent === undefined) throw new Error('p5-10 restart driver: no root agent after creation')
  const watch = watchSessions(ctx)
  await runFixtureTurn(ctx, { task: 'P5-10 restart: the parent takes one turn before it starts a child.' })

  const started = await subagents.startContinuable({
    provider: 'spawn',
    label: 'p5-10 restart child',
    request: { prompt: [{ type: 'text', text: `${HOLD_MARKER}: the child takes its first turn.` }], parent },
    signal: new AbortController().signal,
  })
  const child = started.childId
  const inFlight = await until(() => watch.tally(child).stepStarts >= 1, FIRST_STEP_MS)
  await delay(IN_FLIGHT_MS)
  const ids = { parent: parent.id, child }
  const parentTurnEndsAtInterrupt = watch.tally(parent.id).turnEnds
  let interrupt: InterruptReading
  try {
    interrupt = subagents.interruptByParent(child, parent.id, 'continuable')
  } catch (error: unknown) {
    interrupt = { error: errorCode(error) }
  }
  if (variant === 'crash') {
    // Written with a synchronous write: SIGKILL leaves no later turn in which
    // a buffered stdout could flush. No microtask runs before the kill, so
    // nothing the cancel causes is written to the session log on disk.
    writeSync(1, `${PHASE_TAG} ${JSON.stringify({ ids, inFlight, interrupt, childLive: ctx.agents.get(child) !== undefined })}\n`)
    process.kill(process.pid, 'SIGKILL')
  }

  if (variant !== 'graceful') {
    // The prompt's refusal is decided before its first await, so the tree is
    // disposed below while the child's cancelled request is still ending.
    const outcome = await prompt(subagents, parent.id, child, 'p5-10-before-restart', 'P5-10: take another turn before the restart.')
    report({
      ids,
      inFlight,
      interrupt,
      outcome,
      busRowsBeforeDispose: busRows(ctx),
      childEpochBeforeDispose: ctx.agents.get(child)?.lifecycle?.epoch ?? null,
      parentTurnEndsAtInterrupt,
      parent: watch.tally(parent.id),
      child: watch.tally(child),
      childStatuses: watch.statuses(child),
      childLive: ctx.agents.get(child) !== undefined,
    })
    return
  }

  const childStopped = await until(() => watch.tally(child).turnEnds >= 1, SETTLE_LIMIT_MS)
  const childReleased = await until(() => ctx.agents.get(child) === undefined, SETTLE_LIMIT_MS)
  const releaseSettled = await settle(watch)
  const outcome = await prompt(subagents, parent.id, child, 'p5-10-before-restart', 'P5-10: take another turn before the restart.')
  const settled = await settle(watch)
  report({
    ids,
    inFlight,
    interrupt,
    childStopped,
    childReleased,
    releaseSettled,
    outcome,
    settled,
    busRowsBeforeDispose: busRows(ctx),
    parentTurnEndsAtInterrupt,
    parent: watch.tally(parent.id),
    child: watch.tally(child),
    childStatuses: watch.statuses(child),
    childLive: ctx.agents.get(child) !== undefined,
  })
}

/**
 * The phase after the restart: nothing reopened, then the parent resumed, then
 * one prompt to the child.
 * @param ctx - the booted root context.
 * @param parentId - the parent's session id from `before`.
 * @param childId - the child's session id from `before`.
 */
async function after(ctx: Context, parentId: SessionId, childId: SessionId): Promise<void> {
  const subagents = ctx.get('subagents')
  if (subagents === undefined) throw new Error('p5-10 restart driver: the subagent service is not mounted')
  const watch = watchSessions(ctx)
  await delay(BOOT_WAIT_MS)
  const beforeResume = {
    parentLive: ctx.agents.get(parentId) !== undefined,
    childLive: ctx.agents.get(childId) !== undefined,
    childSessionOpen: ctx.sessions.get(childId) !== undefined,
    sessionsWithEvents: watch.sessionsSeen(),
    childStatuses: watch.statuses(childId),
    busRows: busRows(ctx),
  }

  // What the Web host does when a client opens the session
  // (`session-controller/src/agent.ts` `resumeObserved`).
  const { agent: parent } = await ctx.agents.resume({
    resumeSessionId: parentId,
    agentOptions: { provider: PROVIDER, model: PROVIDER },
  })
  const resumeSettled = await settle(watch)
  const afterResume = {
    settled: resumeSettled,
    parent: structuredClone(watch.tally(parentId)),
    child: structuredClone(watch.tally(childId)),
    childLive: ctx.agents.get(childId) !== undefined,
    childStatuses: [...watch.statuses(childId)],
    busRows: busRows(ctx),
  }

  const outcome = await prompt(subagents, parent.id, childId, 'p5-10-after-restart', 'P5-10: take a turn after the restart.')
  const promptSettled = await settle(watch)
  // Read from the persisted log: a child that settled is no longer published
  // in `ctx.sessions`.
  let childLogTurns: { readonly turnStarts: number; readonly turnEnds: number } | null = null
  const query = ctx.get('sessionQuery')
  if (query !== undefined) {
    using observation = await query.observeSession(childId)
    childLogTurns = {
      turnStarts: observation.events.filter(event => event.type === 'turn/start').length,
      turnEnds: observation.events.filter(event => event.type === 'turn/end').length,
    }
  }
  const afterPrompt = {
    outcome,
    settled: promptSettled,
    parent: structuredClone(watch.tally(parentId)),
    child: structuredClone(watch.tally(childId)),
    childLive: ctx.agents.get(childId) !== undefined,
    childStatuses: [...watch.statuses(childId)],
    childLogTurns,
    busRows: busRows(ctx),
  }

  // The user speaks to the parent: its next step is where the pre-step
  // fallback drain would deliver a settlement still owed to it.
  const parentMessagesBefore = watch.tally(parentId).userMessages.length
  await runFixtureTurn(ctx, { task: 'P5-10: the user speaks to the parent after the restart.' })
  const parentPromptSettled = await settle(watch)
  report({
    beforeResume,
    afterResume,
    afterPrompt,
    afterParentPrompt: {
      settled: parentPromptSettled,
      parentMessages: watch.tally(parentId).userMessages.slice(parentMessagesBefore),
      parentTurnEndReasons: watch.tally(parentId).turnEndReasons,
      busRows: busRows(ctx),
    },
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
  const json = /P5-10-PHASE (?<json>.+)/u.exec(result.stdout)?.groups?.json
  if (json === undefined) {
    throw new Error(`p5-10 restart phase ${args.join(' ')} reported nothing (status ${String(result.status)}, signal ${String(result.signal)}); stderr tail:\n${result.stderr.slice(-1500)}`)
  }
  return {
    status: result.status,
    signal: result.signal,
    reading: JSON.parse(json) as Record<string, unknown>,
    notes: result.stderr.split('\n').filter(line => /settle|outbox|\bbus\b/iu.test(line)).slice(0, 20),
  }
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
  throw new Error('p5-10 restart driver requires a config path, a phase and a variant')
}

if (phase === 'orchestrate') {
  const slowAbort = variant === 'shutdown-while-cancelling' || variant === 'shutdown-while-cancelling-parent-continues'
  const first = runPhase([configPath, 'before', variant], {
    ...process.env,
    P5_10_HOLD: '1',
    P5_10_ABORT_DELAY_MS: String(slowAbort ? SLOW_ABORT_MS : 0),
  })
  const ids = first.reading.ids as { readonly parent: string; readonly child: string }
  const restartDelayMs = variant === 'crash' ? CRASH_RESTART_DELAY_MS : 0
  await delay(restartDelayMs)
  const second = runPhase(
    [configPath, 'after', variant, ids.parent, ids.child],
    variant === 'shutdown-while-cancelling-parent-continues' ? { ...process.env, P5_10_PARENT_CONTINUES: '1' } : process.env,
  )
  process.stdout.write(`P5-10-RESTART ${JSON.stringify({ variant, before: first, restartDelayMs, after: second })}\n`)
} else if (phase === 'before' || phase === 'after') {
  const ctx = await bootProductionProfile({
    binName: 'p5-10-restart',
    profile: 'headless',
    overlayPaths: [resolveConfigPath(configPath, undefined)],
  })
  try {
    if (phase === 'before') {
      await before(ctx, variant)
    } else {
      if (parentArg === undefined || childArg === undefined) throw new Error('p5-10 restart driver: `after` requires the parent and child ids')
      await after(ctx, SessionId(parentArg), SessionId(childArg))
    }
  } finally {
    await ctx.fiber.dispose()
  }
} else {
  throw new Error(`p5-10 restart driver: unknown phase ${String(phase)}`)
}

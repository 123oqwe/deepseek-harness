/**
 * Schedules one assistant step's tool calls. Exclusive calls form barriers;
 * parallel calls use a bounded rolling pool and are reclassified before start.
 * Dispatch may overlap, while policy, results, and result context remain
 * model-ordered. Abort or an internal scheduler failure stops replenishment
 * and drains started calls.
 *
 * Abort records synthetic error results for skipped calls so replay stays
 * valid. A terminal scheduler failure preserves already-recorded `tool/call`
 * events without fabricating results.
 * @module dsh-agent-loop/tool-calls
 */

import type { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, type ToolCallBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionSeq, UserMessage } from '@deepseek-ai/dsh-session'
import { TOOL_ABORTED_BEFORE_DISPATCH, TOOL_RUNTIME_SCHEDULER, type ToolExecutionInput, type ToolExecutionMode, type ToolExecutionResult, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { appendManifestThenGate, computeArgumentsHash, manifestAttribution, manifestIdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { ActionId, ArgumentsHash, CapabilityRef, IdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { LedgerScope } from '@deepseek-ai/dsh-action-ledger'
// The `actionLedger` service augmentation lives in the ledger package's runtime
// face; a type-only import of the entry makes `ctx.get('actionLedger')` typed
// here without this package depending on the plugin at run time.
import type {} from '@deepseek-ai/dsh-action-ledger'
import { attachedIdentity } from '@deepseek-ai/dsh-session'
import { advanceLeasedAgent } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import { createSessionManifestAppender } from '@deepseek-ai/dsh-tools/manifest-log'
// The reserve/confirm pair lives in `dsh-tools` so the code-mode dispatch can
// reach it too: a second copy here is what left code-mode unreserved (§12.35-2).
import { confirmExternalEffect, refusedReservationResult, reserveExternalEffect } from '@deepseek-ai/dsh-tools/external-effect'
import type { Principal } from '@deepseek-ai/dsh-principal'
import { brandString } from '@deepseek-ai/dsh-brand'

/** One tool call after argument parsing, ready to schedule. */
interface PlannedCall {
  block: ToolCallBlock
  exec: ToolExecutionInput
}

/** Settled dispatch awaiting model-order finalization. */
interface Slot {
  exec: ToolRunContext
  result: ToolExecutionResult
  needsPost: boolean
}

/** One scheduler group outcome, including a drained cancellation. */
interface GroupOutcome {
  consumed: number
  aborted: boolean
  /** Whether any committed result carried {@link ToolExecutionResult.concludesTurn}. */
  concluded: boolean
}

/**
 * Schedule one assistant step's tool calls by their live concurrency mode.
 * Ordinary completion and abort commit started-call results in order. Abort
 * drains them, records synthetic results for unstarted calls, and returns with
 * the signal still aborted after accepting started-call context through the
 * caller-supplied acceptor (the machine stages it in its next-step inbox for the
 * step boundary). An internal scheduler failure stops new dispatches, drains
 * already-started dispatches, and rejects with the first failure without
 * fabricating tool results.
 * The committed step's AgentLoop driver boundary supplies the initiating Agent
 * that becomes each explicit {@link ToolExecutionInput.agent}.
 *
 * @param ctx - loop context that owns the tool registry and carries the initiating Agent.
 * @param turn - current turn number.
 * @param step - current step number.
 * @param toolCalls - assistant calls in model order.
 * @param signal - abort signal shared by the step.
 * @param acceptContext - accepts committed result context for the next step boundary.
 */
export async function executeToolCalls(
  ctx: Context,
  turn: number,
  step: number,
  toolCalls: ToolCallBlock[],
  signal: AbortSignal,
  acceptContext: (context: UserMessage) => void,
): Promise<{ concluded: boolean }> {
  const agent = ctx.agents.requireInitiator()

  // P4-07 must[1]: the state write this dispatch is about to make carries the
  // Run's fencing token. The token is the one the Run Service took when it
  // opened this Run, checked against the store's CURRENT lease — so a host
  // whose Run was reclaimed while it was thinking is refused here, before it
  // dispatches a single tool, rather than discovering it when its results are
  // ignored. Read from the AGENT rather than from the Run Service:
  // `@deepseek-ai/dsh-run` already depends on this package, so calling back
  // into it would be a cycle. An agent with no lease answers `no-run`, which
  // is what a composition without a Run Service gets, and dispatches normally.
  const fencing = advanceLeasedAgent(agent, 'waiting_tool', `dispatching ${String(toolCalls.length)} tool call(s)`)
  if (fencing === 'fenced' || fencing === 'lease-refused') {
    // Every call gets its ordered synthetic result: the model must see that
    // its calls did not run, and a silent drop would leave the turn's log
    // claiming calls that neither executed nor failed.
    //
    // The two refusals are named apart because the operator's next step
    // differs: a fenced run HELD its work item and lost it, so another host is
    // already doing the work; a lease-refused run never held it, so this host
    // simply lost the race and its own start is the thing to look at.
    for (const block of toolCalls) appendUnauthorizedToolCall(agent, turn, step, block, fencing)
    return { concluded: false }
  }

  // Inputs are distinct because tools/execute wrappers may replace `exec.signal`.
  const planned: PlannedCall[] = toolCalls.map(block => ({
    block,
    exec: {
      callId: block.id,
      name: block.name,
      arguments: parseArguments(block.arguments),
      agent,
      signal,
    },
  }))

  let next = 0
  let concluded = false
  while (next < planned.length) {
    // Commit before classifying again so registry changes affect unstarted calls.
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
    const first = planned[next]!
    const mode = ctx.tools.executionMode(first.exec).kind
    const group = mode === 'parallel' ? planned.slice(next) : [first]
    const outcome = await runGroup(
      ctx, turn, step, group, mode, signal, acceptContext,
    )
    next += outcome.consumed
    concluded ||= outcome.concluded
    if (outcome.aborted) {
      for (const call of planned.slice(next)) appendSkippedToolCall(agent, turn, step, call.block)
      return { concluded }
    }
  }
  return { concluded }
}

/** Parse model arguments, preserving invalid JSON as text and mapping empty input to `{}`. */
function parseArguments(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return raw
  }
}

/**
 * Run one exclusive barrier or parallel pool. Later calls are reclassified
 * before start; an exclusive reclassification waits for the current pool to
 * drain and remains for the caller's next barrier. Results and contexts commit
 * in model order. Abort stops starts, drains and commits started calls, accepts
 * their contexts into the owning batch, records results for skipped calls, and
 * returns an aborted outcome. Scheduler failure drains dispatches without
 * committing synthetic recovery results.
 */
async function runGroup(
  ctx: Context,
  turn: number,
  step: number,
  group: PlannedCall[],
  mode: ToolExecutionMode['kind'],
  signal: AbortSignal,
  acceptContext: (context: UserMessage) => void,
): Promise<GroupOutcome> {
  const agent = ctx.agents.requireInitiator()
  const { session } = agent
  const { maxParallelToolCalls } = ctx.agentLoop.config
  const slots: (Slot | undefined)[] = group.map(() => undefined)
  // Started slots retain their `tool/call` seq so the result can cite it.
  const callSeqs: Array<SessionSeq | undefined> = group.map(() => undefined)
  // And their reservation, so the ledger can be told what the effect returned.
  const records: Array<ManifestRecord | undefined> = group.map(() => undefined)
  let nextToStart = 0
  let committed = 0
  let started = 0
  let aborted: boolean = signal.aborted
  let concluded = false
  let schedulerFailure: { error: unknown } | undefined
  const throwSchedulerFailure = (): void => {
    if (schedulerFailure !== undefined) throw schedulerFailure.error
  }

  // `committed` advances only across contiguous model-order slots.
  const commitReady = async (): Promise<void> => {
    while (committed < group.length) {
      const slot = slots[committed]
      if (slot === undefined) break
      const call = group[committed]
      const result = slot.needsPost
        ? await ctx.tools[TOOL_RUNTIME_SCHEDULER].finalize(slot.exec, slot.result)
        : ctx.tools[TOOL_RUNTIME_SCHEDULER].finish(slot.exec, slot.result)
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded index
      appendToolResult(session, turn, step, call!.block, result, callSeqs[committed]!)
      confirmExternalEffect(ctx, agent, records[committed], result)
      for (const context of result.additionalContexts ?? []) acceptContext(context)
      concluded ||= result.concludesTurn === true
      committed++
    }
  }

  const inFlight = new Map<number, Promise<number>>()

  const startCall = async (index: number): Promise<void> => {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded index
    const call = group[index]!
    const appended = appendToolCall(agent, turn, step, call.block)
    callSeqs[index] = appended.seq
    records[index] = appended.record
    started++
    // must[4]: the reservation is taken BEFORE the tool runs, so a crash
    // between here and the tool's own commit leaves a durable record that this
    // effect was already claimed. A refusal is a settled outcome, not an
    // error: the first attempt's effect already happened, or the arguments
    // disagree with the reservation, or the state needs a reconciler.
    const refused = reserveExternalEffect(ctx, agent, appended.record)
    if (refused !== undefined) {
      // The prepared exec is what the slot carries; a refusal happens before
      // `prepare`, so the scheduler's own context does not exist yet and the
      // planned input stands in for it.
      slots[index] = { exec: call.exec as unknown as ToolRunContext, result: refusedReservationResult(refused), needsPost: false }
      return
    }
    const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare(call.exec)
    throwSchedulerFailure()
    switch (prepared.kind) {
      case 'dispatch': {
        const promise = ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(prepared.exec).then(
          (outcome) => {
            slots[index] = { exec: prepared.exec, result: outcome.result, needsPost: outcome.kind === 'post-result' }
            return index
          },
          (error: unknown) => {
            schedulerFailure ??= { error }
            return index
          },
        )
        inFlight.set(index, promise)
        break
      }
      case 'post-result':
        slots[index] = { exec: prepared.exec, result: prepared.result, needsPost: true }
        break
      case 'final-result':
        slots[index] = { exec: prepared.exec, result: prepared.result, needsPost: false }
        break
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        assertNever(prepared, 'tool-call scheduler prepare result')
    }
  }

  const fillPool = async (): Promise<void> => {
    while (!aborted && nextToStart < group.length && inFlight.size < maxParallelToolCalls) {
      // Re-read later modes after ordered commits so registry changes can create a barrier.
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
      const nextCall = group[nextToStart]!
      if (nextToStart > 0 && mode === 'parallel'
        && ctx.tools.executionMode(nextCall.exec).kind !== 'parallel') break
      await startCall(nextToStart)
      nextToStart++
      throwSchedulerFailure()
      await commitReady()
      throwSchedulerFailure()
      // Abort may arrive while pre-execute awaits.
      if (signal.aborted) aborted = true
    }
  }

  // Ordered pre-execute may await; only dispatch/body overlaps. A scheduler
  // failure stops new dispatches and reaches the turn boundary after every
  // already-started dispatch settles.
  try {
    await fillPool()
    while (inFlight.size > 0) {
      const settledIndex = await Promise.race(inFlight.values())
      inFlight.delete(settledIndex)
      throwSchedulerFailure()
      await commitReady()
      throwSchedulerFailure()
      // Abort may arrive while a tool or ordered commit awaits.

      if (signal.aborted) aborted = true
      await fillPool()
    }
  } catch (error: unknown) {
    schedulerFailure ??= { error }
    await Promise.allSettled(inFlight.values())
    throw schedulerFailure.error
  }

  if (aborted) {
    // Started calls and accepted context settle first; every remaining model
    // call then receives an ordered synthetic result before the turn aborts.
    for (const call of group.slice(started)) appendSkippedToolCall(agent, turn, step, call.block)
    return { consumed: group.length, aborted: true, concluded }
  }
  /* v8 ignore next -- unreachable: a non-aborted group commits every started call */
  if (committed !== started) throw new Error('tool-call scheduler: uncommitted settled calls')
  return { consumed: started, aborted: false, concluded }
}

/**
 * Append the durable call/result pair for a call this run had no authority to
 * make (P4-07 must[0], must[1], must[3], acceptance[1]).
 *
 * Distinct from the cancellation path below: an aborted call was this run's own
 * decision, while these two mean this host may not act on its work item at all.
 * The texts differ because the model's next move differs — a cancelled turn may
 * be retried, neither of these may.
 *
 * `fenced` and `lease-refused` are also named apart from each other. A fenced
 * run HELD the item and lost it, so another host is already doing the work; a
 * lease-refused run never held it, so this host lost the race at its own start.
 * An operator sent to look for a takeover that never happened is looking in the
 * wrong place.
 * @param agent - the agent the call belonged to; its session is appended to.
 * @param turn - the turn the call belonged to.
 * @param step - the step the call belonged to.
 * @param block - the model call that will not run.
 * @param reason - whether this run lost the item or was never granted it.
 */
function appendUnauthorizedToolCall(
  agent: Agent,
  turn: number,
  step: number,
  block: ToolCallBlock,
  reason: 'fenced' | 'lease-refused',
): void {
  const { session } = agent
  const { seq: callSeq } = appendToolCall(agent, turn, step, block)
  const message = reason === 'fenced'
    ? 'this run is no longer the owner of its work item'
    : 'this run was refused ownership of its work item'
  appendToolResult(session, turn, step, block, {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: {
      message,
      info: { name: reason === 'fenced' ? 'FencedError' : 'LeaseRefusedError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
  }, callSeq)
}

/** Append the durable call/result pair for a model call skipped after cancellation. */
function appendSkippedToolCall(agent: Agent, turn: number, step: number, block: ToolCallBlock): void {
  const { session } = agent
  const { seq: callSeq } = appendToolCall(agent, turn, step, block)
  appendToolResult(session, turn, step, block, {
    content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
    isError: true,
    error: {
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
  }, callSeq)
}

/**
 * Append a started call's manifest and `tool/call` event.
 * @param agent - the agent dispatching it.
 * @param turn - the turn the call belongs to.
 * @param step - the step the call belongs to.
 * @param block - the model's call.
 * @returns the event seq its result must cite, and the manifest's reservation inputs.
 */
function appendToolCall(agent: Agent, turn: number, step: number, block: ToolCallBlock): { seq: SessionSeq; record: ManifestRecord } {
  const { session } = agent
  const record = appendActionManifest(agent, block, 'native-tool-call')
  const event = session.append('tool/call', { turn, step, callId: block.id, name: block.name, arguments: block.arguments })
  return { seq: event.seq, record }
}


/**
 * Append one call's ActionManifest BEFORE its `tool/call` event, so P2-03
 * acceptance[0] — every external write has a manifest preceding it in the log
 * — is answerable by reading the log in order, with no clock or join needed.
 *
 * Placed inside {@link appendToolCall} rather than beside each caller because
 * that function is the single point every native call passes through: a new
 * dispatch path added later inherits the manifest by construction instead of
 * having to remember it. P2-03 must[2] names two further paths, code-mode
 * embedded calls and plugin RPC, which append through their own entry points.
 *
 * The side-effect class comes from `classifySideEffect(undefined)` here: the
 * tool registry carries no declared class for a native call at this point, and
 * must[2]/acceptance[2] require an unclassifiable action to default to the
 * highest-risk class requiring approval rather than to a convenient guess. A
 * later slice supplying real declarations narrows this without changing the
 * default's direction.
 * @param agent - the agent dispatching it; its session is appended to and its lease epoch recorded.
 * @param block - the tool call about to be dispatched.
 * @param origin - which of must[2]'s execution paths is dispatching it.
 */

function appendActionManifest(agent: Agent, block: ToolCallBlock, origin: 'native-tool-call'): ManifestRecord {
  const { session } = agent
  const argumentsHash = computeArgumentsHash(block.arguments)
  // The run and the actor come from the attached identity TOGETHER. An earlier
  // draft branded the SESSION id as a `RunId`: the field must[0] mandates was
  // present and its value was something else, so two runs of one session shared
  // a "runId" and P4-12 would have keyed a scope on it.
  const attribution = manifestAttribution(attachedIdentity(session), session.id)
  // Through `appendManifestThenGate`, which is must[1]'s order in ONE
  // implementation: construct, durably append, and only then decide whether
  // execution may proceed. Both dispatch paths reached that order by writing
  // it out themselves until §12.33; two copies of a sequence is the shape that
  // lets one of them drift, and the package shipped the shared one with no
  // caller at all.
  //
  // No declared side-effect class is available here: the tool registry carries
  // none for a native call at this point, and `classifySideEffect` inside the
  // construction defaults an unclassifiable action to the highest-risk class
  // requiring approval (acceptance[2]) rather than to a convenient guess.
  const { appended } = appendManifestThenGate(
    createSessionManifestAppender(session, (actorId: string): Principal => ({ ...attribution.actor, id: actorId as Principal['id'] }), () => agent.lifecycle?.epoch),
    {
      actionId: brandString<ActionId>(block.id),
      runId: attribution.runId,
      actor: attribution.actor,
      capability: brandString<CapabilityRef>(block.name),
      origin,
      target: { kind: 'other', ref: block.name },
      args: block.arguments,
      idempotencyKey: manifestIdempotencyKey(session.id, brandString<ActionId>(block.id), argumentsHash),
      preconditions: [],
      expectedDiff: { description: `tool ${block.name} executes with the manifested arguments` },
      compensation: { reversible: false, reason: 'the native tool path declares no compensation; a tool that has one states it in its own manifest contribution' },
      evidenceRequirements: [{ kind: 'external-receipt', description: `the tool/result event for call ${block.id}` }],
    },
  )
  return { key: appended.manifest.idempotencyKey, argumentsHash, scope: attribution.actor.id }
}

/** The reservation inputs one appended manifest supplies to the ledger (P4-12 must[4]). */
interface ManifestRecord {
  readonly key: IdempotencyKey
  readonly argumentsHash: ArgumentsHash
  readonly scope: LedgerScope
}

/** Append a model-ordered result linked to its call event. */
function appendToolResult(
  session: Session,
  turn: number,
  step: number,
  block: ToolCallBlock,
  result: ToolExecutionResult,
  callSeq: SessionSeq,
): void {
  const message = createToolResultMessage({
    callId: block.id,
    content: result.content,
    isError: result.isError,
  })
  session.append('tool/result', {
    turn, step,
    message,
    ...result.error?.info ? { error: result.error.info } : {},
    // The tool's private presentation payload (e.g. a result-time diff),
    // persisted so a UI bridge reproduces the card on replay.
    ...result.meta !== undefined ? { meta: result.meta } : {},
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
}

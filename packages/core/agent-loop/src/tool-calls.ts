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
import { computeArgumentsHash, classifySideEffect, createActionManifest, manifestAttribution, manifestIdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { ActionId, CapabilityRef } from '@deepseek-ai/dsh-action-manifest'
import { attachedIdentity } from '@deepseek-ai/dsh-session'
import { advanceLeasedAgent } from '@deepseek-ai/dsh-agent'
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
  const { session } = agent

  // P4-07 must[1]: the state write this dispatch is about to make carries the
  // Run's fencing token. The token is the one the Run Service took when it
  // opened this Run, checked against the store's CURRENT lease — so a host
  // whose Run was reclaimed while it was thinking is refused here, before it
  // dispatches a single tool, rather than discovering it when its results are
  // ignored. `ctx.get` because the Run Service is optional: a composition
  // without one has no Run, no lease, and no authority to present.
  const fencing = advanceLeasedAgent(agent, 'waiting_tool', `dispatching ${String(toolCalls.length)} tool call(s)`)
  if (fencing === 'fenced') {
    // Every call gets its ordered synthetic result: the model must see that
    // its calls did not run, and a silent drop would leave the turn's log
    // claiming calls that neither executed nor failed.
    for (const block of toolCalls) appendFencedToolCall(session, turn, step, block)
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
      for (const call of planned.slice(next)) appendSkippedToolCall(session, turn, step, call.block)
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
  const { session } = ctx.agents.requireInitiator()
  const { maxParallelToolCalls } = ctx.agentLoop.config
  const slots: (Slot | undefined)[] = group.map(() => undefined)
  // Started slots retain their `tool/call` seq so the result can cite it.
  const callSeqs: Array<SessionSeq | undefined> = group.map(() => undefined)
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
      for (const context of result.additionalContexts ?? []) acceptContext(context)
      concluded ||= result.concludesTurn === true
      committed++
    }
  }

  const inFlight = new Map<number, Promise<number>>()

  const startCall = async (index: number): Promise<void> => {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded index
    const call = group[index]!
    callSeqs[index] = appendToolCall(session, turn, step, call.block)
    started++
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
    for (const call of group.slice(started)) appendSkippedToolCall(session, turn, step, call.block)
    return { consumed: group.length, aborted: true, concluded }
  }
  /* v8 ignore next -- unreachable: a non-aborted group commits every started call */
  if (committed !== started) throw new Error('tool-call scheduler: uncommitted settled calls')
  return { consumed: started, aborted: false, concluded }
}

/**
 * Append the durable call/result pair for a call refused because this host was
 * fenced out of its Run (P4-07 must[1]/must[3]).
 *
 * Distinct from the cancellation path below: an aborted call was this run's own
 * decision, while a fenced one means another holder owns this Run now. The
 * texts differ because the model's next move differs — a cancelled turn may be
 * retried, a fenced one must not be.
 * @param session - the session log to append to.
 * @param turn - the turn the call belonged to.
 * @param step - the step the call belonged to.
 * @param block - the model call that will not run.
 */
function appendFencedToolCall(session: Session, turn: number, step: number, block: ToolCallBlock): void {
  const callSeq = appendToolCall(session, turn, step, block)
  appendToolResult(session, turn, step, block, {
    content: [{ type: 'text', text: 'Error: this run is no longer the owner of its work item' }],
    isError: true,
    error: {
      message: 'this run is no longer the owner of its work item',
      info: { name: 'FencedError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
  }, callSeq)
}

/** Append the durable call/result pair for a model call skipped after cancellation. */
function appendSkippedToolCall(session: Session, turn: number, step: number, block: ToolCallBlock): void {
  const callSeq = appendToolCall(session, turn, step, block)
  appendToolResult(session, turn, step, block, {
    content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
    isError: true,
    error: {
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
  }, callSeq)
}

/** Append a started call and return the event seq that its result must cite. */
function appendToolCall(session: Session, turn: number, step: number, block: ToolCallBlock): SessionSeq {
  appendActionManifest(session, block, 'native-tool-call')
  const event = session.append('tool/call', { turn, step, callId: block.id, name: block.name, arguments: block.arguments })
  return event.seq
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
 * @param session - the session log to append to.
 * @param block - the tool call about to be dispatched.
 * @param origin - which of must[2]'s execution paths is dispatching it.
 */

function appendActionManifest(session: Session, block: ToolCallBlock, origin: 'native-tool-call'): void {
  const classification = classifySideEffect(undefined)
  const argumentsHash = computeArgumentsHash(block.arguments)
  // A REAL ActionManifest, built through the package that owns the record and
  // then appended, rather than an event assembled beside it. BLOCKED-143
  // measured what the old arrangement cost: `createActionManifest` had zero
  // production callers, so must[0]'s "the manifest mandates idempotencyKey"
  // held over a record the product never constructed, and the event carried
  // neither the key nor the actor -- the two fields P4-12's ledger keys on.
  // The run and the actor come from the attached identity TOGETHER. An earlier
  // draft branded the SESSION id as a `RunId`: the field must[0] mandates was
  // present and its value was something else, so two runs of one session shared
  // a "runId" and P4-12 would have keyed a scope on it.
  const attribution = manifestAttribution(attachedIdentity(session), session.id)
  const manifest = createActionManifest({
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
  })
  session.append('action/manifest-appended', {
    actionId: manifest.actionId,
    origin: manifest.origin,
    capability: manifest.capability,
    argumentsHash: manifest.argumentsHash,
    sideEffectClass: manifest.sideEffectClass,
    classified: classification.classified,
    requiresApproval: manifest.requiresApproval,
    // must[0]'s remaining fields, INLINED rather than left reconstructable.
    // `idempotencyKey` is minted by this path from caller-supplied values, so
    // an event without it cannot be rebuilt from anything else in the log
    // (BLOCKED-143).
    runId: manifest.runId,
    actor: manifest.actor.id,
    idempotencyKey: manifest.idempotencyKey,
    // The manifest's own position among this session's manifests. It was the
    // literal `0` on every manifest ever written, which made a field documented
    // as "the monotonic append position" a constant -- acceptance[0] asks
    // whether a manifest PRECEDES its execution, and a position that never
    // advances cannot answer that.
    //
    // Read from the session rather than taken from the event's own `seq`: the
    // payload is built before the append that assigns one. The session owns the
    // counter so that this path and the PTC code-mode path read one number; each
    // counting for itself made the same field mean two things and cost a log
    // scan per call.
    sequence: session.countEventsOfType('action/manifest-appended') + 1,
  })
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

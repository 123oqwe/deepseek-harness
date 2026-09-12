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
import { redactTokenForLog } from '@deepseek-ai/dsh-capability-token'
import type { SignedCapabilityToken } from '@deepseek-ai/dsh-capability-token'
import type { ActionManifest } from '@deepseek-ai/dsh-action-manifest'
import { enforceManifestedAction } from '@deepseek-ai/dsh-policy-enforcement'
import type { ExecutionWorldFact, PolicyContextFacts } from '@deepseek-ai/dsh-policy-engine'
import type { ApprovalBindingRequest } from '@deepseek-ai/dsh-tools/external-effect'
import type { ApprovalDisplay } from '@deepseek-ai/dsh-user-approval/types'
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
import { classifyActionRisk, confirmExternalEffect, gateActionRisk, readExecutionWorldFact, readPolicyContextFacts, refusedApprovalResult, refusedPolicyResult, refusedReservationResult, refusedRiskResult, reserveExternalEffect, verifyRecordedApproval } from '@deepseek-ai/dsh-tools/external-effect'
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
    for (const block of toolCalls) {
      appendUnauthorizedToolCall(ctx, agent, turn, step, block, await policyInputsForCall(ctx, agent, block), fencing)
    }
    return { concluded: false }
  }

  // P2-02 must[3]: every tool call presents the session's Capability Token.
  //
  // `whenSessionToken` and never the synchronous `sessionToken`:
  // `agent/session-start` does not await its listeners, so a first tool call
  // can land while the token's durable record is still being written. Reading
  // synchronously there returns undefined, the armed requirement refuses the
  // call, and the refusal is indistinguishable from the gate working — which
  // is what 76 snapshot scenarios showed when this presentation was missing
  // altogether.
  //
  // Absent service means no token and no presentation: a composition that
  // mounts no token provider is unchanged, because the requirement it would
  // have to satisfy is not armed either.
  const capabilityTokens = ctx.get('capabilityTokens')
  const capabilityToken = await capabilityTokens?.whenSessionToken(agent.id)
  // A session whose issuance FAILED holds no token, exactly like a path that
  // never attached one — and at the tool both read as "none was presented".
  // Carrying the reason keeps the refusal fail-closed and says why.
  const capabilityTokenUnavailable = capabilityToken !== undefined
    ? undefined
    : capabilityTokens?.issuanceError(agent.id)

  // Inputs are distinct because tools/execute wrappers may replace `exec.signal`.
  const planned: PlannedCall[] = toolCalls.map(block => ({
    block,
    exec: {
      callId: block.id,
      name: block.name,
      arguments: parseArguments(block.arguments),
      agent,
      signal,
      ...capabilityToken === undefined ? {} : { capabilityToken },
      ...capabilityTokenUnavailable === undefined ? {} : { capabilityTokenUnavailable },
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
      for (const call of planned.slice(next)) {
        appendSkippedToolCall(ctx, agent, turn, step, call.block, await policyInputsForCall(ctx, agent, call.block))
      }
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
    // The token this call PRESENTS, read from the planned input rather than
    // re-resolved: `exec.capabilityToken` is what the capability gate checks,
    // so the policy decides on the same authority that gate did.
    // Classified BEFORE the manifest is appended, because the policy question
    // asked with that manifest carries the class as a fact: a policy that
    // cannot see how risky an action is cannot forbid it for being risky
    // (BLOCKED-201). The same verdict is handed to the risk gate below, so the
    // two layers decide about one classification rather than each computing
    // its own.
    const classified = classifyActionRisk(ctx, call.block.name, ctx.tools.get(call.block.name, agent)?.riskDomainTags ?? [])
    const inputs: PolicyInputs = {
      facts: await readPolicyContextFacts(ctx, agent, classified),
      // The other composition-read input of the same question (P3-01): which
      // world this session's actions run in, `absent` when none is mounted.
      world: await readExecutionWorldFact(ctx, agent),
    }
    const appended = appendToolCall(ctx, agent, turn, step, call.block, inputs, call.exec.capabilityToken)
    callSeqs[index] = appended.seq
    started++
    // must[4]: the reservation is taken BEFORE the tool runs, so a crash
    // between here and the tool's own commit leaves a durable record that this
    // effect was already claimed. A refusal is a settled outcome, not an
    // error: the first attempt's effect already happened, or the arguments
    // disagree with the reservation, or the state needs a reconciler.
    // The RISK gate runs before the reservation: a reservation is a claim on
    // an effect, and claiming one for an action the deployment will not permit
    // would leave a `sent` row for something that never happened.
    // Viewed through the calling agent, as dispatch resolves it: a tool
    // registered on an agent's own runtime is invisible to the global view, so
    // an unscoped lookup reads every scoped tool as declaring nothing and
    // classifies it by the unknown default.
    // P2-05 acceptance[0]: the decision taken when this call's manifest was
    // appended. It runs BEFORE the risk gate and before the reservation, for
    // the same reason the risk gate runs before the reservation — a claim on an
    // effect the deployment will not permit would leave a `sent` row for
    // something that never happened.
    const policy = appended.record.decision
    if (policy !== undefined && policy.effect !== 'permit') {
      slots[index] = {
        exec: call.exec as unknown as ToolRunContext,
        result: refusedPolicyResult(policy.effect, policy.reason, call.block.name),
        needsPost: false,
      }
      return
    }
    // P2-06 must[1]: the approval this gate may ask for is bound to the tuple
    // the decider is deciding about. Built HERE because this is the only place
    // that holds both halves — the model's arguments and the manifest record
    // the append just produced. The registry's own ask sits in a layer with no
    // manifest, and is unbound by declaration rather than by oversight.
    const riskRefusal = await gateActionRisk(
      ctx, agent, call.block.name, ctx.tools.get(call.block.name, agent)?.riskDomainTags ?? [], classified,
      approvalBindingFor(agent, call.block),
      approvalDisplayFor(
        appended.record.manifest,
        classified?.riskClass ?? 'security-sensitive',
        redactArgumentsForDisplay(call.block.arguments),
        Date.now() + APPROVAL_DISPLAY_VALIDITY_MS,
      ),
    )
    if (riskRefusal !== undefined) {
      slots[index] = {
        exec: call.exec as unknown as ToolRunContext,
        result: refusedRiskResult(riskRefusal, call.block.name),
        needsPost: false,
      }
      return
    }
    // P2-06 must[1]: re-verify the recorded approval BEFORE the tool runs. The
    // recorded side comes from the session log and the present side from this
    // dispatch, so a substitution between the decision and the execution is a
    // comparison of two different values rather than of one value with itself.
    // A refusal REFUSES the dispatch: a verification whose result is reported
    // and then ignored passes every case asserting it was called.
    const staleApproval = verifyRecordedApproval(agent, approvalBindingFor(agent, call.block).inputs, Date.now())
    if (staleApproval !== undefined) {
      slots[index] = {
        exec: call.exec as unknown as ToolRunContext,
        result: refusedApprovalResult(staleApproval, call.block.name),
        needsPost: false,
      }
      return
    }
    // Settlement confirms against this record, so it is published only once
    // the risk gate has passed: a risk-refused call never reserved, and
    // markAmbiguous on an unreserved key throws instead of settling.
    records[index] = appended.record
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
    for (const call of group.slice(started)) {
      appendSkippedToolCall(ctx, agent, turn, step, call.block, await policyInputsForCall(ctx, agent, call.block))
    }
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
 * @param ctx - the loop's context, which carries the pinned Trust Kernel.
 * @param agent - the agent the call belonged to; its session is appended to.
 * @param turn - the turn the call belonged to.
 * @param step - the step the call belonged to.
 * @param block - the model call that will not run.
 * @param reason - whether this run lost the item or was never granted it.
 */
function appendUnauthorizedToolCall(
  ctx: Context,
  agent: Agent,
  turn: number,
  step: number,
  block: ToolCallBlock,
  policy: PolicyInputs,
  reason: 'fenced' | 'lease-refused',
): void {
  const { session } = agent
  const { seq: callSeq } = appendToolCall(ctx, agent, turn, step, block, policy)
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
function appendSkippedToolCall(
  ctx: Context,
  agent: Agent,
  turn: number,
  step: number,
  block: ToolCallBlock,
  policy: PolicyInputs,
): void {
  const { session } = agent
  const { seq: callSeq } = appendToolCall(ctx, agent, turn, step, block, policy)
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
 * The facts for one call that will not run.
 *
 * A synthetic result still appends a manifest, and a manifest is a policy
 * question, so the question is asked with the same facts a dispatched call
 * would carry rather than with defaults (BLOCKED-201).
 * @param ctx - the mounting context, consulted for the fact services.
 * @param agent - the agent the call belonged to.
 * @param block - the model call that will not run.
 * @returns the context facts and the world for that call.
 */
async function policyInputsForCall(ctx: Context, agent: Agent, block: ToolCallBlock): Promise<PolicyInputs> {
  const classified = classifyActionRisk(ctx, block.name, ctx.tools.get(block.name, agent)?.riskDomainTags ?? [])
  return {
    facts: await readPolicyContextFacts(ctx, agent, classified),
    world: await readExecutionWorldFact(ctx, agent),
  }
}


/**
 * How long the ask TELLS a decider their approval will last.
 *
 * The service owns the real duration through its own row configuration; this
 * is what the six-field display says, and the two must agree or a decider is
 * told one thing and bound by another. Kept as one constant rather than read
 * from the service because the display is built before the ask reaches it, and
 * a reader of this file should see the coupling rather than discover it.
 */
const APPROVAL_DISPLAY_VALIDITY_MS = 300_000

/**
 * Redact an argument string for display (acceptance[1]).
 *
 * String VALUES are replaced and their keys kept, so a decider sees the shape
 * of what will run without its secrets. The digest the approval is bound to
 * covers the unredacted string, so two arguments that redact identically still
 * bind differently — the property acceptance[1] states and this function is one
 * half of.
 * @param raw - the model's raw argument string.
 * @returns the rendering to show, or the raw string when it is not JSON.
 */
function redactArgumentsForDisplay(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    const redact = (value: unknown): unknown => {
      if (typeof value === 'string') return '<redacted>'
      if (Array.isArray(value)) return value.map(redact)
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]))
      }
      return value
    }
    return JSON.stringify(redact(parsed))
  } catch {
    // Not JSON: a model may emit anything, and showing the raw text is better
    // than showing nothing. It is not a secret leak this function introduces —
    // the same string is what the tool would receive.
    return raw
  }
}

/**
 * What a decider is shown about this dispatch (P2-06 must[0]).
 *
 * Every value is taken from the manifest or from the gate's own
 * classification, never recomputed here: a surface shown a second derivation
 * of the risk class or the diff would be shown a guess where a recorded fact
 * exists. `arguments` arrives already redacted, and the digest the approval is
 * BOUND to covers the unredacted value — that difference is acceptance[1].
 * @param manifest - the manifest just appended for this call.
 * @param riskClass - the class the gate classified this action into.
 * @param redactedArguments - the arguments as the decider should see them.
 * @param expiresAtMs - when an approval given now stops being usable.
 * @returns the six fields must[0] names.
 */
function approvalDisplayFor(
  manifest: ActionManifest,
  riskClass: string,
  redactedArguments: string,
  expiresAtMs: number,
): ApprovalDisplay {
  const target = manifest.target
  const resource = target.kind === 'filesystem'
    ? target.path
    : target.kind === 'network' ? target.host : target.kind === 'process' ? target.command : target.ref
  return {
    manifestDigest: manifest.argumentsHash,
    arguments: redactedArguments,
    // The target's KIND is kept in front of its value: `filesystem:/etc/hosts`
    // and `process:/etc/hosts` are different decisions, and a decider shown
    // only the path cannot tell them apart.
    resource: `${target.kind}:${resource}`,
    riskClass,
    expectedDiff: manifest.expectedDiff.description,
    expiresAtMs,
  }
}

/**
 * What an approval asked for this dispatch is bound to (P2-06 must[1]).
 *
 * The principal is the one attached to the agent AT THE ASK, captured as a
 * value: `'unattached'` when the agent carries no identity, which a
 * re-verification compares rather than treating as a wildcard.
 *
 * Three fields are deliberately absent rather than filled with something
 * shaped like them. `preconditions` is empty because the native manifest path
 * declares none (`appendActionManifest` passes `preconditions: []`), so an
 * approval here is bound to no precondition and a later one that IS declared
 * changes the binding. `capabilityToken` is absent because this path holds a
 * signed token, not the digest the binding compares — binding the manifest's
 * `argumentsHash` in its place would be a field that looks bound and compares
 * something else. `policyVersion` is absent because the decision summary here
 * names an effect and a reason, not the policy set's version. A field bound to
 * a placeholder makes every value look equal, which is worse than absent.
 * @param agent - the dispatching agent, whose identity is captured at the ask.
 * @param block - the model's tool call, supplying the action and its arguments.
 * @returns the binding request, timed by this path's own clock reading.
 */
function approvalBindingFor(agent: Agent, block: ToolCallBlock): ApprovalBindingRequest {
  return {
    inputs: {
      action: block.name,
      args: block.arguments,
      principal: agent.identity?.principal.id ?? 'unattached',
      preconditions: [],
    },
    askedAtMs: Date.now(),
  }
}

/**
 * The two composition-read inputs of one policy question, carried together.
 *
 * Paired rather than passed separately because they are read at the same
 * boundary, by the two readers in `@deepseek-ai/dsh-tools/external-effect`, and
 * threaded down the same call chain to the same enforcement point. A second
 * parameter beside `facts` would let one of them be forgotten at one call site,
 * which is the shape BLOCKED-201 measured for `facts` itself.
 */
interface PolicyInputs {
  /** The declared context facts a policy may read (P2-05 must[0]). */
  readonly facts: PolicyContextFacts
  /** Where the action would run (P3-01), `absent` when no world registry is mounted. */
  readonly world: ExecutionWorldFact
}

/**
 * Append a started call's manifest and `tool/call` event.
 * @param agent - the agent dispatching it.
 * @param turn - the turn the call belongs to.
 * @param step - the step the call belongs to.
 * @param block - the model's call.
 * @returns the event seq its result must cite, and the manifest's reservation inputs.
 */
function appendToolCall(
  ctx: Context,
  agent: Agent,
  turn: number,
  step: number,
  block: ToolCallBlock,
  policy: PolicyInputs,
  presentedToken?: SignedCapabilityToken,
): { seq: SessionSeq; record: ManifestRecord } {
  const { session } = agent
  const record = appendActionManifest(ctx, agent, block, 'native-tool-call', policy, presentedToken)
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

function appendActionManifest(
  ctx: Context,
  agent: Agent,
  block: ToolCallBlock,
  origin: 'native-tool-call',
  policy: PolicyInputs,
  presentedToken?: SignedCapabilityToken,
): ManifestRecord {
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
  // P2-05 acceptance[0]: the manifest IS the policy question, so the decision
  // is taken where the manifest exists. Both native and code-mode paths reach
  // the one enforcement point through this call, and a third path that skipped
  // it would also have skipped the manifest — which
  // `assertManifestPrecedesExecution` already refuses.
  const decision = decideManifestedAction(ctx, agent, appended.manifest, origin, policy, presentedToken)
  return {
    key: appended.manifest.idempotencyKey,
    argumentsHash,
    scope: attribution.actor.id,
    // Carried so the approval ask can SHOW what the decision is about. must[0]
    // names six fields a decider must see, and four of them — the target, the
    // expected diff, the side-effect class and the digest — live on the
    // manifest rather than on the call. Returning the manifest is smaller than
    // rebuilding those four at the ask site from the same inputs, and a second
    // construction is how two views of one action start to disagree.
    manifest: appended.manifest,
    ...decision === undefined ? {} : { decision },
  }
}

/**
 * Ask the enforcement point about one manifested action.
 *
 * Resolved through `ctx.get` rather than injected: a composition that mounts no
 * Trust Kernel — the tests' own compositions among them — must still dispatch
 * tools, and a hard dependency would stop the agent loop registering at all.
 * Absence is capability absence, and the harness behaves as it did before this
 * epic; presence means every dispatch is decided.
 * @param agent - the dispatching agent, whose context carries the kernel.
 * @param manifest - the manifest just appended.
 * @param origin - which originator is dispatching.
 * @returns the decision, or undefined when no enforcement point is mounted.
 */
function decideManifestedAction(
  ctx: Context,
  agent: Agent,
  manifest: ActionManifest,
  origin: 'native-tool-call',
  policy: PolicyInputs,
  presentedToken?: SignedCapabilityToken,
): PolicyDecisionSummary | undefined {
  void agent
  // The loop's own context, not `agent.ctx`: an Agent constructed by a test
  // harness may carry none, and the kernel is pinned on the root anyway.
  if (ctx.get('trustKernel') === undefined) return undefined
  // must[0]'s second input, in the form P2-02 already audited as safe outside
  // the token layer: the token's CLAIMS and its digest, never the signed token
  // — an engine holding that would hold an authority it could pass on.
  const decision = enforceManifestedAction(ctx, {
    manifest,
    ...presentedToken === undefined ? { token: undefined } : { token: redactTokenForLog(presentedToken) },
    origin,
    world: policy.world,
    facts: policy.facts,
  })
  return { effect: decision.effect, ...decision.reason === undefined ? {} : { reason: decision.reason } }
}

/** What a dispatch path carries forward from one policy decision. */
interface PolicyDecisionSummary {
  /** Permit, deny or ask. */
  readonly effect: 'permit' | 'deny' | 'ask'
  /** The closed reason code, absent for a plain permit. */
  readonly reason?: string
}

/** The reservation inputs one appended manifest supplies to the ledger (P4-12 must[4]). */
interface ManifestRecord {
  /**
   * P2-05's decision for this action, absent when the composition pins no
   * Trust Kernel.
   *
   * Carried on the record rather than acted on inside the manifest helper: the
   * helper's contract is that a manifest exists BEFORE the call is logged, and
   * a refusal that skipped the `tool/call` event would leave a manifest with
   * nothing citing it.
   */
  readonly decision?: PolicyDecisionSummary
  readonly key: IdempotencyKey
  readonly argumentsHash: ArgumentsHash
  /** The manifest itself, so an approval ask can show what the action does. */
  readonly manifest: ActionManifest
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

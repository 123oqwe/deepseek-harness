/**
 * Reserving and settling one external effect against the idempotency ledger
 * (Epic P4-12 must[4], acceptance[0]; Epic P2-03 must[2]).
 *
 * **One implementation, because two dispatch paths perform external effects.**
 * The native tool path reserved before running and confirmed after; the
 * code-mode sub-dispatch did neither, so acceptance[0]'s "an external write is
 * performed at most once" was true of native calls and not of the same tool
 * invoked from a code-mode program — the bypass must[2] names, one layer below
 * the manifest where it had already been closed (§12.35-2).
 *
 * These live here rather than in the agent loop because `dsh-tools` is the
 * package both paths can reach: the loop depends on it, and the code-mode
 * scheduler is inside it. Writing them a second time in `ptc.ts` is the shape
 * BLOCKED-136 records, and it is what put the manifest order out of one
 * implementation until §12.33.
 *
 * @module @deepseek-ai/dsh-tools/external-effect
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { advanceLeasedAgent, type Agent } from '@deepseek-ai/dsh-agent'
import type { ArgumentsHash, IdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { LedgerEpoch, LedgerGeneration, LedgerScope, ReceiptDigest, ReserveDecision } from '@deepseek-ai/dsh-action-ledger'
import type {} from '@deepseek-ai/dsh-action-ledger'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { ExecutionWorldFact, PolicyContextFacts } from '@deepseek-ai/dsh-policy-engine'
import { verifyApprovalBinding } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalBinding, ApprovalBindingInputs, ApprovalDisplay, ApprovalVerification } from '@deepseek-ai/dsh-user-approval/types'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { WorldId, WorldProviderId, WorldSpecDigest } from '@deepseek-ai/dsh-execution-world/types'
import type { ToolExecutionResult } from './index.ts'

/**
 * `TOOL_ABORTED_BEFORE_DISPATCH`, restated rather than imported.
 *
 * `./index.ts` imports `./ptc.ts`, which imports this module, so a VALUE
 * import from the barrel closes a module cycle: measured, it hung four
 * code-mode cases at their 5s timeout rather than failing. The type-only
 * import above is erased and closes nothing. One string constant duplicated
 * against a cycle is the smaller cost, and it is pinned by the cases that
 * assert this code on both dispatch paths.
 */
const ABORTED_BEFORE_DISPATCH = 'ABORTED_BEFORE_DISPATCH'

/** What one manifested action reserves against the ledger. */
export interface ExternalEffectRecord {
  /** The reservation scope, from the manifest's actor. */
  readonly scope: LedgerScope
  /** The manifest's idempotency key. */
  readonly key: IdempotencyKey
  /** The canonical hash of the arguments the reservation was taken for. */
  readonly argumentsHash: ArgumentsHash
}

/**
 * The ledger generation this agent's run acts under.
 *
 * A run with no lease is `'unfenced'`, NOT generation zero. It used to be
 * `?? 0`, which gave every lease-less run the same generation as every other,
 * so the ledger read two concurrent runs as one and could not apply must[2] to
 * either (BLOCKED-221). Only the Run Service assigns a lease epoch, so a
 * profile that does not mount it — `sdk-minimal` ships without it — reserves
 * unfenced, and the ledger then keeps at-least-once without promising
 * exclusivity. Naming that is what keeps the promise honest.
 * @param agent - the agent whose run owns the action.
 * @returns the run's lease generation, or `'unfenced'` when it holds no lease.
 */
function generationOf(agent: Agent): LedgerGeneration {
  const epoch = agent.lifecycle?.epoch
  return epoch === undefined ? 'unfenced' : brandNumber<LedgerEpoch>(epoch)
}

/**
 * Reserve one external effect before it runs (must[4]).
 *
 * `sent` is marked BEFORE the tool runs, because the tool call IS the send. A
 * crash between that mark and the tool's own commit must read as "we may have
 * sent it", which is what stops a retry from sending again; marking after the
 * fact leaves open exactly the window this ledger exists to close.
 *
 * An absent ledger is not an approval and not a refusal: a composition that
 * mounts none proceeds as the harness did before the ledger existed. What must
 * never happen is a MOUNTED ledger's refusal being ignored.
 * @param ctx - the mounting context, consulted for an optional ledger.
 * @param agent - the agent whose run owns the action.
 * @param record - the reservation inputs taken from the appended manifest.
 * @returns the ledger's refusal, or `undefined` when the call may proceed.
 */
export function reserveExternalEffect(
  ctx: Context,
  agent: Agent,
  record: ExternalEffectRecord,
): Exclude<ReserveDecision, { action: 'reserved' }> | undefined {
  const ledger = ctx.get('actionLedger')
  if (ledger === undefined) return undefined
  const decision = ledger.reserve({
    scope: record.scope,
    key: record.key,
    argumentsHash: record.argumentsHash,
    epoch: generationOf(agent),
  })
  if (decision.action !== 'reserved') return decision
  ledger.markSent(record.scope, record.key, generationOf(agent))
  return undefined
}

/**
 * Why the risk gate refused an action before it ran (P2-04 must[1], §12.50).
 *
 * `hard-deny` is the kernel band, which no organisation policy may switch
 * off; `approval-refused` is a question that was asked and not answered yes.
 * They are distinct because they demand different responses — a hard deny is
 * never worth re-asking, and a refused approval may be granted next turn.
 */
/**
 * The policy operations this gate needs, named structurally.
 *
 * Declared here rather than imported from `@deepseek-ai/dsh-permission-presets`
 * because that package sits above this one: a value or type dependency would
 * be an upward layer edge, and this module is reached from both dispatch
 * paths in the core. The port is three read-only operations, so a second
 * policy provider satisfies it by implementing them under the same names.
 */
interface RiskPolicyPort {
  /**
   * Classify one action under the deployment's organisation policy.
   * @param subject - the action id and the domain tags it declares.
   * @returns the class, whether it is hard-denied, and how it was reached.
   */
  classifyAction(subject: { readonly actionId: string; readonly domainTags: readonly string[] }): ActionRiskClassification
  /**
   * Whether a classification reaches the named preset's approval threshold.
   * @param classification - the classifier's verdict.
   * @param preset - the preset in force.
   * @returns whether approval is required first.
   */
  requiresApproval(classification: { readonly riskClass: string }, preset: string): boolean
  /**
   * The preset in force for one session.
   * @param session - the agent's session.
   * @returns a preset table key, or the derived custom state.
   */
  current(session: Agent['session']): string
}

/**
 * One action's intrinsic risk verdict under the deployment's organisation policy.
 *
 * Named because it crosses two layers: the dispatch paths compute it before
 * asking policy, so the Cedar request and {@link gateActionRisk} decide about
 * the same action rather than each classifying it for themselves.
 */
export interface ActionRiskClassification {
  /** The class the action was classified into. */
  readonly riskClass: string
  /** Whether the class is in the kernel band no organisation policy may switch off. */
  readonly hardDenied: boolean
}

/**
 * Classify one action ahead of both the policy decision and the risk gate.
 *
 * The dispatch paths call this BEFORE `enforceManifestedAction`, because a
 * policy that cannot see how risky an action is cannot forbid it for being
 * risky — the fact reached Cedar as a default until BLOCKED-201. The verdict
 * is then handed to {@link gateActionRisk} rather than recomputed there.
 * @param ctx - the mounting context, consulted for an optional policy service.
 * @param toolName - the action's capability, used as its identity to the classifier.
 * @param riskDomainTags - what the tool declares it touches, empty when it declares nothing.
 * @returns the verdict, or `undefined` when no policy service is mounted.
 */
export function classifyActionRisk(
  ctx: Context,
  toolName: string,
  riskDomainTags: readonly string[],
): ActionRiskClassification | undefined {
  const presets = ctx.get('permissionPresets') as RiskPolicyPort | undefined
  return presets?.classifyAction({ actionId: toolName, domainTags: riskDomainTags })
}

/**
 * The workspace-trust operation the facts reader needs, named structurally for
 * the same reason as {@link RiskPolicyPort}: `@deepseek-ai/dsh-workspace-trust`
 * sits above this package.
 */
interface WorkspaceTrustPort {
  /**
   * Resolve the trust state bound to a working directory.
   * @param cwd - the session working directory.
   * @returns the workspace's current trust state.
   */
  stateFor(cwd: string): Promise<PolicyContextFacts['workspaceTrust']>
}

/**
 * Read the context facts a policy may see, from what the composition mounts
 * (P2-05 must[0]; BLOCKED-201).
 *
 * Called by both dispatch paths immediately before `enforceManifestedAction`,
 * which is why it lives here: until this existed no caller passed facts at
 * all, so every shipped policy question carried the fail-closed defaults and
 * no rule about trust or risk could ever match. One reader means the two paths
 * cannot answer the same question differently.
 *
 * An unmounted service reads as the most restrictive value rather than the
 * most permissive: a policy written against a fact that silently defaulted
 * open would be enforcing something other than what it says.
 *
 * The session's own `cwd` is the workspace asked about, which is the key
 * `stateFor` is defined on. `@deepseek-ai/dsh-agent-instructions` asks about a
 * discovered project root instead, because the thing it gates is loading that
 * root's files; what runs here is an action of this session, in this directory.
 * @param ctx - the mounting context, consulted for the optional fact services.
 * @param agent - the dispatching agent, whose session carries the cwd and the preset.
 * @param classified - the action's risk verdict, already computed by {@link classifyActionRisk}.
 * @returns every declared fact, each either observed or at its fail-closed value.
 */
export async function readPolicyContextFacts(
  ctx: Context,
  agent: Agent,
  classified: ActionRiskClassification | undefined,
): Promise<PolicyContextFacts> {
  const trust = ctx.get('workspaceTrust') as WorkspaceTrustPort | undefined
  const cwd = agent.session.header.cwd
  const workspaceTrust = trust === undefined || cwd === undefined ? 'untrusted' : await trust.stateFor(cwd)
  return {
    workspaceTrust,
    // STILL the fail-closed default, and now recorded at its one producer
    // rather than defaulted invisibly inside the enforcement point. There is
    // nothing to read: `PermissionPostureFact`'s four members name no preset
    // any composition configures — the shipped table is `read-only`,
    // `workspace-write`, `danger-full-access`, and preset names are a
    // deployment's own — so no real posture can be spelled in that vocabulary
    // (BLOCKED-203). The other two facts are real; this one waits on a ruling
    // about the vocabulary, and says so here rather than looking supplied.
    permissionPosture: 'default',
    // The class the deployment's risk policy put this action in, computed
    // before policy is asked. `security-sensitive` when nothing classified it
    // is the classifier's own unknown default, restated here for the case
    // where no policy service is mounted at all.
    riskClass: (classified?.riskClass ?? 'security-sensitive') as PolicyContextFacts['riskClass'],
  }
}

/**
 * The world registry this reader needs, named structurally for the same reason
 * as {@link RiskPolicyPort}: `@deepseek-ai/dsh-execution-world/plugin` mounts a
 * service, and a dispatch path importing the mount would name a provider.
 */
interface ExecutionWorldPort {
  /**
   * The world this agent's session runs in, created on first ask.
   * @param agent - the dispatching agent.
   * @returns the binding, or `undefined` when the composition can offer none.
   */
  bindingFor(agent: Agent): Promise<{ world: WorldId; provider: WorldProviderId; spec: WorldSpecDigest } | undefined>
}

/**
 * Read where the action would run, from what the composition mounts
 * (P3-01 acceptance[1]; BLOCKED-178's producer half).
 *
 * Called by both dispatch paths beside {@link readPolicyContextFacts}, and for
 * the same reason: `world` was the LAST input to `enforceManifestedAction`
 * still supplied by the enforcement point itself, hardcoded to
 * `{ kind: 'absent' }`, so every policy question a shipped composition asked
 * said the world was unknown even where one was mounted and no rule about
 * where an action runs could match. One reader means the two paths cannot
 * answer the same question differently.
 *
 * An unmounted registry, and a registry whose providers all refuse the
 * deployment's requested confinement, both read as `absent` — the restrictive
 * value, and the same one a policy may refuse on. A world is never invented to
 * fill the gap: acceptance[1] forbids degrading, and reporting a weaker world
 * as the one in force is exactly that.
 * @param ctx - the mounting context, consulted for the optional registry.
 * @param agent - the dispatching agent, whose session the world is bound to.
 * @returns the bound world, or the fail-closed `absent` fact.
 */
export async function readExecutionWorldFact(ctx: Context, agent: Agent): Promise<ExecutionWorldFact> {
  const worlds = ctx.get('executionWorlds') as ExecutionWorldPort | undefined
  const binding = await worlds?.bindingFor(agent)
  if (binding === undefined) return { kind: 'absent' }
  // Appended at the FIRST dispatch that binds this session's world, not on
  // every one: where the session's actions run is one fact. The set is keyed on
  // the session object, so a second session in the same process records its own.
  if (!ANNOUNCED.has(agent.session)) {
    ANNOUNCED.add(agent.session)
    agent.session.append('action/world-bound', {
      world: binding.world,
      provider: binding.provider,
      spec: binding.spec,
    })
  }
  return { kind: 'bound', ...binding }
}

/** Sessions whose world binding has already been recorded. */
const ANNOUNCED = new WeakSet<object>()

/**
 * Re-verify the approval this session recorded for `action` before it runs
 * (P2-06 must[1]).
 *
 * **Reads the RECORDED tuple from the session log, never from the values about
 * to run.** A path that rebuilt the "recorded" side from what it is about to
 * dispatch would compare a value against itself and admit every substitution it
 * exists to refuse, while passing any case written against it.
 *
 * `undefined` means the dispatch may proceed: either the session recorded no
 * binding for this action — an ask that carried no tuple, or no ask at all —
 * or the recorded one still covers what is about to run. A refusal names the
 * field that moved, or the expiry.
 * @param agent - the dispatching agent, whose session holds the record.
 * @param present - the same tuple as it stands now, at dispatch time.
 * @param nowMs - the caller's clock reading.
 * @returns the refusal to report, or undefined when the dispatch may proceed.
 */
export function verifyRecordedApproval(
  agent: Agent,
  present: ApprovalBindingInputs,
  nowMs: number,
): Exclude<ApprovalVerification, { valid: true }> | undefined {
  const { session } = agent
  // The LAST binding for this action, because a re-ask after a refusal records
  // a second one and the decision in force is the most recent.
  for (let index = session.seq - 1; index >= 0; index -= 1) {
    const event = session.eventAt(SessionSeq(index))
    if (event?.type !== 'approval/bound') continue
    const data = event.data
    if (data.action !== present.action) continue
    const recorded: ApprovalBinding = {
      inputs: {
        action: data.action,
        // The record carries no argument values by design, so the recorded
        // side is reconstructed with the PRESENT arguments and the comparison
        // is made by the digest below: an argument change moves the digest and
        // the binding's own recorded digest does not move with it.
        args: present.args,
        principal: data.principal as ApprovalBindingInputs['principal'],
        preconditions: data.preconditions,
        ...data.capabilityToken === undefined ? {} : { capabilityToken: data.capabilityToken },
        ...data.policyVersion === undefined ? {} : { policyVersion: data.policyVersion },
      },
      digest: data.digest as ApprovalBinding['digest'],
      expiresAtMs: data.expiresAtMs,
    }
    const verification = verifyApprovalBinding(recorded, present, nowMs)
    return verification.valid ? undefined : verification
  }
  return undefined
}

/**
 * The approval operation this gate needs, named structurally for the same
 * reason as {@link RiskPolicyPort}.
 *
 * `request` is total: `@deepseek-ai/dsh-user-approval` normalizes an
 * unanswered or rogue result to `'unavailable'`, so this gate reads an
 * outcome rather than handling an absence.
 */
/** What the caller supplies to bind an approval asked at this gate (P2-06). */
export interface ApprovalBindingRequest {
  /** Everything the approval is to be bound to, as the dispatch path sees it now. */
  readonly inputs: ApprovalBindingInputs
  /** The dispatch path's clock reading at the moment of the ask. */
  readonly askedAtMs: number
}

interface ApprovalPort {
  /**
   * Ask composed answerers for one decision.
   * @param request - the agent, the tool and the reason to show.
   * @returns the settled outcome; `'allowed-once'` is the only one that permits the action.
   */
  request(request: {
    agent: Agent
    toolName: string
    reason: string
    binding?: ApprovalBindingRequest
    display?: ApprovalDisplay
  }): Promise<string>
}

/**
 * Why the risk gate refused an action before it ran (P2-04 must[1], §12.50).
 *
 * `hard-deny` is the kernel band, which no organisation policy may switch
 * off; `approval-refused` is a question that was asked and not answered yes.
 * They are distinct because they demand different responses — a hard deny is
 * never worth re-asking, and a refused approval may be granted next turn.
 *
 * `undeclared` rides both arms because it changes what an operator should DO:
 * an action refused for declaring nothing is fixed by declaring its tags, and
 * one refused on a declared class is fixed by policy or not at all.
 */
export type RiskRefusal =
  | { readonly kind: 'hard-deny'; readonly riskClass: string; readonly undeclared: boolean }
  | { readonly kind: 'approval-refused'; readonly riskClass: string; readonly outcome: string; readonly undeclared: boolean }

/**
 * Decide whether one action may run under this deployment's risk policy
 * (P2-04 must[1], P2-03 acceptance[2]).
 *
 * Three outcomes, in this order: an action in a hard-deny band never runs; an
 * action at or above the preset's approval threshold runs only if approval is
 * granted; anything else runs. The order matters — asking about an action the
 * kernel refuses would offer a choice that does not exist.
 *
 * **An UNDECLARED tool is the case this gate is really for.** A tool that
 * declares no domain tags classifies by the unknown default, the highest
 * policy-adjustable class, so it needs approval on an interactive preset and
 * is refused where nothing can answer. That is P2-03's acceptance[2] read
 * literally, and it is why the refusal text names the undeclared tags rather
 * than only the class: an operator seeing it should learn that a tool did not
 * say what it touches, not merely that something scored high.
 *
 * Absent policy service means no gate: a composition with no
 * `permissionPresets` has no organisation policy to enforce, which is
 * capability absence rather than an action nobody vouched for.
 * @param ctx - the mounting context, consulted for an optional policy service.
 * @param agent - the agent dispatching the action; its session carries the preset in force.
 * @param toolName - the action's capability, used as its identity to the classifier.
 * @param riskDomainTags - what the tool declares it touches, empty when it declares nothing.
 * @param classified - the verdict {@link classifyActionRisk} already produced for this action; omitted, the gate classifies for itself.
 * @param binding - what an approval asked here is bound to, when the caller has a tuple (P2-06 must[1]).
 * @param display - the six fields a decider must see, when the caller has a manifest (P2-06 must[0]).
 * @returns the refusal, or `undefined` when the action may run.
 */
export async function gateActionRisk(
  ctx: Context,
  agent: Agent,
  toolName: string,
  riskDomainTags: readonly string[],
  classified?: ActionRiskClassification,
  binding?: ApprovalBindingRequest,
  display?: ApprovalDisplay,
): Promise<RiskRefusal | undefined> {
  const presets = ctx.get('permissionPresets') as RiskPolicyPort | undefined
  if (presets === undefined) return undefined
  const undeclared = riskDomainTags.length === 0
  // The caller classifies first so the POLICY layer can see the class, and
  // hands the result here rather than letting this classify again: one action
  // classified twice is two answers that can disagree, and the policy decision
  // and the risk gate disagreeing about what an action IS would be the worst
  // possible pair to have drift.
  const classification = classified ?? presets.classifyAction({ actionId: toolName, domainTags: riskDomainTags })
  const preset = presets.current(agent.session)
  // The gate's decision is recorded for EVERY branch, including the one that
  // lets the action through. A manifest records the action's intrinsic
  // classification before execution and is preset-blind; without this event a
  // log showing `requiresApproval: true` beside an action nobody was asked
  // about describes a different run than the one that happened (BLOCKED-159).
  // The silent branch is the one that matters: an allow leaves no other trace.
  const recordDecision = (decision: 'asked' | 'refused' | 'hard-denied' | 'allowed-by-preset'): void => {
    agent.session.append('action/risk-gated', {
      actionId: toolName,
      riskClass: classification.riskClass,
      preset,
      decision,
    })
  }
  if (classification.hardDenied) {
    recordDecision('hard-denied')
    return { kind: 'hard-deny', riskClass: classification.riskClass, undeclared }
  }
  if (!presets.requiresApproval(classification, preset)) {
    recordDecision('allowed-by-preset')
    return undefined
  }
  const approval = ctx.get('approval') as ApprovalPort | undefined
  // Unreachable in a real composition: `permission-presets` declares
  // `static inject = ['shell', 'approval', ...]`, so reaching this line at all
  // means a policy service is mounted, which means an approval service is too.
  // Kept because the type admits absence and the fail-closed direction must be
  // stated where a reader looks for it — silence is not consent. A mutation
  // flipping it to `allowed-once` reddens nothing, and that null result is
  // recorded rather than presented as coverage.
  /* v8 ignore next 3 -- see above: presets inject approval, so absence cannot occur here */
  // `waiting_human` is produced exactly here (P4-05 must[0]): asking an
  // operator is the harness's one wait that cannot end on its own, and a
  // supervisor deciding whether to reclaim the run has to tell it from a tool
  // wait. Both dispatch paths reach this gate, so both report the state.
  // A denied advance is not this gate's business: `advanceLeasedAgent`
  // already reports `no-run` when no Run Service is mounted, and an action
  // must not be refused because its lifecycle could not be recorded.
  advanceLeasedAgent(agent, 'waiting_human', `awaiting approval for "${toolName}"`)
  const outcome = approval === undefined
    ? 'unavailable'
    : await approval.request({
      agent,
      toolName,
      reason: riskRefusalReason(classification.riskClass, undeclared),
      // Supplied only when the caller has a tuple. This gate is the one that
      // binds, because its call site holds BOTH halves — the arguments and the
      // manifest record — while the registry's own ask (`serviceAsk`) sits in a
      // layer that appends no manifest. The other path is therefore unbound and
      // says so (P2-06 U's declared limitation) rather than gaining a
      // cross-layer reference to reach one.
      ...binding === undefined ? {} : { binding },
      // must[0]: the decider sees the action, not only its name. Carried
      // through the gate rather than composed by each answerer, so two surfaces
      // show one account of the same call.
      ...display === undefined ? {} : { display },
    })
  // Back to `running` whatever the operator said: the wait is over, and the
  // caller decides whether the action proceeds.
  advanceLeasedAgent(agent, 'running', `approval for "${toolName}" ended "${outcome}"`)
  recordDecision(outcome === 'allowed-once' ? 'asked' : 'refused')
  if (outcome === 'allowed-once') return undefined
  return { kind: 'approval-refused', riskClass: classification.riskClass, outcome, undeclared }
}

/**
 * The sentence an operator sees when the gate stops an action.
 * @param riskClass - the class the action was classified into.
 * @param undeclared - whether the tool declared no domain tags at all.
 * @returns a reason naming the cause rather than only the score.
 */
function riskRefusalReason(riskClass: string, undeclared: boolean): string {
  return undeclared
    ? `this tool declares no risk domain tags, so it classifies at "${riskClass}" by the unknown default`
    : `this action classifies at "${riskClass}"`
}

/**
 * Record what the external effect returned (must[4]).
 *
 * A failure is `ambiguous`, not a release: a tool that threw may or may not
 * have committed its effect, and clearing the reservation would let a retry
 * perform it a second time. acceptance[1] is exactly this — an ambiguous entry
 * goes to reconciliation rather than being retried.
 * @param ctx - the mounting context, consulted for an optional ledger.
 * @param agent - the agent whose run owns the action.
 * @param record - the reservation this result belongs to, absent when the call never reserved.
 * @param result - what the tool returned.
 */
export function confirmExternalEffect(
  ctx: Context,
  agent: Agent,
  record: ExternalEffectRecord | undefined,
  result: ToolExecutionResult,
): void {
  const ledger = ctx.get('actionLedger')
  if (ledger === undefined || record === undefined) return
  const epoch = generationOf(agent)
  if (result.isError) {
    ledger.markAmbiguous(record.scope, record.key, epoch)
    return
  }
  ledger.confirm(record.scope, record.key, epoch, brandString<ReceiptDigest>(
    createHash('sha256').update(JSON.stringify(result.content)).digest('hex'),
  ))
}

/**
 * The model-visible result of a refused reservation.
 *
 * Each refusal reads differently because each demands a different next move,
 * and collapsing them into one message would make a caller defect
 * (`arguments-differ`) look like an outcome to wait on. A duplicate says the
 * effect already happened; an ambiguous entry says a human or a reconciler
 * must settle it and that retrying cannot (acceptance[1]).
 *
 * Shared by both dispatch paths: the native loop and the code-mode
 * sub-dispatch must tell the model the same thing about the same refusal, and
 * two copies of this text would drift the first time one was edited.
 * @param decision - the ledger's refusal.
 * @returns the tool result the model receives instead of an execution.
 */
export function refusedReservationResult(decision: Exclude<ReserveDecision, { action: 'reserved' }>): ToolExecutionResult {
  const text = decision.action === 'duplicate'
    ? `This action was already ${decision.state} under the same idempotency key; it was not performed again.`
    : decision.reason === 'arguments-differ'
      ? 'This idempotency key was first reserved with different arguments, so the action was refused.'
      : decision.reason === 'stale-epoch'
        ? 'A newer generation owns this action; this run has been fenced out and did not perform it.'
        : decision.reason === 'held-at-same-epoch'
          ? 'Another worker in this same generation holds this action and has not sent it; it was not performed twice.'
          : 'This action\'s outcome is unknown and cannot be settled by retrying; it awaits reconciliation.'
  return {
    content: [{ type: 'text', text: `Error: ${text}` }],
    isError: true,
    error: { message: text, info: { name: 'LedgerRefusedError', code: ABORTED_BEFORE_DISPATCH } },
  }
}

/**
 * Render a policy refusal as a settled tool result (Epic P2-05 acceptance[0]).
 *
 * A settled outcome rather than a thrown error, the same shape a risk refusal
 * uses: the action did not happen, and the model is told in the decision's own
 * CLOSED reason code. No policy text crosses — must[3] keeps the matched rules
 * and the engine's diagnostics in the audit trail, where naming a rule, a
 * tenant or a path is safe.
 * @param effect - the decision's effect; `ask` means a human answer is owed and none was given.
 * @param reason - the closed reason code, when the decision carried one.
 * @param toolName - the action refused, named so a multi-call turn is readable.
 * @returns the tool result to record in place of an execution.
 */
export function refusedPolicyResult(
  effect: string,
  reason: string | undefined,
  toolName: string,
): ToolExecutionResult {
  const text = effect === 'ask'
    ? `The action "${toolName}" needs a human decision before it runs (${reason ?? 'approval-required'}), and none was given.`
    : `The action "${toolName}" was refused by policy (${reason ?? 'no-matching-permit'}).`
  return {
    content: [{ type: 'text', text: `Error: ${text}` }],
    isError: true,
    error: { message: text, info: { name: 'PolicyRefusedError', code: ABORTED_BEFORE_DISPATCH } },
  }
}

/**
 * The tool result recorded when a decision no longer covers what is about to
 * run (P2-06 must[2], acceptance[0]).
 *
 * Names the FIELD that moved rather than reporting a failed check, because
 * must[2]'s requirement is that a change invalidates the approval and the
 * operator reading this has to know which change: substituted arguments and a
 * lapsed validity period call for different actions, and so does a switched
 * account.
 * @param verification - the refusal the verifier produced.
 * @param toolName - the action refused, named so a multi-call turn is readable.
 * @returns the tool result to record in place of an execution.
 */
export function refusedApprovalResult(
  verification: Exclude<ApprovalVerification, { valid: true }>,
  toolName: string,
): ToolExecutionResult {
  const text = verification.reason === 'expired'
    ? `The approval for "${toolName}" had expired before it ran, so it was not performed. `
      + 'Ask again: a decision made about a world that has since moved is not a decision about this one.'
    : `The approval for "${toolName}" no longer covers this call: its ${verification.field} changed after the decision was made, `
      + 'so it was not performed. A new request is needed for the changed action.'
  return {
    content: [{ type: 'text', text: `Error: ${text}` }],
    isError: true,
    error: { message: text, info: { name: 'ApprovalNoLongerValidError', code: ABORTED_BEFORE_DISPATCH } },
  }
}

/**
 * Render a risk refusal as a settled tool result (P2-04 must[1]).
 *
 * A refusal is an outcome, not a thrown error, for the same reason a ledger
 * refusal is: the model asked for something the deployment does not permit,
 * and it needs to read that and choose differently rather than see a crash.
 * The text names WHY — an undeclared tool says so, because "this scored high"
 * and "this never said what it touches" call for different fixes.
 * @param refusal - what the gate decided.
 * @param toolName - the action refused, named so a multi-call turn is readable.
 * @returns the tool result to record in place of an execution.
 */
export function refusedRiskResult(refusal: RiskRefusal, toolName: string): ToolExecutionResult {
  const cause = refusal.undeclared
    ? `it declares no risk domain tags, so it classifies at "${refusal.riskClass}" by the unknown default`
    : `it classifies at "${refusal.riskClass}"`
  const text = refusal.kind === 'hard-deny'
    ? `The action "${toolName}" was refused outright: ${cause}, which this deployment hard-denies. No approval can permit it.`
    : `The action "${toolName}" needs approval before it runs: ${cause}. The request ended "${refusal.outcome}", so it was not performed.`
  return {
    content: [{ type: 'text', text: `Error: ${text}` }],
    isError: true,
    error: { message: text, info: { name: 'RiskRefusedError', code: ABORTED_BEFORE_DISPATCH } },
  }
}

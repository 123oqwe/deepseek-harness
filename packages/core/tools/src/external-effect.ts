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
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ArgumentsHash, IdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { LedgerEpoch, LedgerScope, ReceiptDigest, ReserveDecision } from '@deepseek-ai/dsh-action-ledger'
import type {} from '@deepseek-ai/dsh-action-ledger'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
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
 * @param agent - the agent whose run owns the action.
 * @returns the run's lease epoch, or `0` when it holds no lease.
 */
function epochOf(agent: Agent): LedgerEpoch {
  return brandNumber<LedgerEpoch>(agent.lifecycle?.epoch ?? 0)
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
    epoch: epochOf(agent),
  })
  if (decision.action !== 'reserved') return decision
  ledger.markSent(record.scope, record.key, epochOf(agent))
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
  classifyAction(subject: { readonly actionId: string; readonly domainTags: readonly string[] }): {
    readonly riskClass: string
    readonly hardDenied: boolean
  }
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
 * The approval operation this gate needs, named structurally for the same
 * reason as {@link RiskPolicyPort}.
 *
 * `request` is total: `@deepseek-ai/dsh-user-approval` normalizes an
 * unanswered or rogue result to `'unavailable'`, so this gate reads an
 * outcome rather than handling an absence.
 */
interface ApprovalPort {
  /**
   * Ask composed answerers for one decision.
   * @param request - the agent, the tool and the reason to show.
   * @returns the settled outcome; `'allowed-once'` is the only one that permits the action.
   */
  request(request: { agent: Agent; toolName: string; reason: string }): Promise<string>
}

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
 * @returns the refusal, or `undefined` when the action may run.
 */
export async function gateActionRisk(
  ctx: Context,
  agent: Agent,
  toolName: string,
  riskDomainTags: readonly string[],
): Promise<RiskRefusal | undefined> {
  const presets = ctx.get('permissionPresets') as RiskPolicyPort | undefined
  if (presets === undefined) return undefined
  const undeclared = riskDomainTags.length === 0
  const classification = presets.classifyAction({ actionId: toolName, domainTags: riskDomainTags })
  if (classification.hardDenied) {
    return { kind: 'hard-deny', riskClass: classification.riskClass, undeclared }
  }
  if (!presets.requiresApproval(classification, presets.current(agent.session))) return undefined
  const approval = ctx.get('approval') as ApprovalPort | undefined
  // Unreachable in a real composition: `permission-presets` declares
  // `static inject = ['shell', 'approval', ...]`, so reaching this line at all
  // means a policy service is mounted, which means an approval service is too.
  // Kept because the type admits absence and the fail-closed direction must be
  // stated where a reader looks for it — silence is not consent. A mutation
  // flipping it to `allowed-once` reddens nothing, and that null result is
  // recorded rather than presented as coverage.
  /* v8 ignore next 3 -- see above: presets inject approval, so absence cannot occur here */
  const outcome = approval === undefined
    ? 'unavailable'
    : await approval.request({ agent, toolName, reason: riskRefusalReason(classification.riskClass, undeclared) })
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
  const epoch = epochOf(agent)
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
        : 'This action\'s outcome is unknown and cannot be settled by retrying; it awaits reconciliation.'
  return {
    content: [{ type: 'text', text: `Error: ${text}` }],
    isError: true,
    error: { message: text, info: { name: 'LedgerRefusedError', code: ABORTED_BEFORE_DISPATCH } },
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

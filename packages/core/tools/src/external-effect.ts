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

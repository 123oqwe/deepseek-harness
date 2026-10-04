/**
 * What one workflow script `approval()` call resolves to on the host (Epic
 * P2-07 must[2]): wait durably, continue on an approval this run consumed, or
 * refuse.
 *
 * The approval lives in the durable approval queue (`ctx.approvalStore`),
 * scoped to the run, and the run's journal records which call asked and the
 * viewer it was recorded as. A later run of the same id, in this process or
 * another, reaches the same call, reads the approval as that journaled viewer
 * and consumes it by compare-and-swap, so of two runs resuming one waiting
 * run at most one continues past the call (acceptance[1]).
 * @module @deepseek-ai/dsh-workflow-worker-thread/approvals
 */

import { randomUUID } from 'node:crypto'
// Before the approval store, which augments cordis's `Context`: this is the
// package's first source file, and a build that meets that augmentation before
// cordis's own declarations types `Context` twice.
import type {} from '@deepseek-ai/cordis'
import type {
  ApprovalRecord,
  ApprovalRequestId,
  ApprovalStoreContract,
  ApprovalViewer,
  PrincipalId,
  RunId,
  SessionId,
  TenantId,
} from '@deepseek-ai/dsh-approval-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ApprovalRefusal } from '@deepseek-ai/dsh-workflow'
import type { JournalRecorder, JournaledStart } from '@deepseek-ai/dsh-workflow-journal'

/** The longest display text a workflow approval records, so a long title cannot bloat every listing. */
const MAX_DISPLAY = 200

/** What one `approval()` call resolves to. */
export type ApprovalAnswer =
  | { readonly kind: 'granted' }
  | { readonly kind: 'refused'; readonly approvalId: string; readonly refusal: ApprovalRefusal }
  | { readonly kind: 'wait'; readonly approvalId: string }
  | { readonly kind: 'unavailable'; readonly rendered: string }

/** One `approval()` call, as the host sees it. */
export interface ApprovalAsk {
  /** The asking call's identity, from the worker. */
  readonly key: string
  /** What the approval is for. */
  readonly title: string
  /** The run. */
  readonly runId: string
  /** The workflow's name, shown with the title. */
  readonly workflowName: string
  /** What the run was started with, for a run that can wait; `undefined` for one that cannot (not detached). */
  readonly start: JournaledStart | undefined
  /** The viewer a NEW approval is recorded as: the run session's tenant and principal. */
  readonly viewer: ApprovalViewer
  /** How long a new approval stays decidable. */
  readonly waitMs: number
  /** The current time. */
  readonly nowMs: number
}

/**
 * Answer one `approval()` call.
 *
 * A run that is not detached, or a composition with no approval store, cannot
 * wait. A call the journal has not seen records a run-scoped approval and
 * waits. A call it has seen reads that approval as the viewer journaled with
 * it, never the current process's: `requested` waits again, `approved` is
 * consumed (a refused consumption is a refusal), and a terminal approval is a
 * refusal; a call whose approval this run already consumed continues, so a
 * re-run after a crash past the call does not ask again.
 * @param store - the mounted approval store, or `undefined`.
 * @param journal - this run's journal recorder; a new or consumed approval is recorded in it.
 * @param ask - the call.
 * @returns what the call resolves to.
 */
export function answerApproval(store: ApprovalStoreContract | undefined, journal: JournalRecorder, ask: ApprovalAsk): ApprovalAnswer {
  if (ask.start === undefined) {
    return { kind: 'unavailable', rendered: 'approval() needs a detached run: only a run that outlives the turn that started it can be resumed once the approval is decided' }
  }
  if (store === undefined) return { kind: 'unavailable', rendered: 'approval() needs an approval store, and this composition mounts none' }
  const recorded = journal.approvalFor(ask.key)
  if (recorded === undefined) {
    const approvalId = brandString<ApprovalRequestId>(randomUUID())
    store.request({
      id: approvalId,
      tenant: ask.viewer.tenant,
      actor: ask.viewer.principal,
      scope: { kind: 'run', runId: brandString<RunId>(ask.runId), sessionId: brandString<SessionId>(ask.start.session) },
      toolName: `workflow ${ask.workflowName}: ${ask.title}`.slice(0, MAX_DISPLAY),
      requestDigest: `sha256:${ask.key.slice(0, ask.key.lastIndexOf(':'))}`,
      deadlineMs: ask.nowMs + ask.waitMs,
    }, ask.nowMs)
    journal.approvalRecorded({
      key: ask.key, approvalId, tenant: ask.viewer.tenant, principal: ask.viewer.principal, state: 'waiting',
    }, ask.start)
    return { kind: 'wait', approvalId }
  }
  if (recorded.state === 'consumed') return { kind: 'granted' }
  const approvalId = brandString<ApprovalRequestId>(recorded.approvalId)
  const viewer: ApprovalViewer = { tenant: brandString<TenantId>(recorded.tenant), principal: brandString<PrincipalId>(recorded.principal) }
  const row = store.get(approvalId, viewer, ask.nowMs)
  if (row === undefined) return { kind: 'refused', approvalId, refusal: 'revoked' }
  if (row.state === 'requested') return { kind: 'wait', approvalId }
  if (row.state !== 'approved') return { kind: 'refused', approvalId, refusal: refusalOf(row) }
  const consumed = store.consume(approvalId, row.revision, viewer, ask.nowMs)
  if (!consumed.ok) {
    return { kind: 'refused', approvalId, refusal: consumed.current === undefined || consumed.conflict === 'expired' ? 'expired' : refusalOf(consumed.current) }
  }
  journal.approvalConsumed(ask.key)
  return { kind: 'granted' }
}

/**
 * Why an approval that cannot be consumed does not let the script continue.
 * An approval another writer moved without consuming (still `requested` or
 * `approved`) is reported as consumed: some other run holds it.
 * @param record - the approval as the store holds it.
 * @returns the refusal.
 */
function refusalOf(record: ApprovalRecord): ApprovalRefusal {
  switch (record.state) {
    case 'denied':
    case 'revoked':
    case 'expired':
    case 'consumed':
      return record.state
    case 'requested':
    case 'approved':
      return 'consumed'
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(record.state, 'ApprovalState')
  }
}

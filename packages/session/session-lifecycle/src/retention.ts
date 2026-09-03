/**
 * Contract-stage RED scaffold for Epic P6-07's session retention taxonomy
 * (must[1]): the three mutually exclusive dispositions a session may occupy
 * at rest, and the independent legal-hold marker that structurally gates
 * hard erase (acceptance[1]).
 *
 * **Why hard erase is not a fourth disposition.** {@link SessionDisposition}
 * has exactly three members — `active`, `archived`, `soft-deleted` — because
 * a disposition describes a *resting state* a live session record occupies.
 * Hard erase destroys the record; there is no "hard-erased" resting state to
 * be in, only the one-way operation itself (`./delete.ts`'s `hardErase`).
 * Modeling it as a disposition value would invite exactly the conflation
 * must[1] forbids: a caller pattern-matching over `SessionDisposition['kind']`
 * could accidentally treat "already erased" as just another filterable
 * listing state, when erasure must instead be irreversible and terminal.
 *
 * **Why legal hold is not a disposition member either.** A hold is a
 * preservation *obligation* layered on top of whatever disposition a session
 * already has — a session can be `active`, `archived`, or `soft-deleted`
 * while simultaneously under legal hold (see `placeLegalHold`'s doc
 * comment). Folding it into {@link SessionDisposition} would force a false
 * choice between "this session is soft-deleted" and "this session is under
 * legal hold" when both are simultaneously true; {@link LegalHold} is instead
 * an orthogonal, independently-present field on {@link SessionLifecycleRecord}.
 *
 * **The legal-hold gate is structural, not just a runtime check
 * (acceptance[1]).** {@link NoLegalHoldProof} mirrors `@deepseek-ai/dsh-principal`'s
 * `AdminGrant` (first100 registry P2-01, this epic's predecessor): a
 * module-private, compile-time-only `unique symbol` brand that no plain
 * object literal can satisfy without an explicit `as` cast. `./delete.ts`'s
 * `hardErase` requires a `NoLegalHoldProof` as a mandatory parameter, and the
 * only function that can produce one is `assertNoLegalHold` below, which
 * throws {@link LegalHoldBlocksErasureError} when the record it is given
 * carries an active {@link LegalHold}. There is no argument position through
 * which a caller could pass a session under legal hold straight to
 * `hardErase` without first routing it through this check — the same
 * "no bypass argument position exists" property `@deepseek-ai/dsh-run`'s
 * `RUN_SERVICE_OWNER_ID` uses for must[2]'s owner-identity guarantee (first100
 * registry P4-01). Like `AdminGrant`, this is compile-time-only and
 * defeatable by an explicit cast — see `AdminGrant`'s own doc comment for the
 * identical, already-reviewed limit — real revocation-race enforcement needs
 * a real durable retention store, which is this epic's later Provider/Usage
 * stage, not this Contract stage's pure type surface.
 *
 * @module @deepseek-ai/dsh-session-lifecycle/retention
 */

import type { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/**
 * must[1]'s three mutually exclusive resting dispositions a session may
 * occupy. See this module's top-of-file grounding note for why hard erase
 * and legal hold are deliberately absent from this union.
 */
export type SessionDisposition =
  | { readonly kind: 'active' }
  | { readonly kind: 'archived'; readonly archivedAt: number; readonly archivedBy: PrincipalId }
  | { readonly kind: 'soft-deleted'; readonly deletedAt: number; readonly deletedBy: PrincipalId }

/**
 * must[1]'s independent preservation-obligation marker (see this module's
 * top-of-file grounding note). Present on {@link SessionLifecycleRecord.legalHold}
 * regardless of which {@link SessionDisposition} the same record carries.
 */
export interface LegalHold {
  /** Non-negative safe-integer Unix epoch milliseconds the hold was placed. */
  readonly heldAt: number
  /** The principal that placed the hold. */
  readonly heldBy: PrincipalId
  /** Human-readable justification (for example, a litigation or audit reference), never empty. */
  readonly reason: string
}

/**
 * must[0]'s tenant/workspace-scoped, retention-aware projection of one
 * session: everything list/filter/delete/retain operations act on,
 * independent of the session's own event-log content. `workspaceId` is
 * optional because `@deepseek-ai/dsh-workspace`'s own membership is
 * cwd-derived and not every session matches a recorded workspace.
 */
export interface SessionLifecycleRecord {
  readonly header: SessionHeader
  readonly tenantId: TenantId
  readonly workspaceId?: WorkspaceId
  readonly disposition: SessionDisposition
  readonly legalHold?: LegalHold
}

/**
 * Thrown by {@link assertNoLegalHold} when the session it is given carries an
 * active {@link LegalHold} (acceptance[1]: legal hold blocks hard erase).
 */
export class LegalHoldBlocksErasureError extends Error {
  /** The session that could not be cleared for hard erase. */
  readonly sessionId: SessionId
  /** The hold that blocked it. */
  readonly legalHold: LegalHold
  /**
   * @param sessionId - the session that could not be cleared for hard erase.
   * @param legalHold - the hold that blocked it.
   */
  constructor(sessionId: SessionId, legalHold: LegalHold) {
    super(`session '${String(sessionId)}' is under legal hold (held at ${String(legalHold.heldAt)}, reason: ${legalHold.reason}) and cannot be hard-erased`)
    this.name = 'LegalHoldBlocksErasureError'
    this.sessionId = sessionId
    this.legalHold = legalHold
  }
}

declare const NO_LEGAL_HOLD_PROOF: unique symbol

/**
 * Unforgeable, compile-time-only proof that {@link assertNoLegalHold}
 * observed a session with no active {@link LegalHold} (acceptance[1]). See
 * this module's top-of-file grounding note for the full structural-gate
 * rationale and its documented limit.
 */
export type NoLegalHoldProof = { readonly [NO_LEGAL_HOLD_PROOF]: true }

/**
 * must[1]'s archive transition: mark `record` as `archived`, attributing who
 * archived it and when. Archiving is not a deletion — an archived session's
 * disposition is a distinct, independently-listable state from
 * `soft-deleted` (must[1]), and archiving alone never triggers `./delete.ts`'s
 * propagation (must[2] fires only for the two genuine deletion concepts,
 * soft delete and hard erase).
 * @param record - the session to archive; its prior disposition is discarded.
 * @param archivedBy - the principal performing the archive.
 * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this archive is stamped with.
 * @returns `record` with `disposition` set to `{ kind: 'archived', archivedAt: occurredAt, archivedBy }`; every other field unchanged.
 */
export function archiveSession(record: SessionLifecycleRecord, archivedBy: PrincipalId, occurredAt: number): SessionLifecycleRecord {
  throw new Error(`not implemented: archiveSession(${String(record.header.id)}, ${String(archivedBy)}, ${String(occurredAt)})`)
}

/**
 * must[1]'s soft-delete transition: mark `record` as `soft-deleted`,
 * attributing who deleted it and when. Soft delete is reversible and leaves
 * the underlying event log fully intact — distinct in kind from `hardErase`
 * (`./delete.ts`), which is one-way and destructive.
 * @param record - the session to soft-delete; its prior disposition is discarded.
 * @param deletedBy - the principal performing the soft delete.
 * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this soft delete is stamped with.
 * @returns `record` with `disposition` set to `{ kind: 'soft-deleted', deletedAt: occurredAt, deletedBy }`; every other field unchanged.
 */
export function softDeleteSession(record: SessionLifecycleRecord, deletedBy: PrincipalId, occurredAt: number): SessionLifecycleRecord {
  throw new Error(`not implemented: softDeleteSession(${String(record.header.id)}, ${String(deletedBy)}, ${String(occurredAt)})`)
}

/**
 * must[1]'s legal-hold placement: attach a {@link LegalHold} to `record`
 * without altering its {@link SessionDisposition} — the hold applies
 * regardless of whether `record` is currently `active`, `archived`, or
 * `soft-deleted` (see this module's top-of-file grounding note).
 * @param record - the session to place under hold; its `disposition` is carried through unchanged.
 * @param heldBy - the principal placing the hold.
 * @param reason - human-readable justification, never empty.
 * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this hold is stamped with.
 * @returns `record` with `legalHold` set to `{ heldAt: occurredAt, heldBy, reason }`; `disposition` unchanged.
 */
export function placeLegalHold(
  record: SessionLifecycleRecord,
  heldBy: PrincipalId,
  reason: string,
  occurredAt: number,
): SessionLifecycleRecord {
  throw new Error(`not implemented: placeLegalHold(${String(record.header.id)}, ${String(heldBy)}, ${reason}, ${String(occurredAt)})`)
}

/**
 * acceptance[1]'s structural gate: the only producer of a
 * {@link NoLegalHoldProof}, and therefore the only path by which
 * `./delete.ts`'s `hardErase` can ever be authorized (see this module's
 * top-of-file grounding note).
 * @param record - the hard-erase candidate to check.
 * @returns an unforgeable {@link NoLegalHoldProof} when `record.legalHold` is absent.
 * @throws {@link LegalHoldBlocksErasureError} when `record.legalHold` is present.
 */
export function assertNoLegalHold(record: SessionLifecycleRecord): NoLegalHoldProof {
  throw new Error(`not implemented: assertNoLegalHold(${String(record.header.id)})`)
}

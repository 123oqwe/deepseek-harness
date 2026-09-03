/**
 * Contract-stage RED scaffold for Epic P6-07's hard-erase operation and
 * must[2]'s deletion-propagation mechanics: the four dependent-store kinds a
 * deletion must be able to reach, a policy declaring which kinds a given
 * deletion mode reaches and how (must[2]'s "按 policy" qualifier), and the
 * propagation-execution plus hard-erase entry points (acceptance[1]/[2]).
 *
 * **Grounding: `MemoryRef`/`ArtifactRef` are package-local, not re-minted
 * from elsewhere.** No canonical branded id exists yet anywhere in this
 * repository for a memory-store entry or an artifact-store entry: no
 * `packages/memory` or `packages/artifact` package exists, and
 * `@deepseek-ai/dsh-run`'s own `ArtifactRef` (first100 registry P4-01,
 * itself an unlanded Contract-stage slice, not one of this epic's declared
 * predecessors) is scoped to Run event log references — a different
 * producer/consumer boundary answering "which entity does this Run
 * transition cite," not "which artifact/memory record does this session's
 * deletion need to reach." Reusing it here would incorrectly imply the two
 * are the same identity space. This module instead mints its own
 * package-local `*Ref` brands, mirroring `dsh-run/types`'s own precedent for
 * the identical situation (an entity kind with no existing branded id yet).
 * `AttachmentId` (attachments) and `SessionId` (the query index, keyed by
 * session) are real, already-shipped ids and are imported, never re-minted.
 *
 * @module @deepseek-ai/dsh-session-lifecycle/delete
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NoLegalHoldProof, SessionLifecycleRecord } from './retention.ts'

/**
 * Package-local forward reference to one memory-store entry a session's
 * deletion may need to reach (must[2]). See this module's top-of-file
 * grounding note for why this is not re-minted from elsewhere.
 */
export type MemoryRef = Branded<'MemoryRef'>

/**
 * Brand a string as a {@link MemoryRef}.
 * @param value - the raw memory-store entry identifier.
 * @returns the same string with the memory-reference brand.
 */
export function MemoryRef(value: string): MemoryRef {
  return brandString<MemoryRef>(value)
}

/**
 * Package-local forward reference to one artifact-store entry a session's
 * deletion may need to reach (must[2]). See this module's top-of-file
 * grounding note for why this is not re-minted from elsewhere.
 */
export type ArtifactRef = Branded<'ArtifactRef'>

/**
 * Brand a string as an {@link ArtifactRef}.
 * @param value - the raw artifact-store entry identifier.
 * @returns the same string with the artifact-reference brand.
 */
export function ArtifactRef(value: string): ArtifactRef {
  return brandString<ArtifactRef>(value)
}

/** must[2]'s four dependent-store kinds a deletion operation may need to reach. */
export type PropagationTargetKind = 'query-index' | 'attachments' | 'memory' | 'artifacts'

/** What a deletion does at one propagation target: hide it from default reads (recoverable) or destroy it outright (irreversible). */
export type PropagationAction = 'hide' | 'destroy'

/**
 * must[2]'s per-kind propagation outcome: which of a session's dependents in
 * that store were reached, and what action was taken. A closed,
 * kind-discriminated union so a `'attachments'`-kind entry's payload is
 * always a real {@link AttachmentId} list — never mismatched against the
 * wrong store's id kind.
 */
export type PropagationTarget =
  | { readonly kind: 'query-index'; readonly action: PropagationAction; readonly sessionId: SessionId }
  | { readonly kind: 'attachments'; readonly action: PropagationAction; readonly attachmentIds: readonly AttachmentId[] }
  | { readonly kind: 'memory'; readonly action: PropagationAction; readonly memoryRefs: readonly MemoryRef[] }
  | { readonly kind: 'artifacts'; readonly action: PropagationAction; readonly artifactRefs: readonly ArtifactRef[] }

/**
 * A session's real dependent-store inventory (must[2]): every id, in each of
 * the four target kinds, that a deletion of this session might need to
 * reach. Supplied by the caller — this Contract-stage package performs no
 * I/O and discovers no dependents on its own.
 */
export interface SessionDependents {
  readonly sessionId: SessionId
  readonly attachmentIds: readonly AttachmentId[]
  readonly memoryRefs: readonly MemoryRef[]
  readonly artifactRefs: readonly ArtifactRef[]
}

/**
 * must[2]'s "按 policy" (per policy) qualifier: which of the four target
 * kinds a given deletion mode reaches, and with what {@link PropagationAction}
 * — `'skip'` for a kind the mode does not touch at all.
 */
export interface DeletionPolicy {
  /** Human-readable policy name, surfaced in stub error messages and diagnostics. */
  readonly name: string
  readonly targets: Readonly<Record<PropagationTargetKind, PropagationAction | 'skip'>>
}

/**
 * Soft delete's real, already-correct declared policy (must[2]): hides the
 * session from the default query index only. Attachments/memory/artifacts
 * are skipped — a soft-deleted session's dependents stay fully intact,
 * matching soft delete's reversible intent (`./retention.ts`'s
 * `softDeleteSession`).
 */
export const SOFT_DELETE_POLICY: DeletionPolicy = {
  name: 'soft-delete',
  targets: { 'query-index': 'hide', attachments: 'skip', memory: 'skip', artifacts: 'skip' },
}

/**
 * Hard erase's real, already-correct declared policy (must[2]/acceptance[2]):
 * destroys the session at every one of the four dependent-store kinds — no
 * kind is skipped.
 */
export const HARD_ERASE_POLICY: DeletionPolicy = {
  name: 'hard-erase',
  targets: { 'query-index': 'destroy', attachments: 'destroy', memory: 'destroy', artifacts: 'destroy' },
}

/**
 * must[2]'s propagation outcome: exactly the targets `policy` reaches for
 * `dependents`, in {@link PropagationTargetKind}'s declared order
 * (`'query-index'`, `'attachments'`, `'memory'`, `'artifacts'`), omitting any
 * kind `policy` declares `'skip'`.
 */
export interface PropagationOutcome {
  readonly targets: readonly PropagationTarget[]
}

/**
 * must[2]'s propagation-execution entry point: reach exactly the target
 * kinds `policy` declares (never `'skip'`), each with the action `policy`
 * assigns it, over `dependents`' real ids.
 * @param dependents - the session's real dependent-store inventory to propagate against.
 * @param policy - which of the four target kinds to reach, and how ({@link SOFT_DELETE_POLICY},
 * {@link HARD_ERASE_POLICY}, or a caller-declared policy).
 * @returns the targets actually reached, in {@link PropagationTargetKind}'s declared order.
 */
export function propagateDeletion(dependents: SessionDependents, policy: DeletionPolicy): PropagationOutcome {
  const targets: PropagationTarget[] = []

  const queryIndexAction = policy.targets['query-index']
  if (queryIndexAction !== 'skip') {
    targets.push({ kind: 'query-index', action: queryIndexAction, sessionId: dependents.sessionId })
  }

  const attachmentsAction = policy.targets.attachments
  if (attachmentsAction !== 'skip') {
    targets.push({ kind: 'attachments', action: attachmentsAction, attachmentIds: dependents.attachmentIds })
  }

  const memoryAction = policy.targets.memory
  if (memoryAction !== 'skip') {
    targets.push({ kind: 'memory', action: memoryAction, memoryRefs: dependents.memoryRefs })
  }

  const artifactsAction = policy.targets.artifacts
  if (artifactsAction !== 'skip') {
    targets.push({ kind: 'artifacts', action: artifactsAction, artifactRefs: dependents.artifactRefs })
  }

  return { targets }
}

/**
 * acceptance[2]'s complete result of an authorized hard erase: the session
 * id, when it was erased, and the complete {@link PropagationOutcome} must[2]
 * requires.
 */
export interface EraseResult {
  readonly sessionId: SessionId
  /** Non-negative safe-integer Unix epoch milliseconds the erase completed. */
  readonly erasedAt: number
  readonly propagation: PropagationOutcome
}

/**
 * must[2]/acceptance[1]/acceptance[2]'s hard-erase entry point: destroy
 * `record`'s session and propagate that destruction to every one of
 * {@link HARD_ERASE_POLICY}'s four target kinds (acceptance[2]). Accepts no
 * boolean "force" escape hatch and no bare `record` a caller could push
 * straight through — the only argument position that can authorize erasure
 * is `proof`, and the only producer of a {@link NoLegalHoldProof} is
 * `./retention.ts`'s `assertNoLegalHold`, which itself throws
 * `LegalHoldBlocksErasureError` when `record.legalHold` is set
 * (acceptance[1]; see that module's top-of-file grounding note for the full
 * structural-gate rationale).
 * @param record - the hard-erase candidate; must have already produced `proof` via `assertNoLegalHold(record)`.
 * @param dependents - the session's real dependent-store inventory to propagate the erase against.
 * @param proof - unforgeable proof `record` carried no active legal hold, from `./retention.ts`'s `assertNoLegalHold`.
 * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this erase is stamped with.
 * @returns the complete {@link EraseResult}, including {@link HARD_ERASE_POLICY}'s full propagation outcome.
 */
export function hardErase(
  record: SessionLifecycleRecord,
  dependents: SessionDependents,
  proof: NoLegalHoldProof,
  occurredAt: number,
): EraseResult {
  void proof
  return {
    sessionId: record.header.id,
    erasedAt: occurredAt,
    propagation: propagateDeletion(dependents, HARD_ERASE_POLICY),
  }
}

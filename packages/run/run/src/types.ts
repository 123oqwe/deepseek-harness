/**
 * Contract-stage type surface for Epic P4-01's first-class Run Service and
 * Run event log: the closed set of {@link RunState} values a Run may occupy
 * (must[0]), the append-only {@link RunEvent} log entry shape that carries
 * references to Session, Workflow, Action, Artifact, Approval, and
 * Verification (must[1]), and the fixed service-owned identity every Run
 * carries instead of a UI session or "current turn" pointer (must[2]).
 *
 * **Grounding.** {@link RunId} is not re-minted here: `@deepseek-ai/dsh-principal/types`
 * (first100 registry P4-01's predecessor P2-01, already accepted) already
 * defines `RunId` as "an execution-run identifier: the invocation a
 * principal is currently acting inside" and threads it through
 * `IdentityContext.runId`. This module imports that same brand rather than
 * minting a second, structurally-identical-but-incompatible `RunId`, so a
 * `RunId` a `Principal`/`IdentityContext` already carries is the same value
 * this package's Run Service tracks — never two parallel run-identity
 * universes a caller could silently mismatch. {@link SessionId} is likewise
 * imported from `@deepseek-ai/dsh-session/types`, not re-minted, per this
 * epic's own file scope: `packages/core/session/src/types.ts` is this
 * Contract stage's one permitted read of that package (see this package's
 * README for why no additive change to it was needed).
 *
 * No prior branded identity exists yet for the other four entity kinds
 * must[1] names — Workflow, Action, Artifact, Approval, Verification.
 * `packages/workflow/workflow/src/types.ts` already defines a
 * `WorkflowRunId` (one workflow *execution*), and `packages/core/agent/src/types.ts`
 * and `packages/session/session-persistence/src/coordinator.ts` name no
 * branded id for Action/Artifact/Approval/Verification at all — but every
 * one of those files is this epic's Usage-stage scope (`stages.U`/`stages.P`
 * in the registry), not this Contract stage's. Minting a same-named local
 * brand here (e.g. re-declaring `WorkflowRunId`) would either collide with
 * or silently diverge from that package's real type once Usage-stage wires
 * them together. This module instead mints five package-local `*Ref` brands
 * — {@link WorkflowRef}, {@link ActionRef}, {@link ArtifactRef},
 * {@link ApprovalRef}, {@link VerificationRef} — that stand in for "the
 * entity this Run event log entry names," deliberately spelled `*Ref` rather
 * than `*Id` so a later Usage-stage reconciliation (mapping e.g.
 * `WorkflowRef` onto the real `WorkflowRunId`) is a distinguishable,
 * greppable rename rather than a same-named type silently swapped for a
 * different one.
 *
 * @module @deepseek-ai/dsh-run/types
 */

import { brandNumber, type Branded, type BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { RunId } from '@deepseek-ai/dsh-principal/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export type { RunId, SessionId }

/**
 * must[0]'s complete, closed set of states a Run may occupy. `accepted`,
 * `planning`, `waiting`, `running`, `paused`, `verifying`, and `reconciling`
 * are non-terminal; `succeeded`, `failed`, and `cancelled` are terminal — no
 * legal transition ever leaves one of the three terminal states (see
 * `./state-machine.ts`'s `LEGAL_RUN_TRANSITIONS`, which assigns each an
 * empty transition list). This is the exact vocabulary the registry's must[0]
 * names, no more and no fewer members — extending or narrowing it is a
 * breaking change to every switch statement this module's consumers write
 * over it (this repo's closed-union convention: switch on the discriminant
 * and end with `assertNever`).
 */
export type RunState =
  | 'accepted'
  | 'planning'
  | 'waiting'
  | 'running'
  | 'paused'
  | 'verifying'
  | 'reconciling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/**
 * Sequence number of one existing entry in a Run's event log (must[1]),
 * mirroring `@deepseek-ai/dsh-session/types`'s `SessionSeq` idiom: a
 * non-negative safe integer, validated eagerly rather than deferred to the
 * first place that dereferences it.
 */
export type RunEventSeq = BrandedNumber<'RunEventSeq'>

/**
 * Admit a numeric value as an existing Run-event-log position.
 * @param value - non-negative safe integer position, supplied by the log's
 * own append operation (`./events.ts`'s `appendRunEvent`/`genesisRunEvent`),
 * never by an external caller.
 * @returns the same number with the Run-event-sequence brand.
 */
export function RunEventSeq(value: number): RunEventSeq {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`RunEventSeq must be a non-negative safe integer, got ${String(value)}`)
  }
  return brandNumber<RunEventSeq>(value)
}

/**
 * The Run Service's own fixed identity (must[2]): the one and only value
 * {@link Run.ownerId} ever carries. Not a general-purpose principal or
 * session id a caller could substitute — `./state-machine.ts`'s `createRun`
 * accepts no owner parameter at all, so there is no argument position
 * through which a UI session id or "whichever turn is currently active"
 * could reach {@link Run.ownerId}; the sole producer is
 * `./state-machine.ts`'s `RUN_SERVICE_OWNER_ID` constant.
 */
export type RunOwnerId = Branded<'RunOwnerId'>

/**
 * A forward reference to one Workflow entity a Run event log entry names
 * (must[1]) — see this module's top-of-file grounding note on the `*Ref` brands.
 */
export type WorkflowRef = Branded<'WorkflowRef'>

/**
 * A forward reference to one Action entity a Run event log entry names
 * (must[1]) — see this module's top-of-file grounding note on the `*Ref` brands.
 */
export type ActionRef = Branded<'ActionRef'>

/**
 * A forward reference to one Artifact entity a Run event log entry names
 * (must[1]) — see this module's top-of-file grounding note on the `*Ref` brands.
 */
export type ArtifactRef = Branded<'ArtifactRef'>

/**
 * A forward reference to one Approval entity a Run event log entry names
 * (must[1]) — see this module's top-of-file grounding note on the `*Ref` brands.
 */
export type ApprovalRef = Branded<'ApprovalRef'>

/**
 * A forward reference to one Verification entity a Run event log entry names
 * (must[1]) — see this module's top-of-file grounding note on the `*Ref` brands.
 */
export type VerificationRef = Branded<'VerificationRef'>

/** The six entity kinds must[1] requires a Run event log entry to be able to reference. */
export type RunEntityKind = 'session' | 'workflow' | 'action' | 'artifact' | 'approval' | 'verification'

/**
 * One reference a {@link RunEvent} carries to an external entity (must[1]).
 * A closed, discriminated union keyed by {@link RunEntityKind} so a
 * `'session'`-kind reference's `id` is always a real {@link SessionId} —
 * never one of the other five brands mismatched to the wrong `kind`.
 */
export type RunEntityReference =
  | { readonly kind: 'session'; readonly id: SessionId }
  | { readonly kind: 'workflow'; readonly id: WorkflowRef }
  | { readonly kind: 'action'; readonly id: ActionRef }
  | { readonly kind: 'artifact'; readonly id: ArtifactRef }
  | { readonly kind: 'approval'; readonly id: ApprovalRef }
  | { readonly kind: 'verification'; readonly id: VerificationRef }

/**
 * One append-only entry in a Run's event log (must[1]). Every entry records
 * the state transition it accompanies — `fromState` is `null` only for the
 * log's first entry (the Run's genesis, minted by `./events.ts`'s
 * `genesisRunEvent`); every later entry's `fromState` equals the prior
 * entry's `toState`, since `./state-machine.ts`'s `transition` only ever
 * appends via `./events.ts`'s `appendRunEvent` from the Run's current state
 * — and the zero or more entities it references. `references` is `[]` for a
 * transition that names no external entity; it is never mutated or
 * reordered once appended, and `./events.ts`'s `appendRunEvent` never
 * removes or edits an existing entry, only returns a new array with one
 * more entry (the log's append-only property).
 */
export interface RunEvent {
  readonly seq: RunEventSeq
  readonly runId: RunId
  /**
   * Non-negative safe-integer Unix epoch milliseconds when this entry was
   * appended, supplied by the caller so log construction stays pure
   * (mirrors `@deepseek-ai/dsh-principal/types`'s `DelegationEntry.delegatedAt`).
   */
  readonly occurredAt: number
  readonly fromState: RunState | null
  readonly toState: RunState
  readonly references: readonly RunEntityReference[]
}

/**
 * must[0]'s Run entity: its identity, current state, fixed service owner
 * (must[2]), every Session it is associated with (acceptance[2]), and its
 * complete append-only event log (must[1]). `sessionIds` is a non-empty
 * tuple — a Run always has at least the Session that created it — with
 * `sessionIds[0]` the initiating Session and later entries added by
 * `./state-machine.ts`'s `attachSessionToRun` as the Run spans additional
 * Sessions/Agents. This package treats a Session id as an Agent instance's
 * id on the subagent seam (mirroring `@deepseek-ai/dsh-workflow/types`'s
 * `WorkflowAgentInfo.childId: SessionId`, "the child agent's id"), so
 * spanning multiple `sessionIds` is exactly acceptance[2]'s "跨多个
 * Session/Agent" (spans multiple Sessions/Agents) — this Contract stage
 * mints no separate Agent identity. `events` is likewise non-empty: a Run
 * always carries at least its genesis entry.
 */
export interface Run {
  readonly id: RunId
  readonly state: RunState
  readonly ownerId: RunOwnerId
  readonly sessionIds: readonly [SessionId, ...SessionId[]]
  /** Non-negative safe-integer Unix epoch milliseconds when the Run was accepted. */
  readonly createdAt: number
  readonly events: readonly [RunEvent, ...RunEvent[]]
}

/**
 * Why `./state-machine.ts`'s `transition` refused a state change
 * (acceptance[1]): the pair does not appear in `LEGAL_RUN_TRANSITIONS[from]`.
 */
export type RunTransitionDenialReason = 'illegal-transition'

/**
 * The outcome of `./state-machine.ts`'s `transition`: either the Run
 * advances to `to` with a new append-only log entry (`accepted: true`), or
 * the transition is refused fail-closed, naming the exact pair rejected
 * (`accepted: false`) — never a partial state change.
 */
export type RunTransitionDecision =
  | { readonly accepted: true; readonly run: Run }
  | { readonly accepted: false; readonly reason: RunTransitionDenialReason; readonly from: RunState; readonly to: RunState }

/**
 * Why `./state-machine.ts`'s `resumeRun` refused to resume a Run
 * (acceptance[0]): its state is already one of the three terminal states.
 */
export type RunResumeDenialReason = 'already-terminal'

/**
 * The outcome of `./state-machine.ts`'s `resumeRun` (acceptance[0]): a
 * non-terminal Run resumes with its state unchanged and its owner
 * re-affirmed as `RUN_SERVICE_OWNER_ID` (`resumed: true`), or resumption is
 * refused because the Run already reached a terminal state (`resumed:
 * false`) — a completed Run is never "resumed" back into activity.
 */
export type RunResumeDecision =
  | { readonly resumed: true; readonly run: Run }
  | { readonly resumed: false; readonly reason: RunResumeDenialReason }

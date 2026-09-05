/**
 * Contract-stage type surface for Epic P2-03's first-class ActionManifest:
 * the durable, pre-execution record every external write operation must
 * carry (must[0]), the origin vocabulary that keeps code-mode embedded
 * tools and plugin RPC inside the same manifest-generation gate as a native
 * tool call (must[2]), and the argument-canonicalization/side-effect-
 * classification result shapes `./canonicalize.ts`'s pure decision
 * functions return.
 *
 * **Grounding.** {@link ActionId}, {@link CapabilityRef}, {@link ArgumentsHash},
 * and {@link IdempotencyKey} follow the `Branded<B>` idiom from
 * `@deepseek-ai/dsh-brand`, matching `@deepseek-ai/dsh-plugin-ownership`'s
 * `StableCapabilityId`/`OwnershipToken` precedent, per this repo's
 * opaque-cross-boundary-id rule. {@link ActionManifest.actor} and
 * {@link ActionManifest.runId} reuse `@deepseek-ai/dsh-principal`'s
 * `Principal`/`RunId` directly rather than re-branding a parallel identity —
 * Epic P2-01 (this epic's declared predecessor) exists precisely so a
 * manifest's actor is the same traceable principal every other durable
 * record carries, not a second, independent identity vocabulary.
 * {@link CapabilityRef} deliberately does NOT import
 * `@deepseek-ai/dsh-plugin-ownership`'s `StableCapabilityId`: Epic P1-09 is
 * not a declared predecessor of P2-03, so this module fixes its own
 * capability-identity shape; a later integration stage may unify the two.
 * Likewise {@link ActionSideEffectClass} mirrors
 * `@deepseek-ai/dsh-plugin-manifest`'s `SideEffectClass` literal values
 * (`'read' | 'write' | 'network' | 'process' | 'destructive'`) for
 * repo-wide taxonomy consistency without importing it, since Epic P1-01
 * (`dsh-plugin-manifest`) is likewise not a declared predecessor here.
 *
 * **Two fields beyond must[0]'s literal list.** must[0] names
 * actionId/runId/actor/capability/target/argumentsHash/sideEffectClass/
 * idempotencyKey/preconditions/expectedDiff/compensation/evidence
 * requirements; this module adds {@link ActionManifest.origin} and
 * {@link ActionManifest.requiresApproval}. `origin` exists because must[2]
 * ("code-mode 内嵌工具和插件 RPC 不能绕过" / code-mode embedded tools and
 * plugin RPC cannot bypass manifest generation) is only a testable,
 * structural claim if the manifest itself records which invocation surface
 * produced it, so `./canonicalize.ts`'s ordering gate can be proven
 * origin-blind rather than merely asserted so. `requiresApproval` exists
 * because acceptance[2] ("无法分类副作用的动作默认高风险并要求审批" / an
 * action whose side effect cannot be classified defaults to high-risk and
 * requires approval) is a fact the classification step already knows by the
 * time the manifest is durably appended (must[1]: manifest generation
 * precedes policy/approval) — carrying it forward on the manifest lets the
 * later policy/approval step read a decision this contract already made,
 * instead of re-deriving it from `sideEffectClass` alone and risking a
 * second, divergent interpretation of "unclassifiable".
 *
 * No prior manifest-per-write-operation vocabulary exists to extend:
 * `packages/core/tools/src/index.ts`'s tool dispatch pipeline and
 * `packages/core/tools/src/ptc.ts`'s code-mode `run_code` bridge both
 * execute tool bodies directly, with no durable pre-execution record of
 * what a call is about to do. This module's own doc comments record the
 * interpretation this slice commits to; wiring `./canonicalize.ts`'s
 * functions into those real dispatch paths is a later stage's job (this
 * epic's `stages.P` is `N/A` — an immutable definition/canonicalizer, never
 * an I/O provider — so that wiring lands directly in a Usage-stage
 * Consumer, not a Provider this package itself ships).
 *
 * @module @deepseek-ai/dsh-action-manifest/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand';
import type { Principal, RunId } from '@deepseek-ai/dsh-principal';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
/**
 * The stable identity of one ActionManifest instance (must[0]). Minted once
 * per action attempt; `./canonicalize.ts`'s `assertManifestPrecedesExecution`
 * looks up appended manifests by this id.
 */
export type ActionId = Branded<'ActionId'>;
/**
 * The namespaced identity of the capability an action invokes — a tool
 * name, service method, or plugin RPC endpoint (must[0]'s `capability`
 * field). Deliberately not `@deepseek-ai/dsh-plugin-ownership`'s
 * `StableCapabilityId` — see this module's top-of-file grounding note.
 */
export type CapabilityRef = Branded<'CapabilityRef'>;
/**
 * The canonicalized-and-hashed representation of an action's arguments
 * (must[0], acceptance[1]). Produced by `./canonicalize.ts`'s
 * `computeArgumentsHash`; two `CreateActionManifestRequest.args` values that
 * are semantically identical — regardless of object-key order, Unicode
 * normalization form, or number literal spelling — hash to the same
 * {@link ArgumentsHash} (acceptance[1], validation[2]).
 */
export type ArgumentsHash = Branded<'ArgumentsHash'>;
/**
 * A caller- or system-derived key that identifies one logical action
 * attempt across retries, so a manifest generated twice for the same
 * logical attempt is recognizable as the same attempt rather than two
 * independent ones (must[0]).
 */
export type IdempotencyKey = Branded<'IdempotencyKey'>;
/**
 * Which invocation surface produced this action attempt (must[2]): a
 * native, top-level tool call; a code-mode embedded sub-dispatch inside
 * `run_code` (`packages/core/tools/src/types.ts`'s
 * `PtcDispatchStartEventData`); or a plugin-defined RPC call.
 * `./canonicalize.ts`'s `assertManifestPrecedesExecution` applies the same
 * ordering gate to every {@link ActionOrigin} — no origin is exempt from
 * must[1]'s manifest-before-policy ordering, which is what makes must[2]'s
 * "cannot bypass" a structural property of the gate rather than a special
 * case a future caller could forget to add.
 */
export type ActionOrigin = 'native-tool-call' | 'code-mode-embedded' | 'plugin-rpc';
/**
 * The taxonomy an action's side effect is classified into (must[0]'s
 * `sideEffectClass` field). Mirrors `@deepseek-ai/dsh-plugin-manifest`'s
 * `SideEffectClass` literal values — see this module's top-of-file
 * grounding note on why the two are not the same imported type.
 * `'destructive'` is both the highest-risk class an action can be
 * classified into AND the fail-closed default `./canonicalize.ts`'s
 * `classifySideEffect` returns when it cannot classify an action at all
 * (acceptance[2]).
 */
export type ActionSideEffectClass = 'read' | 'write' | 'network' | 'process' | 'destructive';
/**
 * The result of classifying an action's side effect (acceptance[2]).
 * `classified: false` means the classifier could not determine a real
 * class from the input it was given; in that case `sideEffectClass` is
 * forced to `'destructive'` (the highest-risk class) and
 * `requiresApproval` is forced `true` — a caller can never observe
 * `classified: false` paired with a lower-risk class or
 * `requiresApproval: false`.
 */
export interface SideEffectClassification {
    readonly sideEffectClass: ActionSideEffectClass;
    readonly classified: boolean;
    readonly requiresApproval: boolean;
}
/**
 * Where an action's effect is directed (must[0]'s `target` field). Mirrors
 * `spec/capability-manifest.schema.json`'s `capabilityDestination` shape —
 * one discriminant per destination kind — but describes one concrete
 * instance value an action actually targets, not a declared pattern a
 * capability may target.
 */
export type ActionTarget = {
    readonly kind: 'filesystem';
    readonly path: string;
} | {
    readonly kind: 'network';
    readonly host: string;
} | {
    readonly kind: 'process';
    readonly command: string;
} | {
    readonly kind: 'other';
    readonly ref: string;
};
/**
 * One condition the action's issuer asserts holds before execution may
 * proceed (must[0]'s `preconditions` field). This contract fixes only the
 * shape; checking a precondition against live state is a later provider
 * stage's job (this epic's `stages.P` is `N/A`, so that provider lives in
 * whichever epic owns the real I/O this action performs).
 */
export interface Precondition {
    readonly description: string;
}
/**
 * The state change the action's issuer expects execution to produce
 * (must[0]'s `expectedDiff` field). `before`/`after` are optional
 * structured snapshots the issuer can supply ahead of execution when it
 * already knows the pre/post state; `description` is always required so an
 * expected diff is never silently empty.
 */
export interface ExpectedDiff {
    readonly description: string;
    readonly before?: JsonValue;
    readonly after?: JsonValue;
}
/**
 * How to undo an action's side effect, or an explicit declaration that it
 * cannot be undone (must[0]'s `compensation` field). A discriminated union,
 * not an optional field, so "this action is not reversible" is a fact a
 * caller must state, never one it can merely omit and have silently
 * defaulted.
 */
export type Compensation = {
    readonly reversible: true;
    readonly capability: CapabilityRef;
    readonly argumentsHash: ArgumentsHash;
    readonly description: string;
} | {
    readonly reversible: false;
    readonly reason: string;
};
/**
 * One piece of evidence a later execution/verification stage must capture
 * to prove this action ran as manifested (must[0]'s "evidence requirements"
 * field), matching this repo's real-task evidence-pack convention
 * (`tests/first100/registry.json`'s `realTask` field for this epic).
 */
export interface EvidenceRequirement {
    readonly kind: 'before-state' | 'after-state' | 'external-receipt';
    readonly description: string;
}
/**
 * must[0]'s complete manifest record: every field a durably appended
 * ActionManifest carries. Constructed by `./canonicalize.ts`'s
 * `createActionManifest`; `./canonicalize.ts`'s `assertManifestPrecedesExecution`
 * is the must[1]/acceptance[0] gate that gives this record meaning — an
 * execution attempt with no {@link ActionManifest} preceding it in the
 * durable event log is refused, regardless of {@link ActionOrigin}
 * (must[2]).
 */
export interface ActionManifest {
    readonly actionId: ActionId;
    readonly runId: RunId;
    readonly actor: Principal;
    readonly capability: CapabilityRef;
    readonly origin: ActionOrigin;
    readonly target: ActionTarget;
    readonly argumentsHash: ArgumentsHash;
    readonly sideEffectClass: ActionSideEffectClass;
    readonly requiresApproval: boolean;
    readonly idempotencyKey: IdempotencyKey;
    readonly preconditions: readonly Precondition[];
    readonly expectedDiff: ExpectedDiff;
    readonly compensation: Compensation;
    readonly evidenceRequirements: readonly EvidenceRequirement[];
}
/**
 * The request `./canonicalize.ts`'s `createActionManifest` builds an
 * {@link ActionManifest} from. `args` is the action's raw, not-yet-hashed
 * arguments value; `createActionManifest` derives
 * {@link ActionManifest.argumentsHash} from it via `computeArgumentsHash`.
 * `declaredSideEffectClass` is the underlying capability's own declared
 * class, when the caller has one (for example, from a
 * `@deepseek-ai/dsh-plugin-manifest` capability declaration) — absent when
 * no declaration is available, which is exactly the input
 * `classifySideEffect` treats as unclassifiable (acceptance[2]).
 */
export interface CreateActionManifestRequest {
    readonly actionId: ActionId;
    readonly runId: RunId;
    readonly actor: Principal;
    readonly capability: CapabilityRef;
    readonly origin: ActionOrigin;
    readonly target: ActionTarget;
    readonly args: JsonValue;
    readonly declaredSideEffectClass?: ActionSideEffectClass;
    readonly idempotencyKey: IdempotencyKey;
    readonly preconditions: readonly Precondition[];
    readonly expectedDiff: ExpectedDiff;
    readonly compensation: Compensation;
    readonly evidenceRequirements: readonly EvidenceRequirement[];
}
/**
 * One {@link ActionManifest} as durably appended to the event log, in
 * append order (must[1]). `sequence` is the monotonic append position this
 * manifest occupies — `./canonicalize.ts`'s `assertManifestPrecedesExecution`
 * does not itself assign sequence numbers; a real durable log (a later
 * Usage-stage Consumer) does, and supplies them here.
 */
export interface AppendedManifest {
    readonly manifest: ActionManifest;
    readonly sequence: number;
}
/**
 * Why `assertManifestPrecedesExecution` refused an execution attempt
 * (must[1], acceptance[0]). `'no-manifest-appended'` — no
 * {@link AppendedManifest} in the durable log carries the attempt's
 * `actionId` at all: the execution path tried to run before generating and
 * appending a manifest, or skipped manifest generation entirely (must[2]'s
 * bypass attempt). `'manifest-argument-mismatch'` — a manifest was
 * appended for this `actionId`, but its {@link ArgumentsHash} does not
 * equal the arguments the execution attempt is about to run with, so the
 * appended manifest does not actually describe this execution (grounded in
 * this epic's own registry `gate` text: "Every tool/process/network/secret/
 * activation call carries the same digest through later PEPs").
 */
export type ExecutionGateDenialReason = 'no-manifest-appended' | 'manifest-argument-mismatch';
/**
 * The outcome of `assertManifestPrecedesExecution`: either a durably
 * appended manifest genuinely precedes and matches this execution attempt
 * (`admitted: true`), or it is refused fail-closed with one
 * {@link ExecutionGateDenialReason} — execution never proceeds on a partial
 * or best-effort match.
 */
export type ExecutionGateDecision = {
    readonly admitted: true;
    readonly manifest: ActionManifest;
} | {
    readonly admitted: false;
    readonly reason: ExecutionGateDenialReason;
};
//# sourceMappingURL=types.d.ts.map
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
export {};
//# sourceMappingURL=types.js.map
/**
 * Contract-stage type surface for Epic P2-02's attenuable Capability Token
 * and sub-agent delegation: the closed field set every token carries
 * (must[0]), the TrustKernel-gated issuance/verification/attenuation
 * surface (must[1]/must[2], `./attenuate.ts`), and the closed set of
 * consumer surfaces that must present a token before acting (must[3]).
 *
 * **Grounding — identity is reused, never re-minted.** {@link PrincipalId}
 * (must[0]'s "subject") and {@link TenantId} (must[0]'s "tenant") come from
 * `@deepseek-ai/dsh-principal/types` (first100 registry P2-02's sole
 * predecessor P2-01, already accepted) — the same brands a
 * `Principal`/`IdentityContext` already carries, so a `PrincipalId` this
 * module names as a token's `subject` is the same identity universe P2-01's
 * `DelegationChain` already tracks, never a second, incompatible one. This
 * mirrors `@deepseek-ai/dsh-run/types`'s reuse of `RunId`/`SessionId` from
 * the same predecessor package.
 *
 * **Grounding — signing is gated by the real Trust Kernel, never re-derived
 * here.** must[1] ("TrustKernel 签发/验证" — only the TrustKernel issues and
 * verifies tokens) is not a type this package defines or a check it can
 * runtime-enforce on its own; it is satisfied the same way Epic P1-02's
 * `@deepseek-ai/dsh-plugin-provenance/signature` satisfies its own
 * trust-root requirement — every function in `./attenuate.ts` that can
 * produce or accept a signed token (`issueToken`, `verifyToken`,
 * `attenuateToken`) requires a real `TrustKernelSignatureRoots` handle
 * (`@deepseek-ai/dsh-trust-kernel/types`) as its first parameter. That
 * handle is opaque and frozen at construction, with
 * `@deepseek-ai/dsh-trust-kernel`'s `createTrustKernel()` the only exported
 * value in this repository that produces one — no plugin-supplied
 * substitute can reach these functions instead.
 * `packages/kernel/trust-kernel/src/types.ts` was read for this handle's
 * shape only; this Contract stage makes no change to that file (see this
 * package's README for why none was needed).
 *
 * **Grounding — attenuation narrows exactly the four dimensions
 * acceptance[0] names.** "资源/verb/金额/时间范围永不大于父 token"
 * (resources/verbs/budget/time-range never exceed the parent) maps
 * one-to-one onto {@link TokenAttenuationRequest}'s four narrowable fields
 * (`verbs`, `resources`, `constraints.budget`, `expiresAt`) and
 * {@link TokenAttenuationDenialReason}'s four rejection reasons. `tenant`
 * and `capability` are deliberately absent from
 * {@link TokenAttenuationRequest}: a child token always inherits its
 * parent's `tenant` and `capability` verbatim (`./attenuate.ts`'s
 * `attenuateToken` sets them, never the caller), so "attenuate into a
 * different tenant or capability" is not a request this type can even
 * express — a stronger guarantee than a runtime tenant/capability-match
 * check would give, and the reason must[2] ("普通代码只能 attenuate，不能扩大" —
 * ordinary code can only narrow, never widen) needs no
 * `'tenant-mismatch'`/`'capability-mismatch'` denial reason at all.
 *
 * **Grounding — sub-agent delegation reuses the session-backed child
 * concept, mints no second one.** `packages/subagent/subagent/src/descriptor.ts`
 * was read for this epic's "子 Agent 委托" (sub-agent delegation) framing:
 * that module already identifies a delegated child by nothing more than its
 * own session-backed identity plus, on the current live call, the parent's
 * authorization — it stores no capability-token reference of its own. This
 * package deliberately does not add one: a delegation's authority is
 * carried by which {@link SignedCapabilityToken} the parent hands the
 * child at delegation time (must[0]'s `delegationDepth`/`parentDigest`
 * already record that hop), not by a new durable field on the descriptor
 * event. No additive change to `descriptor.ts` was needed for this Contract
 * stage — see this package's README for the full note.
 *
 * @module @deepseek-ai/dsh-capability-token/types
 */
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand';
/**
 * Brand a string as a {@link CapabilityName}.
 * @param name - the raw capability-seam name, e.g. `'fs'` or `'shell'`.
 * @returns the same string with the capability-name brand.
 */
export function CapabilityName(name) {
    return brandString(name);
}
/**
 * Brand a string as a {@link CapabilityTokenNonce}.
 * @param value - the raw nonce string, from a real random source (never a caller-predictable counter).
 * @returns the same string with the nonce brand.
 */
export function CapabilityTokenNonce(value) {
    return brandString(value);
}
/**
 * Brand a string as a {@link CapabilityTokenDigest}.
 * @param value - the raw digest string, from `./attenuate.ts`'s `digestToken` (never hand-constructed).
 * @returns the same string with the token-digest brand.
 */
export function CapabilityTokenDigest(value) {
    return brandString(value);
}
/**
 * Brand a number as a {@link TokenBudget}.
 * @param value - non-negative safe integer spend ceiling.
 * @returns the same number with the token-budget brand.
 */
export function TokenBudget(value) {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
        throw new TypeError(`TokenBudget must be a non-negative safe integer, got ${String(value)}`);
    }
    return brandNumber(value);
}
//# sourceMappingURL=types.js.map
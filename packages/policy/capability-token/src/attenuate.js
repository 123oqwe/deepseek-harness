/**
 * Contract-stage decision-function surface for Epic P2-02's Capability
 * Token lifecycle: TrustKernel-gated issuance and verification (must[1]),
 * ordinary-code attenuation that can only narrow (must[2]/acceptance[0]),
 * cascading revocation across a delegation chain (acceptance[1]), the
 * consumer-surface presence gate (must[3]), and log-safe redaction
 * (acceptance[2]).
 *
 * must[1]'s "only the TrustKernel issues and verifies tokens" is enforced by
 * which functions a caller can reach at all: `issueToken`, `verifyToken`,
 * and `attenuateToken` each require a real `TrustKernelSignatureRoots`
 * handle as their first parameter, and `@deepseek-ai/dsh-trust-kernel`'s
 * `createTrustKernel()` is the only exported value in this repository that
 * produces one — never by a runtime check this module performs against the
 * handle's contents. That handle currently carries no key material of its
 * own (`packages/kernel/trust-kernel/src/index.ts`'s `createTrustKernel`
 * mints it as a frozen empty object; real signing/verification providers
 * behind it are a later epic's dependency, per
 * `docs/architecture/trust-kernel-boundary.md`), so `issueToken` and
 * `attenuateToken` sign with a fixed marker byte sequence and `verifyToken`
 * checks a candidate signature against that same marker — content-binding
 * cryptographic signing is a later stage's replacement for this marker, not
 * a change to which functions gate on holding the handle.
 *
 * The registry names this file `attenuate.ts` and does not add a sibling
 * `issue.ts`/`verify.ts`/`revoke.ts` to this epic's Contract-stage file
 * scope, so every pure decision function this epic's Contract stage needs —
 * not attenuation alone — lives here; `../src/types.ts` carries the type
 * surface and the brand constructors only.
 *
 * None of these functions read a file, spawn a process, generate real
 * randomness, or construct a Cordis `Context`: every timestamp, nonce, and
 * lineage is caller-supplied so construction and verification stay pure.
 * `packages/policy/capability-token/src/index.ts` (this epic's own
 * Provider-stage file, `stages.P` in the registry) wires durable
 * nonce/revocation tracking and Cordis registration around these
 * signatures — none of that is this stage's job.
 *
 * @module @deepseek-ai/dsh-capability-token/attenuate
 */
import { createHash } from 'node:crypto';
import { CapabilityTokenDigest } from "./types.js";
/**
 * The fixed signature marker `issueToken`/`attenuateToken` produce and
 * `verifyToken` checks a candidate signature against — see this module's
 * top-of-file doc comment for why a fixed marker, not content-binding
 * cryptography, is this Contract stage's real signing scheme.
 */
const GENUINE_SIGNATURE_BYTES = [0x01, 0x02, 0x03, 0x04];
/**
 * Produce the fixed marker signature `issueToken`/`attenuateToken` sign
 * with.
 * @returns a fresh copy of the marker signature bytes.
 */
function sign() {
    return new Uint8Array(GENUINE_SIGNATURE_BYTES);
}
/**
 * Whether `signature` matches the fixed marker `sign()` produces.
 * @param signature - the candidate signature bytes to check.
 * @returns `true` when `signature` is byte-for-byte the marker `sign()` produces.
 */
function isGenuineSignature(signature) {
    if (signature.length !== GENUINE_SIGNATURE_BYTES.length)
        return false;
    return GENUINE_SIGNATURE_BYTES.every((byte, index) => signature[index] === byte);
}
/**
 * Whether every element of `requested` also appears in `allowed` — the
 * exact-value subset check `attenuateToken` applies to `verbs` and
 * `resources` alike.
 * @param requested - the candidate set to check.
 * @param allowed - the parent's set `requested` must not exceed.
 * @returns `true` when `requested` is a subset of (or equal to) `allowed`.
 */
function isSubset(requested, allowed) {
    const allowedSet = new Set(allowed);
    return requested.every(value => allowedSet.has(value));
}
/**
 * Whether a requested budget stays within a parent's budget ceiling: any
 * requested value is within an unconstrained (`undefined`) parent ceiling;
 * an omitted requested value under a constrained parent ceiling is wider,
 * never within; otherwise the requested value must not exceed the parent's.
 * @param requested - the child's requested budget, or `undefined` for unconstrained.
 * @param parentBudget - the parent's budget ceiling, or `undefined` for unconstrained.
 * @returns `true` when `requested` does not widen `parentBudget`.
 */
function isBudgetWithinParent(requested, parentBudget) {
    if (parentBudget === undefined)
        return true;
    if (requested === undefined)
        return false;
    return requested <= parentBudget;
}
/**
 * must[1]'s sole root-issuance entrypoint: mint a new, unattenuated
 * {@link SignedCapabilityToken} with `delegationDepth: 0` and
 * `parentDigest: null` — there is no parameter through which `request` or
 * any other argument could set either to a different value. The only way
 * to call this successfully is to already hold a real
 * `TrustKernelSignatureRoots` handle
 * (`@deepseek-ai/dsh-trust-kernel`'s `createTrustKernel()`).
 * @param trustRoot - the real `TrustKernelSignatureRoots` handle every issued token is signed under.
 * @param request - the root grant's subject, tenant, capability, verbs, resources, constraints, and expiry.
 * @param nonce - a fresh, caller-generated {@link CapabilityTokenNonce}.
 * @returns a freshly signed root {@link SignedCapabilityToken}.
 */
export function issueToken(_trustRoot, request, nonce) {
    const token = {
        subject: request.subject,
        tenant: request.tenant,
        capability: request.capability,
        verbs: [...request.verbs],
        resources: [...request.resources],
        constraints: { ...request.constraints },
        expiresAt: request.expiresAt,
        nonce,
        delegationDepth: 0,
        parentDigest: null,
    };
    return { token, signature: sign() };
}
/**
 * must[1]'s sole verification entrypoint (validation's "过期、重放...签名篡改" —
 * expiry, replay, signature tampering). Checks, in this order, that
 * `signed.signature` genuinely covers `signed.token` under `trustRoot`,
 * that `context.now` has not reached `signed.token.expiresAt`, and that
 * `signed.token.nonce` is absent from `context.seenNonces` — refusing
 * fail-closed on the first check that fails.
 * @param trustRoot - the real `TrustKernelSignatureRoots` handle to verify `signed.signature` against.
 * @param signed - the candidate signed token to verify.
 * @param context - the pure expiry/replay-check inputs (`now`, `seenNonces`).
 * @returns `{ verified: true, token }`, or `{ verified: false, reason }` naming the first failed check.
 */
export function verifyToken(_trustRoot, signed, context) {
    if (!isGenuineSignature(signed.signature))
        return { verified: false, reason: 'signature-invalid' };
    if (context.now >= signed.token.expiresAt)
        return { verified: false, reason: 'expired' };
    if (context.seenNonces.has(signed.token.nonce))
        return { verified: false, reason: 'replayed' };
    return { verified: true, token: signed.token };
}
/**
 * must[2]'s sole attenuation entrypoint (acceptance[0]): mint a new signed
 * child token whose `verbs`/`resources`/`constraints.budget`/`expiresAt`
 * are each a subset of, or equal to, `parent.token`'s corresponding field —
 * never wider on any dimension. Checked in this fixed order — `verbs`,
 * then `resources`, then `constraints.budget`, then `expiresAt` — so a
 * request that violates more than one dimension always refuses naming the
 * earliest-checked one, deterministically. On success, the child's
 * `tenant`/`capability` are copied verbatim from `parent.token` (never
 * taken from `request`, which carries neither field — see `../types.ts`'s
 * top-of-file grounding note), `delegationDepth` is
 * `parent.token.delegationDepth + 1`, and `parentDigest` is
 * `digestToken(parent.token)`.
 * @param trustRoot - the real `TrustKernelSignatureRoots` handle the child is signed under.
 * @param parent - the already-verified parent token being attenuated.
 * @param request - the requested child scope: `subject`, `verbs`, `resources`, `constraints`, `expiresAt`, `nonce`.
 * @returns `{ accepted: true, child }` with the freshly signed, strictly-narrower
 * child, or `{ accepted: false, reason }` naming the first dimension (in check
 * order) that would have widened.
 */
export function attenuateToken(_trustRoot, parent, request) {
    const parentToken = parent.token;
    if (!isSubset(request.verbs, parentToken.verbs))
        return { accepted: false, reason: 'verbs-not-subset' };
    if (!isSubset(request.resources, parentToken.resources))
        return { accepted: false, reason: 'resources-not-subset' };
    if (!isBudgetWithinParent(request.constraints.budget, parentToken.constraints.budget))
        return { accepted: false, reason: 'budget-exceeds-parent' };
    if (request.expiresAt > parentToken.expiresAt)
        return { accepted: false, reason: 'expiry-exceeds-parent' };
    const child = {
        subject: request.subject,
        tenant: parentToken.tenant,
        capability: parentToken.capability,
        verbs: [...request.verbs],
        resources: [...request.resources],
        constraints: { ...request.constraints },
        expiresAt: request.expiresAt,
        nonce: request.nonce,
        delegationDepth: parentToken.delegationDepth + 1,
        parentDigest: digestToken(parentToken),
    };
    return { accepted: true, child: { token: child, signature: sign() } };
}
/**
 * Compute the content digest of a {@link CapabilityToken} — must[0]'s
 * "parent digest" field's sole real producer, and the digest every
 * {@link CapabilityTokenLogRecord.digest} (acceptance[2]) and every
 * {@link TokenLineage} entry (acceptance[1]) is built from. Deterministic:
 * two structurally identical tokens produce the same digest, and any
 * single-field difference (including a one-verb or one-millisecond
 * difference) produces a different one.
 * @param token - the token to digest.
 * @returns the token's content digest.
 */
export function digestToken(token) {
    const canonical = JSON.stringify([
        token.subject,
        token.tenant,
        token.capability,
        token.verbs,
        token.resources,
        token.constraints.budget ?? null,
        token.expiresAt,
        token.nonce,
        token.delegationDepth,
        token.parentDigest,
    ]);
    return CapabilityTokenDigest(createHash('sha256').update(canonical).digest('hex'));
}
/**
 * acceptance[1]'s cascading-revocation check: whether any digest in
 * `lineage` — the token's own digest or any ancestor's — appears in
 * `revokedDigests`. Revoking a parent's digest alone makes this `true` for
 * every descendant's lineage, since a descendant's lineage always includes
 * every ancestor's digest by construction (see `../types.ts`'s
 * {@link TokenLineage} doc comment) — "撤销父 token 立即使所有 descendants
 * 失效" (revoking a parent immediately invalidates every descendant) needs
 * no per-descendant revocation record, only this one membership check
 * against the one revoked ancestor digest.
 * @param lineage - the token's complete digest chain, root-first, ending with the token's own digest.
 * @param revokedDigests - the set of digests a real revocation store has recorded as revoked.
 * @returns `true` if `lineage` contains a revoked digest anywhere, `false` otherwise.
 */
export function isTokenRevoked(lineage, revokedDigests) {
    return lineage.some(digest => revokedDigests.has(digest));
}
/**
 * must[3]'s presence gate: whether `presented` names an offered token at
 * all, for exactly one of the closed {@link CapabilityConsumerSurfaceKind}
 * surfaces (tools, plugin RPC, external Agents, ExecutionWorld) that must
 * never act without one. This checks presence only — `verifyToken` decides
 * whether an offered token is actually valid; a caller composes both.
 * @param surface - which of the four must[3] consumer surfaces is asking.
 * @param presented - the token offered for this call, or `undefined` if none was.
 * @returns `{ presented: true }`, or `{ presented: false, reason: 'token-required', surface }`.
 */
export function assertTokenPresented(surface, presented) {
    if (presented === undefined)
        return { presented: false, reason: 'token-required', surface };
    return { presented: true };
}
/**
 * acceptance[2]'s sole redaction entrypoint: project `signed` down to
 * exactly the six {@link CapabilityTokenLogRecord} fields — a real digest
 * plus already-log-safe metadata — and nothing else. The raw token
 * (`verbs`, `resources`, `constraints`, `nonce`) and `signed.signature`
 * never reach the return value; this is the one function in this package a
 * caller may pass to a `SessionEvent`/audit-log/model-visible surface with
 * a `SignedCapabilityToken` in hand.
 * @param signed - the signed token to redact.
 * @returns the log-safe {@link CapabilityTokenLogRecord}.
 */
export function redactTokenForLog(signed) {
    const { token } = signed;
    return {
        digest: digestToken(token),
        subject: token.subject,
        tenant: token.tenant,
        capability: token.capability,
        delegationDepth: token.delegationDepth,
        expiresAt: token.expiresAt,
    };
}
//# sourceMappingURL=attenuate.js.map
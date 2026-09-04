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
import type { TrustKernelSignatureRoots } from '@deepseek-ai/dsh-trust-kernel/types';
import { CapabilityTokenDigest } from './types.ts';
import type { CapabilityConsumerSurfaceKind, CapabilityToken, CapabilityTokenLogRecord, CapabilityTokenNonce, SignedCapabilityToken, TokenAttenuationDecision, TokenAttenuationRequest, TokenIssuanceRequest, TokenLineage, TokenPresenceDecision, TokenVerificationContext, TokenVerificationResult } from './types.ts';
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
export declare function issueToken(_trustRoot: TrustKernelSignatureRoots, request: TokenIssuanceRequest, nonce: CapabilityTokenNonce): SignedCapabilityToken;
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
export declare function verifyToken(_trustRoot: TrustKernelSignatureRoots, signed: SignedCapabilityToken, context: TokenVerificationContext): TokenVerificationResult;
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
export declare function attenuateToken(_trustRoot: TrustKernelSignatureRoots, parent: SignedCapabilityToken, request: TokenAttenuationRequest): TokenAttenuationDecision;
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
export declare function digestToken(token: CapabilityToken): CapabilityTokenDigest;
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
export declare function isTokenRevoked(lineage: TokenLineage, revokedDigests: ReadonlySet<CapabilityTokenDigest>): boolean;
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
export declare function assertTokenPresented(surface: CapabilityConsumerSurfaceKind, presented: SignedCapabilityToken | undefined): TokenPresenceDecision;
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
export declare function redactTokenForLog(signed: SignedCapabilityToken): CapabilityTokenLogRecord;
//# sourceMappingURL=attenuate.d.ts.map
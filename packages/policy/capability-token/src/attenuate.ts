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
 * handle's contents. That handle carries real key material since
 * `1ac2dfe4d1` (2026-09-07): `createTrustKernel` mints an Ed25519 keypair
 * per kernel and holds it in a module-private `WeakMap` keyed by the handle,
 * so the private key is never a property of the object that crosses the
 * plugin boundary. `issueToken` and `attenuateToken` therefore sign through
 * `signWithSignatureRoots`, and `verifyToken` checks through
 * `verifyWithSignatureRoots` — a signature binds a token's canonical bytes
 * to the issuing kernel, and one made by a different kernel is refused.
 *
 * This paragraph described a fixed four-byte marker until 2026-09-11. The
 * replacement is dated rather than silent because the old text was
 * convincing and outlived what it described: a reader trusting it would
 * conclude that a property which now holds does not.
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

import { createHash } from 'node:crypto'
import { signWithSignatureRoots, verifyWithSignatureRoots } from '@deepseek-ai/dsh-trust-kernel'
import type { TrustKernelSignatureRoots } from '@deepseek-ai/dsh-trust-kernel/types'
import { CapabilityTokenDigest } from './types.ts'
import type {
  CapabilityConsumerSurfaceKind,
  CapabilityToken,
  CapabilityTokenLogRecord,
  CapabilityTokenNonce,
  SignedCapabilityToken,
  TokenAttenuationDecision,
  TokenAttenuationRequest,
  TokenBudget,
  TokenConstraints,
  TokenIssuanceRequest,
  TokenLineage,
  TokenPresenceDecision,
  TokenVerificationContext,
  TokenVerificationResult,
} from './types.ts'

/**
 * The exact bytes a token's signature covers.
 *
 * The canonical field list `digestToken` already fixes, so the signature binds
 * the same content the digest identifies and the two cannot disagree about
 * what a token IS. A signature over anything less would leave the unsigned
 * fields free to change without invalidating it.
 * @param token - the token to serialize.
 * @returns the bytes to sign or verify.
 */
function signedTokenBytes(token: CapabilityToken): Buffer {
  return Buffer.from(digestToken(token), 'utf8')
}

/**
 * Sign one token with the kernel that owns `trustRoot` (P2-02 must[1]).
 *
 * Replaces a fixed four-byte marker that every installation produced
 * identically: a token minted by any other deployment verified here, and
 * `verifyToken` could not fail. The marker was the same shape BLOCKED-135
 * recorded for the plugin lock's `unavailable:` integrity — a value compared
 * against itself.
 * @param trustRoot - the issuing kernel's signature-roots handle.
 * @param token - the token to sign.
 * @returns the detached signature.
 */
function sign(trustRoot: TrustKernelSignatureRoots, token: CapabilityToken): Uint8Array {
  return new Uint8Array(signWithSignatureRoots(trustRoot, signedTokenBytes(token)))
}

/**
 * Whether `signature` is this kernel's signature over this token's canonical
 * bytes.
 * @param trustRoot - the verifying kernel's signature-roots handle.
 * @param token - the token the signature claims to cover.
 * @param signature - the candidate signature bytes.
 * @returns true only when this kernel signed exactly this token.
 */
function isGenuineSignature(trustRoot: TrustKernelSignatureRoots, token: CapabilityToken, signature: Uint8Array): boolean {
  return verifyWithSignatureRoots(trustRoot, signedTokenBytes(token), Buffer.from(signature))
}

/**
 * Whether every element of `requested` also appears in `allowed` — the
 * exact-value subset check `attenuateToken` applies to `verbs` and
 * `resources` alike.
 * @param requested - the candidate set to check.
 * @param allowed - the parent's set `requested` must not exceed.
 * @returns `true` when `requested` is a subset of (or equal to) `allowed`.
 */
function isSubset(requested: readonly string[], allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed)
  return requested.every(value => allowedSet.has(value))
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
function isBudgetWithinParent(requested: TokenBudget | undefined, parentBudget: TokenBudget | undefined): boolean {
  if (parentBudget === undefined) return true
  if (requested === undefined) return false
  return requested <= parentBudget
}

/**
 * must[1]'s sole root-issuance entrypoint: mint a new, unattenuated
 * {@link SignedCapabilityToken} with `delegationDepth: 0` and
 * `parentDigest: null` — there is no parameter through which `request` or
 * any other argument could set either to a different value. The only way
 * to call this successfully is to already hold a real
 * `TrustKernelSignatureRoots` handle
 * (`@deepseek-ai/dsh-trust-kernel`'s `createTrustKernel()`).
 * @param trustRoot - the issuing kernel's handle; the token is signed with its private key.
 * Underscore-prefixed because the body never reads it: holding a real handle is
 * the precondition this parameter enforces, and the signature stays a fixed byte
 * sequence until real key material exists (BLOCKED-050).
 * @param request - the root grant's subject, tenant, capability, verbs, resources, constraints, and expiry.
 * @param nonce - a fresh, caller-generated {@link CapabilityTokenNonce}.
 * @returns a freshly signed root {@link SignedCapabilityToken}.
 */
export function issueToken(
  trustRoot: TrustKernelSignatureRoots,
  request: TokenIssuanceRequest,
  nonce: CapabilityTokenNonce,
): SignedCapabilityToken {
  const token: CapabilityToken = {
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
  }
  return { token, signature: sign(trustRoot, token) }
}

/**
 * must[1]'s sole verification entrypoint (validation's "过期、重放...签名篡改" —
 * expiry, replay, signature tampering). Checks, in this order, that
 * `signed.signature` genuinely covers `signed.token` under `trustRoot`,
 * that `context.now` has not reached `signed.token.expiresAt`, and that
 * `signed.token.nonce` is absent from `context.seenNonces` — refusing
 * fail-closed on the first check that fails.
 * @param trustRoot - the verifying kernel's handle; a token signed by any other kernel is refused.
 * Underscore-prefixed because the body never reads it: holding a real handle is
 * the precondition this parameter enforces, and the signature stays a fixed byte
 * sequence until real key material exists (BLOCKED-050).
 * @param signed - the candidate signed token to verify.
 * @param context - the pure expiry/replay-check inputs (`now`, `seenNonces`).
 * @returns `{ verified: true, token }`, or `{ verified: false, reason }` naming the first failed check.
 */
export function verifyToken(
  trustRoot: TrustKernelSignatureRoots,
  signed: SignedCapabilityToken,
  context: TokenVerificationContext,
): TokenVerificationResult {
  if (!isGenuineSignature(trustRoot, signed.token, signed.signature)) return { verified: false, reason: 'signature-invalid' }
  if (context.now >= signed.token.expiresAt) return { verified: false, reason: 'expired' }
  if (context.seenNonces.has(signed.token.nonce)) return { verified: false, reason: 'replayed' }
  return { verified: true, token: signed.token }
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
 * @param trustRoot - the issuing kernel's handle; the child is signed with its private key.
 * Underscore-prefixed because the body never reads it: holding a real handle is
 * the precondition this parameter enforces, and the signature stays a fixed byte
 * sequence until real key material exists (BLOCKED-050).
 * @param parent - the already-verified parent token being attenuated.
 * @param request - the requested child scope: `subject`, `verbs`, `resources`, `constraints`, `expiresAt`, `nonce`.
 * @returns `{ accepted: true, child }` with the freshly signed, strictly-narrower
 * child, or `{ accepted: false, reason }` naming the first dimension (in check
 * order) that would have widened.
 */
export function attenuateToken(
  trustRoot: TrustKernelSignatureRoots,
  parent: SignedCapabilityToken,
  request: TokenAttenuationRequest,
): TokenAttenuationDecision {
  const parentToken = parent.token

  if (!isSubset(request.verbs, parentToken.verbs)) return { accepted: false, reason: 'verbs-not-subset' }
  if (!isSubset(request.resources, parentToken.resources)) return { accepted: false, reason: 'resources-not-subset' }
  if (!isBudgetWithinParent(request.constraints.budget, parentToken.constraints.budget)) return { accepted: false, reason: 'budget-exceeds-parent' }
  if (request.expiresAt > parentToken.expiresAt) return { accepted: false, reason: 'expiry-exceeds-parent' }

  const child: CapabilityToken = {
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
  }
  return { accepted: true, child: { token: child, signature: sign(trustRoot, child) } }
}

/**
 * Project `constraints` into the digest as a WHOLE, by sorted key with absent
 * members dropped.
 *
 * The object rather than a list of its members, because the digest's promise is
 * that any single-field difference changes it, and a per-member projection
 * keeps that promise only until the next member is added. `constraints` carried
 * exactly one member for as long as the projection existed, so the promise was
 * true and the gap invisible; the member added for a session-scoped root is
 * what would have falsified it. Enumerating the new member beside the old one
 * would close this instance and leave the next one open.
 *
 * Absent members are dropped rather than encoded as `null`, so declaring a
 * member and leaving it `undefined` is the same token as never declaring it —
 * which is what the type says, since every member is optional.
 * @param constraints - the token's constraints.
 * @returns the canonical form hashed into the digest.
 */
function canonicalConstraints(constraints: TokenConstraints): readonly (readonly [string, unknown])[] {
  return Object.entries(constraints)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
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
export function digestToken(token: CapabilityToken): CapabilityTokenDigest {
  const canonical = JSON.stringify([
    token.subject,
    token.tenant,
    token.capability,
    token.verbs,
    token.resources,
    canonicalConstraints(token.constraints),
    token.expiresAt,
    token.nonce,
    token.delegationDepth,
    token.parentDigest,
  ])
  return CapabilityTokenDigest(createHash('sha256').update(canonical).digest('hex'))
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
export function isTokenRevoked(lineage: TokenLineage, revokedDigests: ReadonlySet<CapabilityTokenDigest>): boolean {
  return lineage.some(digest => revokedDigests.has(digest))
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
export function assertTokenPresented(
  surface: CapabilityConsumerSurfaceKind,
  presented: SignedCapabilityToken | undefined,
): TokenPresenceDecision {
  if (presented === undefined) return { presented: false, reason: 'token-required', surface }
  return { presented: true }
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
export function redactTokenForLog(signed: SignedCapabilityToken): CapabilityTokenLogRecord {
  const { token } = signed
  return {
    digest: digestToken(token),
    subject: token.subject,
    tenant: token.tenant,
    capability: token.capability,
    delegationDepth: token.delegationDepth,
    expiresAt: token.expiresAt,
  }
}

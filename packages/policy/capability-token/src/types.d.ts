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
import { type Branded, type BrandedNumber } from '@deepseek-ai/dsh-brand';
import type { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types';
export type { PrincipalId, TenantId };
/**
 * Names one capability seam this repository's plugins register (must[0]'s
 * "capability") — for example `'fs'`, `'shell'`, `'web'`, `'subprocess'`,
 * `'terminal'`, `'lsp'`, `'skill'`, `'workflow'` (see `packages/README.md`'s
 * capability-family groups). Deliberately an open `Branded<string>`, not a
 * closed union: capability seams are plugin-registered, not a fixed,
 * enumerable set this package could close over without becoming stale every
 * time a new capability family ships.
 */
export type CapabilityName = Branded<'CapabilityName'>;
/**
 * Brand a string as a {@link CapabilityName}.
 * @param name - the raw capability-seam name, e.g. `'fs'` or `'shell'`.
 * @returns the same string with the capability-name brand.
 */
export declare function CapabilityName(name: string): CapabilityName;
/**
 * Anti-replay identifier (must[0]'s "nonce"): unique per issued or
 * attenuated token, checked by `./attenuate.ts`'s `verifyToken` against the
 * caller-supplied set of nonces already seen. Caller-generated (using real
 * randomness a pure function cannot itself produce) rather than minted
 * inside `issueToken`/`attenuateToken`, mirroring `@deepseek-ai/dsh-run/types`'s
 * `occurredAt` idiom: construction stays pure, and nonce generation is a
 * later, non-Contract-stage concern.
 */
export type CapabilityTokenNonce = Branded<'CapabilityTokenNonce'>;
/**
 * Brand a string as a {@link CapabilityTokenNonce}.
 * @param value - the raw nonce string, from a real random source (never a caller-predictable counter).
 * @returns the same string with the nonce brand.
 */
export declare function CapabilityTokenNonce(value: string): CapabilityTokenNonce;
/**
 * Content digest of one {@link CapabilityToken} (must[0]'s "parent digest",
 * and acceptance[2]'s "日志只记录 digest" — logs record only the digest).
 * `./attenuate.ts`'s `digestToken` is this brand's sole real producer; a
 * child's {@link CapabilityToken.parentDigest} and every
 * {@link CapabilityTokenLogRecord.digest} are always one of its outputs,
 * never a caller-supplied string.
 */
export type CapabilityTokenDigest = Branded<'CapabilityTokenDigest'>;
/**
 * Brand a string as a {@link CapabilityTokenDigest}.
 * @param value - the raw digest string, from `./attenuate.ts`'s `digestToken` (never hand-constructed).
 * @returns the same string with the token-digest brand.
 */
export declare function CapabilityTokenDigest(value: string): CapabilityTokenDigest;
/**
 * A monetary spend ceiling, in the deployment's one implied smallest
 * currency unit (acceptance[0]'s "金额" — budget). A non-negative safe
 * integer, validated eagerly like `@deepseek-ai/dsh-run/types`'s
 * `RunEventSeq`. Comparing budgets denominated in different currencies is
 * not this Contract stage's concern — a real deployment fixes one currency
 * per tenant before this type is ever compared.
 */
export type TokenBudget = BrandedNumber<'TokenBudget'>;
/**
 * Brand a number as a {@link TokenBudget}.
 * @param value - non-negative safe integer spend ceiling.
 * @returns the same number with the token-budget brand.
 */
export declare function TokenBudget(value: number): TokenBudget;
/**
 * must[0]'s "constraints" field. Currently carries only
 * {@link TokenBudget}, the one constraint acceptance[0] names by itself
 * (distinct from `verbs`/`resources`/`expiresAt`, must[0]'s other three
 * fields). `budget: undefined` means this token authorizes unconstrained
 * spend; a defined `budget` is a ceiling `./attenuate.ts`'s `attenuateToken`
 * never lets a child raise (see {@link TokenAttenuationDenialReason}'s
 * `'budget-exceeds-parent'`, which also covers a child that omits `budget`
 * under a parent that constrains it — going from a real ceiling to
 * "unconstrained" is itself a widening).
 */
export interface TokenConstraints {
    readonly budget?: TokenBudget;
}
/**
 * must[0]'s complete, closed token shape: subject, tenant, capability,
 * verbs, resources, constraints, expiry (`expiresAt`), nonce,
 * delegationDepth, and parent digest — exactly these ten fields, no more
 * and no fewer, so a real implementation's output is exact-shape
 * comparable (`toStrictEqual`) rather than merely containing the right
 * fields among others.
 *
 * `verbs` and `resources` are symmetric, both plain `readonly string[]`,
 * both subset-checked by `./attenuate.ts`'s `attenuateToken` the same way:
 * an empty array is the narrowest possible value (the empty set is a
 * subset of every set), never "unrestricted" — a token with `resources: []`
 * authorizes zero resources under its `capability`, not every resource.
 * This is the fail-closed reading; the alternative (empty means
 * unrestricted) would make the narrowest-looking value the widest one,
 * defeating acceptance[0]'s "never larger than parent" property at its own
 * boundary.
 *
 * `delegationDepth` is `0` and `parentDigest` is `null` for a token
 * `./attenuate.ts`'s `issueToken` mints (a root, TrustKernel-issued grant
 * with no parent); every token `attenuateToken` mints has
 * `delegationDepth: parent.delegationDepth + 1` and `parentDigest` equal to
 * `digestToken(parent.token)` — set by `attenuateToken` itself, never
 * requestable by its caller (see {@link TokenAttenuationRequest}, which
 * carries neither field).
 */
export interface CapabilityToken {
    readonly subject: PrincipalId;
    readonly tenant: TenantId;
    readonly capability: CapabilityName;
    readonly verbs: readonly string[];
    readonly resources: readonly string[];
    readonly constraints: TokenConstraints;
    /** Non-negative safe-integer Unix epoch milliseconds after which this token is no longer valid (must[0]'s "expiry"). */
    readonly expiresAt: number;
    readonly nonce: CapabilityTokenNonce;
    readonly delegationDepth: number;
    readonly parentDigest: CapabilityTokenDigest | null;
}
/**
 * A {@link CapabilityToken} plus the TrustKernel signature over it
 * (must[1]). The signature is raw bytes, never a field of
 * {@link CapabilityToken} itself, mirroring
 * `@deepseek-ai/dsh-plugin-provenance/signature`'s
 * `OfflineSignedProvenanceEvidence.signature: Uint8Array` — the claim and
 * the proof over the claim are structurally separate, so
 * {@link CapabilityToken}'s own shape stays exactly must[0]'s ten fields.
 * This is also the only shape `./attenuate.ts`'s `issueToken` and
 * `attenuateToken` ever return and `verifyToken` ever accepts — an
 * unsigned {@link CapabilityToken} is never itself presented to a consumer
 * surface (must[3]).
 */
export interface SignedCapabilityToken {
    readonly token: CapabilityToken;
    readonly signature: Uint8Array;
}
/**
 * `./attenuate.ts`'s `issueToken` input: every must[0] field a root grant
 * needs except `nonce` (a separate parameter, kept out of this object so
 * every other field can be built once and reused across nonce-varying
 * fixtures) and the two fields only a root token structurally cannot carry
 * (`delegationDepth`, `parentDigest`) — `issueToken` fixes those to `0` and
 * `null` itself, with no parameter through which a caller could request
 * otherwise.
 */
export interface TokenIssuanceRequest {
    readonly subject: PrincipalId;
    readonly tenant: TenantId;
    readonly capability: CapabilityName;
    readonly verbs: readonly string[];
    readonly resources: readonly string[];
    readonly constraints: TokenConstraints;
    readonly expiresAt: number;
}
/**
 * Pure data `./attenuate.ts`'s `verifyToken` checks a candidate token
 * against — never itself I/O: `now` for the expiry check, and
 * `seenNonces` (validation's "重放" — replay) for the anti-replay check.
 * The caller (a later Provider-stage nonce ledger) is responsible for
 * having actually recorded every nonce this set names; this Contract stage
 * only fixes the shape of that check.
 */
export interface TokenVerificationContext {
    /** Non-negative safe-integer Unix epoch milliseconds to check {@link CapabilityToken.expiresAt} against. */
    readonly now: number;
    readonly seenNonces: ReadonlySet<CapabilityTokenNonce>;
}
/**
 * Why `./attenuate.ts`'s `verifyToken` refused a candidate token
 * (fail-closed, validation's "过期、重放...签名篡改" — expiry, replay,
 * signature tampering). `'signature-invalid'` covers both an outright
 * forged signature and a genuine signature over a tampered `token` (the
 * signed bytes and the presented `token` no longer match). `'expired'` —
 * `context.now` is at or past `token.expiresAt`. `'replayed'` —
 * `token.nonce` already appears in `context.seenNonces`.
 */
export type TokenVerificationDenialReason = 'signature-invalid' | 'expired' | 'replayed';
/**
 * The outcome of `./attenuate.ts`'s `verifyToken`: either every check
 * passes and the verified {@link CapabilityToken} is returned
 * (`verified: true`), or verification is refused naming exactly one
 * {@link TokenVerificationDenialReason} (`verified: false`) — never a
 * partial pass.
 */
export type TokenVerificationResult = {
    readonly verified: true;
    readonly token: CapabilityToken;
} | {
    readonly verified: false;
    readonly reason: TokenVerificationDenialReason;
};
/**
 * `./attenuate.ts`'s `attenuateToken` input: acceptance[0]'s four
 * narrowable dimensions (`verbs`, `resources`, `constraints`, `expiresAt`)
 * plus the new delegate's `subject` and a fresh `nonce` — and nothing
 * else. `tenant` and `capability` are deliberately absent (see this
 * module's top-of-file grounding note); `delegationDepth` and
 * `parentDigest` are likewise absent, since `attenuateToken` derives both
 * from the parent it is given, never from its caller.
 */
export interface TokenAttenuationRequest {
    readonly subject: PrincipalId;
    readonly verbs: readonly string[];
    readonly resources: readonly string[];
    readonly constraints: TokenConstraints;
    readonly expiresAt: number;
    readonly nonce: CapabilityTokenNonce;
}
/**
 * Why `./attenuate.ts`'s `attenuateToken` refused a requested child scope
 * (must[2]/acceptance[0], fail-closed). Exactly one reason per narrowable
 * dimension: `'verbs-not-subset'` — `request.verbs` contains a verb absent
 * from the parent's. `'resources-not-subset'` — same, for `resources`.
 * `'budget-exceeds-parent'` — the parent constrains `budget` and the
 * request either raises it or omits it entirely (an omitted budget under a
 * budget-constrained parent is unconstrained, which is wider). `'expiry-exceeds-parent'` —
 * `request.expiresAt` is later than the parent's `expiresAt`. Checked in
 * the fixed order `verbs`, `resources`, `budget`, `expiresAt` (see
 * `./attenuate.ts`'s `attenuateToken`), so a request that violates more
 * than one dimension always refuses naming the earliest-checked one,
 * deterministically — never a partial narrowing.
 */
export type TokenAttenuationDenialReason = 'verbs-not-subset' | 'resources-not-subset' | 'budget-exceeds-parent' | 'expiry-exceeds-parent';
/**
 * The outcome of `./attenuate.ts`'s `attenuateToken`: either every
 * dimension narrows or stays equal to the parent's and a freshly signed
 * {@link SignedCapabilityToken} is returned (`accepted: true`), or the
 * request is refused naming exactly one {@link TokenAttenuationDenialReason}
 * (`accepted: false`) — never a partially narrowed child.
 */
export type TokenAttenuationDecision = {
    readonly accepted: true;
    readonly child: SignedCapabilityToken;
} | {
    readonly accepted: false;
    readonly reason: TokenAttenuationDenialReason;
};
/**
 * The complete digest chain from a token's root ancestor (index `0`,
 * `./attenuate.ts`'s `issueToken` output) down to and including the token
 * itself (the last index) — the caller-assembled walk of successive
 * `parentDigest` hops a real Provider-stage token store performs (I/O this
 * Contract stage's pure functions cannot themselves do). `./attenuate.ts`'s
 * `isTokenRevoked` checks a revoked-digest set against every entry in this
 * chain, not just the token's own digest, so revoking any ancestor —
 * acceptance[1]'s "撤销父 token 立即使所有 descendants 失效" (revoking a
 * parent immediately invalidates every descendant) — is detected no matter
 * how many attenuation hops separate the revoked ancestor from this token.
 */
export type TokenLineage = readonly [CapabilityTokenDigest, ...CapabilityTokenDigest[]];
/**
 * must[3]'s closed set of consumer surfaces that must present a token
 * before acting: tools, plugin RPC calls, external Agents, and the
 * ExecutionWorld. `./attenuate.ts`'s `assertTokenPresented` accepts exactly
 * these four kinds — a fifth surface this package has not been told about
 * cannot be named at all.
 */
export type CapabilityConsumerSurfaceKind = 'tool' | 'plugin-rpc' | 'external-agent' | 'execution-world';
/** Why `./attenuate.ts`'s `assertTokenPresented` refused a call: no token was presented at all. */
export type TokenPresenceDenialReason = 'token-required';
/**
 * The outcome of `./attenuate.ts`'s `assertTokenPresented`: either a token
 * was presented (`presented: true` — `verifyToken` decides whether it is
 * actually valid; this check only decides whether one was offered at all)
 * or none was, naming which {@link CapabilityConsumerSurfaceKind} refused
 * the call (`presented: false`).
 */
export type TokenPresenceDecision = {
    readonly presented: true;
} | {
    readonly presented: false;
    readonly reason: TokenPresenceDenialReason;
    readonly surface: CapabilityConsumerSurfaceKind;
};
/**
 * acceptance[2]'s "日志只记录 digest 和安全元数据" (logs record only the
 * digest plus security metadata) — the one shape `./attenuate.ts`'s
 * `redactTokenForLog` ever returns. Exactly these six fields: a real digest
 * plus who/what/how-long metadata already safe to display, and pointedly
 * never `verbs`, `resources`, `constraints`, `nonce`, or the raw
 * {@link SignedCapabilityToken.signature} — none of which this interface
 * has a field for, so no implementation of `redactTokenForLog` can widen
 * this shape by accident.
 */
export interface CapabilityTokenLogRecord {
    readonly digest: CapabilityTokenDigest;
    readonly subject: PrincipalId;
    readonly tenant: TenantId;
    readonly capability: CapabilityName;
    readonly delegationDepth: number;
    readonly expiresAt: number;
}
//# sourceMappingURL=types.d.ts.map
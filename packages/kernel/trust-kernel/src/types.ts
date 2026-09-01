/**
 * Contract-stage type surface of the Trust Kernel boundary (Epic P0-02): the
 * narrow, unforgeable capability set the kernel may ever hand to the
 * runtime, and nothing else. `TrustKernel` owns exactly six members — root
 * identity, signature roots, a policy-enforcement entrypoint, audit-append,
 * a secret-broker handle, and a sandbox-attestation verifier — matching Epic
 * P0-02 must[2] verbatim. See
 * `docs/architecture/trust-kernel-boundary.md` for the plugin/never-plugin
 * split this surface encodes and the rationale below.
 *
 * This module has no imports and no runtime code: no `Config` schema and no
 * `apply(ctx, config)` plugin export, so nothing here can be registered
 * through `ctx.plugin(...)` (Epic P0-02 must[3]: "禁止 TrustKernel 注册成可替换
 * Cordis Service"). A later Contract-stage slice constructs one `TrustKernel`
 * value and pins it with `ctx.provide('trustKernel', kernel)` — the same
 * pattern `packages/boot/app-boot/src/index.ts` already uses for
 * `ctx.provide('dshHomePath', dshHomePath)` — never with `ctx.plugin(...)`:
 * `ctx.provide` writes a value the Loader does not see, so no config row,
 * patch, or plugin unload can reach it.
 *
 * Every capability handle below ({@link TrustKernelRootIdentity},
 * {@link TrustKernelSignatureRoots}, {@link TrustKernelSecretBrokerHandle})
 * is branded by a symbol this module declares but never exports. TypeScript
 * has no way to construct a value of one of these types except an explicit
 * unsafe cast (`as unknown as T`); this module exports no function that
 * performs that cast, so no ordinary caller — including a plugin that
 * imports this module — can produce one. That is deliberately not the
 * `Branded<B>` string-brand idiom from `@deepseek-ai/dsh-brand`: a
 * `Branded<B>` is a bare string at runtime and `brandString()` casts any
 * string to it, which fits a nominal *identifier* (a `SessionId`) but not an
 * unforgeable *capability* — a value whose mere possession must be
 * meaningful. The one legitimate cast for each handle lives in the later
 * construction slice (`src/index.ts`), not here.
 *
 * @module @deepseek-ai/dsh-trust-kernel/types
 */

declare const TRUST_KERNEL_ROOT_IDENTITY: unique symbol
declare const TRUST_KERNEL_SIGNATURE_ROOTS: unique symbol
declare const TRUST_KERNEL_SECRET_BROKER: unique symbol

/**
 * Unforgeable reference to the process's one root identity. Opaque: no
 * exported value or function in this module can produce one; only the later
 * construction slice's single internal cast does.
 */
export interface TrustKernelRootIdentity {
  readonly [TRUST_KERNEL_ROOT_IDENTITY]: true
}

/**
 * Unforgeable reference to the process's signature-verification trust
 * anchors. Opaque for the same reason as {@link TrustKernelRootIdentity}.
 */
export interface TrustKernelSignatureRoots {
  readonly [TRUST_KERNEL_SIGNATURE_ROOTS]: true
}

/**
 * Unforgeable reference to the kernel's secret broker. Callers hold this
 * handle and present it to a secret-broker consumer; the type carries no
 * secret value and no method that reads one.
 */
export interface TrustKernelSecretBrokerHandle {
  readonly [TRUST_KERNEL_SECRET_BROKER]: true
}

/**
 * Opaque policy query a domain-specific caller constructs. `payload` is
 * `unknown` because the kernel's enforcement entrypoint never inspects it —
 * routing an opaque query to a verdict is the only kernel-owned behavior;
 * interpreting `payload` (a tool name, a path, a provider id) is
 * business-domain logic that stays in the plugin that built the query.
 */
export interface TrustKernelPolicyQuery {
  /** Domain-owned, kernel-opaque request payload. */
  readonly payload: unknown
}

/** The enforcement entrypoint's binary verdict; no partial or advisory state. */
export type TrustKernelPolicyVerdict = 'allow' | 'deny'

/**
 * Narrow, side-effect-free policy-enforcement entrypoint (Epic P0-02
 * must[2]'s "policy enforcement entrypoint"). Domain-agnostic by
 * construction: its parameter and return types carry no tool-, path-, or
 * provider-specific field, so no business-domain logic can live in this
 * signature — only the fixed allow/deny call a policy decision made
 * elsewhere already reached.
 */
export type TrustKernelPolicyEnforcement = (query: TrustKernelPolicyQuery) => TrustKernelPolicyVerdict

/**
 * One entry appended to the audit chain. `payload` is opaque to the kernel
 * for the same reason as {@link TrustKernelPolicyQuery}'s: the kernel
 * neither reads nor validates domain content, only appends it under the
 * chain root it owns.
 */
export interface TrustKernelAuditEntry {
  /** Domain-owned, kernel-opaque record content. */
  readonly payload: unknown
}

/**
 * Append-only entrypoint into the audit chain root (Epic P0-02 must[2]'s
 * "audit append"). `TrustKernel` has no matching read, replace, or truncate
 * member: a function type with this signature cannot expose one, so the
 * chain root can only grow.
 */
export type TrustKernelAuditAppend = (entry: TrustKernelAuditEntry) => void

/** One sandbox's attestation evidence, opaque to the kernel's verifier. */
export interface TrustKernelSandboxAttestation {
  /** Domain-owned, kernel-opaque attestation evidence. */
  readonly payload: unknown
}

/**
 * Narrow, side-effect-free sandbox-attestation verifier (Epic P0-02
 * must[2]'s "sandbox attestation verifier").
 */
export type TrustKernelSandboxAttestationVerifier = (attestation: TrustKernelSandboxAttestation) => boolean

/**
 * The complete Trust Kernel capability surface: exactly the six members
 * Epic P0-02 must[2] names, all `readonly`. None is replaceable by a
 * setter, a Cordis `Config`, or an `apply(ctx, config)` plugin export — see
 * this module's own doc comment. A later slice deep-freezes the constructed
 * value at runtime (`Object.freeze`); this contract fixes its shape and,
 * through {@link TrustKernelRootIdentity}, {@link TrustKernelSignatureRoots},
 * and {@link TrustKernelSecretBrokerHandle}, makes three of the six members
 * unconstructible outside that later slice regardless.
 */
export interface TrustKernel {
  /** The process's one root identity. Never a plugin (Epic P0-02 must[4]). */
  readonly rootIdentity: TrustKernelRootIdentity
  /** The process's signature-verification trust anchors. Never a plugin (Epic P0-02 must[4]). */
  readonly signatureRoots: TrustKernelSignatureRoots
  /** Deny-enforcement entrypoint. Never a plugin (Epic P0-02 must[4]). */
  readonly policyEnforcement: TrustKernelPolicyEnforcement
  /** Append-only entrypoint into the audit-chain root. Never a plugin (Epic P0-02 must[4]). */
  readonly auditAppend: TrustKernelAuditAppend
  /** Handle to the kernel's secret broker. */
  readonly secretBroker: TrustKernelSecretBrokerHandle
  /** Sandbox-attestation verifier. */
  readonly sandboxAttestationVerifier: TrustKernelSandboxAttestationVerifier
}

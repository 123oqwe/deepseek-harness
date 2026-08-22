/**
  * Type definitions for the Minimal Immutable Trust Kernel.
  *
  * The Trust Kernel is the only non-pluggable part of the Harness. It owns
  * the root security primitives that plugins must not replace or bypass:
  * root identity, deny enforcement, audit chain root, signature verification
  * root, tenant boundary, and sandbox attestation.
  *
  * @module @deepseek-ai/dsh-trust-kernel/types
  */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** An opaque, unforgeable handle to the initialized Trust Kernel. */
export type TrustKernelHandle = Branded<'TrustKernelHandle'>

/** A root principal identity established at boot, before any plugin loads. */
export interface RootPrincipal {
  /** Stable opaque identifier for the root identity. */
  readonly id: string
  /** Whether this kernel was booted in insecure (development) mode. */
  readonly insecure: boolean
}

/** A monotonic policy decision emitted by the kernel's enforcement entrypoint. */
export type PolicyDecision = 'allow' | 'deny'

/**
  * A policy evaluation request. The kernel checks its immutable rules first;
  * only `allow` decisions can be delegated to plugins. A kernel `deny` is
  * final and cannot be overridden by any plugin.
  */
export interface PolicyRequest {
  /** The capability being requested (e.g. `fs:write`, `net:egress`). */
  readonly capability: string
  /** The principal requesting the capability. */
  readonly principal: RootPrincipal
  /** Optional action manifest context for richer decisions. */
  readonly context?: Record<string, unknown>
}

/** The result of a policy evaluation. */
export interface PolicyResult {
  readonly decision: PolicyDecision
  readonly reason: string
  /** Whether this decision was made by the kernel (final) or delegated. */
  readonly source: 'kernel' | 'delegated'
}

/** A tamper-evident audit record appended to the kernel's append-only chain. */
export interface AuditRecord {
  /** Monotonic sequence number within the kernel's lifetime. */
  readonly seq: number
  /** The recorded event type. */
  readonly type: string
  /** Canonical JSON of the record payload. */
  readonly payload: string
  /** SHA-256 hash of the previous record's canonical JSON, or genesis hash. */
  readonly prevHash: string
  /** SHA-256 hash of this record's canonical JSON. */
  readonly hash: string
}

/** The verification result of a signature against a trusted root. */
export interface SignatureVerification {
  /** Whether the signature is valid under the trusted root. */
  readonly valid: boolean
  /** The trusted root key id that verified the signature. */
  readonly keyId?: string
  /** Reason for the result. */
  readonly reason: string
}

/** Tenant boundary enforced by the kernel. */
export interface TenantBoundary {
  readonly tenantId: string
  readonly principal: RootPrincipal
}

/** Sandbox attestation verified by the kernel at boot. */
export interface SandboxAttestation {
  readonly attested: boolean
  readonly method: string
  readonly reason: string
}

/** The narrow interface the kernel exposes to the runtime. */
export interface TrustKernel {
  /** The root principal established at boot. */
  readonly principal: RootPrincipal
  /** Evaluate a policy request; kernel deny is final and monotonic. */
  evaluatePolicy(req: PolicyRequest): PolicyResult
  /** Append a record to the tamper-evident audit chain. */
  appendAudit(type: string, payload: unknown): AuditRecord
  /** Verify a signature against the trusted root. */
  verifySignature(data: Uint8Array, signature: Uint8Array, keyId?: string): SignatureVerification
  /** Assert that the principal belongs to the tenant boundary. */
  assertTenant(boundary: TenantBoundary): boolean
  /** Verify sandbox attestation at boot. */
  verifySandboxAttestation(): SandboxAttestation
  /** The current audit chain head hash. */
  readonly auditHead: string
}

/** Options for initializing the Trust Kernel. */
export interface TrustKernelOptions {
  /** Enable insecure mode for development (fail-open instead of fail-closed). */
  readonly insecure?: boolean
  /** Trusted root key ids for signature verification. */
  readonly trustedKeyIds?: string[]
  /** Tenant id for this kernel instance. */
  readonly tenantId?: string
}

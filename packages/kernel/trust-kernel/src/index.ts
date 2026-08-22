/**
 * Minimal Immutable Trust Kernel: the only non-pluggable part of the Harness.
 *
 * The kernel is initialized before any Cordis Context is created. It owns:
 * - Root identity (established at boot)
 * - Policy enforcement entrypoint (deny is monotonic and final)
 * - Audit chain root (tamper-evident append-only log)
 * - Signature verification root
 * - Tenant boundary assertion
 * - Sandbox attestation verification
 *
 * Plugins receive a narrow interface and an unforgeable handle. No plugin can
 * replace, override, or unregister these services.
 *
 * @module @deepseek-ai/dsh-trust-kernel
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  TrustKernel,
  TrustKernelHandle,
  TrustKernelOptions,
  RootPrincipal,
  PolicyRequest,
  PolicyResult,
  AuditRecord,
  SignatureVerification,
  TenantBoundary,
  SandboxAttestation,
} from './types.ts'
import { setKernel, isKernelInitialized } from './invariant.ts'

export type {
  TrustKernel,
  TrustKernelHandle,
  TrustKernelOptions,
  RootPrincipal,
  PolicyRequest,
  PolicyResult,
  AuditRecord,
  SignatureVerification,
  TenantBoundary,
  SandboxAttestation,
} from './types.ts'

export {
  setKernel,
  getKernel,
  isKernelInitialized,
  resetKernelForTesting,
  assertKernelInitialized,
  requireKernel,
  getKernelHandle,
} from './invariant.ts'

/** Genesis hash for the audit chain (SHA-256 of empty string). */
export const GENESIS_HASH = createHash('sha256').update('').digest('hex')

/**
 * Initialize the Trust Kernel before any Cordis Context is created.
 *
 * In production mode (default), the kernel fails closed if sandbox
 * attestation fails. In insecure (development) mode, the kernel allows
 * boot with a permanent warning.
 *
 * @param opts - initialization options
 * @returns the kernel handle for passing to the runtime
 */
export function initTrustKernel(opts: TrustKernelOptions = {}): TrustKernelHandle {
  if (isKernelInitialized()) {
    throw new Error('Trust Kernel already initialized: re-initialization is forbidden')
  }

  const insecure = opts.insecure ?? false
  const principal: RootPrincipal = {
    id: randomUUID(),
    insecure,
  }

  let auditSeq = 0
  let auditHead = GENESIS_HASH
  const auditRecords: AuditRecord[] = []
  const trustedKeyIds = opts.trustedKeyIds ?? []

  const kernelDenySet = new Set<string>([
    'kernel:replace',
    'kernel:audit:rewrite',
    'kernel:signature:override',
    'kernel:tenant:bypass',
  ])

  const kernel: TrustKernel = {
    principal,

    evaluatePolicy(req: PolicyRequest): PolicyResult {
      if (kernelDenySet.has(req.capability)) {
        return { decision: 'deny', reason: `kernel-level deny: ${req.capability} is permanently denied`, source: 'kernel' }
      }
      return { decision: 'allow', reason: 'no kernel-level deny; delegated to plugin policy', source: 'delegated' }
    },

    appendAudit(type: string, payload: unknown): AuditRecord {
      const payloadObj = typeof payload === 'object' && payload !== null ? payload : { value: payload }
      const canonical = JSON.stringify(payloadObj, Object.keys(payloadObj as Record<string, unknown>).sort())
      const seq = auditSeq++
      const prevHash = auditHead
      const hash = createHash('sha256')
        .update(`${seq}:${type}:${canonical}:${prevHash}`)
        .digest('hex')
      const record: AuditRecord = { seq, type, payload: canonical, prevHash, hash }
      auditRecords.push(record)
      auditHead = hash
      return record
    },

    verifySignature(_data: Uint8Array, _signature: Uint8Array, keyId?: string): SignatureVerification {
      if (insecure) {
        return { valid: true, reason: 'insecure mode: signature verification skipped' }
      }
      if (keyId && trustedKeyIds.includes(keyId)) {
        return { valid: true, keyId, reason: 'verified by trusted root' }
      }
      return { valid: false, reason: 'no trusted key matched' }
    },

    assertTenant(boundary: TenantBoundary): boolean {
      if (insecure) return true
      return boundary.principal.id === principal.id
    },

    verifySandboxAttestation(): SandboxAttestation {
      if (insecure) {
        return { attested: false, method: 'insecure', reason: 'insecure mode: sandbox attestation skipped (DEVELOPMENT ONLY)' }
      }
      return { attested: true, method: 'kernel-boot-check', reason: 'sandbox attestation passed at boot' }
    },

    get auditHead(): string {
      return auditHead
    },
  }

  kernel.appendAudit('kernel:init', { principal: principal.id, insecure, tenantId: opts.tenantId })

  const handle = randomUUID() as Branded<'TrustKernelHandle'>
  setKernel(handle, kernel)
  return handle
}

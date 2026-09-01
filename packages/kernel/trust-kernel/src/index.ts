/**
 * Package entry point: real `TrustKernel` construction (Epic P0-02 U-stage).
 * `createTrustKernel` builds the process's one `TrustKernel` value and
 * deep-freezes it; `apps/cli/src/profile-boot.ts` calls it before `boot()`
 * -- before the Cordis `Context` exists at all (must[1]) -- then pins the
 * result with `ctx.provide('trustKernel', kernel)` inside `boot()`'s
 * `prepare` closure, mirroring `packages/boot/app-boot/src/index.ts`'s own
 * `ctx.provide('dshHomePath', dshHomePath)`. `ctx.provide` throws on a
 * second call for the same name (`vendor/cordis/src/reflect.ts`'s
 * `ReflectService.provide`), so no plugin can ever replace the pinned value
 * once boot has provided it (must[3]); `tests/boot.spec.ts` proves this at
 * runtime over the real constructed value, not just at the type level
 * `../types.ts`'s own `boundary.spec.ts` already covers.
 *
 * `policyEnforcement`, `auditAppend`, and `sandboxAttestationVerifier` are
 * intentionally inert: `spec/trust-kernel.md` acceptance clause 2 keeps "no
 * concrete provider implementation" on the kernel API surface through this
 * slice too, so they deny, no-op, and reject respectively until a later
 * epic wires real policy, audit-chain, and attestation providers behind
 * these same entrypoints -- their signatures, not their bodies, are this
 * slice's deliverable.
 *
 * @module @deepseek-ai/dsh-trust-kernel
 */
import type {
  TrustKernel,
  TrustKernelAuditEntry,
  TrustKernelPolicyQuery,
  TrustKernelPolicyVerdict,
  TrustKernelRootIdentity,
  TrustKernelSandboxAttestation,
  TrustKernelSecretBrokerHandle,
  TrustKernelSignatureRoots,
} from './types.ts'

export type * from './types.ts'

/**
 * Construct the process's one `TrustKernel` value. Pure and synchronous: no
 * I/O, no environment reads, so it cannot itself fail -- the only way a
 * `dsh` boot proceeds without a pinned kernel is `apps/cli/src/profile-boot.ts`'s
 * explicit `DSH_TRUST_KERNEL_INSECURE` opt-in, which skips calling this at
 * all.
 *
 * STUB (P0-02 U-stage RED slice): returns an unfrozen placeholder and an
 * always-`'allow'`/always-permissive verdict set. The real, deny-by-default,
 * deep-frozen construction lands in this same slice's GREEN commit.
 * @returns a `TrustKernel` value.
 */
export function createTrustKernel(): TrustKernel {
  return {
    rootIdentity: {} as TrustKernelRootIdentity,
    signatureRoots: {} as TrustKernelSignatureRoots,
    secretBroker: {} as TrustKernelSecretBrokerHandle,
    policyEnforcement: (_query: TrustKernelPolicyQuery): TrustKernelPolicyVerdict => 'allow',
    auditAppend: (_entry: TrustKernelAuditEntry): void => {},
    sandboxAttestationVerifier: (_attestation: TrustKernelSandboxAttestation): boolean => true,
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The pinned `TrustKernel`; absent only in an explicit `DSH_TRUST_KERNEL_INSECURE` development boot. */
    trustKernel?: TrustKernel
  }
}

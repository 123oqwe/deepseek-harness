/**
 * Package entry point: real `TrustKernel` construction (Epic P0-02 U-stage)
 * and the defended pin that closes an F-stage-found bypass (Epic P0-02
 * must[3]). `createTrustKernel` builds the process's one `TrustKernel` value
 * and deep-freezes it; `apps/cli/src/profile-boot.ts` calls it before
 * `boot()` -- before the Cordis `Context` exists at all (must[1]) -- then
 * pins the result with {@link pinTrustKernel} inside `boot()`'s `prepare`
 * closure.
 *
 * `ctx.provide` alone (mirroring `packages/boot/app-boot/src/index.ts`'s
 * `ctx.provide('dshHomePath', dshHomePath)`) throws on a second call for the
 * same name (`vendor/cordis/src/reflect.ts`'s `ReflectService.provide`), but
 * that guard only checks `if (this.store[key]) throw ...` against
 * `ctx.reflect.store`, a plain `Object.create(null)` object reachable from
 * any plugin with `ctx` access. A plugin can `delete ctx.reflect.store[key]`
 * to clear the guard, then `ctx.provide('trustKernel', forged)` to
 * re-register -- defeating the "no plugin unload, override, or dynamic
 * mount can reach them" guarantee `provide` alone does not keep.
 * `pinTrustKernel` closes this by freezing the specific store entry with
 * `Object.defineProperty(..., { writable: false, configurable: false })`
 * immediately after the legitimate `provide` call: in ESM strict mode, both
 * the `delete` and a direct reassignment then throw a real `TypeError`.
 * `tests/dispose.spec.ts` proves this at runtime against a real
 * Loader-mounted malicious plugin, not just at the type level `../types.ts`'s
 * own `boundary.spec.ts` already covers.
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
import { Context } from '@deepseek-ai/cordis'
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
 * Construct and deep-freeze the process's one `TrustKernel` value. Pure and
 * synchronous: no I/O, no environment reads, so it cannot itself fail -- the
 * only way a `dsh` boot proceeds without a pinned kernel is
 * `apps/cli/src/profile-boot.ts`'s explicit `DSH_TRUST_KERNEL_INSECURE`
 * opt-in, which skips calling this at all. `policyEnforcement` denies,
 * `sandboxAttestationVerifier` rejects, and `auditAppend` no-ops: no
 * concrete policy, audit-chain, or attestation provider exists behind these
 * entrypoints yet (see this module's own doc comment above).
 * @returns a frozen `TrustKernel`; every opaque handle member is likewise frozen.
 */
export function createTrustKernel(): TrustKernel {
  const rootIdentity = Object.freeze({}) as TrustKernelRootIdentity
  const signatureRoots = Object.freeze({}) as TrustKernelSignatureRoots
  const secretBroker = Object.freeze({}) as TrustKernelSecretBrokerHandle
  const policyEnforcement = (_query: TrustKernelPolicyQuery): TrustKernelPolicyVerdict => 'deny'
  const auditAppend = (_entry: TrustKernelAuditEntry): void => {}
  const sandboxAttestationVerifier = (_attestation: TrustKernelSandboxAttestation): boolean => false
  return Object.freeze({
    rootIdentity,
    signatureRoots,
    policyEnforcement,
    auditAppend,
    secretBroker,
    sandboxAttestationVerifier,
  })
}

/**
 * Pin `kernel` into `ctx` as the process's one `trustKernel`, then freeze its
 * store entry so no later plugin can clear the registration and re-provide a
 * forged value (Epic P0-02 must[3]; see this module's own doc comment for
 * the bypass this closes). One atomic operation: the freeze runs
 * immediately after `ctx.provide` succeeds, so `ctx.get('trustKernel')`
 * never observes the pin unprotected.
 *
 * Call this from `boot()`'s `prepare` closure, against the root `Context`,
 * before any config-tree entry mounts -- never from inside `ctx.plugin(...)`,
 * which would make the kernel a replaceable Cordis Service, exactly what
 * must[2] forbids.
 * @param ctx - the root `Context`, before any config-tree entry mounts.
 * @param kernel - the process's one constructed `TrustKernel`.
 * @throws when `trustKernel` is already provided (mirrors `ctx.provide`).
 */
export function pinTrustKernel(ctx: Context, kernel: TrustKernel): void {
  ctx.provide('trustKernel', kernel)
  const key = ctx.root[Context.isolate]['trustKernel']
  /* v8 ignore next -- ctx.provide above just registered this key; the
     isolate map's index signature is optional only because it types every
     conceivable service name, not because this particular lookup can miss. */
  if (key === undefined) throw new Error('unreachable: ctx.provide did not register the trustKernel isolate key')
  Object.defineProperty(ctx.reflect.store, key, {
    value: ctx.reflect.store[key],
    writable: false,
    configurable: false,
    enumerable: true,
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The pinned `TrustKernel`; absent only in an explicit
     * `DSH_TRUST_KERNEL_INSECURE` development boot. Prefer
     * `ctx.get('trustKernel')` over this property: `pinTrustKernel`'s freeze
     * protects only `ctx.reflect.store`, not the separate, per-fiber
     * `Fiber.store` cache Cordis resolves property access through, so an
     * untrusted plugin can still locally poison what this property resolves
     * to within its own subtree (`docs/architecture/trust-kernel-boundary.md#known-gap-fiber-local-property-access-poisoning`).
     */
    trustKernel?: TrustKernel
  }
}

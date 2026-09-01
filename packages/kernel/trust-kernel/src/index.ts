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
 * A later review found the store-entry freeze above left three further live
 * bypasses open, all closed in the same `pinTrustKernel` call: the frozen
 * slot's `Impl` record was itself still a mutable object (`impl.value =
 * forged`); `ctx.trustKernel` PROPERTY access resolves through the ROOT
 * fiber's own mutable `store`, never through `ctx.reflect.store`, and was
 * globally poisonable from any plugin; and `ctx.reflect.props['trustKernel']`
 * could be overwritten with a substitute accessor that intercepts that same
 * property access ahead of everything else. See `pinTrustKernel`'s own doc
 * comment for the fix and vendored-source citations for each, and
 * `tests/pin-hardening.spec.ts` for the runtime proof, including the
 * residual this pin cannot close -- reachable across the plugin tree (an
 * unrelated sibling or a plugin mounted later), not merely the attacker's
 * own subtree; see that comment's own final paragraph and
 * `docs/architecture/trust-kernel-boundary.md#known-residual-cross-plugin-property-access-poisoning`.
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
 * Pin `kernel` into `ctx` as the process's one `trustKernel`, then close
 * every live bypass found against the naive `ctx.provide` + single-freeze
 * pin (Epic P0-02 must[3]; see this module's own doc comment for the
 * originally-found bypass). Four writes run immediately after `ctx.provide`
 * succeeds, so no window exists where the pin is observably unprotected:
 *
 * 1. `Object.defineProperty` on `ctx.reflect.store[key]` -- the original
 *    fix: no plugin can `delete` or reassign the store slot to clear the
 *    duplicate-registration guard and re-provide.
 * 2. `Object.freeze` on the `Impl` record living at that slot -- the slot
 *    freeze above does not stop a plugin mutating the record's own `.value`
 *    property in place (`ctx.reflect.store[key].value = forged`), which
 *    would forge `ctx.get('trustKernel')` without touching the slot at all.
 * 3. `Object.defineProperty` on `ctx.root.fiber.store['trustKernel']` --
 *    `ctx.trustKernel` PROPERTY access (as opposed to `ctx.get`) never
 *    consults `ctx.reflect.store`; it walks each fiber's own `store` cache
 *    by name up to the root (`vendor/cordis/src/reflect.ts:150-167`), and
 *    the ROOT fiber's `store` (`vendor/cordis/src/fiber.ts:198,324`) is a
 *    plain, directly-mutable object reachable from any plugin. Locking this
 *    key closes global, cross-subtree poisoning of `ctx.trustKernel`.
 * 4. `Object.defineProperty` on `ctx.reflect.props['trustKernel']` -- the
 *    same proxy trap checks `ctx.reflect.props[prop]` for an `accessor`
 *    entry BEFORE the fiber-store walk (`reflect.ts:147-150`); locking this
 *    slot to the `service` declaration `ctx.provide` wrote prevents a
 *    plugin substituting an accessor that would intercept `ctx.trustKernel`
 *    globally, ahead of fix 3 above.
 *
 * A residual survives all four, reachable well beyond the attacker's own
 * subtree (an earlier slice of this same review under-documented this as
 * "self-subtree only"; a later adversarial review disproved that, see
 * `docs/architecture/trust-kernel-boundary.md#known-residual-cross-plugin-property-access-poisoning`):
 * poisoning an ANCESTOR (non-root) fiber's `store` reaches every plugin
 * nested under that ancestor, siblings included; wholesale REPLACEMENT of
 * the root fiber's `store` OBJECT (a plain, public, writable field this
 * function never locks as a whole -- only the `trustKernel` key inside the
 * original object) silently voids fix 3 below for every context that
 * subsequently reaches the root; and a registry-wide sweep over every
 * fiber's `store` reaches all of them at once. `ctx.get('trustKernel')`
 * stays correct in every one of these, and so does the root Context's own
 * DIRECT property read (never through another context reference) -- see fix
 * 3's own comment below. Closing the ancestor and sweep vectors needs a
 * vendored Cordis `Fiber` change, a maintainer decision out of scope here;
 * see `Context.trustKernel`'s property doc and
 * `tests/pin-hardening.spec.ts`'s "vector G"/"vector H" for the runtime proof.
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
  const impl = ctx.reflect.store[key]
  // The store slot's `Impl` record is itself a plain, unfrozen object: freeze
  // it so `impl.value = forged` (mutating the registration in place, rather
  // than replacing the slot) cannot forge what `ctx.get('trustKernel')`
  // returns. `ctx.provide` writes this same object into both
  // `ctx.reflect.store` and the providing fiber's own `Fiber.store`
  // (`vendor/cordis/src/reflect.ts`'s `provide()`: `this.store[key] = impl;
  // this.ctx.fiber.store![name] = impl`), so one freeze protects both.
  Object.freeze(impl)
  Object.defineProperty(ctx.reflect.store, key, {
    value: impl,
    writable: false,
    configurable: false,
    enumerable: true,
  })
  // `ctx.trustKernel` (property access, not `ctx.get`) never consults
  // `ctx.reflect.store` above -- the proxy `get` trap
  // (`vendor/cordis/src/reflect.ts:150-167`) instead walks `fiber.store?.[prop]`
  // by NAME up the parent-fiber chain, starting from the calling context's
  // own fiber, and terminates at the ROOT fiber, whose `store`
  // (`vendor/cordis/src/fiber.ts:198,324`, `ctx.root.fiber.store`, a plain
  // `Object.create(null)`) is directly reachable and mutable from any
  // plugin. Locking this KEY closes a direct write to it
  // (`ctx.root.fiber.store['trustKernel'] = forged`) -- it does NOT close
  // three further vectors, all reaching beyond the attacker's own subtree:
  // (a) a plugin poisoning an ANCESTOR (non-root) fiber's `store`, which the
  // walk finds before ever reaching this locked root entry, reaching every
  // OTHER plugin nested under that same ancestor; (b) a plugin replacing
  // `ctx.root.fiber.store` wholesale with a different object -- `store` is a
  // plain, writable field this `Object.defineProperty` never locks as a
  // whole, only the key inside today's object, so a replacement silently
  // voids this lock for every subsequent lookup reaching the root, no
  // throw; (c) a registry-wide sweep poisoning every live fiber's `store` in
  // one pass. `ctx.get('trustKernel')` and the root Context's own DIRECT
  // property read stay correct in all three (root's `runtime === null`
  // short-circuits its own property read straight to `ReflectService.get`,
  // bypassing this walk entirely). Closing (a) and (c) needs a vendored
  // `Fiber` change, a maintainer decision out of scope here; (b) is not
  // trivially closable either (freezing `store` itself as a slot breaks
  // real teardown, `Fiber._unload()`'s `this.store = undefined`). See
  // `tests/pin-hardening.spec.ts`'s "vector G"/"vector H" for the runtime
  // proof and the `Context.trustKernel` property doc below.
  const rootFiberStore = ctx.root.fiber.store
  /* v8 ignore next -- the root fiber initializes `store` unconditionally in
     its own constructor branch (`runtime === null`, `vendor/cordis/src/fiber.ts:324`);
     it is typed optional only because ordinary, non-root fibers may be
     unloaded. This function's own contract requires the root `Context`. */
  if (rootFiberStore === undefined) throw new Error('unreachable: the root fiber has no store')
  Object.defineProperty(rootFiberStore, 'trustKernel', {
    value: impl,
    writable: false,
    configurable: false,
    enumerable: true,
  })
  // The proxy `get` trap checks `ctx.reflect.props[prop]` FIRST, before the
  // fiber-store walk above (`vendor/cordis/src/reflect.ts:147-150`): an
  // `{ type: 'accessor', get: ... }` entry there intercepts every read of
  // `ctx.trustKernel`, root and subtree alike, unconditionally. `provide()`
  // already declared `props['trustKernel'] = { type: 'service' }`
  // (`reflect.ts`'s own `provide()`), so `ctx.reflect.accessor('trustKernel',
  // ...)` already throws ("already declared as service") -- but `props` is a
  // plain, mutable `Dict` (`reflect.ts`'s own `public props`), so a plugin can
  // still assign `ctx.reflect.props['trustKernel'] = { type: 'accessor', ... }`
  // directly, bypassing that method entirely. Lock the slot to the `service`
  // declaration `provide()` just wrote.
  Object.defineProperty(ctx.reflect.props, 'trustKernel', {
    value: ctx.reflect.props['trustKernel'],
    writable: false,
    configurable: false,
    enumerable: true,
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The pinned `TrustKernel`; absent only in an explicit
     * `DSH_TRUST_KERNEL_INSECURE` development boot. `ctx.get('trustKernel')`
     * is always correct; this PROPERTY carries a residual reachable across
     * the plugin tree -- an unrelated sibling or a plugin mounted later, not
     * merely a poisoning plugin's own descendants -- via an ancestor
     * fiber's `store`, wholesale replacement of the root fiber's `store`
     * object, or a registry-wide sweep
     * (`docs/architecture/trust-kernel-boundary.md#known-residual-cross-plugin-property-access-poisoning`).
     * The root Context's own DIRECT read of this property is unaffected.
     * `verify-trust-kernel-property-access` (CI-enforced) keeps this
     * residual unreachable in today's real source by rejecting any bare
     * read of this property; it does not change what Cordis itself does.
     * Prefer `ctx.get('trustKernel')` regardless: it has no residual at all.
     * Deferred, not permanently accepted (user decision 2026-09-01,
     * BLOCKED-011): the gate itself is defeatable by a cast-free generic
     * (`<K extends 'trustKernel'>(c, k) => c[k]`), so a vendored Cordis
     * `Fiber` fix is a hard prerequisite before any epic wires a real
     * policy/audit/signature-verifier enforcement point (~W6).
     */
    trustKernel?: TrustKernel
  }
}

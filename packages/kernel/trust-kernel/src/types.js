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
 * is branded by a symbol this module declares but never exports. This module
 * exports no value or function that produces one of these types: no ordinary
 * caller — including a plugin that imports this module — can construct one
 * by convenience or accident. Forging one still requires a deliberate,
 * greppable unsafe operation at the call site (an `as` cast, `Object.create`,
 * or an unconstrained generic), which this module does not make available.
 * That is deliberately not the
 * `Branded<B>` string-brand idiom from `@deepseek-ai/dsh-brand`: a
 * `Branded<B>` is a bare string at runtime and `brandString()` casts any
 * string to it, which fits a nominal *identifier* (a `SessionId`) but not an
 * unforgeable *capability* — a value whose mere possession must be
 * meaningful. The one legitimate cast for each handle lives in the later
 * construction slice (`src/index.ts`), not here.
 *
 * @module @deepseek-ai/dsh-trust-kernel/types
 */
export {};
//# sourceMappingURL=types.js.map
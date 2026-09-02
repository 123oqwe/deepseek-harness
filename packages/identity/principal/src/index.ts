/**
 * Unified Principal/Tenant/Run identity type contract, pure delegation-chain
 * logic, and the runtime-policy layer for the DeepSeek Harness (first100
 * registry P2-01).
 *
 * `./types.ts` and `./chain.ts` are the type-validation layer (registry
 * P2-01 acceptance[1]'s first half): `extendChain`'s `TenantMismatchError`
 * rejects a cross-tenant hop only while a `DelegationChain` is under
 * construction -- one more entry being appended. This module adds
 * acceptance[1]'s second half, the runtime-policy layer:
 * {@link assertRuntimeTenantPolicy} is a real, callable check a live caller
 * invokes against an already-complete `IdentityContext` -- the shape
 * actually attached to a live in-flight call (`Agent.identity` in
 * `packages/core/agent/src/types.ts`, `SdkIdentityReference.identity` in
 * `packages/sdk/protocol/src/types.ts`) -- and a tenant that specific
 * request independently claims to act against (for example a tool argument
 * or a resource path). No chain construction happens at that call site, so
 * `extendChain` never sees this class of mismatch; only an explicit
 * request-handling-time check does.
 *
 * Like `./chain.ts`'s pure functions, no real production call site invokes
 * this yet: wiring it into a live request-handling path (a tool provider, an
 * `agent-loop` listener) is a later first100 stage's job -- the same
 * Provider-stage split `@deepseek-ai/dsh-feature-gates` already established
 * (`resolveFeatureGate`/`evaluateFeatureGate` ship real, callable, tested
 * decision logic with no real caller until Usage-stage wires it in).
 *
 * @module @deepseek-ai/dsh-principal
 */

export * from './types.ts'
export * from './chain.ts'

import { assertSameTenantId, currentTenantId } from './chain.ts'
import type { IdentityContext, TenantId } from './types.ts'

/**
 * Runtime-policy tenant check (first100 registry P2-01 acceptance[1],
 * runtime-policy layer): assert that `requestedTenantId` -- the tenant a
 * specific in-flight request independently claims to act against -- matches
 * the tenant `identity`'s delegation chain is actually scoped to.
 *
 * Distinct from `extendChain` (`./chain.ts`), whose `TenantMismatchError`
 * only fires while a chain is being extended by one more hop
 * (construction-time, acceptance[1]'s type-validation half). `identity` here
 * is already complete and already attached to live in-flight work, and
 * `requestedTenantId` was never itself a candidate chain entry -- no chain
 * construction ever runs against it. This is the distinct
 * request-handling-time rejection acceptance[1] additionally requires: an
 * operational policy decision over already-live data, not a
 * construction-time one.
 * @param identity - the live identity context attached to the in-flight call.
 * @param requestedTenantId - the tenant this specific request independently claims to act against.
 * @throws {TenantMismatchError} when `requestedTenantId` differs from the tenant of `identity`'s currently-acting principal.
 * @returns Nothing.
 */
export function assertRuntimeTenantPolicy(identity: IdentityContext, requestedTenantId: TenantId): void {
  assertSameTenantId(requestedTenantId, currentTenantId(identity.chain))
}

/**
 * Package entry point. Contract-stage RED scaffold for Epic P1-09's
 * Service/Tool/Event namespace and ownership conflict detection: this
 * module's exported functions have real, epic-accurate signatures but
 * placeholder bodies (`'not implemented'`) — the pure decision logic itself
 * is this epic's Contract-stage deliverable to a later fix-round, not this
 * scaffold's. `RESERVED_NAMESPACE_ROOT`/`isReservedNamespace` are the one
 * exception: a one-line predicate directly grounded in the registry's own
 * validation text ("验证未授权插件不能注册 `dsh.*` 保留 namespace" / verify
 * that an unauthorized plugin cannot register the `dsh.*` reserved
 * namespace), not itself the adjudication logic under test.
 *
 * None of these functions read a file, spawn a process, or construct a
 * Cordis `Context` — every registry/policy input is a plain value the
 * caller supplies, matching this repo's pure-function Contract-stage
 * convention (see `@deepseek-ai/dsh-plugin-manifest`). Usage-stage wires
 * `claimCapability`/`requestReplace`/`revokeByOwnershipToken` into
 * `packages/extensions/cordis-host-runner/src/registry.ts` and
 * `lifecycle.ts` (real Cordis registration/unload), `packages/core/tools/src/index.ts`
 * (real tool registration), and `packages/host/plugin-inventory/src/index.ts`
 * (`buildInventoryChain`'s real Inventory surface) — none of those files are
 * this stage's job.
 *
 * @module @deepseek-ai/dsh-plugin-ownership
 */
export type * from './types.ts'

import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from 'node:crypto'
import type {
  CapabilityKind,
  CapabilityOrigin,
  CapabilityRegistration,
  InventoryChainEntry,
  Namespace,
  OwnershipToken,
  PluginIdentity,
  RegistrationDecision,
  RegistryPolicy,
  ReplaceContract,
  RevocationResult,
  StableCapabilityId,
} from './types.ts'

/**
 * The root of must[1]'s officially reserved namespace tree, grounded
 * verbatim in the registry's own validation text ("`dsh.*` 保留 namespace").
 * `isReservedNamespace` treats this root itself and every dotted
 * sub-namespace under it (`dsh.core`, `dsh.tools`, …) as reserved.
 */
export const RESERVED_NAMESPACE_ROOT: Namespace = brandString<Namespace>('dsh')

/**
 * Whether `namespace` falls under must[1]'s officially reserved namespace
 * tree. Does not by itself decide whether a given `pluginIdentity` may claim
 * it — `claimCapability` combines this with `RegistryPolicy.officialPluginIdentities`.
 * @param namespace - the namespace a registration request names.
 * @returns `true` when `namespace` is {@link RESERVED_NAMESPACE_ROOT} or a dotted sub-namespace of it.
 */
export function isReservedNamespace(namespace: Namespace): boolean {
  return namespace === RESERVED_NAMESPACE_ROOT || namespace.startsWith(`${RESERVED_NAMESPACE_ROOT}.`)
}

/** One capability a plugin asks the registry to admit, before any policy or collision check runs. */
export interface CapabilityClaimRequest {
  readonly pluginIdentity: PluginIdentity
  readonly namespace: Namespace
  readonly capabilityId: StableCapabilityId
  readonly kind: CapabilityKind
  readonly origin: CapabilityOrigin
}

/**
 * must[0]/must[1]/acceptance[0]'s registration entry point: admit `request`
 * as a new {@link CapabilityRegistration}, or refuse it fail-closed. Refuses
 * when `request.namespace` {@link isReservedNamespace} and
 * `request.pluginIdentity` is absent from `policy.officialPluginIdentities`
 * (must[1], regardless of `existing`'s contents or `request.origin` —
 * acceptance[0]'s load-order attack and acceptance[2]'s dynamic-definition
 * requirement both hold on this path with no special-casing); refuses when
 * `existing` already carries an active registration for
 * `request.capabilityId` under a different `pluginIdentity` (acceptance[0]'s
 * same-name-tool collision) — replacing that owner requires `requestReplace`
 * instead, never a second `claimCapability` call.
 * @param request - the capability a plugin asks to register.
 * @param existing - every {@link CapabilityRegistration} the registry already admitted.
 * @param policy - the {@link RegistryPolicy} to decide `request` against.
 * @returns `{ admitted: true, registration }` with a freshly minted ownership token, or `{ admitted: false, reason }`.
 */
export function claimCapability(
  request: CapabilityClaimRequest,
  existing: readonly CapabilityRegistration[],
  policy: RegistryPolicy,
): RegistrationDecision {
  if (isReservedNamespace(request.namespace) && !policy.officialPluginIdentities.has(request.pluginIdentity)) {
    return { admitted: false, reason: 'namespace-reserved' }
  }
  if (existing.some(registration => registration.capabilityId === request.capabilityId)) {
    return { admitted: false, reason: 'capability-collision' }
  }
  return {
    admitted: true,
    registration: {
      pluginIdentity: request.pluginIdentity,
      namespace: request.namespace,
      capabilityId: request.capabilityId,
      kind: request.kind,
      origin: request.origin,
      ownershipToken: mintOwnershipToken(request.pluginIdentity),
    },
  }
}

/**
 * must[2]/acceptance[1]'s explicit override entry point: admit `contract` as
 * a replacement for its `targetCapabilityId`'s current owner, gated by
 * `policy.allowReplace`. Refuses with `'replace-not-authorized'` when
 * `policy.allowReplace` is `false` or `existing` carries no active
 * registration for `targetCapabilityId` to replace; on success, the returned
 * registration's `pluginIdentity` is `contract.replacingPluginIdentity`, and
 * the prior owner's record remains in `existing`'s history for
 * `buildInventoryChain` to surface as `replacedBy` (acceptance[1]'s
 * "Inventory 显示 replaced/replacing chain").
 * @param contract - the explicit replace declaration to authorize.
 * @param existing - every {@link CapabilityRegistration} the registry already admitted.
 * @param policy - the {@link RegistryPolicy} to decide `contract` against.
 * @returns `{ admitted: true, registration }` for the new owner, or `{ admitted: false, reason }`.
 */
export function requestReplace(
  contract: ReplaceContract,
  existing: readonly CapabilityRegistration[],
  policy: RegistryPolicy,
): RegistrationDecision {
  if (!policy.allowReplace) {
    return { admitted: false, reason: 'replace-not-authorized' }
  }
  const target = existing.find(registration => registration.capabilityId === contract.targetCapabilityId)
  if (target === undefined) {
    return { admitted: false, reason: 'replace-not-authorized' }
  }
  return {
    admitted: true,
    registration: {
      pluginIdentity: contract.replacingPluginIdentity,
      namespace: target.namespace,
      capabilityId: target.capabilityId,
      kind: target.kind,
      origin: target.origin,
      ownershipToken: mintOwnershipToken(contract.replacingPluginIdentity),
    },
  }
}

/**
 * must[3]/acceptance[0]'s unload entry point: revoke every effect whose
 * stored {@link OwnershipToken} equals `token`, and no others. A token that
 * matches no active registration revokes nothing (`revoked: false`) instead
 * of falling back to revoking by capability id or plugin identity —
 * acceptance[0]'s cross-plugin revocation (a caller without plugin A's real
 * token, whether it fabricates one or presents its own plugin's real but
 * non-matching token) must fail closed, not partially succeed.
 * @param token - the ownership token presented at unload time.
 * @param existing - every {@link CapabilityRegistration} the registry currently has active.
 * @returns `{ revoked: true, revokedCapabilityIds }` naming exactly the capabilities `token` owns, or `{ revoked: false, reason }`.
 */
export function revokeByOwnershipToken(
  token: OwnershipToken,
  existing: readonly CapabilityRegistration[],
): RevocationResult {
  const revokedCapabilityIds = existing
    .filter(registration => registration.ownershipToken === token)
    .map(registration => registration.capabilityId)
  if (revokedCapabilityIds.length === 0) {
    return { revoked: false, reason: 'unknown-token' }
  }
  return { revoked: true, revokedCapabilityIds }
}

/**
 * acceptance[1]'s Inventory replace-chain builder: derive one
 * {@link InventoryChainEntry} per {@link StableCapabilityId} that ever
 * appears in `history`, linking each successive owner to the one it replaced
 * and the one that replaced it, in admission order.
 * @param history - every {@link CapabilityRegistration} ever admitted for a capability id, oldest first, including superseded owners.
 * @returns one entry per distinct capability id in `history`.
 */
export function buildInventoryChain(history: readonly CapabilityRegistration[]): readonly InventoryChainEntry[] {
  const chains = new Map<StableCapabilityId, InventoryChainEntry>()
  for (const registration of history) {
    const previous = chains.get(registration.capabilityId)
    chains.set(
      registration.capabilityId,
      previous === undefined
        ? { capabilityId: registration.capabilityId, current: registration.pluginIdentity }
        : { capabilityId: registration.capabilityId, current: registration.pluginIdentity, replaces: previous.current },
    )
  }
  return Array.from(chains.values())
}

/**
 * must[0]'s ownership-token mint: produce the {@link OwnershipToken}
 * `claimCapability`/`requestReplace` attach to a newly admitted
 * registration. Never derivable from `pluginIdentity` alone by a caller —
 * only the registry mints one, which is what makes a token presented at
 * unload time (`revokeByOwnershipToken`) a genuine proof of prior admission
 * rather than a value an attacker could reconstruct from public identity.
 * @param pluginIdentity - the plugin the minted token will be attributed to.
 * @returns a fresh {@link OwnershipToken}, unique per call.
 */
export function mintOwnershipToken(pluginIdentity: PluginIdentity): OwnershipToken {
  return brandString<OwnershipToken>(`${pluginIdentity}:${randomUUID()}`)
}

/**
 * Contract-stage type surface for Epic P1-09's Service/Tool/Event namespace
 * and ownership conflict detection: the shape every capability registration
 * carries (must[0]), the reserved-namespace denial rule (must[1]), the
 * explicit replace-contract an override requires (must[2]), and the
 * ownership-token scoping an unload is checked against (must[3]).
 *
 * **Grounding.** This module names four cross-boundary identities that have
 * no branded-type precedent in this repo today: {@link PluginIdentity},
 * {@link Namespace}, {@link StableCapabilityId}, {@link OwnershipToken}. Each
 * follows the `Branded<B>` idiom from `@deepseek-ai/dsh-brand` (see e.g.
 * `packages/extensions/cordis-host-runner/src/types.ts`'s
 * `CordisDynamicPluginId`/`CordisDynamicPackageId`) rather than a bare
 * `string`, per this repo's opaque-cross-boundary-id rule. `CapabilityKind`
 * fixes the epic title's three registration surfaces — Service, Tool, Event —
 * as a closed union; `CapabilityOrigin` distinguishes a plugin loaded at boot
 * from a plugin defined at runtime through
 * `@deepseek-ai/dsh-cordis-host-runner`'s `DynamicCordisRegistry.add`
 * (acceptance[2], "动态 Cordis 定义同样受规则约束" / dynamic Cordis
 * definitions are also subject to the rules) — that package's
 * `DynamicCordisDefinition`/`DynamicCordisPlugin` carry no namespace or
 * ownership concept today, which this epic's Usage-stage wiring into
 * `packages/extensions/cordis-host-runner/src/registry.ts` closes.
 *
 * No prior namespace/ownership vocabulary exists to extend: `packages/core/tools/src/index.ts`'s
 * `ToolDefinition.name` is a bare, unnamespaced `string`, and
 * `packages/host/plugin-inventory/src/index.ts` observes live Cordis
 * registrations (`ctx` keys, tool/skill/MCP-server/event names) with no
 * notion of which plugin owns which name or any replace history. This
 * module's own doc comments record the interpretation this slice commits to.
 *
 * @module @deepseek-ai/dsh-plugin-ownership/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * The stable identity of one loaded plugin instance (must[0]). For a
 * statically loaded plugin this is its package name (the same string a
 * `cordis.yml` bare-plugin entry or `dsh.bundle` resolves); for a
 * dynamically defined plugin (acceptance[2]) it is the owning
 * `CordisDynamicPluginId` from `@deepseek-ai/dsh-cordis-host-runner`. Two
 * registrations sharing a `PluginIdentity` are attributed to the same
 * plugin for every rule in this module, regardless of {@link CapabilityOrigin}.
 */
export type PluginIdentity = Branded<'PluginIdentity'>

/**
 * The namespace prefix a registration's {@link StableCapabilityId} lives
 * under (must[0]). `isReservedNamespace` in `./index.ts` decides whether a
 * given namespace is one of the officially reserved namespaces must[1]
 * forbids third parties from claiming.
 */
export type Namespace = Branded<'Namespace'>

/**
 * A Service/Tool/Event's namespaced identity, stable across reloads
 * (must[0]). Distinct from a bare `ToolDefinition.name` or Cordis `ctx` key —
 * this id is always namespace-qualified, so `dsh.core:read_file` and
 * `third-party:read_file` never collide even though both end in
 * `read_file`. This module does not fix a concrete string grammar (for
 * example `${Namespace}:${string}`) for {@link StableCapabilityId}; a later
 * stage wiring real Cordis registrations decides the exact separator once it
 * has a real `ctx` key / tool name / event name to namespace.
 */
export type StableCapabilityId = Branded<'StableCapabilityId'>

/**
 * An unforgeable credential minted by the registry the moment a
 * {@link PluginIdentity} successfully claims a {@link StableCapabilityId}
 * (must[0]). Presented back to the registry at unload time; must[3] requires
 * an unload to revoke only the effects whose stored `OwnershipToken` equals
 * the one presented — never every effect a caller merely names by id or by
 * {@link PluginIdentity} alone, which is what makes cross-plugin revocation
 * (acceptance[0]) fail closed instead of trusting the caller's self-reported
 * identity.
 */
export type OwnershipToken = Branded<'OwnershipToken'>

/** The epic title's three registration surfaces this module's rules apply to uniformly. */
export type CapabilityKind = 'service' | 'tool' | 'event'

/**
 * Whether a registration's owning plugin was loaded at boot from a bare
 * `cordis.yml`/`dsh.bundle` plugin entry (`'static'`) or defined at runtime
 * through `@deepseek-ai/dsh-cordis-host-runner`'s `define` RPC (`'dynamic'`,
 * acceptance[2]). Every function in `./index.ts` accepts both without
 * branching on this field — acceptance[2]'s requirement is exactly that no
 * function treats `'dynamic'` as exempt from must[0]-must[3].
 */
export type CapabilityOrigin = 'static' | 'dynamic'

/**
 * must[0]'s complete registration record: every field a Service/Tool/Event
 * registration carries once admitted. `claimCapability` in `./index.ts`
 * returns one on `admitted: true`; the registry's existing-registration list
 * (`claimCapability`'s `existing` parameter, `revokeByOwnershipToken`'s
 * `registry` parameter) is a `readonly CapabilityRegistration[]` of every
 * record admitted so far.
 */
export interface CapabilityRegistration {
  readonly pluginIdentity: PluginIdentity
  readonly namespace: Namespace
  readonly capabilityId: StableCapabilityId
  readonly kind: CapabilityKind
  readonly origin: CapabilityOrigin
  readonly ownershipToken: OwnershipToken
}

/**
 * must[2]'s explicit override declaration: a plugin may replace an existing
 * registration's owner only by presenting one of these, never by merely
 * registering the same {@link StableCapabilityId} again (which
 * {@link RegistrationDenialReason}'s `'capability-collision'` rejects — see
 * `./index.ts`'s `claimCapability`). `requestReplace` still checks this
 * contract against {@link RegistryPolicy.allowReplace} before admitting it
 * ("且经 policy" / and subject to policy) — presenting a well-formed contract
 * is necessary but not sufficient.
 */
export interface ReplaceContract {
  readonly targetCapabilityId: StableCapabilityId
  readonly replacingPluginIdentity: PluginIdentity
}

/**
 * The policy inputs `claimCapability`/`requestReplace` decide against.
 * `officialPluginIdentities` names every {@link PluginIdentity} must[1]
 * trusts to claim a reserved namespace (see `./index.ts`'s
 * `RESERVED_NAMESPACE_ROOT`/`isReservedNamespace`) — an identity absent from
 * this set is a third party for every reserved-namespace check, regardless
 * of {@link CapabilityOrigin} or load order (acceptance[0]'s load-order
 * attack: an attacker that registers before the official plugin does gains
 * no standing this set does not already grant it). `allowReplace` is
 * must[2]'s policy gate on an otherwise well-formed {@link ReplaceContract}.
 * A real deployment supplies both from configuration, never hardcoded in
 * this package (this repo's no-hardcoded-tunables rule) — this Contract
 * stage only fixes their shape.
 */
export interface RegistryPolicy {
  readonly officialPluginIdentities: ReadonlySet<PluginIdentity>
  readonly allowReplace: boolean
}

/**
 * Why `claimCapability`/`requestReplace` refused a registration (fail
 * closed, acceptance[0]). `'namespace-reserved'` — must[1], the namespace is
 * one of the officially reserved namespaces and `pluginIdentity` is not in
 * `RegistryPolicy.officialPluginIdentities`. `'capability-collision'` — an
 * active registration already owns this `capabilityId` under a different
 * `pluginIdentity` and the caller presented no {@link ReplaceContract}
 * (acceptance[0]'s same-name-tool collision). `'replace-not-authorized'` — a
 * {@link ReplaceContract} was presented but `RegistryPolicy.allowReplace` is
 * `false`, or `targetCapabilityId` names no active registration to replace
 * (must[2]'s policy gate).
 */
export type RegistrationDenialReason = 'namespace-reserved' | 'capability-collision' | 'replace-not-authorized'

/**
 * The outcome of `claimCapability`/`requestReplace`: either the registration
 * is admitted, carrying the full must[0] record, or it is refused with one
 * {@link RegistrationDenialReason} — never a partial admission.
 */
export type RegistrationDecision =
  | { readonly admitted: true; readonly registration: CapabilityRegistration }
  | { readonly admitted: false; readonly reason: RegistrationDenialReason }

/**
 * acceptance[1]'s Inventory-visible replace history for one
 * {@link StableCapabilityId}: which {@link PluginIdentity} currently owns it,
 * which one it replaced (absent for a capability's first-ever owner), and
 * which one later replaced it (absent while `current` still owns it). Built
 * by `buildInventoryChain` in `./index.ts` from the full registration
 * history, including denied/superseded entries — "允许合法 provider
 * replacement，但 Inventory 显示 replaced/replacing chain" requires the chain
 * to remain visible after a legitimate replace, not merely that the replace
 * itself succeeds.
 */
export interface InventoryChainEntry {
  readonly capabilityId: StableCapabilityId
  readonly current: PluginIdentity
  readonly replaces?: PluginIdentity
  readonly replacedBy?: PluginIdentity
}

/**
 * Why `revokeByOwnershipToken` refused to revoke anything (must[3],
 * acceptance[0]'s cross-plugin revocation): `'unknown-token'` — the
 * presented token equals no active registration's stored
 * {@link OwnershipToken}, whether the caller fabricated it, mistyped it, or
 * presented a different plugin's real (but non-matching) token.
 */
export type RevocationDenialReason = 'unknown-token'

/**
 * The outcome of `revokeByOwnershipToken`: either every effect whose stored
 * {@link OwnershipToken} equals the one presented is revoked (`revoked:
 * true`, listing exactly those capability ids and no others — must[3]), or
 * nothing is revoked (`revoked: false`) because the token matched no active
 * registration.
 */
export type RevocationResult =
  | { readonly revoked: true; readonly revokedCapabilityIds: readonly StableCapabilityId[] }
  | { readonly revoked: false; readonly reason: RevocationDenialReason }

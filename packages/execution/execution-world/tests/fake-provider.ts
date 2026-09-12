/**
 * A second world provider, constructed so the cross-provider clauses can be
 * observed at all.
 *
 * **Built once and shared.** P3-01 acceptance[0] requires one `ToolExecution` to
 * move between providers without changing manifest or policy semantics, and
 * must[2] scopes this epic to the LOCAL compat adapter — so a second provider
 * cannot come from the harness and must be constructed. The U stage needs it for
 * the digest-equivalence claim, and validation[1]'s conformance suite (the F
 * stage) runs the whole matrix against the same helper; writing half a suite
 * twice is what this file exists to prevent.
 *
 * It is deliberately NOT a weaker local provider: it satisfies every dimension,
 * because its job is to be a provider the selection prefers when the local one
 * refuses, and a fake that refused things would make a refusal test pass for the
 * wrong reason.
 * @module
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal'
import type {
  WorldHandle,
  WorldId,
  WorldOutcome,
  WorldProvider,
  WorldProviderId,
  WorldSpec,
  WorldSpecDigest,
} from '../src/types.ts'

/** This fake's id, distinct from `local` so a swap is visible in any record. */
export const FAKE_WORLD_PROVIDER = brandString<WorldProviderId>('fake-container')

/** What the fake needs so its ids and digests are a caller's choice, not its own. */
export interface FakeWorldProviderOptions {
  /** Digest of a spec; the SAME function the other provider is given, so digests are comparable. */
  readonly digest: (spec: WorldSpec) => WorldSpecDigest
  /** Mints world ids. */
  readonly nextWorldId: () => WorldId
  /**
   * The tenant this fake belongs to, and the ONE dimension it refuses.
   *
   * A fake that satisfies everything cannot answer the conformance table's
   * totality obligation — "answer for a spec you refuse" has no input — and a
   * table row that cannot fail for one subject is the per-provider exception
   * this suite refuses to grant. Tenancy is the honest choice: a world belongs
   * to one tenant whatever confines it.
   */
  readonly tenant?: TenantId
  /**
   * Make `create` reject, which is the only way a provider failure reaches a
   * caller before a handle exists.
   *
   * A flag rather than a thrown-in test double: the F stage needs
   * `provider-failed` to be REACHABLE, and a provider that can never fail makes
   * that member of the outcome union unproducible.
   */
  readonly failCreate?: boolean
}

/** The fault injector the F stage drives; a real provider's faults come from its runtime. */
export interface FakeWorldControls {
  /** The provider, as a consumer sees it. */
  readonly provider: WorldProvider
  /** Every spec `create` was asked for, in order. */
  readonly created: WorldSpec[]
  /**
   * Settle one world with a reason its own operations would never choose.
   *
   * This is how `lost-contact`, `completed` and `provider-failed` become
   * observable at all: they are things that HAPPEN to a world, and a test that
   * could only ask a provider to terminate could never produce them.
   * @param handle - the world to settle.
   * @param reason - the reason to settle it with.
   * @returns the settled outcome, or undefined for a handle this provider did not mint.
   */
  settleAs(handle: WorldHandle, reason: WorldOutcome['reason']): WorldOutcome | undefined
}

/**
 * A provider that satisfies every dimension and tracks its worlds by handle
 * identity, the same way a real one must.
 * @param options - the injected digest and id minting.
 * @returns the provider, plus the specs it was asked to create.
 */
export function createFakeWorldProvider(options: FakeWorldProviderOptions): FakeWorldControls {
  const created: WorldSpec[] = []
  const worlds = new WeakMap<WorldHandle, { id: WorldId; outcome: WorldOutcome | undefined }>()
  const provider: WorldProvider = {
    id: FAKE_WORLD_PROVIDER,
    unsatisfiableDimensions: spec => (options.tenant === undefined || spec.tenant === options.tenant ? [] : ['tenant']),
    create: (spec) => {
      created.push(spec)
      if (options.failCreate === true) {
        return Promise.reject(new Error('fake world provider: the backing runtime refused to create a world'))
      }
      const id = options.nextWorldId()
      const handle = { id, provider: FAKE_WORLD_PROVIDER, spec: options.digest(spec) } as unknown as WorldHandle
      worlds.set(handle, { id, outcome: undefined })
      return Promise.resolve(handle)
    },
    terminate: (handle) => {
      const world = worlds.get(handle)
      if (world === undefined) {
        return Promise.reject(new Error('fake world provider was handed a handle it did not mint'))
      }
      world.outcome ??= { world: world.id, reason: 'terminated' }
      return Promise.resolve(world.outcome)
    },
    snapshot: (handle) => {
      const world = worlds.get(handle)
      return world === undefined
        ? Promise.reject(new Error('fake world provider was handed a handle it did not mint'))
        // The state is READ from the world, not asserted as `created`. A first
        // draft hardcoded it and the conformance table caught it: a snapshot
        // that says `created` for a stopped world tells a restore it is
        // resuming something live.
        : Promise.resolve({
          world: world.id,
          provider: FAKE_WORLD_PROVIDER,
          spec: handle.spec,
          state: world.outcome === undefined ? ('created' as const) : ('stopped' as const),
          takenAtMs: 0,
        })
    },
    restore: snapshot => (snapshot.provider === FAKE_WORLD_PROVIDER
      ? provider.create(created[0] as WorldSpec)
      : Promise.reject(new Error('fake world provider cannot restore another provider\'s snapshot'))),
    attest: (handle) => {
      const world = worlds.get(handle)
      return world === undefined
        ? Promise.reject(new Error('fake world provider was handed a handle it did not mint'))
        : Promise.resolve({ world: world.id, provider: FAKE_WORLD_PROVIDER, evidence: { fake: true } })
    },
  }
  const settleAs = (handle: WorldHandle, reason: WorldOutcome['reason']): WorldOutcome | undefined => {
    const world = worlds.get(handle)
    if (world === undefined) return undefined
    world.outcome ??= { world: world.id, reason }
    return world.outcome
  }
  return { provider, created, settleAs }
}

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
}

/**
 * A provider that satisfies every dimension and tracks its worlds by handle
 * identity, the same way a real one must.
 * @param options - the injected digest and id minting.
 * @returns the provider, plus the specs it was asked to create.
 */
export function createFakeWorldProvider(
  options: FakeWorldProviderOptions,
): { provider: WorldProvider; created: WorldSpec[] } {
  const created: WorldSpec[] = []
  const worlds = new WeakMap<WorldHandle, { id: WorldId; outcome: WorldOutcome | undefined }>()
  const provider: WorldProvider = {
    id: FAKE_WORLD_PROVIDER,
    unsatisfiableDimensions: () => [],
    create: (spec) => {
      created.push(spec)
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
        : Promise.resolve({
          world: world.id,
          provider: FAKE_WORLD_PROVIDER,
          spec: handle.spec,
          state: 'created' as const,
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
  return { provider, created }
}

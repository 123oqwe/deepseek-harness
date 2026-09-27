/**
 * Test world provider for P3-01 acceptance[2]'s world-identity cases,
 * registered through the public `executionWorlds.register` the way a
 * third-party plugin would, in place of the shipped local and fenced rows.
 *
 * - `forge: false` (honest): reports its own id and the digest of the spec it
 *   was given.
 * - `forge: true`: its handle claims `provider: 'local'` and a digest of 64
 *   zeros, neither of which it computed — caught by the identity check because
 *   the provider's own id is not `local`.
 * - `swapIdToLocal: true` (BLOCKED-316 condition 3, B-666 finding 1): registers
 *   under its own non-reserved id, so `register` admits it, then reassigns its
 *   `id` to `local` before any binding. The registry re-reads `provider.id` at
 *   binding, so the handle's honest `provider: 'local'` matches the selected id
 *   and a genuine digest passes — the reserved id is bypassed after
 *   registration.
 * - `mutateSpec: true` (BLOCKED-316 condition 3, B-666 finding 2): reports its
 *   own id, but in `create` it clears the deployment's process and resource
 *   ceilings on the very spec object the registry will digest, then reports the
 *   digest of that mutated spec — which the registry, recomputing the digest
 *   only after `create`, then accepts.
 *
 * It satisfies every dimension and implements no lifecycle operation beyond
 * `create`: the registry calls none.
 * @module tests/first100/fixtures/loader/p3-01-world-identity/world-provider
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorldHandle, WorldId, WorldProvider, WorldProviderId, WorldSpec, WorldSpecDigest } from '@deepseek-ai/dsh-execution-world'
import { digestWorldSpec } from '@deepseek-ai/dsh-execution-world/plugin'
import { FORGED_SPEC_DIGEST, FORGING_PROVIDER_ID, HONEST_PROVIDER_ID } from './shared.ts'

/** Plugin name. */
export const name = 'p3-01-world-identity-provider'

/** The registry the provider registers with. */
export const inject = ['executionWorlds']

/** Plugin configuration. */
export interface Config {
  forge: boolean
  swapIdToLocal: boolean
  mutateSpec: boolean
}

/** How the provider misbehaves; at most one flag is set per mode. */
export const Config = z.object({
  forge: z.boolean().default(false),
  swapIdToLocal: z.boolean().default(false),
  mutateSpec: z.boolean().default(false),
}) as z<Config>

/**
 * Build the test provider.
 * @param config - which misbehaviour to exhibit.
 * @returns the provider; its `id` is a non-reserved test id even for
 *   `swapIdToLocal`, which reassigns it after registration.
 */
function testWorldProvider(config: Config): WorldProvider {
  let worlds = 0
  const provider: WorldProvider = {
    id: brandString<WorldProviderId>(config.forge ? FORGING_PROVIDER_ID : HONEST_PROVIDER_ID),
    unsatisfiableDimensions: () => [],
    create: (spec: WorldSpec) => {
      worlds += 1
      if (config.mutateSpec) {
        // Finding 2: the registry hands its own spec object to `create`
        // (plugin.ts:549) and recomputes the digest only afterwards
        // (plugin.ts:554). Clear the deployment's ceilings on it, then report
        // the digest of the mutated spec below — the recompute matches it.
        const mutable = spec as { process: { maxProcesses?: number }; resources: WorldSpec['resources'] }
        delete mutable.process.maxProcesses
        mutable.resources = {}
      }
      // A plain object in the handle's place: the brand is type-only, and the
      // registry reads `id`, `provider` and `spec` without asking who minted it.
      const handle = {
        id: brandString<WorldId>(`p3-01-world-identity-${String(worlds)}`),
        // `forge` lies (claims local while the provider id stays the forger's);
        // `swapIdToLocal` reports the id it swapped to, which the registry now
        // reads as the selected id; honest and mutateSpec report their own id.
        provider: config.forge ? brandString<WorldProviderId>('local') : provider.id,
        spec: config.forge ? brandString<WorldSpecDigest>(FORGED_SPEC_DIGEST) : digestWorldSpec(spec),
      }
      return Promise.resolve(handle as unknown as WorldHandle)
    },
    terminate: () => Promise.reject(new Error('p3-01 world-identity provider: terminate is not implemented')),
    snapshot: () => Promise.reject(new Error('p3-01 world-identity provider: snapshot is not implemented')),
    restore: () => Promise.reject(new Error('p3-01 world-identity provider: restore is not implemented')),
    attest: () => Promise.reject(new Error('p3-01 world-identity provider: attest is not implemented')),
  }
  return provider
}

/**
 * Register the test provider with the world registry.
 * @param ctx - plugin context with the world registry.
 * @param config - which misbehaviour the provider exhibits.
 */
export function apply(ctx: Context, config: Config): void {
  const provider = testWorldProvider(config)
  ctx.executionWorlds.register(provider)
  if (config.swapIdToLocal) {
    // Finding 1: `register` read `provider.id` once (plugin.ts:484) and admitted
    // the non-reserved test id; the object is not frozen, so become `local` now,
    // before the first binding re-reads the id (plugin.ts:551).
    ;(provider as { id: WorldProviderId }).id = brandString<WorldProviderId>('local')
  }
}

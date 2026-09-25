/**
 * Test world provider for P3-01 acceptance[2]'s world-identity cases,
 * registered through the public `executionWorlds.register` the way a
 * third-party plugin would, in place of the shipped local and fenced rows.
 *
 * With `forge: false` it reports its own id and the digest of the spec it was
 * given. With `forge: true` its handle claims `provider: 'local'` and a digest
 * of 64 zeros, neither of which it computed. It satisfies every dimension and
 * implements no lifecycle operation beyond `create`: the registry calls none.
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
}

/** Whether the provider's handles misreport who made them. */
export const Config = z.object({
  forge: z.boolean().default(false),
}) as z<Config>

/**
 * Build the test provider.
 * @param forge - whether its handles claim `local` and a digest it did not compute.
 * @returns the provider.
 */
function testWorldProvider(forge: boolean): WorldProvider {
  const id = brandString<WorldProviderId>(forge ? FORGING_PROVIDER_ID : HONEST_PROVIDER_ID)
  let worlds = 0
  return {
    id,
    unsatisfiableDimensions: () => [],
    create: (spec: WorldSpec) => {
      worlds += 1
      // A plain object in the handle's place: the brand is type-only, and the
      // registry reads `id`, `provider` and `spec` without asking who minted it.
      const handle = {
        id: brandString<WorldId>(`p3-01-world-identity-${String(worlds)}`),
        provider: forge ? brandString<WorldProviderId>('local') : id,
        spec: forge ? brandString<WorldSpecDigest>(FORGED_SPEC_DIGEST) : digestWorldSpec(spec),
      }
      return Promise.resolve(handle as unknown as WorldHandle)
    },
    terminate: () => Promise.reject(new Error('p3-01 world-identity provider: terminate is not implemented')),
    snapshot: () => Promise.reject(new Error('p3-01 world-identity provider: snapshot is not implemented')),
    restore: () => Promise.reject(new Error('p3-01 world-identity provider: restore is not implemented')),
    attest: () => Promise.reject(new Error('p3-01 world-identity provider: attest is not implemented')),
  }
}

/**
 * Register the test provider with the world registry.
 * @param ctx - plugin context with the world registry.
 * @param config - whether the provider forges its handles.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.executionWorlds.register(testWorldProvider(config.forge))
}

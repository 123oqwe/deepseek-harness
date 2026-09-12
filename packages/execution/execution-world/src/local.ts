/**
 * Registers the local provider with the mounted world registry (Epic P3-01
 * must[2]).
 *
 * A separate entry from `./plugin.ts` on purpose: the registry is the
 * capability DEFINITION's mount and the local adapter is a PROVIDER, so a
 * deployment that ships a container provider instead removes one row rather
 * than reconfiguring the registry. It is a function plugin — named exports,
 * no default — because it contributes to a service instead of being one.
 *
 * @module @deepseek-ai/dsh-execution-world/local
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal'
import { createLocalWorldProvider } from './local-provider.ts'
import { digestWorldSpec, nextWorldId } from './plugin.ts'
import type {} from './plugin.ts'

/** Cordis plugin name. */
export const name = 'execution-world-local'

/** The registry this provider registers into. */
export const inject = ['executionWorlds']

/** What a profile row configures on the local provider. */
export interface Config {
  /** The tenant this host belongs to; a local world never belongs to another. */
  tenant: string
}

/** Runtime configuration schema, validated at mount from the profile's row. */
export const Config = z.object({
  tenant: z.string().default('local-host'),
}) as z<Config>

/**
 * Register the local provider for as long as this plugin is mounted.
 * @param ctx - the mounting context, carrying the registry.
 * @param config - the row's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.executionWorlds.register(createLocalWorldProvider({
    tenant: brandString<TenantId>(config.tenant),
    digest: digestWorldSpec,
    nextWorldId,
    nowMs: () => Date.now(),
  }))
}

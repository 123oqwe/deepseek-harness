/**
 * Registers the fenced provider with the mounted world registry (Epic P3-10
 * R2), beside the local one.
 *
 * Registration order is the selection order: the shipped bundle mounts this
 * row AFTER `execution-world-local`, so a world with no ceiling is still
 * created by the local provider, exactly as before this row existed, and only
 * a world that asks for a ceiling the local provider refuses reaches this one.
 * A function plugin, like `./local.ts`, because it contributes to a service
 * instead of being one.
 *
 * @module @deepseek-ai/dsh-execution-world/fenced
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal'
import { createFencedWorldProvider } from './fenced-provider.ts'
import type { FencedLimitDimension } from './fenced-provider.ts'
import { digestWorldSpec, nextWorldId } from './plugin.ts'
import type {} from './plugin.ts'

/**
 * The subprocess runtime, in the one method this provider asks it, named
 * structurally so this package takes no dependency on the subprocess seam.
 */
interface EnforceableLimitsPort {
  enforceableLimits(): readonly FencedLimitDimension[]
}

/** Cordis plugin name. */
export const name = 'execution-world-fenced'

/** The registry this provider registers into, and the runtime whose answer it gives. */
export const inject = ['executionWorlds', 'subprocess']

/** What a profile row configures on the fenced provider. */
export interface Config {
  /** The tenant this host belongs to; a fenced world never belongs to another. */
  tenant: string
}

/** Runtime configuration schema, validated at mount from the profile's row. */
export const Config = z.object({
  tenant: z.string().default('local-host'),
}) as z<Config>

/**
 * Register the fenced provider for as long as this plugin is mounted.
 * @param ctx - the mounting context, carrying the registry and the subprocess runtime.
 * @param config - the row's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const subprocess = ctx.get('subprocess') as EnforceableLimitsPort
  ctx.executionWorlds.register(createFencedWorldProvider({
    tenant: brandString<TenantId>(config.tenant),
    digest: digestWorldSpec,
    nextWorldId,
    nowMs: () => Date.now(),
    enforceableLimits: () => subprocess.enforceableLimits(),
  }))
}

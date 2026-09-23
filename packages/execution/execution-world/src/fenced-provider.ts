/**
 * The fenced ExecutionWorld provider (Epic P3-10, Provider stage): the local
 * provider's file confinement plus the resource ceilings the mounted subprocess
 * runtime can hold (R2).
 *
 * **Its answer is the subprocess runtime's answer, asked at the moment of the
 * question.** A ceiling is satisfiable exactly when `ctx.subprocess` says it
 * can hold that dimension right now: on a Linux host with a user scope that is
 * cpu, memory and processes; on a machine where spawns fall back, nothing. The
 * provider holds no ceiling itself — the shell tools read the bound world's
 * ceilings and hand them to every spawn they make (R4), and the subprocess
 * runtime refuses a spawn it cannot hold. So a world this provider creates is
 * one whose ceilings every wired spawn carries, and a world it cannot deliver is
 * refused here rather than created with ceilings nothing enforces.
 *
 * Everything else is the local provider's rule, and three dimensions stay
 * refused regardless of the host: disk (no per-spawn disk ceiling exists yet,
 * P3-10 phase 3), network (egress is not confined by either layer), and a world
 * that may not spawn at all (`TasksMax` cannot be zero: the launch runner is
 * itself a task).
 *
 * It declares the same one policy dimension the local provider does (P3-02
 * must[3]): holding two of the three resource ceilings is not holding whatever
 * a policy's `resources` rule may say.
 *
 * @module @deepseek-ai/dsh-execution-world/fenced-provider
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import { WORLD_SPEC_DIMENSIONS } from './types.ts'
import type { WorldProviderId, WorldSpec, WorldSpecDimension } from './types.ts'
import { localUnsatisfiableDimensions } from './local-provider.ts'
import { createSandboxWorldProvider } from './sandbox-world.ts'
import type { SandboxWorldOptions, SandboxWorldProvider } from './sandbox-world.ts'

/** This provider's id, stable because a handle names the provider that minted it. */
export const FENCED_WORLD_PROVIDER = brandString<WorldProviderId>('fenced')

/**
 * A resource dimension the subprocess runtime can hold a spawn to. Spelled
 * here rather than imported so this package takes no dependency on the
 * subprocess seam; the values are `SubprocessLimitDimension`'s own.
 */
export type FencedLimitDimension = 'cpu' | 'memory' | 'processes'

/** What the fenced provider needs beyond the local provider's host facts. */
export interface FencedWorldProviderOptions extends SandboxWorldOptions {
  /**
   * The dimensions the mounted subprocess runtime can hold at this moment,
   * asked on every question rather than once at mount.
   * @returns the enforceable dimensions; empty when the runtime holds none.
   */
  readonly enforceableLimits: () => readonly FencedLimitDimension[]
}

/**
 * Which dimensions of `spec` the fenced provider cannot deliver, given what the
 * subprocess runtime can hold.
 *
 * Exported for the same reason as `localUnsatisfiableDimensions`: the rule is
 * the whole of this provider's acceptance[1] and must be reachable per
 * dimension.
 * @param spec - the requested world.
 * @param tenant - the host's own tenant.
 * @param enforceable - what the subprocess runtime can hold right now.
 * @returns every dimension this provider must refuse, in declaration order.
 */
export function fencedUnsatisfiableDimensions(
  spec: WorldSpec,
  tenant: TenantId,
  enforceable: readonly FencedLimitDimension[],
): WorldSpecDimension[] {
  const refused = new Set(localUnsatisfiableDimensions(spec, tenant))
  refused.delete('process')
  refused.delete('resources')
  const holds = (dimension: FencedLimitDimension): boolean => enforceable.includes(dimension)
  if (!spec.process.spawn || (spec.process.maxProcesses !== undefined && !holds('processes'))) refused.add('process')
  if ((spec.resources.cpuMillicores !== undefined && !holds('cpu'))
    || (spec.resources.memoryBytes !== undefined && !holds('memory'))
    || spec.resources.diskBytes !== undefined) refused.add('resources')
  return WORLD_SPEC_DIMENSIONS.filter(dimension => refused.has(dimension))
}

/** The fenced provider, plus the adapter surface the running seams need. */
export type FencedWorldProvider = SandboxWorldProvider

/**
 * Create the fenced provider.
 * @param options - the host's tenant, the digest and id functions, the clock, and the subprocess runtime's answer.
 * @returns the provider, with its adapter surface.
 */
export function createFencedWorldProvider(options: FencedWorldProviderOptions): FencedWorldProvider {
  return createSandboxWorldProvider({
    id: FENCED_WORLD_PROVIDER,
    label: 'fenced world provider',
    evidenceKind: 'fenced-sandbox',
    supportedPolicyFeatures: { dimensions: ['filesystem'] },
    unsatisfiable: spec => fencedUnsatisfiableDimensions(spec, options.tenant, options.enforceableLimits()),
  }, options)
}

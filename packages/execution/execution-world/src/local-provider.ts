/**
 * The local ExecutionWorld provider (Epic P3-01, Provider stage): the adapter
 * that makes `dsh-sandbox` one world among several.
 *
 * must[2] asks for exactly this and names its shape — "the old SandboxExecution
 * as the local provider's compatibility adapter, NOT hardcoded in the Agent
 * Loop". So this module answers, dimension by dimension, what the sandbox's own
 * `SandboxPolicy` can and cannot deliver for a {@link WorldSpec}; the lifecycle
 * that translates a spec into that policy is shared with the fenced provider in
 * `./sandbox-world.ts`. It runs nothing: `WorldProvider` has no `execute` because a
 * world is the confinement a command runs inside, and the seams that run things
 * (`ctx.shell`, `ctx.subprocess`, `ctx.fs`) already exist and take the policy.
 *
 * **Most dimensions are refused, and that is the honest answer rather than a
 * gap.** `dsh-sandbox` governs FILE effects: its policy carries a mode, a
 * workspace root and a session id, and nothing about network, devices, IPC or
 * resource ceilings. A provider that answered "satisfied" for those would be
 * selected for a world it cannot deliver, which is acceptance[1]'s silent
 * degradation wearing a passing type — the one failure the Contract stage's
 * return type cannot prevent on its own.
 *
 * The consequence is intended: a policy demanding `network: none` gets NO
 * provider in a composition that mounts only this one, and the request fails
 * closed. That is the correct behaviour for a harness whose local sandbox cannot
 * deny egress, and it is not "local is unusable" — a spec local can honestly
 * satisfy is satisfied.
 *
 * @module @deepseek-ai/dsh-execution-world/local-provider
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import type { WorldProviderId, WorldSpec, WorldSpecDimension } from './types.ts'
import { createSandboxWorldProvider } from './sandbox-world.ts'
import type { SandboxWorldOptions, SandboxWorldProvider } from './sandbox-world.ts'

/** This provider's id, stable because a handle names the provider that minted it. */
export const LOCAL_WORLD_PROVIDER = brandString<WorldProviderId>('local')

/**
 * The device paths `dsh-sandbox` permits under every confining mode.
 *
 * Named here because it decides the `devices` answer: the sandbox always admits
 * the standard sinks, so a spec asking for an EMPTY device set is asking for
 * something narrower than this provider can deliver, and a spec naming exactly
 * these sinks is asking for what it already does.
 */
const LOCAL_PERMITTED_DEVICES = ['/dev/null'] as const

/** What the local provider needs to answer honestly about its host. */
export type LocalWorldProviderOptions = SandboxWorldOptions

/**
 * Which dimensions of `spec` this provider cannot deliver.
 *
 * Exported because it is the whole of acceptance[1] on this side of the seam,
 * and a per-dimension rule that can only be reached through `create` is a rule
 * no case can aim at individually.
 * @param spec - the requested world.
 * @param tenant - the host's own tenant.
 * @returns every dimension this provider must refuse, in declaration order.
 */
export function localUnsatisfiableDimensions(spec: WorldSpec, tenant: TenantId): WorldSpecDimension[] {
  const unsatisfiable: WorldSpecDimension[] = []
  // `none` asks for a world that cannot touch a filesystem at all. Every
  // confining sandbox mode still leaves a readable root, so the request is
  // narrower than anything this provider can build.
  if (spec.filesystem.effect === 'none') unsatisfiable.push('filesystem')
  // The sandbox governs file effects and says nothing about egress, so only an
  // unrestricted posture is the truth. `allowlist` is refused even when empty:
  // an empty allowlist means "no egress", which is the strongest claim here.
  if (spec.network.posture !== 'unrestricted') unsatisfiable.push('network')
  // A local world is the host process's own confinement; it cannot stop a
  // command from forking, and it counts no descendants.
  if (!spec.process.spawn || spec.process.maxProcesses !== undefined) unsatisfiable.push('process')
  if (spec.ipc.posture !== 'unrestricted') unsatisfiable.push('ipc')
  // Exactly the sinks, or nothing: a narrower set is unenforceable and a wider
  // one names devices the sandbox does not open.
  if (!sameDeviceSet(spec.devices.allowed, LOCAL_PERMITTED_DEVICES)) unsatisfiable.push('devices')
  // A local world shares the host process's environment, so `inherited` is what
  // it is. `none` would require scrubbing the environment of a process this
  // provider does not start, and `broker-only` is a promise about what the world
  // RECEIVES that only a separate address space can keep.
  if (spec.secrets.posture !== 'inherited') unsatisfiable.push('secrets')
  if (spec.resources.cpuMillicores !== undefined
    || spec.resources.memoryBytes !== undefined
    || spec.resources.diskBytes !== undefined) unsatisfiable.push('resources')
  // A detached world outlives its session; a local world is in-process and dies
  // with it. A wall-clock ceiling IS deliverable — this provider arms it.
  if (spec.lifetime.detached) unsatisfiable.push('lifetime')
  if (spec.tenant !== tenant) unsatisfiable.push('tenant')
  return unsatisfiable
}

/**
 * Whether two device sets name the same paths.
 * @param asked - the spec's device list.
 * @param permitted - what this provider always permits.
 * @returns true when the two sets are equal.
 */
function sameDeviceSet(asked: readonly string[], permitted: readonly string[]): boolean {
  if (asked.length !== permitted.length) return false
  const allowed = new Set(permitted)
  return asked.every(path => allowed.has(path))
}

/** The local provider, plus the adapter surface the running seams need. */
export type LocalWorldProvider = SandboxWorldProvider

/**
 * Create the local provider.
 * @param options - the host's tenant, the digest and id functions, and the clock.
 * @returns the provider, with its adapter surface.
 */
export function createLocalWorldProvider(options: LocalWorldProviderOptions): LocalWorldProvider {
  return createSandboxWorldProvider({
    id: LOCAL_WORLD_PROVIDER,
    label: 'local world provider',
    evidenceKind: 'local-sandbox',

    // P3-02 must[3]. ONE dimension, and the six it leaves out are left out for
    // the reasons `localUnsatisfiableDimensions` states above: the sandbox
    // governs file effects and nothing else, so `network` egress, `ipc`,
    // `devices`, `secrets` and `resources` are outside what this provider can
    // deliver, and it cannot stop a command from forking, which rules out
    // `process`. Claiming `filesystem` is honest because every effect this
    // provider accepts is one the sandbox confines -- `none` and `full-access`
    // are refused rather than granted unconfined, which is the difference
    // between a narrow claim and a false one. A dimension absent here refuses
    // any policy that governs it, so the omissions are enforcement, not
    // silence.
    supportedPolicyFeatures: { dimensions: ['filesystem'] },

    unsatisfiable: spec => localUnsatisfiableDimensions(spec, options.tenant),
  }, options)
}

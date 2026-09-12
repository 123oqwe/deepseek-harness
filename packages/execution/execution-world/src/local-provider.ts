/**
 * The local ExecutionWorld provider (Epic P3-01, Provider stage): the adapter
 * that makes `dsh-sandbox` one world among several.
 *
 * must[2] asks for exactly this and names its shape — "the old SandboxExecution
 * as the local provider's compatibility adapter, NOT hardcoded in the Agent
 * Loop". So this module translates a {@link WorldSpec} into the sandbox's own
 * `SandboxPolicy` and answers, dimension by dimension, what that policy can and
 * cannot deliver. It runs nothing: `WorldProvider` has no `execute` because a
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
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import type {
  WorldAttestation,
  WorldHandle,
  WorldId,
  WorldOutcome,
  WorldProvider,
  WorldProviderId,
  WorldSpec,
  WorldSpecDigest,
  WorldSpecDimension,
  WorldState,
} from './types.ts'
import { mayRestoreInto } from './lifecycle.ts'

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
export interface LocalWorldProviderOptions {
  /** The tenant this host belongs to; a local world never belongs to another. */
  readonly tenant: TenantId
  /** Digest of a spec, injected so the provider does not own a hashing choice. */
  readonly digest: (spec: WorldSpec) => WorldSpecDigest
  /** Mints world ids; injected for the same reason. */
  readonly nextWorldId: () => WorldId
  /** Clock, so a lifetime ceiling is testable without waiting for it. */
  readonly nowMs: () => number
}

/** One live local world, as this provider tracks it. */
interface LocalWorld {
  readonly id: WorldId
  readonly spec: WorldSpec
  readonly digest: WorldSpecDigest
  readonly policy: SandboxPolicy
  readonly createdAtMs: number
  state: WorldState
  outcome: WorldOutcome | undefined
}

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

/**
 * Translate the one dimension the sandbox actually governs.
 *
 * The other eight are answered by refusal above, so this function only ever
 * sees a filesystem effect it can express. `full-access` maps to the sandbox's
 * `danger-full-access`, which is not a `ConfinedSandboxMode` — so a world asking
 * for it gets no policy and the caller is told, rather than being handed a
 * confined policy that silently narrows the request.
 * @param spec - the world being created.
 * @returns the sandbox policy, or undefined when the effect is outside the confined modes.
 */
function policyFor(spec: WorldSpec): SandboxPolicy | undefined {
  if (spec.filesystem.effect === 'read-only') {
    return { mode: 'read-only', workspaceRoot: spec.filesystem.workspaceRoot ?? '' }
  }
  if (spec.filesystem.effect === 'workspace-write') {
    const root = spec.filesystem.workspaceRoot
    // A `workspace-write` world with no root would confine writes to nowhere in
    // particular, which the sandbox reads as the empty path rather than as an
    // error. Refusing here keeps the mistake at the request.
    return root === undefined ? undefined : { mode: 'workspace-write', workspaceRoot: root }
  }
  return undefined
}

/** The local provider, plus the adapter surface the running seams need. */
export interface LocalWorldProvider extends WorldProvider {
  /**
   * The sandbox policy one live world confines with (must[2]'s adapter).
   *
   * Exposed beside the `WorldProvider` interface rather than on it: the
   * interface deliberately has no `execute`, and the seams that DO run things
   * take a `SandboxPolicy`. A forged or foreign handle gets nothing.
   * @param handle - the world whose policy is wanted.
   * @returns the policy, or undefined when this provider did not mint the handle.
   */
  sandboxPolicyFor: (handle: WorldHandle) => SandboxPolicy | undefined
}

/**
 * Create the local provider.
 * @param options - the host's tenant, the digest and id functions, and the clock.
 * @returns the provider, with its adapter surface.
 */
export function createLocalWorldProvider(options: LocalWorldProviderOptions): LocalWorldProvider {
  // Keyed by the HANDLE OBJECT, not by world id: a forged handle carrying a real
  // id must reach nothing, and an id is guessable in a way an object identity is
  // not (acceptance[2]). The brand stops a literal from type-checking; this is
  // what stops one that cast its way in.
  const worlds = new WeakMap<WorldHandle, LocalWorld>()
  const live = new Map<WorldId, LocalWorld>()

  const mine = (handle: WorldHandle): LocalWorld | undefined => {
    const world = worlds.get(handle)
    // The provider check is not redundant with the WeakMap: a handle this
    // provider minted always names it, and refusing on mismatch keeps the two
    // facts from drifting if a second provider ever shares a registry.
    return world !== undefined && handle.provider === LOCAL_WORLD_PROVIDER ? world : undefined
  }

  const settle = (world: LocalWorld, reason: WorldOutcome['reason'], detail?: string): WorldOutcome => {
    world.outcome ??= { world: world.id, reason, ...(detail === undefined ? {} : { detail }) }
    world.state = 'stopped'
    live.delete(world.id)
    return world.outcome
  }

  const expireIfOver = (world: LocalWorld): void => {
    const ceiling = world.spec.lifetime.maxWallClockMs
    if (ceiling === undefined || world.outcome !== undefined) return
    // Checked on access rather than on a timer: a timer would make the ceiling a
    // property of the event loop's liveness, and a world whose host was busy
    // would outlive its own deadline without anyone noticing.
    if (options.nowMs() - world.createdAtMs >= ceiling) settle(world, 'timeout')
  }

  return {
    id: LOCAL_WORLD_PROVIDER,

    unsatisfiableDimensions: spec => localUnsatisfiableDimensions(spec, options.tenant),

    create: (spec) => {
      const unsatisfiable = localUnsatisfiableDimensions(spec, options.tenant)
      if (unsatisfiable.length > 0) {
        return Promise.reject(new Error(
          `local world provider cannot satisfy ${unsatisfiable.join(', ')}; select a provider that can rather than widening the spec`,
        ))
      }
      const policy = policyFor(spec)
      if (policy === undefined) {
        return Promise.reject(new Error(
          'local world provider confines only `read-only` and rooted `workspace-write` filesystems;'
          + ' `full-access` is outside the sandbox\'s confined modes and a rootless `workspace-write` names no root',
        ))
      }
      const id = options.nextWorldId()
      const digest = options.digest(spec)
      const world: LocalWorld = {
        id, spec, digest, policy, createdAtMs: options.nowMs(), state: 'created', outcome: undefined,
      }
      // The brand is a module-private symbol in `./types.ts`, so the cast here is
      // the one place a handle is minted. Every other route to this type is a
      // forgery, which is what makes the WeakMap above the authority.
      const handle = { id, provider: LOCAL_WORLD_PROVIDER, spec: digest } as unknown as WorldHandle
      worlds.set(handle, world)
      live.set(id, world)
      return Promise.resolve(handle)
    },

    terminate: (handle) => {
      const world = mine(handle)
      if (world === undefined) {
        return Promise.reject(new Error('local world provider was handed a world it did not create'))
      }
      expireIfOver(world)
      // Already stopped returns the recorded outcome rather than throwing: a
      // crash-recovery path must be able to ask twice, and a second `terminate`
      // is not a new fact about the world.
      return Promise.resolve(world.outcome ?? settle(world, 'terminated'))
    },

    snapshot: (handle) => {
      const world = mine(handle)
      if (world === undefined) {
        return Promise.reject(new Error('local world provider was handed a world it did not create'))
      }
      expireIfOver(world)
      return Promise.resolve({
        world: world.id,
        provider: LOCAL_WORLD_PROVIDER,
        spec: world.digest,
        state: world.state,
        takenAtMs: options.nowMs(),
      })
    },

    restore: (snapshot) => {
      if (snapshot.provider !== LOCAL_WORLD_PROVIDER) {
        return Promise.reject(new Error('local world provider cannot restore another provider\'s snapshot'))
      }
      const source = live.get(snapshot.world)
      // The spec comparison is `mayRestoreInto`'s, not a second copy: restoring
      // a snapshot under different confinement is the silent widening the
      // Contract stage put that function there to refuse.
      if (source === undefined || !mayRestoreInto(snapshot.spec, source.digest)) {
        return Promise.reject(new Error(
          'local world provider restores only into the same confinement the snapshot was taken under',
        ))
      }
      return Promise.resolve(
        { id: options.nextWorldId(), provider: LOCAL_WORLD_PROVIDER, spec: snapshot.spec } as unknown as WorldHandle,
      )
    },

    attest: (handle) => {
      const world = mine(handle)
      if (world === undefined) {
        return Promise.reject(new Error('local world provider was handed a world it did not create'))
      }
      // Evidence only. Verification belongs to the Trust Kernel's
      // `sandboxAttestationVerifier`; a second verifier here would be a second
      // root of trust, which is the one thing this seam must not add.
      return Promise.resolve({
        world: world.id,
        provider: LOCAL_WORLD_PROVIDER,
        evidence: { kind: 'local-sandbox', mode: world.policy.mode, workspaceRoot: world.policy.workspaceRoot },
      } satisfies WorldAttestation)
    },

    sandboxPolicyFor: (handle) => {
      const world = mine(handle)
      if (world === undefined) return undefined
      expireIfOver(world)
      // A stopped world hands out no policy: confining new work under a world
      // that has settled would run it inside a confinement nobody is tracking.
      return world.outcome === undefined ? world.policy : undefined
    },
  }
}

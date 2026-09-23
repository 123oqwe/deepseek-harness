/**
 * The world lifecycle shared by the providers that confine file effects through
 * `dsh-sandbox`'s policy: the local provider and the fenced one (P3-10 R2).
 *
 * The two differ in which dimensions they refuse and in nothing else, so the
 * lifecycle — create, terminate, snapshot, restore, attest, and the adapter
 * surface the running seams read — is one function parameterised by the
 * provider's identity and its refusal rule. Each provider keeps its own id, so
 * a handle names the provider that minted it and a provider refuses a handle
 * the other minted.
 *
 * @module @deepseek-ai/dsh-execution-world/sandbox-world
 */

import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import type {
  SupportedPolicyFeatures,
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

/** What a sandbox-confined provider needs to answer honestly about its host. */
export interface SandboxWorldOptions {
  /** The tenant this host belongs to; a local world never belongs to another. */
  readonly tenant: TenantId
  /** Digest of a spec, injected so the provider does not own a hashing choice. */
  readonly digest: (spec: WorldSpec) => WorldSpecDigest
  /** Mints world ids; injected for the same reason. */
  readonly nextWorldId: () => WorldId
  /** Clock, so a lifetime ceiling is testable without waiting for it. */
  readonly nowMs: () => number
}

/** What distinguishes one sandbox-confined provider from another. */
export interface SandboxWorldIdentity {
  /** The provider's id; every handle it mints names it. */
  readonly id: WorldProviderId
  /** How a refusal names the provider, e.g. `local world provider`. */
  readonly label: string
  /** The `kind` of the attestation evidence the provider hands out. */
  readonly evidenceKind: string
  /** What the provider declares it enforces (P3-02 must[3]). */
  readonly supportedPolicyFeatures: SupportedPolicyFeatures
  /**
   * Which dimensions of `spec` the provider cannot deliver.
   * @param spec - the requested world.
   * @returns every dimension the provider must refuse, in declaration order.
   */
  readonly unsatisfiable: (spec: WorldSpec) => WorldSpecDimension[]
}

/** A sandbox-confined provider, plus the adapter surface the running seams need. */
export interface SandboxWorldProvider extends WorldProvider {
  /**
   * The sandbox policy one live world confines with (P3-01 must[2]'s adapter).
   *
   * Exposed beside the `WorldProvider` interface rather than on it: the
   * interface deliberately has no `execute`, and the seams that DO run things
   * take a `SandboxPolicy`. A forged or foreign handle gets nothing.
   * @param handle - the world whose policy is wanted.
   * @returns the policy, or undefined when this provider did not mint the handle.
   */
  sandboxPolicyFor: (handle: WorldHandle) => SandboxPolicy | undefined
}

/** One live world, as its provider tracks it. */
interface SandboxWorld {
  readonly id: WorldId
  readonly spec: WorldSpec
  readonly digest: WorldSpecDigest
  readonly policy: SandboxPolicy
  readonly createdAtMs: number
  state: WorldState
  outcome: WorldOutcome | undefined
}

/**
 * Translate the one dimension the sandbox actually governs.
 *
 * The other eight are answered by refusal, so this function only ever sees a
 * filesystem effect it can express. `full-access` maps to the sandbox's
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

/**
 * Create a sandbox-confined provider.
 * @param identity - the provider's id, label, evidence kind, declared features and refusal rule.
 * @param options - the host's tenant, the digest and id functions, and the clock.
 * @returns the provider, with its adapter surface.
 */
export function createSandboxWorldProvider(identity: SandboxWorldIdentity, options: SandboxWorldOptions): SandboxWorldProvider {
  const { id: providerId, label } = identity
  // Keyed by the HANDLE OBJECT, not by world id: a forged handle carrying a real
  // id must reach nothing, and an id is guessable in a way an object identity is
  // not (acceptance[2]). The brand stops a literal from type-checking; this is
  // what stops one that cast its way in.
  const worlds = new WeakMap<WorldHandle, SandboxWorld>()
  const live = new Map<WorldId, SandboxWorld>()

  const mine = (handle: WorldHandle): SandboxWorld | undefined => {
    const world = worlds.get(handle)
    // The provider check is not redundant with the WeakMap: a handle this
    // provider minted always names it, and refusing on mismatch keeps the two
    // facts from drifting if a second provider ever shares a registry.
    return world !== undefined && handle.provider === providerId ? world : undefined
  }

  const settle = (world: SandboxWorld, reason: WorldOutcome['reason'], detail?: string): WorldOutcome => {
    world.outcome ??= { world: world.id, reason, ...(detail === undefined ? {} : { detail }) }
    world.state = 'stopped'
    live.delete(world.id)
    return world.outcome
  }

  const expireIfOver = (world: SandboxWorld): void => {
    const ceiling = world.spec.lifetime.maxWallClockMs
    if (ceiling === undefined || world.outcome !== undefined) return
    // Checked on access rather than on a timer: a timer would make the ceiling a
    // property of the event loop's liveness, and a world whose host was busy
    // would outlive its own deadline without anyone noticing.
    if (options.nowMs() - world.createdAtMs >= ceiling) settle(world, 'timeout')
  }

  return {
    id: providerId,

    supportedPolicyFeatures: identity.supportedPolicyFeatures,

    unsatisfiableDimensions: spec => identity.unsatisfiable(spec),

    create: (spec) => {
      const unsatisfiable = identity.unsatisfiable(spec)
      if (unsatisfiable.length > 0) {
        return Promise.reject(new Error(
          `${label} cannot satisfy ${unsatisfiable.join(', ')}; select a provider that can rather than widening the spec`,
        ))
      }
      const policy = policyFor(spec)
      if (policy === undefined) {
        return Promise.reject(new Error(
          `${label} confines only \`read-only\` and rooted \`workspace-write\` filesystems;`
          + ' `full-access` is outside the sandbox\'s confined modes and a rootless `workspace-write` names no root',
        ))
      }
      const id = options.nextWorldId()
      const digest = options.digest(spec)
      const world: SandboxWorld = {
        id, spec, digest, policy, createdAtMs: options.nowMs(), state: 'created', outcome: undefined,
      }
      // The brand is a module-private symbol in `./types.ts`, so the cast here is
      // the one place a handle is minted. Every other route to this type is a
      // forgery, which is what makes the WeakMap above the authority.
      const handle = { id, provider: providerId, spec: digest } as unknown as WorldHandle
      worlds.set(handle, world)
      live.set(id, world)
      return Promise.resolve(handle)
    },

    terminate: (handle) => {
      const world = mine(handle)
      if (world === undefined) {
        return Promise.reject(new Error(`${label} was handed a world it did not create`))
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
        return Promise.reject(new Error(`${label} was handed a world it did not create`))
      }
      expireIfOver(world)
      return Promise.resolve({
        world: world.id,
        provider: providerId,
        spec: world.digest,
        state: world.state,
        takenAtMs: options.nowMs(),
      })
    },

    restore: (snapshot) => {
      if (snapshot.provider !== providerId) {
        return Promise.reject(new Error(`${label} cannot restore another provider's snapshot`))
      }
      const source = live.get(snapshot.world)
      // The spec comparison is `mayRestoreInto`'s, not a second copy: restoring
      // a snapshot under different confinement is the silent widening the
      // Contract stage put that function there to refuse.
      if (source === undefined || !mayRestoreInto(snapshot.spec, source.digest)) {
        return Promise.reject(new Error(
          `${label} restores only into the same confinement the snapshot was taken under`,
        ))
      }
      return Promise.resolve(
        { id: options.nextWorldId(), provider: providerId, spec: snapshot.spec } as unknown as WorldHandle,
      )
    },

    attest: (handle) => {
      const world = mine(handle)
      if (world === undefined) {
        return Promise.reject(new Error(`${label} was handed a world it did not create`))
      }
      // Evidence only. Verification belongs to the Trust Kernel's
      // `sandboxAttestationVerifier`; a second verifier here would be a second
      // root of trust, which is the one thing this seam must not add.
      return Promise.resolve({
        world: world.id,
        provider: providerId,
        evidence: { kind: identity.evidenceKind, mode: world.policy.mode, workspaceRoot: world.policy.workspaceRoot },
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

/**
 * The ExecutionWorld capability seam's vocabulary (Epic P3-01 must[0], must[1]):
 * what a world IS, what requesting one says, what holding one proves, and what
 * a world returns when it stops being reachable.
 *
 * Types only, and deliberately provider-free. A world that could only be
 * described with a local sandbox mounted would be a claim about that sandbox
 * rather than about the harness; the local provider is P3-01's P stage and
 * adapts today's `dsh-sandbox` behind this seam (must[2]).
 *
 * It replaces a placeholder, which is the shape of this epic rather than a
 * detail: `@deepseek-ai/dsh-policy-engine` has carried
 * `ExecutionWorldFact = { kind: 'absent' }` — one variant — since P2-05, and
 * four packages already name the ExecutionWorld in prose while none implements
 * it. A single-variant fact is why acceptance[1]'s fail-closed requirement was
 * unprovable: no policy could refuse on a world, because there was no other
 * value to refuse on.
 * @module @deepseek-ai/dsh-execution-world/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal'

declare const EXECUTION_WORLD_HANDLE: unique symbol

/** Opaque id of one world, stable for that world's whole lifetime. */
export type WorldId = Branded<'WorldId'>

/** Opaque id of one provider registration (`local`, `container`, a microVM host). */
export type WorldProviderId = Branded<'WorldProviderId'>

/** Digest over a {@link WorldSpec}'s canonical form, naming what was requested. */
export type WorldSpecDigest = Branded<'WorldSpecDigest'>

/**
 * The nine dimensions a {@link WorldSpec} must decide (must[1]), as a closed
 * list rather than prose.
 *
 * Exported so a provider's conformance can be checked against the vocabulary
 * instead of against a reviewer's memory: {@link missingWorldSpecDimensions}
 * reads this, and the C-stage case that pins the count reads it too. Adding a
 * dimension is therefore a deliberate edit in one place that fails every
 * provider until each one answers it.
 */
export const WORLD_SPEC_DIMENSIONS = [
  'filesystem',
  'network',
  'process',
  'ipc',
  'devices',
  'secrets',
  'resources',
  'lifetime',
  'tenant',
] as const

/** One of {@link WORLD_SPEC_DIMENSIONS}. */
export type WorldSpecDimension = typeof WORLD_SPEC_DIMENSIONS[number]

/** What the world may read and write, and where its writable root is. */
export interface WorldFilesystemSpec {
  /** Closed effect class; `none` is a world that cannot touch a filesystem at all. */
  readonly effect: 'none' | 'read-only' | 'workspace-write' | 'full-access'
  /** Absolute path the `workspace-write` effect is confined to; absent for the other effects. */
  readonly workspaceRoot?: string
}

/** What the world may reach over the network. */
export interface WorldNetworkSpec {
  /** Closed posture; `none` denies every egress, `allowlist` denies everything not named. */
  readonly posture: 'none' | 'allowlist' | 'unrestricted'
  /** Hosts the `allowlist` posture admits; empty under `allowlist` is a world with no egress. */
  readonly allowedHosts?: readonly string[]
}

/** Whether the world may start processes, and how deep. */
export interface WorldProcessSpec {
  readonly spawn: boolean
  /** Maximum live descendants; absent means the provider's own ceiling applies. */
  readonly maxProcesses?: number
}

/** Which inter-process channels cross the world boundary. */
export interface WorldIpcSpec {
  /** Closed posture; `none` is a world with no channel out other than its own result. */
  readonly posture: 'none' | 'parent-only' | 'unrestricted'
}

/** Which host devices the world may open. */
export interface WorldDevicesSpec {
  /** Device paths the world may open; empty is the default and denies all. */
  readonly allowed: readonly string[]
}

/** How secrets reach the world, if at all. */
export interface WorldSecretsSpec {
  /**
   * Closed posture. `broker-only` means the world receives no secret material
   * directly and must ask the Trust Kernel's secret broker, which is the one
   * posture that keeps a secret out of a snapshot.
   */
  readonly posture: 'none' | 'broker-only' | 'inherited'
}

/** The world's resource ceilings. */
export interface WorldResourcesSpec {
  readonly cpuMillicores?: number
  readonly memoryBytes?: number
  readonly diskBytes?: number
}

/** How long the world may live, and what ends it. */
export interface WorldLifetimeSpec {
  /** Wall-clock ceiling; the world is terminated with `reason: 'timeout'` when it passes. */
  readonly maxWallClockMs?: number
  /** Whether the world survives the session that created it. */
  readonly detached: boolean
}

/**
 * What a caller asks for, in the nine dimensions must[1] names.
 *
 * Every dimension is required, and that is the decision rather than an
 * inconvenience: an absent dimension is a question the provider would answer
 * from its own defaults, and a policy comparing two worlds could not tell a
 * deliberate `none` from an unstated one.
 */
export interface WorldSpec {
  readonly filesystem: WorldFilesystemSpec
  readonly network: WorldNetworkSpec
  readonly process: WorldProcessSpec
  readonly ipc: WorldIpcSpec
  readonly devices: WorldDevicesSpec
  readonly secrets: WorldSecretsSpec
  readonly resources: WorldResourcesSpec
  readonly lifetime: WorldLifetimeSpec
  /** The tenant the world belongs to; a world never spans two. */
  readonly tenant: TenantId
}

/**
 * An unforgeable reference to one live world (acceptance[2]).
 *
 * The brand is a module-private `unique symbol`, so no object literal a model
 * emitted or a third-party plugin built can inhabit this type, and no cast from
 * JSON produces one. The handle carries no authority of its own: what it proves
 * is that the world was minted by the provider that issued it, and every
 * operation takes the handle so a forged object reaches nothing. The same shape
 * the Trust Kernel uses for its own handles, for the same reason.
 */
export interface WorldHandle {
  readonly [EXECUTION_WORLD_HANDLE]: true
  readonly id: WorldId
  readonly provider: WorldProviderId
  /** Digest of the spec this world was created from; what a policy compares. */
  readonly spec: WorldSpecDigest
}

/**
 * The OCI runtime-spec lifecycle states, adapted (`standards-ownership.json`:
 * P3-01 owns `OCI runtime-spec lifecycle/state`).
 *
 * Adopted rather than invented because the ordering is the part providers must
 * agree on, and a container or microVM provider will already report these. Only
 * the four states are taken; the OCI `paused` state is deliberately absent,
 * since nothing in this harness suspends a world and a state no provider can
 * enter would be a vocabulary entry that cannot be tested.
 */
export const WORLD_STATES = ['creating', 'created', 'running', 'stopped'] as const

/** One of {@link WORLD_STATES}. */
export type WorldState = typeof WORLD_STATES[number]

/** Why a world reached `stopped`, as a closed set (validation[3]). */
export type WorldStopReason =
  | 'completed'
  | 'terminated'
  | 'timeout'
  | 'lost-contact'
  | 'provider-failed'

/**
 * What a caller gets when a world stops, whatever stopped it.
 *
 * One shape for all five reasons, which is validation[3]'s requirement: a
 * killed world, an expired one and an unreachable one must be distinguishable
 * by `reason` and identical in shape, so a caller cannot handle one and fall
 * through on another.
 */
export interface WorldOutcome {
  readonly world: WorldId
  readonly reason: WorldStopReason
  /** Exit status when the world ran something to completion; absent otherwise. */
  readonly exitCode?: number
  /** Provider-supplied detail for the audit; never model-visible. */
  readonly detail?: string
}

/**
 * Evidence about what a world actually is, for a policy that must decide
 * whether to trust it.
 *
 * Verification is the Trust Kernel's, not this seam's: the kernel already
 * publishes `sandboxAttestationVerifier`, so a second verifier here would be a
 * second root of trust. This type is what gets handed to it.
 */
export interface WorldAttestation {
  readonly world: WorldId
  readonly provider: WorldProviderId
  /** Opaque provider evidence; the kernel's verifier is the only reader that may trust it. */
  readonly evidence: unknown
}

/**
 * A restorable point in one world's life.
 *
 * `spec` is carried so a restore can refuse a snapshot taken under different
 * confinement rather than silently widening them — restoring a
 * `full-access` snapshot into a `read-only` request is the failure this field
 * exists to make detectable.
 */
export interface WorldSnapshot {
  readonly world: WorldId
  readonly provider: WorldProviderId
  readonly spec: WorldSpecDigest
  readonly state: WorldState
  readonly takenAtMs: number
}

/**
 * What a provider must implement to be an ExecutionWorld (must[0]).
 *
 * `execute` is absent on purpose. A world does not run commands — it is the
 * confinement a command runs inside, and the harness already has the seams that
 * run things (`ctx.shell`, `ctx.subprocess`, `ctx.fs`). Giving this interface an
 * `execute` would create a second dispatch path for every tool, which is the
 * opposite of acceptance[0]'s requirement that ONE `ToolExecution` survive a
 * provider swap unchanged.
 */
export interface WorldProvider {
  readonly id: WorldProviderId
  /**
   * Whether this provider can satisfy `spec`, and if not, which dimensions it
   * cannot meet — the input to a fail-closed selection (acceptance[1]).
   * @param spec - the requested world.
   * @returns an empty list when the provider satisfies every dimension.
   */
  unsatisfiableDimensions(spec: WorldSpec): readonly WorldSpecDimension[]
  /**
   * Create a world for `spec` and return its unforgeable handle.
   * @param spec - the requested world.
   * @returns the handle, once the world reaches `created`.
   */
  create(spec: WorldSpec): Promise<WorldHandle>
  /**
   * Stop a world and settle its outcome.
   * @param handle - the world to stop.
   * @returns the outcome, with `reason: 'terminated'` for a caller-requested stop.
   */
  terminate(handle: WorldHandle): Promise<WorldOutcome>
  /**
   * Capture a restorable point.
   * @param handle - the world to snapshot.
   * @returns the snapshot.
   */
  snapshot(handle: WorldHandle): Promise<WorldSnapshot>
  /**
   * Recreate a world from a snapshot.
   * @param snapshot - the point to restore.
   * @returns the new world's handle; never the original handle, because the original world is gone.
   */
  restore(snapshot: WorldSnapshot): Promise<WorldHandle>
  /**
   * Produce evidence about a live world for the kernel's verifier.
   * @param handle - the world to attest.
   * @returns the attestation.
   */
  attest(handle: WorldHandle): Promise<WorldAttestation>
}

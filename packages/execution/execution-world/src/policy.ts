/**
 * The allow layer over {@link WorldSpec}'s dimensions (Epic P3-02).
 *
 * **A policy is not a spec, and the difference is the whole point of this
 * module.** A `WorldSpec` is a REQUEST — what confinement this run asks for. A
 * `*Policy` is a RULE — which requests a deployment permits at all. They carry
 * different information and neither substitutes for the other: a spec names one
 * posture, a policy names the closed set of postures that may be asked for.
 * {@link satisfiesPolicySet} is the one place the two meet, answering *may this
 * requested spec be granted under these rules*.
 *
 * They live in this package rather than in `dsh-sandbox`, where Epic P3-02's
 * registry entry places them, because a policy must reference the dimension
 * types P3-01 declares here and `execution-world` already imports
 * `dsh-sandbox` — the other direction would close a cycle. The clause ownership
 * is unchanged: these types are P3-02's, recorded through
 * `adjudication.json`'s `deliverablePathPatches`.
 *
 * Each policy REFERENCES its dimension's field type rather than restating it,
 * so a posture added to `WorldNetworkSpec` cannot leave a second copy behind
 * here saying something older.
 * @module @deepseek-ai/dsh-execution-world/policy
 */

import type {
  WorldDevicesSpec,
  WorldFilesystemSpec,
  WorldIpcSpec,
  WorldNetworkSpec,
  WorldProcessSpec,
  WorldResourcesSpec,
  WorldSecretsSpec,
  WorldSpecDimension,
} from './types.ts'

/**
 * Filesystem rights, named as the Landlock kernel UAPI names them.
 *
 * The UAPI spelling is the stable ABI and is what an operator reading a kernel
 * manual will search for. This repository's own transcription abbreviates:
 * `native/landlock-run/packages/entry/src/main.c:71-86` defines the same
 * sixteen bits as `LL_FS_EXECUTE` … `LL_FS_IOCTL_DEV`, a clean prefix
 * substitution, with the ABI that introduced each. Both spellings are recorded
 * so that grepping either one finds this vocabulary; pinning only the UAPI name
 * would leave a reader searching this tree, finding nothing, and concluding no
 * transcription exists.
 *
 * That C file is a RECORD of what was transcribed, not an independent oracle:
 * it is hand-copied, and macOS carries no `linux/landlock.h` to compare against.
 */
export const LANDLOCK_FS_RIGHTS = [
  'LANDLOCK_ACCESS_FS_EXECUTE',
  'LANDLOCK_ACCESS_FS_WRITE_FILE',
  'LANDLOCK_ACCESS_FS_READ_FILE',
  'LANDLOCK_ACCESS_FS_READ_DIR',
  'LANDLOCK_ACCESS_FS_REMOVE_DIR',
  'LANDLOCK_ACCESS_FS_REMOVE_FILE',
  'LANDLOCK_ACCESS_FS_MAKE_CHAR',
  'LANDLOCK_ACCESS_FS_MAKE_DIR',
  'LANDLOCK_ACCESS_FS_MAKE_REG',
  'LANDLOCK_ACCESS_FS_MAKE_SOCK',
  'LANDLOCK_ACCESS_FS_MAKE_FIFO',
  'LANDLOCK_ACCESS_FS_MAKE_BLOCK',
  'LANDLOCK_ACCESS_FS_MAKE_SYM',
  'LANDLOCK_ACCESS_FS_REFER',
  'LANDLOCK_ACCESS_FS_TRUNCATE',
  'LANDLOCK_ACCESS_FS_IOCTL_DEV',
] as const

/** One Landlock filesystem right, by its kernel UAPI name. */
export type LandlockFsRight = typeof LANDLOCK_FS_RIGHTS[number]

/**
 * The in-tree abbreviation for one UAPI right.
 *
 * `LANDLOCK_ACCESS_FS_EXECUTE` is written `LL_FS_EXECUTE` in the transcription.
 * Exported so the correspondence is testable rather than asserted in prose.
 * @param right - the kernel UAPI name.
 * @returns the abbreviated name used by this repository's transcription.
 */
export function transcribedLandlockName(right: LandlockFsRight): string {
  return right.replace('LANDLOCK_ACCESS_FS_', 'LL_FS_')
}

/** What filesystem requests are permitted, and which rights may be asked for. */
export interface FileSystemPolicy {
  readonly allowedEffects: readonly WorldFilesystemSpec['effect'][]
  readonly allowedRights: readonly LandlockFsRight[]
}

/** What network postures are permitted. */
export interface NetworkPolicy {
  readonly allowedPostures: readonly WorldNetworkSpec['posture'][]
}

/** Whether spawning is permitted, and the largest process ceiling that may be asked for. */
export interface ProcessPolicy {
  readonly allowSpawn: boolean
  readonly maxProcessesCeiling?: WorldProcessSpec['maxProcesses']
}

/** What IPC postures are permitted. */
export interface IpcPolicy {
  readonly allowedPostures: readonly WorldIpcSpec['posture'][]
}

/** Which device paths may be asked for; a closed allowlist, never a pattern. */
export interface DevicePolicy {
  readonly allowedDevices: readonly WorldDevicesSpec['allowed'][number][]
}

/** What secret postures are permitted. */
export interface SecretPolicy {
  readonly allowedPostures: readonly WorldSecretsSpec['posture'][]
}

/** The largest resource ceilings that may be asked for; absent means the dimension may not be constrained. */
export interface ResourcePolicy {
  readonly cpuMillicoresCeiling?: WorldResourcesSpec['cpuMillicores']
  readonly memoryBytesCeiling?: WorldResourcesSpec['memoryBytes']
  readonly diskBytesCeiling?: WorldResourcesSpec['diskBytes']
}

/**
 * A deployment's rules over every dimension it governs.
 *
 * Partial BY DESIGN, and that is what must[2] turns on: a dimension with no
 * entry is not "unconstrained", it is UNKNOWN, and an unknown capability is
 * denied. Making the record total would remove the very state the rule is
 * about.
 */
export interface PolicySet {
  readonly filesystem?: FileSystemPolicy
  readonly network?: NetworkPolicy
  readonly process?: ProcessPolicy
  readonly ipc?: IpcPolicy
  readonly devices?: DevicePolicy
  readonly secrets?: SecretPolicy
  readonly resources?: ResourcePolicy
}

/**
 * What one provider claims it can actually enforce (must[3]).
 *
 * A provider declares a dimension here only if it can deliver EVERY value the
 * policy permits for it. Claiming a dimension it can only partly enforce is the
 * impersonation {@link satisfiesPolicySet} exists to refuse.
 */
export interface SupportedPolicyFeatures {
  readonly dimensions: readonly WorldSpecDimension[]
}

/** Why a request was refused, as a closed list a caller switches on. */
export type PolicyRefusal =
  /** No rule covers this dimension; unknown is denied (must[2]). */
  | { readonly kind: 'unknown-dimension'; readonly dimension: WorldSpecDimension }
  /** The rule exists and does not permit the requested value (must[1]). */
  | { readonly kind: 'not-allowed'; readonly dimension: WorldSpecDimension; readonly requested: string }
  /** The request exceeds a ceiling the rule sets. */
  | { readonly kind: 'exceeds-ceiling'; readonly dimension: WorldSpecDimension; readonly requested: number; readonly ceiling: number }
  /** The provider does not claim this dimension, so granting would be weak posing as strong (must[3]). */
  | { readonly kind: 'unsupported-by-provider'; readonly dimension: WorldSpecDimension }

/** The answer to "may this spec be granted here", as a discriminated union. */
export type PolicyDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusals: readonly PolicyRefusal[] }

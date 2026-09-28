/**
 * Types for `verify-declared-files-exist.mjs`: declared paths that the tree does not hold.
 */

import type { ApprovedAddition, DeliverablePathPatch, OverlayEpic } from './files-overlay.d.mts'

/** One `command-freeze.json` entry, as this gate reads it. */
export interface DeclaredFilesFreezeEntry {
  readonly epic: string
  readonly stage: string
  readonly files?: readonly string[]
  /** Absent on a base entry; present on each supplement, and part of its address. */
  readonly supplementSeq?: number
  /** Present once a later entry replaces this one, which takes it out of the check. */
  readonly supersededBy?: string
  /** The frozen command; its arguments after `run` name the tests it runs. */
  readonly argv?: readonly string[]
  /** When the entry was frozen; part of an exception's address. */
  readonly frozenAtUtc?: string
}

export function missingFreezeFiles(
  entries: readonly DeclaredFilesFreezeEntry[],
  exists: (path: string) => boolean,
  basenameIndex: ReadonlyMap<string, readonly string[]>,
): { label: string; path: string; sameNameElsewhere: readonly string[] }[]

/** One live freeze entry whose argv runs a test its `files` do not name. */
export interface ArgvFilesViolation {
  /** The entry's position in `command-freeze.json`. */
  readonly index: number
  readonly label: string
  /** Each uncovered argument, with what is unlisted below a directory argument. */
  readonly uncovered: readonly string[]
}

export function argvPathsOutsideFiles(
  entries: readonly DeclaredFilesFreezeEntry[],
  trackedPaths: readonly string[],
): ArgvFilesViolation[]

/** One row of `freeze-argv-files-exceptions.json`. */
export interface ArgvFilesException {
  /** The excepted entry's position in `command-freeze.json`. */
  readonly index: number
  readonly epic: string
  readonly stage: string
  readonly frozenAtUtc: string
  /** The last day, `YYYY-MM-DD` in UTC, the exception holds. */
  readonly expiresOn: string
  readonly reason: string
}

export function judgeArgvExceptions(
  violations: readonly ArgvFilesViolation[],
  table: { readonly exceptions: readonly ArgvFilesException[] },
  entries: readonly DeclaredFilesFreezeEntry[],
  rowStatus: (epic: string) => string | undefined,
  today: string,
): { unexcused: ArgvFilesViolation[]; invalid: { index: number; reason: string }[] }

export function missingAcceptedRegistryRefs(
  registry: { readonly epics: readonly OverlayEpic[] },
  acceptedIds: ReadonlySet<string>,
  exists: (path: string) => boolean,
  patches: readonly DeliverablePathPatch[],
  neverDeliveredPairSet?: ReadonlySet<string>,
  additions?: readonly ApprovedAddition[],
): {
  declaredMissing: { where: string; path: string }[]
  neverDelivered: { where: string; path: string }[]
  /** One per approved addition whose path is absent and whose `expectedAt` makes that a debt. */
  additionsMissing: { where: string; path: string; expectedAt: string | undefined }[]
  resolvedMissing: { where: string; path: string; absentApprovedPaths: string[] }[]
}

/** One `never-delivered.json` entry, as this gate reads it. */
export interface NeverDeliveredEntry {
  readonly epic: string
  readonly path: string
  readonly reason: string
  readonly rulingRef: string
}

export function neverDeliveredPairs(
  document: { readonly entries: readonly NeverDeliveredEntry[] } | undefined,
  declaredPaths: ReadonlySet<string>,
  exists: (path: string) => boolean,
): Set<string>

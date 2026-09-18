/**
 * Types for `verify-declared-files-exist.mjs`: declared paths that the tree does not hold.
 */

import type { DeliverablePathPatch, OverlayEpic } from './files-overlay.d.mts'

/** One `command-freeze.json` entry, as this gate reads it. */
export interface DeclaredFilesFreezeEntry {
  readonly epic: string
  readonly stage: string
  readonly files?: readonly string[]
  /** Absent on a base entry; present on each supplement, and part of its address. */
  readonly supplementSeq?: number
  /** Present once a later entry replaces this one, which takes it out of the check. */
  readonly supersededBy?: string
}

export function missingFreezeFiles(
  entries: readonly DeclaredFilesFreezeEntry[],
  exists: (path: string) => boolean,
  basenameIndex: ReadonlyMap<string, readonly string[]>,
): { label: string; path: string; sameNameElsewhere: readonly string[] }[]

export function missingAcceptedRegistryRefs(
  registry: { readonly epics: readonly OverlayEpic[] },
  acceptedIds: ReadonlySet<string>,
  exists: (path: string) => boolean,
  patches: readonly DeliverablePathPatch[],
  neverDeliveredPairSet?: ReadonlySet<string>,
): {
  declaredMissing: { where: string; path: string }[]
  neverDelivered: { where: string; path: string }[]
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

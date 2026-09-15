/**
 * Types for `verify-files-overlay.mjs`: §12.4's two refusals.
 */

import type { DeliverablePathPatch, OverlayEntry, OverlayEpic, OverlayFreezeEntry } from './files-overlay.d.mts'

export function unaccountedCitations(
  registry: { epics: readonly OverlayEpic[] },
  freeze: readonly OverlayFreezeEntry[],
  overlay: readonly OverlayEntry[],
  patches: readonly DeliverablePathPatch[],
): { epic: string; stage: string; path: string }[]

export function sourceEntriesWithoutReason(overlay: readonly OverlayEntry[]): OverlayEntry[]

export function hotZoneEntriesWithoutCitation(overlay: readonly OverlayEntry[]): OverlayEntry[]

export function unusedReasonKeys(overlay: readonly OverlayEntry[], reasons: Readonly<Record<string, string>>): string[]

export function overlayFileText(overlay: readonly OverlayEntry[]): string

/** A committed `files-overlay.json` against the computed overlay; drift keys read `"<epic> <path>"` and are sorted. */
export type CommittedOverlayComparison =
  | { status: 'match' }
  | { status: 'uncomparable'; reason: string }
  | { status: 'drift'; onlyCommitted: string[]; onlyComputed: string[] }

export function compareCommittedOverlay(committedText: string | undefined, overlay: readonly OverlayEntry[]): CommittedOverlayComparison

export function exitCodeFor(failures: readonly string[], comparison: CommittedOverlayComparison): 0 | 1 | 2

/**
 * Types for `verify-files-overlay.mjs`: §12.4's two refusals.
 */

import type { OverlayEntry, OverlayEpic, OverlayFreezeEntry } from './files-overlay.d.mts'

export function unaccountedCitations(
  registry: { epics: readonly OverlayEpic[] },
  freeze: readonly OverlayFreezeEntry[],
  overlay: readonly OverlayEntry[],
): { epic: string; stage: string; path: string }[]

export function sourceEntriesWithoutReason(overlay: readonly OverlayEntry[]): OverlayEntry[]

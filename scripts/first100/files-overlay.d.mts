/**
 * Types for `files-overlay.mjs`: the append-only record of the files an epic
 * really touched (§12.4).
 */

export type OverlayKind = 'test' | 'fixture' | 'doc' | 'manifest' | 'scaffold' | 'source'

export interface OverlayEntry {
  epic: string
  path: string
  kind: OverlayKind
  stages: string[]
  reason?: string
}

export interface OverlayEpic {
  id: string
  files?: readonly { path: string }[]
  stages?: Readonly<Record<string, { files?: readonly string[] } | undefined>>
}

export interface OverlayFreezeEntry {
  epic: string
  stage: string
  supplementSeq?: number
  files?: readonly string[]
  supersededBy?: unknown
}

export const OVERLAY_KINDS: readonly OverlayKind[]

export function classifyOverlayPath(path: string): OverlayKind

/** One approved deliverable-path patch from `adjudication.json`, with its epic resolved. */
export interface DeliverablePathPatch {
  readonly epic: string
  readonly stage: string
  readonly declaredPath: string
  readonly approvedPath: string
}

/** One registry declaration and the paths approved patches substitute for it. */
export interface ResolvedDeclaration {
  where: string
  declaredPath: string
  approvedPaths: string[]
}

export function patchEntries(adjudication: { deliverablePathPatches?: { entries?: Readonly<Record<string, Omit<DeliverablePathPatch, 'epic'> & { epic?: string }>> } }): DeliverablePathPatch[]

export function resolveDeclaredPaths(epic: OverlayEpic, patches: readonly DeliverablePathPatch[]): ResolvedDeclaration[]

export function declaredPaths(epic: OverlayEpic, patches: readonly DeliverablePathPatch[]): Set<string>

export function declaredPathsAsExtracted(epic: OverlayEpic): Set<string>

export function computeOverlay(
  registry: { epics: readonly OverlayEpic[] },
  freeze: readonly OverlayFreezeEntry[],
  reasons: Readonly<Record<string, string>>,
  patches: readonly DeliverablePathPatch[],
): OverlayEntry[]

export function loadOverlayInputs(): {
  registry: { epics: OverlayEpic[] }
  freeze: OverlayFreezeEntry[]
  reasons: Record<string, string>
  patches: DeliverablePathPatch[]
}

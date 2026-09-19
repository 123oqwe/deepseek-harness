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
  /** `substitution`: the approved path replaces the declared one. `widening`: the declared path stays a deliverable and the approved path is added. */
  readonly kind: 'widening' | 'substitution'
  /** Present on a retired patch, saying what replaced it; `patchEntries` leaves such a patch out. */
  readonly supersededBy?: string
}

/** One approved addition from `adjudication.json`: a file a stage must change that no registry row declares. */
export interface ApprovedAddition {
  readonly epic: string
  /** `C`, `P`, `U` or `F`, optionally with a supplement sequence such as `U.1`. */
  readonly stage: string
  readonly path: string
  readonly reason: string
  /** The epics that declare the path today, recorded before the ruling; empty when none do. */
  readonly declaredBy: readonly string[]
  /** What the files overlay says about it today, recorded the same way. */
  readonly overlay: string
  /** `tree` when the path exists today, `stage` when this stage creates it. */
  readonly expectedAt: 'tree' | 'stage'
  /** The ruling that approved the addition; an entry without one is refused. */
  readonly rulingRef: string
  /**
   * Present on a retired addition, naming the entry of this block that took the
   * file over; `additionEntries` leaves such an addition out and refuses a key
   * no entry has, or the entry's own.
   *
   * Unlike {@link DeliverablePathPatch.supersededBy}, which carries reason
   * prose: a patch describes what happened to a declared path, so prose is the
   * whole record, while an addition records a file nobody declared and its
   * retirement has to say who builds it now.
   */
  readonly supersededBy?: string
}

/** One registry declaration and the paths approved patches substitute for it. */
export interface ResolvedDeclaration {
  where: string
  declaredPath: string
  approvedPaths: string[]
  /** True when any applicable patch is a widening, so the declared path is still a deliverable. */
  widening: boolean
  /** True on a record that comes from an approved addition rather than from the registry. */
  addition?: boolean
}

export function patchEntries(adjudication: { deliverablePathPatches?: { entries?: Readonly<Record<string, Omit<DeliverablePathPatch, 'epic'> & { epic?: string }>> } }): DeliverablePathPatch[]

export function additionEntries(adjudication: { approvedAdditions?: { entries?: Readonly<Record<string, Omit<ApprovedAddition, 'epic'> & { epic?: string }>> } }): ApprovedAddition[]

export function resolveDeclaredPaths(epic: OverlayEpic, patches: readonly DeliverablePathPatch[], additions?: readonly ApprovedAddition[]): ResolvedDeclaration[]

export function declaredPaths(epic: OverlayEpic, patches: readonly DeliverablePathPatch[], additions?: readonly ApprovedAddition[]): Set<string>

export function declaredPathsAsExtracted(epic: OverlayEpic): Set<string>

export function computeOverlay(
  registry: { epics: readonly OverlayEpic[] },
  freeze: readonly OverlayFreezeEntry[],
  reasons: Readonly<Record<string, string>>,
  patches: readonly DeliverablePathPatch[],
  additions?: readonly ApprovedAddition[],
): OverlayEntry[]

export function loadOverlayInputs(): {
  registry: { epics: OverlayEpic[] }
  freeze: OverlayFreezeEntry[]
  reasons: Record<string, string>
  patches: DeliverablePathPatch[]
  additions: ApprovedAddition[]
}

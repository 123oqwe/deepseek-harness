/**
 * Types for `epic-reality-set.mjs`: which files an epic actually touched, and
 * whether a failure's subject is one of them.
 */

import type { ApprovedAddition, DeliverablePathPatch } from './files-overlay.d.mts'

export interface RealitySetEpic {
  id: string
  files?: readonly { path: string }[]
  stages?: Readonly<Record<string, { files?: readonly string[] } | undefined>>
}

export interface RealitySetFreezeEntry {
  epic: string
  files?: readonly string[]
  supersededBy?: unknown
}

export function realitySet(
  epic: RealitySetEpic,
  freeze: readonly RealitySetFreezeEntry[],
  patches: readonly DeliverablePathPatch[],
  additions?: readonly ApprovedAddition[],
): string[]

export function realitySetOverlap(
  epicPaths: readonly string[],
  subjectPaths: readonly string[],
): { subject: string; declared: string }[]

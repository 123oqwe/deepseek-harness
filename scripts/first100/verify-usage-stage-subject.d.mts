/**
 * Types for `verify-usage-stage-subject.mjs`: gate (u).
 */

export interface UsageSubjectEpic {
  id: string
  files?: readonly { path: string; kind?: string }[]
  stages?: Readonly<Record<string, { files?: readonly string[] } | undefined>>
}

export interface UsageSubjectFreezeEntry {
  epic: string
  stage: string
  supplementSeq?: number
  files?: readonly string[]
  supersededBy?: unknown
}

export interface UsageSubjectFinding {
  /** The EPIC the finding is about; the gate is asked per epic since §12.24-3. */
  key: string
  subjects: string[]
  files: readonly string[]
  /** Every live U entry behind this finding, so a reader sees which observations it covers. */
  entries: readonly string[]
}

export function usageBaselineFiles(epic: UsageSubjectEpic): string[]

export function usageEntriesWithoutSubject(
  registry: { epics: readonly UsageSubjectEpic[] },
  freeze: readonly UsageSubjectFreezeEntry[],
  exemptions: Readonly<Record<string, { blocked?: unknown; ruling?: unknown }>>,
): UsageSubjectFinding[]

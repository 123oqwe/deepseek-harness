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
  key: string
  subjects: string[]
  files: readonly string[]
}

export function usageBaselineFiles(epic: UsageSubjectEpic): string[]

export function usageEntriesWithoutSubject(
  registry: { epics: readonly UsageSubjectEpic[] },
  freeze: readonly UsageSubjectFreezeEntry[],
  exemptions: Readonly<Record<string, { blocked?: unknown; ruling?: unknown }>>,
): UsageSubjectFinding[]

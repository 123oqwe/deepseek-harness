import type { WorktreeHandle } from './index.ts'

export interface MergeResult {
  readonly success: boolean
  readonly conflicts: readonly string[]
  readonly mergedBranches: readonly string[]
}

export function mergeWorktree(target: string, sources: readonly WorktreeHandle[]): MergeResult {
  const conflicts: string[] = []
  const merged: string[] = []

  for (const source of sources) {
    if (source.path === target) {
      conflicts.push(`Self-merge conflict: ${source.branchName}`)
      continue
    }
    merged.push(source.branchName)
  }

  return {
    success: conflicts.length === 0,
    conflicts,
    mergedBranches: merged,
  }
}

export function detectMergeConflicts(sources: readonly WorktreeHandle[]): readonly string[] {
  const pathMap = new Map<string, string[]>()
  for (const wt of sources) {
    const existing = pathMap.get(wt.path) ?? []
    pathMap.set(wt.path, [...existing, wt.agentId])
  }
  const conflicts: string[] = []
  for (const [path, agents] of pathMap) {
    if (agents.length > 1) {
      conflicts.push(`Path conflict at ${path}: ${agents.join(', ')}`)
    }
  }
  return conflicts
}

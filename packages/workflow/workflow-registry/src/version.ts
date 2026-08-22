/**
 * Workflow version resolution and compatibility checking.
 * @module @deepseek-ai/dsh-workflow-registry/version
 */

import type { WorkflowVersion, WorkflowDefinition, WorkflowDefinitionRef } from './types.ts'

/** Compare two versions. Returns -1, 0, or 1. */
export function compareVersions(a: WorkflowVersion, b: WorkflowVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

/** Check if a ref is compatible with a definition (same major version). */
export function isCompatible(ref: WorkflowDefinitionRef, def: WorkflowDefinition): boolean {
  const refParts = ref.version.split('.').map(Number)
  return refParts[0] === def.version.major
}

/** Resolve the best matching version for a ref from a list of definitions. */
export function resolveVersion(
  ref: WorkflowDefinitionRef,
  definitions: WorkflowDefinition[],
): { definition?: WorkflowDefinition; reason: string } {
  const matches = definitions.filter(d => d.id === ref.definitionId)
  if (matches.length === 0) {
    return { reason: `No definition found for id ${ref.definitionId}` }
  }

  // Check digest match first (exact pin)
  const byDigest = matches.find(d => d.digest === ref.digest)
  if (byDigest) {
    return { definition: byDigest, reason: 'matched by digest' }
  }

  // Try version match
  const refParts = ref.version.split('.').map(Number)
  const compatible = matches.filter(d => d.version.major === refParts[0])
  if (compatible.length === 0) {
    return { reason: `No compatible version for ${ref.version} (major mismatch)` }
  }

  // Return highest compatible minor+patch
  compatible.sort((a, b) => -compareVersions(a.version, b.version))
  const resolved = compatible[0]
  if (resolved === undefined) {
    return { reason: 'No compatible version found' }
  }
  return { definition: resolved, reason: `resolved to ${resolved.version.toString()}` }
}

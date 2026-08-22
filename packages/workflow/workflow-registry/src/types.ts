/**
 * Workflow Registry: detached, saved, versioned, and nested workflow definitions.
 * @module @deepseek-ai/dsh-workflow-registry/types
 */

import { createHash } from 'node:crypto'

/** Identifies a registered workflow definition. */
export type WorkflowDefinitionId = string

/** Version of a workflow definition. */
export interface WorkflowVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  toString(): string
}

export function WorkflowVersion(major: number, minor: number, patch: number): WorkflowVersion {
  return {
    major,
    minor,
    patch,
    toString: () => `${major}.${minor}.${patch}`,
  }
}

/** A registered, signed workflow definition artifact. */
export interface WorkflowDefinition {
  readonly id: WorkflowDefinitionId
  readonly version: WorkflowVersion
  readonly scriptDigest: string
  readonly meta: {
    readonly name: string
    readonly description: string
    readonly whenToUse: string
  }
  readonly maxRecursionDepth: number
  readonly defaultBudget: {
    readonly tokens: number
    readonly cost: number
    readonly time: number
    readonly agents: number
  }
  readonly failureStrategy: 'propagate' | 'isolate' | 'retry-once'
  readonly digest: string
}

/** A reference to a workflow definition by digest. */
export interface WorkflowDefinitionRef {
  readonly definitionId: WorkflowDefinitionId
  readonly version: string
  readonly digest: string
}

/** A nested workflow call within a parent workflow. */
export interface NestedWorkflowCall {
  readonly parentRunId: string
  readonly childDefinitionRef: WorkflowDefinitionRef
  readonly depth: number
  readonly attenuatedBudget: WorkflowDefinition['defaultBudget']
  readonly capabilityTokenDigest: string
  readonly traceId: string
}

/** Result of registering a workflow definition. */
export interface RegistrationResult {
  readonly definitionId: WorkflowDefinitionId
  readonly version: string
  readonly digest: string
  readonly status: 'registered' | 'already-exists' | 'rejected'
  readonly reason?: string
}

/** Compute the canonical digest of a workflow definition. */
export function computeDigest(def: Omit<WorkflowDefinition, 'digest'>): string {
  const content = JSON.stringify(def, Object.keys(def).sort())
  return createHash('sha256').update(content).digest('hex')
}

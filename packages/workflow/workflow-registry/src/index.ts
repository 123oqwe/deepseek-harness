/**
 * Workflow Registry: register, version, and resolve detached/saved/nested workflows.
 * @module @deepseek-ai/dsh-workflow-registry
 */


import type {
  WorkflowDefinition,
  WorkflowDefinitionRef,
  WorkflowDefinitionId,
  RegistrationResult,
  NestedWorkflowCall,
} from './types.ts'
import { computeDigest } from './types.ts'
import { resolveVersion } from './version.ts'

export type { WorkflowDefinition, WorkflowDefinitionRef, WorkflowDefinitionId, RegistrationResult, NestedWorkflowCall, WorkflowVersion } from './types.ts'
export { computeDigest } from './types.ts'
export { compareVersions, isCompatible, resolveVersion } from './version.ts'

const MAX_RECURSION_DEPTH = 10
const MAX_TOTAL_AGENTS = 100
const MAX_TOTAL_BUDGET_TOKENS = 10_000_000

export class WorkflowRegistry {
  private readonly definitions = new Map<string, WorkflowDefinition[]>()
  private readonly runBindings = new Map<string, WorkflowDefinitionRef>()
  private readonly activeNested = new Map<string, NestedWorkflowCall[]>()

  /** Register a workflow definition. */
  register(input: Omit<WorkflowDefinition, 'digest'>): RegistrationResult {
    const digest = computeDigest(input)
    const def: WorkflowDefinition = { ...input, digest }

    // Check for existing definition with same digest
    const existing = this.definitions.get(def.id)
    if (existing) {
      const alreadyExists = existing.some(d => d.digest === digest)
      if (alreadyExists) {
        return { definitionId: def.id, version: def.version.toString(), digest, status: 'already-exists' }
      }
    }

    // Validate recursion and budget limits
    if (def.maxRecursionDepth > MAX_RECURSION_DEPTH) {
      return { definitionId: def.id, version: def.version.toString(), digest, status: 'rejected', reason: `maxRecursionDepth ${def.maxRecursionDepth} exceeds limit ${MAX_RECURSION_DEPTH}` }
    }
    if (def.defaultBudget.agents > MAX_TOTAL_AGENTS) {
      return { definitionId: def.id, version: def.version.toString(), digest, status: 'rejected', reason: `agents ${def.defaultBudget.agents} exceeds limit ${MAX_TOTAL_AGENTS}` }
    }
    if (def.defaultBudget.tokens > MAX_TOTAL_BUDGET_TOKENS) {
      return { definitionId: def.id, version: def.version.toString(), digest, status: 'rejected', reason: `tokens ${def.defaultBudget.tokens} exceeds limit ${MAX_TOTAL_BUDGET_TOKENS}` }
    }

    // Add to registry
    const list = existing ?? []
    list.push(def)
    this.definitions.set(def.id, list)

    return { definitionId: def.id, version: def.version.toString(), digest, status: 'registered' }
  }

  /** Bind a run to a specific workflow definition version. */
  bindRun(runId: string, ref: WorkflowDefinitionRef): { bound: boolean; reason: string } {
    const defs = this.definitions.get(ref.definitionId)
    if (!defs || defs.length === 0) {
      return { bound: false, reason: `Unknown definition ${ref.definitionId}` }
    }
    const { definition, reason } = resolveVersion(ref, defs)
    if (!definition) {
      return { bound: false, reason }
    }
    // Verify digest matches
    if (definition.digest !== ref.digest) {
      return { bound: false, reason: 'Digest mismatch — definition has been modified' }
    }
    this.runBindings.set(runId, ref)
    return { bound: true, reason: `bound to ${definition.version.toString()}` }
  }

  /** Register a nested workflow call with recursion and budget checks. */
  registerNestedCall(call: NestedWorkflowCall): { allowed: boolean; reason: string } {
    // Check recursion depth
    if (call.depth >= MAX_RECURSION_DEPTH) {
      return { allowed: false, reason: `Recursion depth ${call.depth} exceeds limit ${MAX_RECURSION_DEPTH}` }
    }

    // Check for circular references
    const chain = this.activeNested.get(call.parentRunId) ?? []
    const childDef = this.definitions.get(call.childDefinitionRef.definitionId)
    if (childDef) {
      const childDigest = call.childDefinitionRef.digest
      // Check if this definition is already in the call chain (circular)
      const isCircular = chain.some(c => c.childDefinitionRef.digest === childDigest)
      if (isCircular) {
        return { allowed: false, reason: 'Circular workflow reference detected' }
      }
    }

    // Check total budget across nested calls
    const totalTokens = chain.reduce((sum, c) => sum + c.attenuatedBudget.tokens, 0) + call.attenuatedBudget.tokens
    if (totalTokens > MAX_TOTAL_BUDGET_TOKENS) {
      return { allowed: false, reason: `Total nested budget ${totalTokens} exceeds limit ${MAX_TOTAL_BUDGET_TOKENS}` }
    }

    // Check total agents
    const totalAgents = chain.reduce((sum, c) => sum + c.attenuatedBudget.agents, 0) + call.attenuatedBudget.agents
    if (totalAgents > MAX_TOTAL_AGENTS) {
      return { allowed: false, reason: `Total nested agents ${totalAgents} exceeds limit ${MAX_TOTAL_AGENTS}` }
    }

    // Verify child definition exists
    if (!childDef || childDef.length === 0) {
      return { allowed: false, reason: `Unknown child definition ${call.childDefinitionRef.definitionId}` }
    }

    // Verify child digest
    const childExists = childDef.some(d => d.digest === call.childDefinitionRef.digest)
    if (!childExists) {
      return { allowed: false, reason: 'Child definition digest mismatch' }
    }

    // Verify budget attenuation (child must not exceed parent)
    const parentDef = this.runBindings.get(call.parentRunId)
    if (parentDef) {
      const parentDefs = this.definitions.get(parentDef.definitionId)
      if (parentDefs) {
        const parent = parentDefs.find(d => d.digest === parentDef.digest)
        if (parent && call.attenuatedBudget.tokens > parent.defaultBudget.tokens) {
          return { allowed: false, reason: 'Child budget exceeds parent budget (attenuation violated)' }
        }
      }
    }

    this.activeNested.set(call.parentRunId, [...chain, call])
    return { allowed: true, reason: `nested call at depth ${call.depth + 1}` }
  }

  /** Complete a nested call (remove from active chain). */
  completeNestedCall(parentRunId: string, callDigest: string): void {
    const chain = this.activeNested.get(parentRunId)
    if (chain) {
      this.activeNested.set(parentRunId, chain.filter(c => c.childDefinitionRef.digest !== callDigest))
    }
  }

  /** Cancel all nested workflows for a parent run. */
  cancelNested(parentRunId: string): { cancelled: string[]; reason: string } {
    const chain = this.activeNested.get(parentRunId) ?? []
    const cancelled = chain.map(c => c.childDefinitionRef.definitionId)
    this.activeNested.delete(parentRunId)
    return { cancelled, reason: `cancelled ${cancelled.length} nested workflows` }
  }

  /** Get a workflow definition by id and optional version. */
  getDefinition(id: WorkflowDefinitionId, version?: string): WorkflowDefinition | undefined {
    const defs = this.definitions.get(id)
    if (!defs || defs.length === 0) return undefined
    if (version) {
      return defs.find(d => d.version.toString() === version)
    }
    // Return highest version
    return defs.sort((a, b) => {
      if (a.version.major !== b.version.major) return b.version.major - a.version.major
      if (a.version.minor !== b.version.minor) return b.version.minor - a.version.minor
      return b.version.patch - a.version.patch
    })[0]
  }

  /** List all registered definition IDs. */
  listDefinitions(): WorkflowDefinitionId[] {
    return Array.from(this.definitions.keys())
  }
}

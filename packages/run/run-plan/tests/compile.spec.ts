/**
 * Contract-stage behaviour of Epic P4-03's RunPlan compile (C stage), and the
 * malformed-input cases the F stage freezes from the same file.
 *
 * Each case names the clause it observes, and the refusals come in pairs: a
 * case showing a plan REFUSED is indistinguishable from a compiler that
 * refuses everything until the case beside it shows the same plan compiled
 * once the offending value is fixed. The positive controls here are that
 * `base` compiles, and that a demand which refuses a plan as `hard` leaves it
 * standing as `soft`.
 *
 * Two properties need more than a single-member example. "Minimal" reads the
 * same on a one-member conflict set whether or not anything minimizes, so the
 * golden case carries two members that are each satisfiable alone. And a
 * report of unmet preferences is indistinguishable from one that reports
 * everything until a case shows it empty.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { BUDGET_DIMENSIONS } from '@deepseek-ai/dsh-resource-budget'
import type { BudgetDimension } from '@deepseek-ai/dsh-resource-budget'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ApprovalRef, VerificationRef } from '@deepseek-ai/dsh-run/types'
import type { TaskGoalRef, TaskProfileRef } from '@deepseek-ai/dsh-task-profile/types'
import type { WorldSpecDigest } from '@deepseek-ai/dsh-execution-world'
import {
  RUN_PLAN_SCHEMA_VERSION,
  compilePlan,
  inputProblems,
  minimalConflictSet,
  planDemands,
  planIdOf,
  satisfiable,
} from '../src/compile.ts'
import type { DeploymentFacts, PlanDemand, PlanInputs, PlanRequirement } from '../src/compile.ts'
import type { RunPlan } from '../src/types.ts'

const DIGEST = 'a'.repeat(64)
const OTHER_DIGEST = 'b'.repeat(64)

const goalRef: TaskGoalRef = { sessionId: SessionId('session-1'), messageId: MessageId('message-1') }

const provenance = { origin: 'user-stated', goalRef, confidence: 1, rationale: 'the goal said so' } as const

/** The inputs every case starts from: one node, routed, bound to a world, under one ceiling, and satisfiable. */
const base: PlanInputs = {
  objectives: [{ id: 'o1', statement: 'produce the report', goalRef }],
  constraints: [
    { id: 'c-hard', strength: 'hard', statement: 'must not leave the workspace', provenance },
    { id: 'c-soft', strength: 'soft', statement: 'prefer the cheaper model', provenance },
  ],
  nodes: [
    { id: 'n1', role: 'author', taskProfileRef: brandString<TaskProfileRef>(DIGEST), requirementId: 'req-1', worldId: 'w1', budgetIds: ['b1'] },
    { id: 'n2', role: 'reviewer', taskProfileRef: brandString<TaskProfileRef>(DIGEST), requirementId: 'req-2' },
  ],
  edges: [{ from: 'n1', to: 'n2', kind: 'dataDependency' }],
  channels: [{ id: 'ch1', from: 'n1', to: 'n2', carries: 'result', retention: 'run' }],
  modelRoutes: [{ nodeId: 'n1', selection: { provider: 'deepseek', model: 'chat' } }],
  worlds: [{ id: 'w1', spec: brandString<WorldSpecDigest>(DIGEST) }],
  budgets: [{ id: 'b1', dimension: 'memoryBytes', limit: 100 }],
  approvalGates: [{ id: 'g1', nodeId: 'n2', approvalRef: brandString<ApprovalRef>('approval-1') }],
  verification: [{
    id: 'v1',
    nodeId: 'n2',
    verificationRef: brandString<VerificationRef>('verification-1'),
    verificationContractRef: { contract: 'report-contract', version: 1 },
  }],
  recovery: { onNodeFailure: [{ nodeId: 'n1', action: 'retry', maxAttempts: 2 }], terminal: 'halt' },
  requirements: [],
  facts: {
    availableCapabilities: ['fs.read'],
    allowedPolicies: ['write-report'],
    availableModels: [{ provider: 'deepseek', model: 'chat' }],
    worldSatisfiability: { [DIGEST]: [] },
    budgetCaps: { memoryBytes: 1000, wallClockMs: 60_000, toolCalls: 50 },
  },
}

/** Build inputs from `base` with some fields replaced. */
const inputs = (fields: Partial<PlanInputs>): PlanInputs => ({ ...base, ...fields })

/** One node, for the cases that need a graph wider than the two `base` carries. */
const node = (id: string, requirementId: string): PlanInputs['nodes'][number] =>
  ({ id, role: 'worker', taskProfileRef: brandString<TaskProfileRef>(DIGEST), requirementId })

/** Build facts from `base`'s with some replaced. */
const facts = (fields: Partial<DeploymentFacts>): DeploymentFacts => ({ ...base.facts, ...fields })

/** One stated requirement, sourced from a constraint of the caller's choosing. */
const requires = (id: string, constraintId: string, capabilities: readonly string[]): PlanRequirement =>
  ({ id, kind: 'capability', capabilities, source: { kind: 'constraint', constraintId } })

/** One stated budget demand. */
const asks = (id: string, dimension: BudgetDimension, amount: number, constraintId = 'c-hard'): PlanRequirement =>
  ({ id, kind: 'budget', dimension, amount, source: { kind: 'constraint', constraintId } })

/**
 * The compiled plan, which every case reads through so that no successful
 * plan escapes its own schema.
 *
 * Validating here rather than in one case is the difference between "the
 * plan we remembered to check is valid" and "every plan this file compiles
 * is valid" (B-29 ⑧).
 */
function compiled(from: PlanInputs): RunPlan {
  const result = compilePlan(from)
  if (!result.ok) throw new Error(`expected a plan, got ${result.reason}: ${JSON.stringify(result)}`)
  const errors = schemaErrors(result.plan)
  if (errors.length > 0) throw new Error(`the compiled plan fails its own schema: ${errors.join('; ')}`)
  return result.plan
}

/** The conflicts of a refusal, or a failure naming what happened instead. */
function conflicts(from: PlanInputs): readonly { kind: string; requirementId: string }[] {
  const result = compilePlan(from)
  if (result.ok || result.reason !== 'unsatisfiable') throw new Error(`expected an unsatisfiable refusal, got ${JSON.stringify(result)}`)
  return result.conflicts
}

/** The input problems of a refusal, or a failure naming what happened instead. */
function problems(from: PlanInputs): readonly { kind: string; at: string; detail: string }[] {
  const result = compilePlan(from)
  if (result.ok || result.reason !== 'invalid-inputs') throw new Error(`expected invalid inputs, got ${JSON.stringify(result)}`)
  return result.problems
}

/** Every leaf value a plan carries, for the case that says none of them executes. */
function leaves(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(leaves)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(leaves)
  return [value]
}

const schema: object = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'spec', 'run-plan.schema.json'), 'utf8'),
) as object

// strict, so a misspelled keyword in the schema is refused rather than silently checking nothing.
const validatePlan = new Ajv2020({ allErrors: true, strict: true }).compile(schema)

/** Validate a plan against the shipped schema, returning ajv's own messages. */
function schemaErrors(plan: RunPlan): string[] {
  return validatePlan(plan) ? [] : (validatePlan.errors ?? []).map(error => `${error.instancePath} ${error.message ?? ''}`)
}

describe('P4-03 C — the plan a compile produces', () => {
  it('P4-03 C: the plan carries the schema\'s twelve fields and nothing else', () => {
    expect(Object.keys(compiled(base)).sort()).toStrictEqual([...(schema as { required: string[] }).required].sort())
  })

  it('P4-03 C: every referenced vocabulary is the owning package\'s own, not a restatement', () => {
    const plan = compiled(base)
    expect(BUDGET_DIMENSIONS).toContain(plan.budgets[0]?.dimension)
    expect(plan.agentGraph.nodes[0]?.taskProfileRef).toBe(base.nodes[0]?.taskProfileRef)
    expect(plan.worlds[0]?.spec).toBe(base.worlds[0]?.spec)
    expect(plan.modelRoutes[0]?.selection).toStrictEqual(base.modelRoutes[0]?.selection)
    expect(plan.constraints.map(constraint => constraint.strength).sort()).toStrictEqual(['hard', 'soft'])
  })

  it('P4-03 C: a plan carries no executable leaf', () => {
    for (const leaf of leaves(compiled(base))) {
      expect(['string', 'number', 'boolean']).toContain(typeof leaf)
    }
  })

  it('P4-03 C: the plan states the ABI version it was compiled under', () => {
    expect(compiled(base).schemaVersion).toBe(RUN_PLAN_SCHEMA_VERSION)
    const declared = (schema as { properties: { schemaVersion: { type: string; minimum: number } } }).properties.schemaVersion
    expect([declared.type, declared.minimum]).toStrictEqual(['integer', 1])
  })

  it('P4-03 C: every verification entry names the versioned contract it was compiled against', () => {
    expect(compiled(base).verification[0]?.verificationContractRef).toStrictEqual({ contract: 'report-contract', version: 1 })
    expect(problems(inputs({
      verification: [{ ...base.verification[0]!, verificationContractRef: { contract: 'report-contract', version: 0 } }],
    })).map(problem => problem.at)).toContain('verification[v1].verificationContractRef.version')
  })

  it('P4-03 C: every agent node names the TaskProfile requirement it satisfies', () => {
    expect(compiled(base).agentGraph.nodes.map(node => node.requirementId)).toStrictEqual(['req-1', 'req-2'])
  })

  it('P4-03 C: a requirement that names another node\'s requirement does not compile', () => {
    const wrong = requires('q1', 'c-hard', ['fs.read'])
    expect(problems(inputs({
      requirements: [{ ...wrong, source: { kind: 'node', nodeId: 'n1', requirementId: 'req-2' } }],
    })).map(problem => problem.kind)).toContain('dangling-reference')
    expect(compilePlan(inputs({
      requirements: [{ ...wrong, source: { kind: 'node', nodeId: 'n1', requirementId: 'req-1' } }],
    })).ok).toBe(true)
  })

  it('P4-03 C: the same normalized inputs give the same plan id', () => {
    expect(compiled(base).planId).toBe(compiled(inputs({})).planId)
  })

  it('P4-03 C: reordering an array that has no meaningful order does not change the plan id', () => {
    const reordered = inputs({
      nodes: [base.nodes[1]!, base.nodes[0]!],
      constraints: [base.constraints[1]!, base.constraints[0]!],
    })
    expect(compiled(reordered).planId).toBe(compiled(base).planId)
    expect(compiled(reordered).agentGraph.nodes.map(node => node.id)).toStrictEqual(['n1', 'n2'])
  })

  it('P4-03 C: changing one character of one constraint changes the plan id', () => {
    const changed = inputs({ constraints: [{ ...base.constraints[0]!, statement: 'must not leave the workspaces' }, base.constraints[1]!] })
    expect(compiled(changed).planId).not.toBe(compiled(base).planId)
  })

  it('P4-03 C: the plan id is derived from the plan, never taken from the caller', () => {
    const plan = compiled(base)
    const { planId, ...body } = plan
    expect(planId).toBe(planIdOf(body))
    expect(Object.keys(base)).not.toContain('planId')
  })

  it('P4-03 C: a diamond of independent work compiles, so an ordering is not mistaken for a loop', () => {
    const diamond = inputs({
      nodes: [node('n1', 'req-1'), node('n2', 'req-2'), node('n3', 'req-3'), node('n4', 'req-4')],
      edges: [
        { from: 'n1', to: 'n2', kind: 'ordering' },
        { from: 'n1', to: 'n3', kind: 'ordering' },
        { from: 'n2', to: 'n4', kind: 'dataDependency' },
        { from: 'n3', to: 'n4', kind: 'dataDependency' },
      ],
      channels: [],
      modelRoutes: [],
      approvalGates: [],
      verification: [],
      recovery: { onNodeFailure: [], terminal: 'halt' },
    })
    expect(compiled(diamond).agentGraph.edges).toHaveLength(4)
  })

  it('P4-03 C: the compiled plan validates against the shipped schema', () => {
    expect(schemaErrors(compiled(base))).toStrictEqual([])
  })
})

describe('P4-03 C — what cannot be satisfied does not enter the run', () => {
  it('P4-03 C: a satisfiable plan compiles and reports no conflict', () => {
    const result = compilePlan(base)
    expect(result.ok).toBe(true)
    expect(result.ok && result.unmetSoft).toStrictEqual([])
  })

  it('P4-03 C: an unsatisfiable hard demand produces a conflict set and no plan', () => {
    expect(conflicts(inputs({ requirements: [requires('q-gpu', 'c-hard', ['gpu'])] })).map(conflict => conflict.requirementId))
      .toStrictEqual(['q-gpu'])
  })

  it('P4-03 C: the conflict set is minimal — removing any one member makes the rest satisfiable', () => {
    const over = inputs({ budgets: [{ id: 'b1', dimension: 'memoryBytes', limit: 600 }, { id: 'b2', dimension: 'memoryBytes', limit: 700 }] })
    const members = conflicts(over).map(conflict => conflict.requirementId)
    expect(members).toStrictEqual(['plan:budgets:b1', 'plan:budgets:b2'])
    const demands = [...over.requirements, ...planDemands(over)]
    for (const member of members) {
      expect(satisfiable(demands.filter(demand => demand.id !== member), over.facts)).toBe(true)
    }
    expect(satisfiable(demands, over.facts)).toBe(false)
  })

  it('P4-03 C: a demand that holds does not enter the conflict set', () => {
    const over = inputs({
      budgets: [{ id: 'b1', dimension: 'memoryBytes', limit: 600 }, { id: 'b2', dimension: 'memoryBytes', limit: 700 }],
      requirements: [requires('q-holds', 'c-hard', ['fs.read'])],
    })
    expect(conflicts(over).map(conflict => conflict.requirementId)).not.toContain('q-holds')
  })

  it('P4-03 C: a missing model is a model conflict, and the route alone is enough to find it', () => {
    const refused = conflicts(inputs({ modelRoutes: [{ nodeId: 'n1', selection: { provider: 'other', model: 'ghost' } }], requirements: [] }))
    expect(refused).toStrictEqual([expect.objectContaining({ kind: 'model', requirementId: 'plan:modelRoutes:n1' })])
  })

  it('P4-03 C: a world no provider can meet is a world conflict', () => {
    expect(conflicts(inputs({ facts: facts({ worldSatisfiability: { [DIGEST]: ['network'] } }) })).map(conflict => conflict.kind))
      .toStrictEqual(['world'])
  })

  it('P4-03 C: a world spec nobody answered for is refused rather than assumed', () => {
    expect(conflicts(inputs({ worlds: [{ id: 'w1', spec: brandString<WorldSpecDigest>(OTHER_DIGEST) }] })).map(conflict => conflict.kind))
      .toStrictEqual(['world'])
  })

  it('P4-03 C: a ceiling over what the deployment caps is a budget conflict', () => {
    expect(conflicts(inputs({ budgets: [{ id: 'b1', dimension: 'memoryBytes', limit: 4000 }] })).map(conflict => conflict.kind))
      .toStrictEqual(['budget'])
  })

  it('P4-03 C: a policy the deployment does not allow is a policy conflict', () => {
    const demand: PlanRequirement = { id: 'q-policy', kind: 'policy', policies: ['delete-everything'], source: { kind: 'constraint', constraintId: 'c-hard' } }
    expect(conflicts(inputs({ requirements: [demand] })).map(conflict => conflict.kind)).toStrictEqual(['policy'])
  })

  it('P4-03 C: wall clock takes the largest demand while the other dimensions add up', () => {
    const wall = inputs({
      budgets: [{ id: 'b1', dimension: 'wallClockMs', limit: 40_000 }, { id: 'b2', dimension: 'wallClockMs', limit: 50_000 }],
    })
    expect(compilePlan(wall).ok).toBe(true)
    const memory = inputs({
      budgets: [{ id: 'b1', dimension: 'memoryBytes', limit: 600 }, { id: 'b2', dimension: 'memoryBytes', limit: 500 }],
    })
    expect(conflicts(memory).map(conflict => conflict.kind)).toStrictEqual(['budget', 'budget'])
  })
})

describe('P4-03 C — a preference is not a refusal', () => {
  const unmet = requires('q-soft', 'c-soft', ['gpu'])

  it('P4-03 C: an unsatisfiable soft demand leaves the plan standing and is reported', () => {
    const result = compilePlan(inputs({ requirements: [unmet] }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.unmetSoft.map(conflict => conflict.requirementId)).toStrictEqual(['q-soft'])
  })

  it('P4-03 C: the same demand sourced from a hard constraint refuses the plan', () => {
    expect(conflicts(inputs({ requirements: [{ ...unmet, source: { kind: 'constraint', constraintId: 'c-hard' } }] })).map(conflict => conflict.requirementId))
      .toStrictEqual(['q-soft'])
  })

  it('P4-03 C: only the hard demand enters the conflict set when both fail', () => {
    expect(conflicts(inputs({ requirements: [unmet, requires('q-hard', 'c-hard', ['tpu'])] })).map(conflict => conflict.requirementId))
      .toStrictEqual(['q-hard'])
  })

  it('P4-03 C: a soft demand that holds is reported as nothing', () => {
    const result = compilePlan(inputs({ requirements: [requires('q-soft', 'c-soft', ['fs.read'])] }))
    expect(result.ok && result.unmetSoft).toStrictEqual([])
  })

  it('P4-03 C: the report of unmet preferences does not depend on the order they were listed in', () => {
    const first = requires('q-soft-a', 'c-soft', ['gpu'])
    const second = requires('q-soft-b', 'c-soft', ['tpu'])
    const forwards = compilePlan(inputs({ requirements: [first, second] }))
    const backwards = compilePlan(inputs({ requirements: [second, first] }))
    expect(forwards.ok && forwards.unmetSoft).toStrictEqual(backwards.ok ? backwards.unmetSoft : [])
    expect(forwards.ok && forwards.unmetSoft.map(conflict => conflict.requirementId)).toStrictEqual(['q-soft-a', 'q-soft-b'])
  })

  it('P4-03 C: what a deployment cannot offer does not move the plan id', () => {
    const withSoft = compilePlan(inputs({ requirements: [unmet] }))
    expect(withSoft.ok && withSoft.plan.planId).toBe(compiled(base).planId)
  })
})

describe('P4-03 F — inputs that would make a decision unsafe', () => {
  it('P4-03 F: an amount that is not a number is refused rather than compared', () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(problems(inputs({ requirements: [asks('q-budget', 'toolCalls', amount)] })).map(problem => problem.kind))
        .toStrictEqual(['out-of-range'])
    }
    expect(compilePlan(inputs({ requirements: [asks('q-budget', 'toolCalls', 10)] })).ok).toBe(true)
  })

  it('P4-03 F: a cap that is not a number is refused, so nothing is compared against it', () => {
    expect(problems(inputs({ facts: facts({ budgetCaps: { memoryBytes: Number.NaN } }) })).map(problem => problem.at))
      .toContain('facts.budgetCaps.memoryBytes')
    expect(problems(inputs({ facts: facts({ budgetCaps: { memoryBytes: -1 } }) })).map(problem => problem.kind))
      .toContain('out-of-range')
  })

  it('P4-03 F: a ceiling of zero forbids the work rather than bounding it, and is refused', () => {
    expect(problems(inputs({ budgets: [{ id: 'b1', dimension: 'memoryBytes', limit: 0 }] })).map(problem => problem.at))
      .toStrictEqual(['budgets[b1].limit'])
  })

  it('P4-03 F: a dimension outside the eight is refused on both sides', () => {
    expect(problems(inputs({ budgets: [{ id: 'b1', dimension: 'constructor' as never, limit: 5 }] })).map(problem => problem.at))
      .toStrictEqual(['budgets[b1].dimension'])
    expect(problems(inputs({ requirements: [asks('q-budget', 'toString' as never, 1)] })).map(problem => problem.at))
      .toStrictEqual(['requirements[q-budget].dimension'])
  })

  it('P4-03 F: a cap is never read off an inherited property', () => {
    // The dimension is the instrument: `{}['constructor']` answers with a
    // function, and every comparison against it is false — which reads as
    // "fits" unless the cap is read through `Object.hasOwn`. A case using a
    // real dimension would pass either way, so it would measure nothing.
    const inherited: PlanDemand = { id: 'd', kind: 'budget', dimension: 'constructor' as never, amount: 1, source: { kind: 'declaration', at: 'budgets[b1]' } }
    expect(satisfiable([inherited], facts({ budgetCaps: {} }))).toBe(false)
    const declared: PlanDemand = { ...inherited, dimension: 'memoryBytes' }
    expect(satisfiable([declared], facts({ budgetCaps: {} }))).toBe(false)
    expect(satisfiable([declared], facts({ budgetCaps: { memoryBytes: 1 } }))).toBe(true)
  })

  it('P4-03 F: a reference to something the plan does not contain is an input problem, not a conflict', () => {
    expect(problems(inputs({ edges: [{ from: 'n1', to: 'ghost', kind: 'ordering' }] })).map(problem => problem.kind)).toStrictEqual(['dangling-reference'])
    expect(problems(inputs({ channels: [{ ...base.channels[0]!, to: 'ghost' }] })).map(problem => problem.kind)).toStrictEqual(['dangling-reference'])
    expect(problems(inputs({ recovery: { onNodeFailure: [{ nodeId: 'n1', action: 'substitute', substituteNodeId: 'ghost' }], terminal: 'halt' } })).map(problem => problem.kind))
      .toStrictEqual(['dangling-reference'])
  })

  it('P4-03 F: a graph that waits on itself does not compile', () => {
    const looped = inputs({
      edges: [{ from: 'n1', to: 'n2', kind: 'ordering' }, { from: 'n2', to: 'n1', kind: 'dataDependency' }],
    })
    expect(problems(looped)).toStrictEqual([{ kind: 'cyclic-graph', at: 'edges', detail: 'the graph waits on itself: n1 -> n2 -> n1' }])
  })

  it('P4-03 F: a node that waits for itself does not compile', () => {
    expect(problems(inputs({ edges: [{ from: 'n1', to: 'n1', kind: 'ordering' }] })).map(problem => problem.kind))
      .toStrictEqual(['cyclic-graph'])
  })

  it('P4-03 F: the cycle named is the same one however the graph was listed', () => {
    // TWO cycles through n1, so the answer depends on which successor is
    // tried first. A graph with one cycle would be reported identically
    // whether or not the walk sorts anything, and would measure nothing.
    const twoCycles: PlanInputs['edges'] = [
      { from: 'n1', to: 'n2', kind: 'ordering' },
      { from: 'n2', to: 'n1', kind: 'ordering' },
      { from: 'n1', to: 'n3', kind: 'ordering' },
      { from: 'n3', to: 'n1', kind: 'ordering' },
    ]
    const nodes = [node('n1', 'req-1'), node('n2', 'req-2'), node('n3', 'req-3')]
    const graph = (listedNodes: PlanInputs['nodes'], listedEdges: PlanInputs['edges']): PlanInputs => inputs({
      nodes: listedNodes,
      edges: listedEdges,
      channels: [],
      modelRoutes: [],
      approvalGates: [],
      verification: [],
      recovery: { onNodeFailure: [], terminal: 'halt' },
    })
    const listings = [
      graph(nodes, twoCycles),
      graph(nodes, [...twoCycles].reverse()),
      graph([...nodes].reverse(), twoCycles),
      graph([...nodes].reverse(), [...twoCycles].reverse()),
    ]
    for (const listing of listings) {
      expect(problems(listing).map(problem => problem.detail)).toStrictEqual(['the graph waits on itself: n1 -> n2 -> n1'])
    }
  })

  it('P4-03 F: a cycle and a broken reference are each reported, not one instead of the other', () => {
    const both = inputs({
      edges: [{ from: 'n1', to: 'n2', kind: 'ordering' }, { from: 'n2', to: 'n1', kind: 'ordering' }, { from: 'n1', to: 'ghost', kind: 'ordering' }],
    })
    expect(problems(both).map(problem => problem.kind)).toStrictEqual(['dangling-reference', 'cyclic-graph'])
  })

  it('P4-03 F: a broken reference on its own is not reported as a cycle', () => {
    expect(problems(inputs({ edges: [{ from: 'n1', to: 'ghost', kind: 'ordering' }] })).map(problem => problem.kind))
      .toStrictEqual(['dangling-reference'])
  })

  it('P4-03 F: a chain far longer than a call stack is answered, not thrown at', () => {
    const length = 50_000
    const long = Array.from({ length }, (_, index) => node(`n${String(index).padStart(6, '0')}`, `req-${index}`))
    const chain: PlanInputs['edges'] = long.slice(0, -1).map((from, index) => ({ from: from.id, to: long[index + 1]!.id, kind: 'ordering' }))
    const graph = (edges: PlanInputs['edges']): PlanInputs => inputs({
      nodes: long,
      edges,
      channels: [],
      modelRoutes: [],
      approvalGates: [],
      verification: [],
      recovery: { onNodeFailure: [], terminal: 'halt' },
    })
    expect(inputProblems(graph(chain)).filter(problem => problem.kind === 'cyclic-graph')).toStrictEqual([])
    const closed = inputProblems(graph([...chain, { from: long[length - 1]!.id, to: long[0]!.id, kind: 'ordering' }]))
    expect(closed.map(problem => problem.kind)).toStrictEqual(['cyclic-graph'])
    expect(closed[0]?.detail).toBe('the graph waits on itself: n000000 -> n000001 -> n000002 -> ... (49995 more) -> n049998 -> n049999 -> n000000')
  })

  it('P4-03 F: an identifier longer than the schema admits is refused before a plan carries it', () => {
    expect(problems(inputs({ objectives: [{ ...base.objectives[0]!, id: 'x'.repeat(201) }] })).map(problem => problem.kind))
      .toContain('malformed-value')
  })

  it('P4-03 F: a task profile reference that is not a digest is refused', () => {
    expect(problems(inputs({ nodes: [{ ...base.nodes[0]!, taskProfileRef: brandString<TaskProfileRef>('not-a-digest') }, base.nodes[1]!] })).map(problem => problem.at))
      .toContain('nodes[n1].taskProfileRef')
  })

  it('P4-03 F: a plan with an extra top-level property is refused by its own schema', () => {
    const plan = { ...compiled(base), surprise: true } as unknown as RunPlan
    expect(schemaErrors(plan).length).toBeGreaterThan(0)
  })

  it('P4-03 F: a plan round-trips through JSON unchanged, so it can be persisted and sent', () => {
    const plan = compiled(base)
    expect(JSON.parse(JSON.stringify(plan))).toStrictEqual(plan)
    expect(schemaErrors(JSON.parse(JSON.stringify(plan)) as RunPlan)).toStrictEqual([])
  })

  it('P4-03 F: recomputing the id of a plan whose id was replaced gives a different id', () => {
    const plan = compiled(base)
    const { planId, ...body } = { ...plan, planId: 'f'.repeat(64) }
    expect(planId).not.toBe(planIdOf(body))
  })

  it('P4-03 F: the derived demands take a prefix a caller cannot claim', () => {
    expect(problems(inputs({ requirements: [requires('plan:modelRoutes:n1', 'c-hard', ['fs.read'])] })).map(problem => problem.kind))
      .toContain('reserved-id')
  })

  it('P4-03 F: a plan with no objective and no node is refused as empty', () => {
    expect(inputProblems({ ...base, objectives: [], nodes: [] }).map(problem => problem.kind)).toContain('empty-plan')
  })

  it('P4-03 F: the conflict set for one refusal is the same set every time', () => {
    const over = inputs({ budgets: [{ id: 'b1', dimension: 'memoryBytes', limit: 600 }, { id: 'b2', dimension: 'memoryBytes', limit: 700 }] })
    const demands = [...over.requirements, ...planDemands(over)]
    const first = minimalConflictSet(demands, over.facts)
    const shuffled = minimalConflictSet([...demands].reverse(), over.facts)
    expect(shuffled).toStrictEqual(first)
  })
})

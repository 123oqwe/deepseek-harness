/**
 * Epic P4-03's compile: inputs a deployment assembles become either one plan
 * with a deterministic id, or the smallest set of demands that cannot all
 * hold.
 *
 * Two refusals, because they have different authors. Inputs that do not hang
 * together — a route for a node the graph does not have, a ceiling of zero, an
 * amount that is not a number — are invalid, and the caller assembling them
 * fixes that. Inputs that hang together but ask for more than the deployment
 * offers are unsatisfiable, and somebody changes a decision. Neither produces
 * a plan (acceptance[0]: what cannot be satisfied does not enter the run), and
 * a caller that could not tell them apart would not know whose problem it has.
 *
 * What is judged is not only what the caller states. Every model route, world
 * binding and budget the PLAN declares is checked against the deployment's
 * facts by this compile, so a caller that states no requirements at all still
 * cannot get a plan routed to a model nobody serves. What a caller adds are
 * the demands a plan's own fields cannot express — a capability, a policy, an
 * amount of a resource — and they join the declared ones in one conflict set.
 *
 * Free text is never read. A constraint's `statement` is prose, and
 * translating prose into demands belongs to whoever wrote it; a compiler that
 * guessed would produce a different plan for the same words.
 *
 * The conflict set is computed by deletion rather than by a solver: a demand
 * is dropped when the rest are still unsatisfiable without it, so every member
 * that survives is one the refusal depends on. That argument needs
 * satisfiability to be monotone — adding a demand never makes a set easier —
 * which is why an amount that is negative or not a number is refused as an
 * input rather than compared.
 */

import { createHash } from 'node:crypto'
import { canonicalizeArguments } from '@deepseek-ai/dsh-action-manifest/canonicalize'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorldSpecDigest, WorldSpecDimension } from '@deepseek-ai/dsh-execution-world'
import { BUDGET_DIMENSIONS } from '@deepseek-ai/dsh-resource-budget'
import type { BudgetDimension } from '@deepseek-ai/dsh-resource-budget'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  AgentEdge,
  AgentNode,
  ApprovalGate,
  ContextChannel,
  PlanId,
  RunPlan,
  RunPlanBudget,
  RunPlanConstraint,
  RunPlanModelRoute,
  RunPlanObjective,
  RunPlanRecovery,
  VerificationEntry,
  WorldBinding,
} from './types.ts'

/**
 * The RunPlan ABI this compiler stamps.
 *
 * A constant rather than a caller's choice: must[4] asks a reader to refuse a
 * version it does not know, which only means something if one producer speaks
 * one version.
 */
export const RUN_PLAN_SCHEMA_VERSION = 1

/** The longest an identifier may be, as `spec/run-plan.schema.json`'s `identifier` says. */
const IDENTIFIER_MAX_LENGTH = 200

/** What a digest looks like, as that schema's `digest` says. */
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u

/** The prefix this compile gives the demands it derives, so a caller's own ids cannot collide with them. */
const DERIVED_ID_PREFIX = 'plan:'

/**
 * The one dimension whose demands do not add up.
 *
 * `BudgetLimits.maxWallClockMs` says why in its own words: parallel work does
 * not sum elapsed time, so a wall-clock demand is compared directly. Every
 * other dimension accumulates — the held ones because they are in use at once,
 * the consumed ones because they are a total over a lifetime.
 */
const NON_ADDITIVE_DIMENSION: BudgetDimension = 'wallClockMs'

/**
 * The dimensions a demand may name, from the list `resource-budget` already
 * publishes rather than a second copy of the eight names.
 *
 * A demand naming anything else is refused before satisfiability sees it: a
 * cap read for an unknown key on a plain object can land on something
 * inherited — `constructor` reads as a function — and a comparison against
 * that is false, which would pass as "fits under the cap".
 */
const KNOWN_DIMENSIONS: ReadonlySet<string> = new Set<string>(BUDGET_DIMENSIONS)

/**
 * What a demand exists to satisfy, so every conflict member points at
 * something its author can change (acceptance[1]).
 *
 * A caller's requirement that points at neither a constraint nor a node is
 * refused as an invalid input rather than carried into a conflict set nobody
 * can act on.
 */
export type RequirementSource =
  | {
    /** The demand implements a plan constraint. */
    readonly kind: 'constraint'
    /** That constraint's own id. */
    readonly constraintId: string
  }
  | {
    /** The demand comes from what a node needs to run. */
    readonly kind: 'node'
    /** The node. */
    readonly nodeId: string
    /** The task-profile requirement that node satisfies. */
    readonly requirementId: string
  }
  | {
    /** The demand comes from the plan's own text, which no single node owns. */
    readonly kind: 'declaration'
    /** Where it is declared, as a field path. */
    readonly at: string
  }

/**
 * One mechanically decidable demand on the deployment.
 *
 * Five kinds: three a caller states ({@link PlanRequirement}) and two this
 * compile derives from a plan's own routes and world bindings. Budgets arrive
 * both ways — a caller may state an amount, and every budget the plan declares
 * is one — and they are judged together, because a ceiling that fits alone and
 * not beside its siblings is exactly the case acceptance[0]'s "minimal" is
 * about.
 */
export type PlanDemand = {
  /** Stable identifier of this demand. Derived ones carry the `plan:` prefix. */
  readonly id: string
  /** What it exists to satisfy. */
  readonly source: RequirementSource
} & (
  | {
    /** Needs capabilities the deployment must already offer. */
    readonly kind: 'capability'
    /** Every one of these must be available. */
    readonly capabilities: readonly string[]
  }
  | {
    /** Needs an amount of one budgeted resource. */
    readonly kind: 'budget'
    /** Which dimension. */
    readonly dimension: BudgetDimension
    /** How much, in that dimension's own unit. */
    readonly amount: number
  }
  | {
    /** Needs a policy decision to permit something. */
    readonly kind: 'policy'
    /** Every one of these must be allowed. */
    readonly policies: readonly string[]
  }
  | {
    /** Needs a model the deployment serves. */
    readonly kind: 'model'
    /** The selection a route asks for. */
    readonly selection: ModelSelection
  }
  | {
    /** Needs a world some provider can create. */
    readonly kind: 'world'
    /** The spec the binding pins. */
    readonly spec: WorldSpecDigest
  }
)

/**
 * The demands a caller states: the three a plan's own fields cannot express.
 *
 * Models and worlds are not here because the plan declares them, and a demand
 * a caller has to restate is one a caller can forget to restate.
 */
export type PlanRequirement = Extract<PlanDemand, { kind: 'capability' | 'budget' | 'policy' }>

/**
 * What the deployment offers, as facts rather than as registries to consult.
 *
 * Supplied by the caller because this compile is pure: one that asked a live
 * registry would answer differently on two machines given the same inputs,
 * which is what acceptance[2] forbids. Each field is the ANSWER a registry
 * would have given — `worldSatisfiability` in particular is
 * `WorldProvider.unsatisfiableDimensions`' result per spec, not a provider.
 */
export interface DeploymentFacts {
  /** The capabilities on offer. A demand's capabilities must be a subset. */
  readonly availableCapabilities: readonly string[]
  /** What policy permits. A demand's policies must all appear. */
  readonly allowedPolicies: readonly string[]
  /** The models served. A route matches when provider and model agree, and, when the route names an effort, that too. */
  readonly availableModels: readonly ModelSelection[]
  /**
   * Per world spec digest, the dimensions no provider can meet; an empty list
   * means the world can be created. A digest with no entry has no answer, and
   * is refused rather than assumed.
   */
  readonly worldSatisfiability: Readonly<Record<string, readonly WorldSpecDimension[]>>
  /** The ceiling per dimension. A dimension with no cap admits nothing: an unbounded resource is one nobody decided about. */
  readonly budgetCaps: Readonly<Partial<Record<BudgetDimension, number>>>
}

/** Everything a plan is built from, and everything it is judged against. */
export interface PlanInputs {
  /** What the run is for; a plan with none has nothing to execute for. */
  readonly objectives: readonly RunPlanObjective[]
  /** What it must (`hard`) or should (`soft`) respect. */
  readonly constraints: readonly RunPlanConstraint[]
  /** The nodes to plan. */
  readonly nodes: readonly AgentNode[]
  /** The ordering relations between them. */
  readonly edges: readonly AgentEdge[]
  /** The channels the deployment permits between nodes. */
  readonly channels: readonly ContextChannel[]
  /** The routes, at most one per node. */
  readonly modelRoutes: readonly RunPlanModelRoute[]
  /** The worlds a node's `worldId` may name. */
  readonly worlds: readonly WorldBinding[]
  /** The ceilings a node's `budgetIds` may name. */
  readonly budgets: readonly RunPlanBudget[]
  /** Where the run stops for a human decision. */
  readonly approvalGates: readonly ApprovalGate[]
  /** What must be verified, and under which contract. */
  readonly verification: readonly VerificationEntry[]
  /** What happens when a node fails. */
  readonly recovery: RunPlanRecovery
  /**
   * The demands the plan's own fields cannot express.
   *
   * Not part of a `RunPlan`: the plan records what the run does, and these
   * record what else had to be true for it to exist.
   * `spec/run-plan.schema.json` governs the former only.
   */
  readonly requirements: readonly PlanRequirement[]
  /** What the deployment offers. */
  readonly facts: DeploymentFacts
}

/** One way the inputs do not hang together, independent of what the deployment offers. */
export interface InputProblem {
  /** What is wrong with them. */
  readonly kind: 'cyclic-graph' | 'dangling-reference' | 'duplicate-id' | 'empty-plan' | 'malformed-value' | 'out-of-range' | 'reserved-id'
  /** Where the problem is, as the input's own field path. */
  readonly at: string
  /** What is wrong, in terms a caller can fix. */
  readonly detail: string
}

/** Which satisfiability question a conflict answers `no` to (must[1], validation[1]). */
export type ConflictKind = PlanDemand['kind']

/** One member of a minimal conflict set: a demand the refusal depends on. */
export interface Conflict {
  /** Which question it failed. */
  readonly kind: ConflictKind
  /** The demand's own id. */
  readonly requirementId: string
  /** What it exists to satisfy, so an author knows what to change. */
  readonly source: RequirementSource
  /** What is unsatisfiable about it, given the facts. */
  readonly detail: string
}

/**
 * A compile produces a plan, or refuses for one of two reasons.
 *
 * Both refusals are returned rather than thrown: acceptance[0] asks for the
 * conflict set as an answer, and a caller that had to catch an exception to
 * read it could not tell a refusal from a defect in this compiler.
 */
export type CompileResult =
  | {
    readonly ok: true
    /** The compiled plan. */
    readonly plan: RunPlan
    /**
     * The advisory demands that do not hold beside the enforced ones.
     *
     * A `soft` constraint is a preference, so a demand implementing one never
     * refuses a plan; reporting it here is what keeps "preferred" from meaning
     * "silently dropped". It is NOT part of the plan and not part of what
     * `planId` covers: the same plan compiled against a poorer deployment is
     * the same plan, with more of its preferences unmet.
     */
    readonly unmetSoft: readonly Conflict[]
  }
  | { readonly ok: false; readonly reason: 'invalid-inputs'; readonly problems: readonly InputProblem[] }
  | { readonly ok: false; readonly reason: 'unsatisfiable'; readonly conflicts: readonly Conflict[] }

/**
 * Order a set-valued array by a key.
 *
 * Normalization happens by construction rather than by a rule callers follow:
 * `compilePlan` puts these in key order into the plan itself, so two callers
 * who listed the same things differently produce the same plan and therefore
 * the same id (acceptance[2]).
 *
 * Which arrays are sets, and why their order carries nothing: `objectives`,
 * `constraints`, `worlds`, `budgets`, `approvalGates` and `verification` are
 * each identified by their own id; `modelRoutes` and `recovery.onNodeFailure`
 * by the node they are about, of which there is at most one each; `channels`
 * and `agentGraph.nodes` by their ids; `agentGraph.edges` by the pair they
 * order and why. Execution order lives in `edges` as data, not in the order
 * `nodes` is listed in, which is what makes the listing free to reorder.
 * `AgentNode.budgetIds` is a set of references for the same reason.
 * @param items - the array to order.
 * @param key - the member's identity.
 * @returns a new array in ascending key order.
 */
function sortedByKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => {
    const a = key(left)
    const b = key(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/** The key an edge is ordered by: the pair it orders and why, which is all an edge is. */
function edgeKey(edge: AgentEdge): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}`
}

/** Put one node's own set-valued member in key order. */
function normalizedNode(node: AgentNode): AgentNode {
  return node.budgetIds === undefined ? node : { ...node, budgetIds: sortedByKey(node.budgetIds, id => id) }
}

/**
 * The plan body in normalized form, everything but the id it is named by.
 * @param inputs - inputs already checked for validity and satisfiability.
 * @returns the plan's fields, each set-valued array in key order.
 */
function normalizedBody(inputs: PlanInputs): Omit<RunPlan, 'planId'> {
  return {
    schemaVersion: RUN_PLAN_SCHEMA_VERSION,
    objectives: sortedByKey(inputs.objectives, objective => objective.id),
    constraints: sortedByKey(inputs.constraints, constraint => constraint.id),
    modelRoutes: sortedByKey(inputs.modelRoutes, route => route.nodeId),
    contextTopology: { channels: sortedByKey(inputs.channels, channel => channel.id) },
    agentGraph: {
      nodes: sortedByKey(inputs.nodes, node => node.id).map(normalizedNode),
      edges: sortedByKey(inputs.edges, edgeKey),
    },
    worlds: sortedByKey(inputs.worlds, world => world.id),
    budgets: sortedByKey(inputs.budgets, budget => budget.id),
    approvalGates: sortedByKey(inputs.approvalGates, gate => gate.id),
    verification: sortedByKey(inputs.verification, entry => entry.id),
    recovery: {
      onNodeFailure: sortedByKey(inputs.recovery.onNodeFailure, rule => rule.nodeId),
      terminal: inputs.recovery.terminal,
    },
  }
}

/** Record one way the inputs do not hang together. */
function problem(problems: InputProblem[], kind: InputProblem['kind'], at: string, detail: string): void {
  problems.push({ kind, at, detail })
}

/** Report an id listed more than once, which would make a later reference ambiguous. */
function checkUnique(problems: InputProblem[], at: string, ids: readonly string[]): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) problem(problems, 'duplicate-id', at, `${JSON.stringify(id)} is listed more than once`)
    seen.add(id)
  }
}

/** Report a reference to something the inputs do not contain. */
function checkKnown(problems: InputProblem[], at: string, known: ReadonlySet<string>, referenced: string, what: string): void {
  if (!known.has(referenced)) problem(problems, 'dangling-reference', at, `${JSON.stringify(referenced)} names no ${what}`)
}

/** Report an identifier the plan's own schema would refuse, so a compiled plan cannot fail its contract. */
function checkIdentifier(problems: InputProblem[], at: string, value: string): void {
  if (value.length === 0 || value.length > IDENTIFIER_MAX_LENGTH) {
    problem(problems, 'malformed-value', at, `an identifier is 1 to ${IDENTIFIER_MAX_LENGTH} characters; this one is ${value.length}`)
  }
}

/** Report a digest that is not one, for the same reason. */
function checkDigest(problems: InputProblem[], at: string, value: string): void {
  if (!DIGEST_PATTERN.test(value)) problem(problems, 'malformed-value', at, `a digest is 64 lowercase hex characters: ${JSON.stringify(value)}`)
}

/** Report a dimension outside the eight `resource-budget` names, before any cap is read for it. */
function checkDimension(problems: InputProblem[], at: string, dimension: string): void {
  if (!KNOWN_DIMENSIONS.has(dimension)) {
    problem(problems, 'malformed-value', at, `${JSON.stringify(dimension)} is not one of the budget dimensions ${JSON.stringify([...KNOWN_DIMENSIONS])}`)
  }
}

/**
 * Report a number that cannot be compared safely.
 *
 * `NaN` is the case this exists for: every comparison against it is false, so
 * an unchecked `NaN` amount would read as fitting under any cap — a fail-OPEN,
 * in the direction a budget exists to prevent. A negative amount is refused
 * for a second reason: it would make satisfiability non-monotone, and the
 * deletion argument the conflict set rests on assumes that dropping a demand
 * never makes the rest harder.
 * @param problems - where to record a failure.
 * @param at - the field path being checked.
 * @param value - the number as supplied.
 * @param bound - the floor, whether it is exclusive, and whether only whole numbers are admitted.
 */
function checkNumber(
  problems: InputProblem[],
  at: string,
  value: number,
  bound: { readonly min: number; readonly exclusive?: boolean; readonly integer?: boolean },
): void {
  if (!Number.isFinite(value)) {
    problem(problems, 'out-of-range', at, `must be a finite number, not ${String(value)}`)
    return
  }
  if (bound.integer === true && !Number.isInteger(value)) problem(problems, 'out-of-range', at, `must be a whole number: ${value}`)
  if (bound.exclusive === true ? value <= bound.min : value < bound.min) {
    problem(problems, 'out-of-range', at, `must be ${bound.exclusive === true ? 'greater than' : 'at least'} ${bound.min}: ${value}`)
  }
}

/** Check the fields a goal reference carries, which the plan's schema also constrains. */
function checkGoalRef(problems: InputProblem[], at: string, goalRef: RunPlanObjective['goalRef']): void {
  checkIdentifier(problems, `${at}.sessionId`, goalRef.sessionId)
  checkIdentifier(problems, `${at}.messageId`, goalRef.messageId)
  if (goalRef.goalRound === undefined) return
  checkIdentifier(problems, `${at}.goalRound.goalId`, goalRef.goalRound.goalId)
  checkNumber(problems, `${at}.goalRound.revision`, goalRef.goalRound.revision, { min: 0, integer: true })
  checkNumber(problems, `${at}.goalRound.round`, goalRef.goalRound.round, { min: 1, integer: true })
}

/**
 * Everything wrong with the inputs themselves, independent of what the
 * deployment offers.
 *
 * Three families: references that name nothing, ids that name two things, and
 * values the plan's own schema would refuse. The third is here rather than
 * left to a validator downstream because a compile that returned a plan its
 * schema rejects would have produced something that cannot be persisted or
 * sent (validation[2]), and because the numbers it checks are the ones
 * satisfiability would otherwise compare unsafely.
 *
 * The line this draws is what feeds a decision. A budget dimension and every
 * number are checked here because satisfiability compares them; the closed
 * unions the types already name — a constraint's strength, an edge's kind, a
 * channel's retention, a recovery action — are not, because nothing here
 * branches on an unknown member. A plan carrying one is refused by the schema
 * where the plan is validated, not twice.
 * @param inputs - the inputs as assembled.
 * @returns every problem found, in the order the fields are checked; empty when the inputs hang together.
 */
export function inputProblems(inputs: PlanInputs): readonly InputProblem[] {
  const problems: InputProblem[] = []
  if (inputs.objectives.length === 0) problem(problems, 'empty-plan', 'objectives', 'a plan with no objective runs for nothing')
  if (inputs.nodes.length === 0) problem(problems, 'empty-plan', 'nodes', 'a plan with no node executes nothing')

  checkUnique(problems, 'objectives', inputs.objectives.map(objective => objective.id))
  checkUnique(problems, 'constraints', inputs.constraints.map(constraint => constraint.id))
  checkUnique(problems, 'nodes', inputs.nodes.map(node => node.id))
  checkUnique(problems, 'channels', inputs.channels.map(channel => channel.id))
  checkUnique(problems, 'worlds', inputs.worlds.map(world => world.id))
  checkUnique(problems, 'budgets', inputs.budgets.map(budget => budget.id))
  checkUnique(problems, 'approvalGates', inputs.approvalGates.map(gate => gate.id))
  checkUnique(problems, 'verification', inputs.verification.map(entry => entry.id))
  checkUnique(problems, 'requirements', inputs.requirements.map(requirement => requirement.id))
  // One route per node and one recovery rule per node: a second of either
  // would be a silent choice between two answers to the same question.
  checkUnique(problems, 'modelRoutes', inputs.modelRoutes.map(route => route.nodeId))
  checkUnique(problems, 'recovery.onNodeFailure', inputs.recovery.onNodeFailure.map(rule => rule.nodeId))

  const nodeIds = new Set(inputs.nodes.map(node => node.id))
  const worldIds = new Set(inputs.worlds.map(world => world.id))
  const budgetIds = new Set(inputs.budgets.map(budget => budget.id))
  const constraintIds = new Set(inputs.constraints.map(constraint => constraint.id))

  for (const objective of inputs.objectives) {
    checkIdentifier(problems, `objectives[${objective.id}].id`, objective.id)
    if (objective.statement.length === 0) problem(problems, 'malformed-value', `objectives[${objective.id}].statement`, 'an objective that states nothing is not one')
    checkGoalRef(problems, `objectives[${objective.id}].goalRef`, objective.goalRef)
  }
  for (const constraint of inputs.constraints) {
    checkIdentifier(problems, `constraints[${constraint.id}].id`, constraint.id)
    if (constraint.statement.length === 0) problem(problems, 'malformed-value', `constraints[${constraint.id}].statement`, 'a constraint that states nothing is not one')
    checkNumber(problems, `constraints[${constraint.id}].provenance.confidence`, constraint.provenance.confidence, { min: 0 })
    if (constraint.provenance.confidence > 1) {
      problem(problems, 'out-of-range', `constraints[${constraint.id}].provenance.confidence`, `a confidence is at most 1: ${constraint.provenance.confidence}`)
    }
    checkGoalRef(problems, `constraints[${constraint.id}].provenance.goalRef`, constraint.provenance.goalRef)
  }
  for (const node of inputs.nodes) {
    checkIdentifier(problems, `nodes[${node.id}].id`, node.id)
    checkIdentifier(problems, `nodes[${node.id}].role`, node.role)
    checkIdentifier(problems, `nodes[${node.id}].requirementId`, node.requirementId)
    checkDigest(problems, `nodes[${node.id}].taskProfileRef`, node.taskProfileRef)
    if (node.worldId !== undefined) checkKnown(problems, `nodes[${node.id}].worldId`, worldIds, node.worldId, 'world this plan binds')
    for (const id of node.budgetIds ?? []) checkKnown(problems, `nodes[${node.id}].budgetIds`, budgetIds, id, 'budget this plan declares')
  }
  for (const route of inputs.modelRoutes) {
    checkKnown(problems, 'modelRoutes', nodeIds, route.nodeId, 'node in this graph')
    checkIdentifier(problems, `modelRoutes[${route.nodeId}].selection.provider`, route.selection.provider)
    checkIdentifier(problems, `modelRoutes[${route.nodeId}].selection.model`, route.selection.model)
    if (route.selection.reasoningEffort !== undefined) {
      checkIdentifier(problems, `modelRoutes[${route.nodeId}].selection.reasoningEffort`, route.selection.reasoningEffort)
    }
  }
  for (const world of inputs.worlds) {
    checkIdentifier(problems, `worlds[${world.id}].id`, world.id)
    checkDigest(problems, `worlds[${world.id}].spec`, world.spec)
  }
  for (const budget of inputs.budgets) {
    checkIdentifier(problems, `budgets[${budget.id}].id`, budget.id)
    checkDimension(problems, `budgets[${budget.id}].dimension`, budget.dimension)
    // The schema's `exclusiveMinimum: 0`: a ceiling of zero forbids the work
    // rather than bounding it, and a negative one is not a ceiling at all.
    checkNumber(problems, `budgets[${budget.id}].limit`, budget.limit, { min: 0, exclusive: true })
  }
  for (const gate of inputs.approvalGates) {
    checkIdentifier(problems, `approvalGates[${gate.id}].id`, gate.id)
    checkIdentifier(problems, `approvalGates[${gate.id}].approvalRef`, gate.approvalRef)
    checkKnown(problems, `approvalGates[${gate.id}].nodeId`, nodeIds, gate.nodeId, 'node in this graph')
  }
  for (const entry of inputs.verification) {
    checkIdentifier(problems, `verification[${entry.id}].id`, entry.id)
    checkIdentifier(problems, `verification[${entry.id}].verificationRef`, entry.verificationRef)
    checkIdentifier(problems, `verification[${entry.id}].verificationContractRef.contract`, entry.verificationContractRef.contract)
    checkNumber(problems, `verification[${entry.id}].verificationContractRef.version`, entry.verificationContractRef.version, { min: 1, integer: true })
    checkKnown(problems, `verification[${entry.id}].nodeId`, nodeIds, entry.nodeId, 'node in this graph')
  }
  for (const edge of inputs.edges) {
    checkKnown(problems, 'edges.from', nodeIds, edge.from, 'node in this graph')
    checkKnown(problems, 'edges.to', nodeIds, edge.to, 'node in this graph')
  }
  for (const channel of inputs.channels) {
    checkIdentifier(problems, `channels[${channel.id}].id`, channel.id)
    checkKnown(problems, `channels[${channel.id}].from`, nodeIds, channel.from, 'node in this graph')
    checkKnown(problems, `channels[${channel.id}].to`, nodeIds, channel.to, 'node in this graph')
  }
  for (const rule of inputs.recovery.onNodeFailure) {
    checkKnown(problems, 'recovery.onNodeFailure', nodeIds, rule.nodeId, 'node in this graph')
    if (rule.action === 'substitute') {
      checkKnown(problems, 'recovery.onNodeFailure.substituteNodeId', nodeIds, rule.substituteNodeId, 'node in this graph')
    }
    if (rule.action === 'retry') {
      checkNumber(problems, `recovery.onNodeFailure[${rule.nodeId}].maxAttempts`, rule.maxAttempts, { min: 1, integer: true })
    }
  }
  for (const requirement of inputs.requirements) {
    const at = `requirements[${requirement.id}]`
    if (requirement.id.startsWith(DERIVED_ID_PREFIX)) {
      problem(problems, 'reserved-id', at, `${JSON.stringify(DERIVED_ID_PREFIX)} names the demands this compile derives; a stated one cannot take that prefix`)
    }
    if (requirement.kind === 'budget') {
      checkNumber(problems, `${at}.amount`, requirement.amount, { min: 0 })
      checkDimension(problems, `${at}.dimension`, requirement.dimension)
    }
    if (requirement.source.kind === 'constraint') {
      checkKnown(problems, `${at}.source`, constraintIds, requirement.source.constraintId, 'constraint this plan carries')
    } else if (requirement.source.kind === 'node') {
      const { nodeId, requirementId } = requirement.source
      checkKnown(problems, `${at}.source`, nodeIds, nodeId, 'node in this graph')
      const node = inputs.nodes.find(candidate => candidate.id === nodeId)
      if (node !== undefined && node.requirementId !== requirementId) {
        problem(problems, 'dangling-reference', `${at}.source`, `${JSON.stringify(requirementId)} is not the requirement node ${JSON.stringify(node.id)} satisfies`)
      }
    } else {
      problem(problems, 'dangling-reference', `${at}.source`, 'a stated requirement names the constraint or the node it comes from; `declaration` is this compile\'s own')
    }
  }
  // Every declared cap is checked, including one declared as `undefined`. The
  // type says a cap is a number, so a key carrying `undefined` came from data
  // rather than from a typed caller — and at the read site it is
  // indistinguishable from "this deployment set no cap", which refuses every
  // demand on that dimension. Refusing it as an input says which of the two
  // the caller meant, instead of silently taking the stricter one.
  for (const [dimension, cap] of Object.entries(inputs.facts.budgetCaps)) {
    checkNumber(problems, `facts.budgetCaps.${dimension}`, cap, { min: 0 })
  }
  // Reported beside the broken references rather than instead of them: a
  // cycle between nodes that exist does not stop existing because an edge
  // elsewhere names one that does not, and a caller told about one at a time
  // fixes one and is refused again.
  const cycle = firstCycle(inputs.nodes, inputs.edges)
  if (cycle.length > 0 && problems.length === 0) problem(problems, 'cyclic-graph', 'edges', describeCycle(cycle))
  return problems
}

/**
 * The first cycle in the graph, as the nodes it runs through.
 *
 * Both edge kinds order a pair — one needs the other's result, one merely
 * starts after it — so a cycle of either kind is a plan whose nodes each wait
 * for another and none of which can start. That makes it an input that does
 * not hang together rather than a demand the deployment cannot meet, which is
 * why it is refused beside the dangling references and not carried into a
 * conflict set.
 *
 * The walk is deterministic: nodes are entered in ascending id order and each
 * node's successors are visited in ascending order too, so a graph with two
 * cycles always names the same one however its edges were listed.
 *
 * The stack is explicit because the depth is the caller's to choose: a chain
 * of fifty thousand nodes is a valid input, and a recursive walk would answer
 * it by throwing `RangeError` — while this file's contract is that a refusal
 * is a returned value. An edge naming a node the graph does not have is
 * skipped rather than followed; that is reported on its own.
 * @param nodes - the graph's nodes.
 * @param edges - the ordering relations between them.
 * @returns the cycle's nodes, starting and ending at the node it closes on; empty when the graph is acyclic.
 */
function firstCycle(nodes: readonly AgentNode[], edges: readonly AgentEdge[]): readonly string[] {
  const successors = new Map<string, string[]>(sortedByKey(nodes, node => node.id).map(node => [node.id, []]))
  for (const edge of sortedByKey(edges, edgeKey)) successors.get(edge.from)?.push(edge.to)
  for (const [, targets] of successors) targets.sort()
  // 'open' is on the current path, 'done' is finished and cannot start a cycle.
  const state = new Map<string, 'open' | 'done'>()

  for (const root of successors.keys()) {
    if (state.has(root)) continue
    state.set(root, 'open')
    const stack: { readonly id: string; index: number }[] = [{ id: root, index: 0 }]
    while (stack.length > 0) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- the loop guard is the stack's length
      const frame = stack[stack.length - 1]!
      const targets = successors.get(frame.id) ?? []
      if (frame.index >= targets.length) {
        state.set(frame.id, 'done')
        stack.pop()
        continue
      }
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the check above
      const next = targets[frame.index++]!
      if (state.get(next) === 'open') {
        const path = stack.map(entry => entry.id)
        return [...path.slice(path.indexOf(next)), next]
      }
      if (!state.has(next) && successors.has(next)) {
        state.set(next, 'open')
        stack.push({ id: next, index: 0 })
      }
    }
  }
  return []
}

/**
 * A cycle written out, shortened when it is longer than a reader can use.
 *
 * The ends are what identifies the cycle and the middle is what makes a
 * fifty-thousand-node path unreadable, so a long one keeps both ends and
 * counts what it dropped. The cycle itself is unchanged — only this sentence
 * is shortened — so the determinism the walk provides survives.
 * @param cycle - the cycle's nodes, as {@link firstCycle} returns them.
 * @returns the sentence the input problem carries.
 */
function describeCycle(cycle: readonly string[]): string {
  const shown = 3
  if (cycle.length <= shown * 2) return `the graph waits on itself: ${cycle.join(' -> ')}`
  const head = cycle.slice(0, shown).join(' -> ')
  const tail = cycle.slice(-shown).join(' -> ')
  return `the graph waits on itself: ${head} -> ... (${cycle.length - shown * 2} more) -> ${tail}`
}

/**
 * What the plan itself demands, beside what the caller stated.
 *
 * Every route, world binding and budget the plan declares becomes a demand
 * here, so a plan routed to a model nobody serves is refused even when the
 * caller stated no requirements at all. A route's demand points at the node it
 * serves, which carries the `requirementId` acceptance[1] asks to be traceable
 * to; a world's and a budget's point at the declaration, because several nodes
 * may share one and no single node owns it.
 * @param inputs - inputs already checked for validity.
 * @returns the derived demands, each carrying the `plan:` prefix.
 */
export function planDemands(inputs: PlanInputs): readonly PlanDemand[] {
  const requirementOf = new Map(inputs.nodes.map(node => [node.id, node.requirementId]))
  const routes = inputs.modelRoutes.map((route): PlanDemand => ({
    id: `${DERIVED_ID_PREFIX}modelRoutes:${route.nodeId}`,
    kind: 'model',
    selection: route.selection,
    source: { kind: 'node', nodeId: route.nodeId, requirementId: requirementOf.get(route.nodeId) ?? '' },
  }))
  const worlds = inputs.worlds.map((world): PlanDemand => ({
    id: `${DERIVED_ID_PREFIX}worlds:${world.id}`,
    kind: 'world',
    spec: world.spec,
    source: { kind: 'declaration', at: `worlds[${world.id}]` },
  }))
  const budgets = inputs.budgets.map((budget): PlanDemand => ({
    id: `${DERIVED_ID_PREFIX}budgets:${budget.id}`,
    kind: 'budget',
    dimension: budget.dimension,
    amount: budget.limit,
    source: { kind: 'declaration', at: `budgets[${budget.id}]` },
  }))
  return [...routes, ...worlds, ...budgets]
}

/**
 * What one set of demands asks of each budget dimension.
 *
 * Wall clock is the maximum rather than the total, because elapsed time does
 * not add across parallel work; every other dimension accumulates. Both
 * aggregations grow monotonically as demands are added, which is what the
 * deletion-based conflict set needs.
 */
function budgetDemand(demands: readonly PlanDemand[]): Map<BudgetDimension, number> {
  const totals = new Map<BudgetDimension, number>()
  for (const demand of demands) {
    if (demand.kind !== 'budget') continue
    const running = totals.get(demand.dimension)
    if (running === undefined) {
      totals.set(demand.dimension, demand.amount)
      continue
    }
    totals.set(demand.dimension, demand.dimension === NON_ADDITIVE_DIMENSION ? Math.max(running, demand.amount) : running + demand.amount)
  }
  return totals
}

/**
 * The cap for one dimension, read so an inherited property can never answer.
 *
 * `budgetCaps` arrives as data — from JSON, from a config file — and a plain
 * object answers `constructor` with a function. Reading that as a cap would
 * make every comparison against it false, which reads as "fits".
 * @param facts - the deployment's facts.
 * @param dimension - the dimension to read.
 * @returns the cap, or undefined when the deployment declared none.
 */
function capOf(facts: DeploymentFacts, dimension: BudgetDimension): number | undefined {
  return Object.hasOwn(facts.budgetCaps, dimension) ? facts.budgetCaps[dimension] : undefined
}

/** Whether the deployment serves the model a route asks for; an effort the route names must match too. */
function modelServed(selection: ModelSelection, facts: DeploymentFacts): boolean {
  return facts.availableModels.some(available => available.provider === selection.provider
    && available.model === selection.model
    && (selection.reasoningEffort === undefined || available.reasoningEffort === selection.reasoningEffort))
}

/**
 * Whether every demand in a set can hold at once, given the facts.
 *
 * Capabilities, policies, models and worlds are decided one demand at a time;
 * budgets are decided per dimension over the whole set, because two ceilings
 * that each fit under a cap can exceed it together — the case acceptance[0]'s
 * "minimal" is about.
 *
 * Silence is never permission: a dimension with no cap, and a world spec no
 * provider answered for, are both refused rather than assumed.
 * @param demands - the set to decide.
 * @param facts - what the deployment offers.
 * @returns true when all of them hold together.
 */
export function satisfiable(demands: readonly PlanDemand[], facts: DeploymentFacts): boolean {
  const available = new Set(facts.availableCapabilities)
  const allowed = new Set(facts.allowedPolicies)
  for (const demand of demands) {
    if (demand.kind === 'capability' && !demand.capabilities.every(capability => available.has(capability))) return false
    if (demand.kind === 'policy' && !demand.policies.every(policy => allowed.has(policy))) return false
    if (demand.kind === 'model' && !modelServed(demand.selection, facts)) return false
    if (demand.kind === 'world' && facts.worldSatisfiability[demand.spec]?.length !== 0) return false
  }
  for (const [dimension, demanded] of budgetDemand(demands)) {
    const cap = capOf(facts, dimension)
    if (cap === undefined || demanded > cap) return false
  }
  return true
}

/** Why one surviving member of a conflict set cannot hold, in terms its author can act on. */
function conflictDetail(demand: PlanDemand, facts: DeploymentFacts, kept: readonly PlanDemand[]): string {
  if (demand.kind === 'capability') {
    const missing = demand.capabilities.filter(capability => !facts.availableCapabilities.includes(capability))
    return `needs ${JSON.stringify(missing.length > 0 ? missing : demand.capabilities)}, which the deployment does not offer`
  }
  if (demand.kind === 'policy') {
    const refused = demand.policies.filter(policy => !facts.allowedPolicies.includes(policy))
    return `needs ${JSON.stringify(refused.length > 0 ? refused : demand.policies)}, which policy does not allow`
  }
  if (demand.kind === 'model') {
    return `routes to ${JSON.stringify(`${demand.selection.provider}/${demand.selection.model}`)}, which the deployment does not serve`
  }
  if (demand.kind === 'world') {
    const unsatisfiable = facts.worldSatisfiability[demand.spec]
    return unsatisfiable === undefined
      ? `binds a world spec no provider answered for: ${demand.spec}`
      : `binds a world no provider can meet on ${JSON.stringify(unsatisfiable)}`
  }
  const cap = capOf(facts, demand.dimension)
  const demanded = budgetDemand(kept).get(demand.dimension) ?? demand.amount
  return cap === undefined
    ? `asks ${demand.amount} of ${demand.dimension}, which has no cap`
    : `asks ${demand.amount} of ${demand.dimension}, and the set asks ${demanded} against a cap of ${cap}`
}

/** The ids of the constraints this plan calls `soft`, which is what makes a demand implementing one advisory. */
function softConstraintIds(constraints: readonly RunPlanConstraint[]): ReadonlySet<string> {
  return new Set(constraints.filter(constraint => constraint.strength === 'soft').map(constraint => constraint.id))
}

/**
 * Whether a demand is advisory rather than enforced.
 *
 * Only a demand that implements a constraint can be: `soft` is a property of
 * a constraint, and what a node or the plan's own text declares — a route, a
 * world, a ceiling — is a resource the run needs, not a preference somebody
 * expressed.
 * @param demand - the demand to classify.
 * @param soft - the ids of the plan's soft constraints.
 * @returns true when the plan may execute without it.
 */
function isAdvisory(demand: PlanDemand, soft: ReadonlySet<string>): boolean {
  return demand.source.kind === 'constraint' && soft.has(demand.source.constraintId)
}

/**
 * Which advisory demands do not hold, given what is enforced.
 *
 * Each is judged ALONE beside the enforced set rather than all of them
 * together: two preferences that exclude each other would otherwise both be
 * reported as unmet or both as met depending on the order they were listed
 * in, and a caller cannot act on an answer that depends on that. Judged in
 * ascending id order, so the same inputs report the same list.
 * @param advisory - the demands that implement soft constraints.
 * @param enforced - the demands that already hold.
 * @param facts - what the deployment offers.
 * @returns one entry per advisory demand that cannot hold beside the enforced set.
 */
export function unmetSoftDemands(
  advisory: readonly PlanDemand[],
  enforced: readonly PlanDemand[],
  facts: DeploymentFacts,
): readonly Conflict[] {
  return sortedByKey(advisory, demand => demand.id)
    .filter(demand => !satisfiable([...enforced, demand], facts))
    .map(demand => ({
      kind: demand.kind,
      requirementId: demand.id,
      source: demand.source,
      detail: conflictDetail(demand, facts, [...enforced, demand]),
    }))
}

/**
 * The smallest set of demands the refusal depends on (acceptance[0]).
 *
 * Deletion, not search: each demand is tried for removal in ascending id order
 * and dropped when the rest are still unsatisfiable without it. What survives
 * is minimal in the testable sense — remove any one member and the rest can
 * hold — and is the same set every time, because the order the candidates are
 * tried in is the ids' own.
 *
 * Several minimal sets can exist over the same inputs. The rule this order
 * fixes is that the earliest removable id is removed first, so the set
 * returned is the one whose members have the LATER ids; a caller comparing two
 * runs is comparing the same rule, not the order its inputs happened to arrive
 * in.
 * @param demands - all demands, which must already be unsatisfiable together.
 * @param facts - what the deployment offers.
 * @returns one conflict per surviving demand, in ascending id order.
 */
export function minimalConflictSet(demands: readonly PlanDemand[], facts: DeploymentFacts): readonly Conflict[] {
  const ordered = sortedByKey(demands, demand => demand.id)
  let kept = ordered
  for (const candidate of ordered) {
    const without = kept.filter(demand => demand.id !== candidate.id)
    if (!satisfiable(without, facts)) kept = without
  }
  return kept.map(demand => ({
    kind: demand.kind,
    requirementId: demand.id,
    source: demand.source,
    detail: conflictDetail(demand, facts, kept),
  }))
}

/**
 * The identity a plan is named by: the sha256 of its normalized body.
 *
 * Canonicalization is P2-03's `canonicalizeArguments` (RFC 8785 JCS),
 * imported rather than written again, so a plan hashed here and a manifest
 * hashed there cannot disagree about what canonical means.
 *
 * The body excludes `planId` because a field cannot be part of what produces
 * it, and includes everything else: two plans differing anywhere, down to one
 * character of one constraint, are different plans.
 * @param body - a normalized plan body, everything but the id.
 * @returns the lowercase hex sha256 of its canonical form.
 */
export function planIdOf(body: Omit<RunPlan, 'planId'>): PlanId {
  const canonical = canonicalizeArguments(body as unknown as JsonValue)
  return brandString<PlanId>(createHash('sha256').update(canonical, 'utf8').digest('hex'))
}

/**
 * Compile inputs into a plan, or refuse with what stopped it.
 *
 * The order is deliberate: inputs that do not hang together are reported
 * before satisfiability is asked at all, because a conflict set computed over
 * demands that name things the plan does not contain — or over an amount that
 * is not a number — would describe a plan nobody proposed.
 * A demand implementing a `soft` constraint never refuses a plan and never
 * enters the conflict set — the schema says as much where it describes
 * `constraints` — but one that does not hold is reported on the successful
 * result, because a preference nothing records is a preference nobody can
 * see was dropped.
 * @param inputs - everything the plan is built from and judged against.
 * @returns the compiled plan with its unmet preferences, the input problems, or the minimal conflict set.
 */
export function compilePlan(inputs: PlanInputs): CompileResult {
  const problems = inputProblems(inputs)
  if (problems.length > 0) return { ok: false, reason: 'invalid-inputs', problems }
  const soft = softConstraintIds(inputs.constraints)
  const advisory = inputs.requirements.filter(requirement => isAdvisory(requirement, soft))
  const enforced = [...inputs.requirements.filter(requirement => !isAdvisory(requirement, soft)), ...planDemands(inputs)]
  if (!satisfiable(enforced, inputs.facts)) {
    return { ok: false, reason: 'unsatisfiable', conflicts: minimalConflictSet(enforced, inputs.facts) }
  }
  const body = normalizedBody(inputs)
  return { ok: true, plan: { ...body, planId: planIdOf(body) }, unmetSoft: unmetSoftDemands(advisory, enforced, inputs.facts) }
}

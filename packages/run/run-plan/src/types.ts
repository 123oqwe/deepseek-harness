/**
 * Epic P4-03's RunPlan: the compiled, data-only plan a run executes.
 *
 * This module is the TypeScript face of `spec/run-plan.schema.json` and
 * carries no logic. Every field name and every required member matches that
 * document, so a plan that validates against one reads under the other.
 *
 * Seven of must[0]'s ten fields name vocabulary this repository already owns
 * and are imported rather than restated: a goal reference and a provenance
 * from the compiled task profile, a hard/soft constraint strength, a model
 * selection, a world's own digest, the budget dimensions, and the approval and
 * verification references the Run carries. Restating any of them would let a
 * plan and the record it points at disagree about what they mean.
 *
 * `contextTopology`, `agentGraph` and `recovery` had no existing vocabulary
 * and are defined here for the first time.
 *
 * must[2] — a plan is data — holds structurally: every leaf below is a string,
 * a number or a closed union member, so nothing a plan carries can name an
 * expression, a script or a module to execute.
 */

import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorldSpecDigest } from '@deepseek-ai/dsh-execution-world'
import type { BudgetDimension } from '@deepseek-ai/dsh-resource-budget'
import type { ApprovalRef, VerificationRef } from '@deepseek-ai/dsh-run/types'
import type { InferenceProvenance, TaskConstraintStrength, TaskGoalRef, TaskProfileRef } from '@deepseek-ai/dsh-task-profile/types'

/**
 * A plan's content-addressed identity: the lowercase hex sha256 of its
 * normalized inputs, formed the way `TaskProfileRef` and `WorldSpecDigest`
 * are.
 *
 * Never chosen by a caller (acceptance[2]): the same normalized inputs give
 * the same id, and any change gives a different one, which is what makes two
 * records naming a plan answerable against each other.
 */
export type PlanId = Branded<'PlanId'>

/** One thing the run is for, traceable to the goal message it came from. */
export interface RunPlanObjective {
  /** Stable identifier of this objective within the plan. */
  readonly id: string
  /** What the objective asks for, in the plan's own generic terms. */
  readonly statement: string
  /** The goal message this objective was compiled from. */
  readonly goalRef: TaskGoalRef
}

/** One thing the run must or should respect. */
export interface RunPlanConstraint {
  /** Stable identifier of this constraint within the plan. */
  readonly id: string
  /**
   * Whether the constraint must hold or is preferred.
   *
   * The field acceptance[0]'s minimal conflict set is computed over: an
   * unsatisfiable `hard` constraint enters the set, a `soft` one does not.
   */
  readonly strength: TaskConstraintStrength
  /** What the constraint says. */
  readonly statement: string
  /** Where the value came from and how certain the compile was of it. */
  readonly provenance: InferenceProvenance
}

/** Which model serves one node. */
export interface RunPlanModelRoute {
  /** The {@link AgentNode} this route is for. */
  readonly nodeId: string
  /**
   * The provider and model, as the agent layer spells a selection.
   *
   * A node with no route takes the deployment's default, which is resolved at
   * run time and deliberately not recorded in a plan.
   */
  readonly selection: ModelSelection
}

/** What crosses a context channel: the producer's result, a summary of it, or a reference to an artifact. */
export type ContextChannelPayload = 'result' | 'summary' | 'artifactRef'

/** How long the receiving node may keep what a channel carried: the step it was read in, the run, or durably. */
export type ContextChannelRetention = 'step' | 'run' | 'durable'

/** One directed channel: which node may read what another node produced. */
export interface ContextChannel {
  /** Stable identifier of this channel within the plan. */
  readonly id: string
  /** The node that produces what crosses the channel. */
  readonly from: string
  /** The node that may read it. */
  readonly to: string
  /** What crosses. */
  readonly carries: ContextChannelPayload
  /** How long the receiver may keep it. */
  readonly retention: ContextChannelRetention
}

/** must[0]'s `contextTopology`: every channel the plan permits, and nothing implicit beside them. */
export interface RunPlanContextTopology {
  /** The directed channels. A pair of nodes with no channel exchanges nothing. */
  readonly channels: readonly ContextChannel[]
}

/** One node the run executes. */
export interface AgentNode {
  /** Stable identifier of this node within the plan. */
  readonly id: string
  /** What the node is in the plan, in the deployment's own vocabulary. */
  readonly role: string
  /** The compiled task profile the node executes under, by its digest. */
  readonly taskProfileRef: TaskProfileRef
  /**
   * The requirement inside that profile this node exists to satisfy.
   *
   * Required and not nullable: acceptance[1] asks that every node be
   * traceable to one, and an optional field would be omitted by every
   * producer and indistinguishable from having no requirement at all.
   */
  readonly requirementId: string
  /** The {@link WorldBinding} the node runs in, absent when the run's default world serves. */
  readonly worldId?: string
  /** The {@link RunPlanBudget} entries that bound this node, absent when only run-wide budgets apply. */
  readonly budgetIds?: readonly string[]
}

/** Why one node's order before another holds: the second needs the first's result, or it must merely start after it. */
export type AgentEdgeKind = 'dataDependency' | 'ordering'

/** One ordering relation between two nodes. */
export interface AgentEdge {
  /** The node that runs first. */
  readonly from: string
  /** The node that runs after it. */
  readonly to: string
  /** Why the order holds. */
  readonly kind: AgentEdgeKind
}

/** must[0]'s `agentGraph`: the nodes the run executes and the order they may execute in. */
export interface RunPlanAgentGraph {
  /** The nodes. A plan with none executes nothing, so a compile produces at least one. */
  readonly nodes: readonly AgentNode[]
  /** The ordering relations. Nodes with no path between them may run concurrently. */
  readonly edges: readonly AgentEdge[]
}

/** One execution world a node may run in, pinned by the world's own digest rather than by a restated spec. */
export interface WorldBinding {
  /** Stable identifier of this binding within the plan, which {@link AgentNode.worldId} names. */
  readonly id: string
  /** The world's pinned identity: a changed world is a different digest and therefore a different plan. */
  readonly spec: WorldSpecDigest
}

/** One ceiling over one resource dimension. */
export interface RunPlanBudget {
  /** Stable identifier of this budget within the plan, which {@link AgentNode.budgetIds} names. */
  readonly id: string
  /** Which dimension is bounded, in the vocabulary the budget layer already owns. */
  readonly dimension: BudgetDimension
  /** The ceiling, in that dimension's own unit. A ceiling of zero would forbid the work rather than bound it, so a compile refuses it. */
  readonly limit: number
}

/** One point where the run stops until an Approval settles. */
export interface ApprovalGate {
  /** Stable identifier of this gate within the plan. */
  readonly id: string
  /** The node whose execution the gate precedes. */
  readonly nodeId: string
  /** The Approval entity that settles it. */
  readonly approvalRef: ApprovalRef
}

/**
 * The versioned contract a verification is written against (must[3]'s
 * extension point).
 *
 * A plan names the version it was compiled under; a fuller contract arrives
 * by raising `version`, never by changing what a field of an earlier version
 * meant.
 */
export interface VerificationContractRef {
  /** Which contract, in the deployment's own vocabulary. */
  readonly contract: string
  /** Which version of it, from one. */
  readonly version: number
}

/** One thing that must be verified, and the contract it is verified under. */
export interface VerificationEntry {
  /** Stable identifier of this entry within the plan. */
  readonly id: string
  /** The node whose work is verified. */
  readonly nodeId: string
  /** The Verification entity that carries the result. */
  readonly verificationRef: VerificationRef
  /** The contract version this entry was compiled against. */
  readonly verificationContractRef: VerificationContractRef
}

/**
 * What the run does when one node fails.
 *
 * A discriminated union rather than one shape with optional members: the
 * schema's conditional requirements say a `retry` carries an attempt ceiling
 * and a `substitute` carries the node that replaces it, and a union makes a
 * rule that carries neither impossible to write rather than merely invalid.
 */
export type RecoveryRule =
  | {
    /** The node this rule is about. */
    readonly nodeId: string
    /** Run the node again. */
    readonly action: 'retry'
    /** How many attempts in total, from one. */
    readonly maxAttempts: number
  }
  | {
    /** The node this rule is about. */
    readonly nodeId: string
    /** Run a named alternative instead. */
    readonly action: 'substitute'
    /** The {@link AgentNode} that replaces it. */
    readonly substituteNodeId: string
  }
  | {
    /** The node this rule is about. */
    readonly nodeId: string
    /** Give up on the node and let {@link RunPlanRecovery.terminal} decide the run's disposition. */
    readonly action: 'abandon'
  }

/** What the run does when no recovery rule applies: stop and keep the record, or stop and roll the compensations back. */
export type RunTerminalDisposition = 'halt' | 'compensate'

/** must[0]'s `recovery`: a per-node policy plus the disposition that covers everything the policy does not. */
export interface RunPlanRecovery {
  /** The per-node rules. A node with no rule takes {@link RunPlanRecovery.terminal}. */
  readonly onNodeFailure: readonly RecoveryRule[]
  /** What the run does when no rule applies. */
  readonly terminal: RunTerminalDisposition
}

/**
 * The compiled plan: must[0]'s ten fields, plus the ABI version a reader
 * checks first and the identity the plan is named by.
 *
 * Every member is required. An optional field here would be omitted by every
 * producer, which is indistinguishable from a plan that decided nothing about
 * it — the distinction acceptance[1] and the conflict set both depend on.
 */
export interface RunPlan {
  /**
   * The RunPlan ABI this document speaks.
   *
   * A reader that does not know the version refuses the plan rather than
   * reading fields it may misunderstand (must[4]).
   */
  readonly schemaVersion: number
  /** The plan's own identity, derived from its normalized inputs. */
  readonly planId: PlanId
  /** What the run is for. */
  readonly objectives: readonly RunPlanObjective[]
  /** What it must or should respect. */
  readonly constraints: readonly RunPlanConstraint[]
  /** Which model serves which node. */
  readonly modelRoutes: readonly RunPlanModelRoute[]
  /** Which node may read what another produced. */
  readonly contextTopology: RunPlanContextTopology
  /** The nodes and their order. */
  readonly agentGraph: RunPlanAgentGraph
  /** The worlds nodes run in. */
  readonly worlds: readonly WorldBinding[]
  /** The ceilings the run executes under. */
  readonly budgets: readonly RunPlanBudget[]
  /** Where the run stops for a human decision. */
  readonly approvalGates: readonly ApprovalGate[]
  /** What must be verified, and under which contract. */
  readonly verification: readonly VerificationEntry[]
  /** What happens when a node fails. */
  readonly recovery: RunPlanRecovery
}

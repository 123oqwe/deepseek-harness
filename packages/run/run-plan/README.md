---
description: "Epic P4-03's RunPlan vocabulary: the compiled, data-only plan a run executes, written as a mirror of spec/run-plan.schema.json, referencing the goal, constraint, model, world, budget, approval and verification types the repository already owns and minting only the three it had none for."
kind: "package-library"
---

# @deepseek-ai/dsh-run-plan

English | [中文](README.zh.md)

## Summary

`dsh-run-plan` holds the vocabulary Epic P4-03's must[0] fixes: a plan's objectives, constraints, model routes, context topology, agent graph, world bindings, budgets, approval gates, verification entries and recovery rules, together with the ABI version a reader checks first and the content-addressed `PlanId` a plan is named by.

`src/types.ts` is the TypeScript face of `spec/run-plan.schema.json`: same field names, same required members, so a plan that validates against one reads under the other. The compile that turns inputs into a plan — or into the minimal set of constraints that cannot all hold — lands in `src/compile.ts`, and the mount that puts a plan to work is a later stage of the same epic.

## Table of Contents

- [What this package imports rather than declares](#what-this-package-imports-rather-than-declares)
- [What is deliberately absent](#what-is-deliberately-absent)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## What this package imports rather than declares

Seven of the ten fields must[0] names have vocabulary this repository already owns, and this package imports every one of them.

`RunPlanObjective.goalRef` and `RunPlanConstraint.provenance` are `TaskGoalRef` and `InferenceProvenance` from `@deepseek-ai/dsh-task-profile`, and `RunPlanConstraint.strength` is that package's `TaskConstraintStrength`. A plan compiled from a task profile and the profile itself must agree about which goal message a decision came from; two declarations of the same reference could disagree, and nothing would notice.

`AgentNode.taskProfileRef` is `TaskProfileRef`, `WorldBinding.spec` is `WorldSpecDigest`, and `RunPlanBudget.dimension` is `BudgetDimension` — the eight members `BudgetAmounts` already names. `ApprovalGate.approvalRef` and `VerificationEntry.verificationRef` are the Run's own `ApprovalRef` and `VerificationRef`. `RunPlanModelRoute.selection` is the agent layer's `ModelSelection`.

Three fields had no existing vocabulary and are defined here for the first time: `contextTopology`, which says which node may read what another produced and for how long; `agentGraph`, the nodes and the order they may execute in; and `recovery`, what happens when a node fails. Each is data — a directed channel, an edge with a reason, a rule with a bounded action — and carries nothing to execute.

The one identity this package mints is `PlanId`, formed the way `TaskProfileRef` and `WorldSpecDigest` are: the lowercase hex sha256 of the plan's normalized inputs, never a value a caller chose.

## What is deliberately absent

**No executable leaf.** must[2] is enforced by construction rather than by a check: every leaf of a `RunPlan` is a string, a number or a member of a closed union, so there is no field a plan could carry an expression, a script or a module path in. A `Record<string, unknown>` escape hatch anywhere in this file would reopen exactly that.

**No optional field standing in for an undecided one.** Every member of `RunPlan` is required. An optional field would be omitted by every producer, which is indistinguishable from a plan that decided nothing about it — and acceptance[1]'s traceability depends on telling those apart. `AgentNode.worldId` and `AgentNode.budgetIds` are the two exceptions, and they mean something specific: the run's default world, and no node-level ceiling beyond the run-wide ones.

**No recovery rule that omits what its action needs.** `RecoveryRule` is a union over its action rather than one shape with optional members, so a `retry` without an attempt ceiling or a `substitute` without a replacement node cannot be written at all.

**Runtime invariant:** No runtime invariant companion is published: this package declares types and, from its next stage, one pure compile over a caller-assembled input. It owns no registry, no log and no `Context` value whose relation to another observation a checker could compare.

## Model Experience

None, as this package registers no prompt, schema, or tool, and a compiled plan reaches no model request: nothing mounts it yet, and the reader that would put a plan's content into a request is a later stage of this epic.

#### KV Cache effect

None; nothing here assembles or contributes to a provider request, so no prefix moves and no cached prefix is invalidated.

## Known Limitations and Deferred Work

- **No compile yet.** This stage fixes the vocabulary. `compilePlan` and `planIdOf` land in `src/compile.ts`, and until they do nothing produces a `RunPlan` — the types describe a shape no code in this repository builds.
- **No mount.** No profile carries a row for this package. A plan that nothing compiles and nothing executes is a contract waiting for its stages, which is what a C stage is.
- **`schemaVersion` has no reader.** The field exists so must[4]'s promise can be kept — an unknown version is refused rather than misread — but the refusal belongs to the compile, not to a type.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

The open question is what "normalized inputs" means precisely, because `PlanId`'s stability is measured against it. Reordering an array whose order carries no meaning must not change the id, while reordering `agentGraph.edges` — where order carries none either, though the graph it describes does — must not change it for a different reason. Which arrays are sets and which are sequences is a decision the compile has to make explicitly, and writing it down there rather than here is deliberate: a type cannot express it.

The second open question is how far the conflict set should look. acceptance[0] asks for a minimal set over hard constraints, and minimality is testable — remove any member and the rest are satisfiable. Whether a conflict between a constraint and a budget, or between a constraint and the world a node needs, belongs in the same set as a constraint-to-constraint conflict is not settled by the clause.

</details>

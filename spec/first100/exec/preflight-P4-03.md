# P4-03 preFlight — factory state

Read-only preflight taken 2026-09-14 while the queue was empty. **Measurement only: no code, no `clause-subject-audit` record.** The audit record is a start marker and belongs with a real dispatch, not with a holding preflight.

## Why this epic and not the other two READY

Three epics are READY, all wave 8. Measured against the 265-path conflict set:

| epic | declared files in the conflict set |
|---|---|
| P1-06 | 2 (`app-boot/src/index.ts`, `app-boot/src/profile.ts`) |
| P3-12 | 1 (`workspace/src/paths.ts`) |
| **P4-03** | **0** |

**P4-03 is the only one whose factory state survives S1.** A preflight of the other two would be re-measured after the merge moves their landing points.

## Readiness

Both predecessors are **ACCEPTED**: P3-01 and P4-02 (measured at `a33665cca3`). The 2026-09-14 text here explained why a `NOT_RUN` P4-02 still satisfied `check-ready.mjs:10-11`; P4-02 has since been accepted, so nothing needs explaining.

## Factory state — the C stage creates a new package

| declared path | state |
|---|---|
| `packages/run/run-plan/src/types.ts` | **absent** |
| `packages/run/run-plan/src/compile.ts` | **absent** |
| `packages/run/run-plan/tests/compile.spec.ts` | **absent** |
| `packages/run/run-plan/src/index.ts` | **absent** |
| `spec/run-plan.schema.json` | **absent** |
| `packages/run/run/src/types.ts` | present, 263 lines |
| `packages/workflow/workflow/src/types.ts` | present, 131 lines |
| `packages/core/agent/src/model-selection.ts` | present, 127 lines |

**`packages/run/run-plan` does not exist.** Five of eight declared paths are new; three existing files are modified at the U stage.

## The gate surface a new package must satisfy — learned the expensive way

`secrets-broker` cost three CI rounds because a new package was not wired into repo-level gates. P4-03 creates a package, so the same surface applies. Checked in advance:

| gate | P4-03's position |
|---|---|
| `architecture:layers` | **already covered** — `run: 'orchestration-runtime'` exists in `GROUP_LAYERS` (`check-layer-deps.mjs:172`). This is the one that bit `secrets-broker`, and `packages/run` has an entry, so a new package under it classifies automatically. |
| `constraints` | package.json must use published entry points (`main`/`types` at `lib/`, correct `repository.directory`, a `./src/*` export for `publishConfig` to strip). Copy a sibling, **not** a template. |
| `doc-standard` | README needs frontmatter + Summary + Table of Contents + Dev Note. |
| `verify-package-readme-model-experience` | needs either canonical model-context entries or the `None, as …` short form **plus an audited `SENTENCE_MODEL_EXPERIENCE` entry**. |
| `verify-package-invariants` | if no `./invariant` companion is published, the README must say so with a reason. |
| `verify-module-graph` | regenerate; a new package changes the graph. |
| `verify-translation-pairing` | English + `.zh.md` + recorded pair. |

**Caution on the sibling template.** `packages/run/run` is the obvious model and is **not** a complete one: it has `README.md` but **no `README.zh.md` and no `README.i18n.yaml`**. Copying its doc surface would reproduce a translation-pairing gap. It does have a `SENTENCE_MODEL_EXPERIENCE` entry, which is the part worth copying.

Siblings under `packages/run/`: `lease`, `lease-sqlite`, `message-bus`, `run`, `task-profile`, `taskboard-sqlite`.

## Clause shape

must[0] enumerates ten RunPlan fields; must[1] is compile-time satisfiability; must[2] is "plan is data, no executable code"; must[3] a versioned `verificationContractRef` extension point; must[4] constrains P7-01 not to break the RunPlan ABI. acceptance: minimal conflict set on unsatisfiable constraints, node→TaskProfile traceability, and a deterministic plan id from normalized inputs.

**Measured since, at `a33665cca3`:** seven of the ten must[0] fields have existing vocabulary to reference; `contextTopology`, `agentGraph` and `recovery` do not. The field-by-field sources are in lane A's `p4-03-workpack.md`. The rest of this paragraph is the question as it stood on 2026-09-14.

**Not measured (2026-09-14):** whether the ten must[0] fields have existing vocabulary to reference rather than restate. That is the P3-02 question — seven `*Policy` types that turned out to be P3-01's dimensions word for word — and it is the first thing worth checking before the C stage writes types. `packages/run/run/src/types.ts` (263 lines) and `task-profile` are where to look.

## What the compile decides, and what it refuses to (recorded 2026-09-19, before the C stage wrote it)

The execution card settles three things this stage would otherwise have to invent, and they are written here so the next reader does not re-open them.

**Satisfiability is over typed requirements, not over prose.** The card's residual line is `Satisfiability over typed constraints (capability ⊆ available, budget ≤ cap, policy allow) + deletion-based minimal conflict set (~100 LOC)`. So the compile decides three questions — a capability set contained in what is available, an amount under its cap, a policy that is allowed — and never reads a constraint's `statement`, which is free text. Translating a statement into requirements belongs to whoever wrote the statement; a compiler that guessed would produce a different plan for the same words.

**The comparison is against what the deployment offers, supplied as inputs.** `available`, `cap` and `allow` are facts the caller hands the compile, not registries it consults: a compile that asked a live registry would answer differently on two machines given the same inputs, which acceptance[2] forbids.

**A dangling reference is not an unsatisfiable requirement.** A route for a node the graph does not have, or a budget id nothing declares, means the inputs do not hang together, and the caller assembling them fixes that. A requirement that asks for more than the deployment offers means somebody has to change a decision. Both refuse to produce a plan — acceptance[0]'s "does not enter the run" — and they are reported separately so each reaches the author who can act on it. validation[1]'s four constructions (missing model, missing world, insufficient budget, policy conflict) are cases over the second kind, each asserting which kind it is.

**Every conflict member points at something an author can change.** A demand carries one of three sources: the `constraints[].id` it implements, the node and `requirementId` it comes from (acceptance[1]), or the declaration it was derived from. The third exists because the plan's own routes, world bindings and budgets are judged too, and a world or a budget several nodes share is owned by no single node — the field path is what an author edits. A caller-stated requirement that names neither a constraint nor a node is refused as an invalid input rather than carried into a set nobody can act on.

**A soft constraint is a preference, and a dropped preference is recorded.** A demand implementing a `soft` constraint never refuses a plan and never enters the conflict set, which is what the schema says where it describes `constraints`. One that cannot hold beside what is enforced is reported on the successful result instead — outside the plan, so `planId` does not move with the deployment — because a preference nothing records is one nobody can see was dropped. Each is judged alone beside the enforced set, in id order, so the report does not depend on how the inputs were listed.

**Minimality is deletion-based and deterministic.** A requirement is dropped when the rest are still unsatisfiable without it, so every survivor is one the refusal depends on, and the candidates are tried in their ids' own order so the same inputs return the same set. Several minimal sets can exist; the rule the order fixes is stated at the function and pinned by a case. A case only tests minimality when its conflict set has at least two members that are each satisfiable alone — a one-member set reads the same whether or not the code minimizes anything.

**No solver, and no second canonicalizer.** The card's reject line records why: `z3 wasm / logic-solver — SAT solver adds MBs for a ~100 LOC deletion-based minimal conflict set`. Its ruling overlay records the other half: `argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份`, so the plan id is P2-03's `canonicalizeArguments` (RFC 8785 JCS) plus sha256, the way `TaskProfileRef` is formed.

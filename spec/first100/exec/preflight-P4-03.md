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

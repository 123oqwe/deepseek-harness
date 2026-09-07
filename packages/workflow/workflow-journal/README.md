---
description: "Workflow journal and step-level resume for Epic P4-08: the per-step record of script digest, program counter, artifact refs, child and side-effect receipts and phase; the pure/side-effecting split that decides what a resume may skip; digest-change refusal; and compaction that retains every receipt."
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-journal

## Summary

`dsh-workflow-journal` answers one question after a crash: *which steps already happened, and which of them may be trusted?* Those are two questions, and the package is shaped around not conflating them. `src/types.ts` holds the per-step record must[0] enumerates and the per-entry resume decision; `src/replay.ts` walks a whole journal into a plan and compacts it without shedding evidence.

## Table of Contents

- [Completed is not the same as reusable](#completed-is-not-the-same-as-reusable)
- [A changed script refuses the whole resume](#a-changed-script-refuses-the-whole-resume)
- [Compaction keeps what cannot be regenerated](#compaction-keeps-what-cannot-be-regenerated)
- [No closure is ever serialized](#no-closure-is-ever-serialized)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Completed is not the same as reusable

A **pure** step's recorded output *is* its result, so a resume reuses it. A **side-effecting** step's recorded output is a claim about the world that may since have become false, so a resume reconciles its receipts instead — **even when the step completed and was verified.**

That last point is the one worth stating plainly: verifying that a charge was *recorded* correctly says nothing about whether the charge *happened*. `decideResume` therefore checks effect class **before** verification, and a mutation that swaps those two reddens the cases that exist for it.

`effectClass` is declared by the script, never inferred from what a step did. Inferring it would mean deciding after the fact whether an effect escaped — precisely what cannot be known from inside the process that crashed.

`verified` is a separate field from `outcome` because "it finished" and "we checked it" are different facts, and must[1] skips only steps that are both.

## A changed script refuses the whole resume

Step ids are positions in a script. Against a *different* script they name different work, so a resume guided by a stale journal would skip steps that never ran and re-run steps that did. `admitResume` refuses outright rather than degrading to a partial resume; migrating or restarting is the caller's choice, and guessing is not on offer.

## Compaction keeps what cannot be regenerated

A completed, verified, pure step's **inputs** are recomputable from the steps that produced them, so compaction drops them. Its output ref is kept — that is what a resume reuses.

**Receipts are never dropped, from any entry.** A receipt is evidence that something happened outside this process, and nothing inside it can regenerate that. `retainsAllReceipts` is exported so a caller can check the property rather than take this page's word for it.

## No closure is ever serialized

A journal entry names a step and carries data; it never carries code (must[3]). A resumed run re-enters the script and is steered by the journal, rather than reconstructing a suspended continuation — which could not be verified against the script it came from and would silently resurrect logic the script no longer contains.

## Model Experience

None, as this package exports resume decisions, journal compaction, and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **A journal is written; nothing READS one back.** `@deepseek-ai/dsh-workflow-worker-thread`'s `WorkerRun` records an entry per `agent()` call through `journalingObserver`, and `WorkerRun.journalSnapshot()` returns it. Nothing persists it and no run resumes from one, so `planResume`, `admitResume` and `receiptsToReconcile` still have no production caller: must[1]'s skip and must[2]'s reconciliation are decisions the harness can make and does not yet make.
- **Every recorded step is `side-effecting`.** The class is the script's declaration and the DSL has no syntax for it, so the host supplies the fail-closed default. That is correct for `agent()` — a child may have written files or spent money — but it means a genuinely pure step cannot be marked skippable, and must[1]'s optimisation is unreachable until the DSL can say so.
- **Reconciliation is named, not performed.** `decideResume` returns `reconcile` with the receipts to check; deciding whether an effect actually landed requires the system that produced it and is outside this package.
- **The script digest is a SHA-256 of the script body**, computed by the host that records the journal. It changes with whitespace and comments, so a cosmetic edit refuses a resume that would have been safe; refusing too often is the right direction for acceptance[1], but it is a bluntness worth naming.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

`planResume` stops at the first non-skippable step, which is correct but conservative: a later pure step whose inputs are unaffected by the re-run could in principle still be skipped. Deciding that needs a dependency graph between steps, which the journal does not currently record — it stores each step's input refs but not which step produced them.

</details>

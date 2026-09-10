# preFlight — P1-10 Contract stage

Supplements the approved epic preFlight (§12.65). Everything measured at `aea8776d11`.

## must[2]'s approval subject does not fit, and the epic preFlight assumed it did

The epic preFlight reads: "The approval subject already exists — P2-04's gate and the `approval` service — so this reads that rather than inventing a second prompt." Measured, that is half true and the other half blocks the Usage stage:

| fact | measurement |
| --- | --- |
| `ApprovalRequest` is tool-shaped | `user-approval/src/types.ts:63` requires `agent` and `toolName`. A plugin migration has neither: it is not a tool call, and the "agent" asking is a CLI invocation. |
| `approval.request()` refuses outside an open turn | `user-approval/src/index.ts:207-213` throws, and its reason is durable-log integrity: the `approval/asked` + `approval/decided` pair must be turn-enclosed, because a bare event between turns is crash-tail garbage on reload. |
| a plugin upgrade is not inside a turn | the registry's own Usage file is `apps/cli/src/plugin.ts` — a CLI command, not an agent turn. |

So must[2] cannot be closed by calling the existing service from the upgrade path, and the refusal is not an oversight to route around: it protects the audit pair this epic also needs.

**What C can and cannot promise.** C owns the DECISION — whether a migration is irreversible, and therefore whether approval is required and an export must exist — and it can name what such an approval would have to carry. It cannot promise the approval will be asked, because the seam that asks has a precondition the upgrade path cannot meet. That goes in C's note verbatim, so a reader does not take the decision for the mechanism.

**For the delegate, before U:** either the approval seam gains a turn-less audit path (a real change to P2-04's territory, with its own log-integrity argument), or the upgrade runs inside a session that opens a turn for it, or must[2]'s approval half is directed to whoever owns operator approvals outside a turn. I am not choosing between those — it is a scope ruling, and the third option in particular decides whether must[2] closes in this epic at all.

## What C delivers

`packages/plugin/plugin-migrations/src/types.ts` and `src/index.ts`, plus tests. No I/O, no service, no plugin — the package does not exist yet and starts as vocabulary and pure decisions:

- **the manifest vocabulary** must[0] names: the migration DAG, preconditions, backup strategy, rollback support.
- **is this DAG acyclic** — a cycle is refused structurally, not discovered by running out of depth, for the reason P4-09 recorded: an operator needs "this definition calls itself" reported differently from "this composition is too deep".
- **is this upgrade path admissible** — from the installed version to the requested one, every edge present, every precondition declared.
- **is this migration reversible** — and therefore whether must[2]'s approval and export are required.
- **the digest decision** for acceptance[1]: what makes a data digest and a schema version reconcilable. Recording it is the transaction's job at P.

## Naming, per the delegate's ruling

`PluginDataSnapshot` for the plugin's own durable data, config and schema. A workspace path is a NEGATIVE case, not a supported input: P3-11 owns workspace checkpointing, and the manifest's `backup strategy` field is exactly where the line would blur.

## make-vs-use, carried from the epic preFlight

`node:sqlite VACUUM INTO` is recorded `adapt` for the snapshot phase (an atomically consistent copy without stopping writers) and `umzug` a `deviation`. Neither lands in C: both are P's, and a C stage that imported either would be a decision package with a runtime dependency.

## Status

**No code written.** Freeze recorded run-and-pasted per §12.68 once the cases exist.

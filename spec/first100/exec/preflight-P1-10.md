# preFlight — P1-10 插件数据迁移、升级事务与回滚

Per lifecycle §1 and rule 1.12: written before any code, for delegate confirmation. `check-ready.mjs` reports READY (`P1-03` and `P4-12` both ACCEPTED, no declared-file overlap with an in-flight epic).

Measured at `b9bc2d1bbd`.

## What already exists, and what does not

| declared target | state |
| --- | --- |
| `apps/cli/src/plugin.ts` | present |
| `packages/storage/storage/src/backend.ts` | present |
| `packages/storage/storage/src/registry.ts` | present |
| `packages/settings/settings/src/index.ts` | present |
| `packages/plugin/plugin-migrations/**` | **does not exist** — the whole subject is new |

The nearest live mechanism is `STORAGE_SQLITE_SCHEMA_VERSION` (`storage-sqlite/src/schema.ts:20`, currently `1`), which stamps `user_version` and **refuses** an on-disk version it does not recognise (`:82`). That is the repo's stated stance — backends reject old on-disk formats, `SCHEMA_VERSION` is monotonic — and it is the opposite of a migration path. **P1-10 does not weaken it:** rejecting an unknown format stays correct; what this epic adds is the ability to CONVERT a known older format under a transaction, so the reject remains the failure mode for anything unconverted.

## make-vs-use

The ledger's community survey names the duplication this epic exists to end: **at least five competing rollback/checkpoint implementations** (`dsh-checkpoint-rewind`, `dsh-turn-rewind`, `dsh-undo`, `dsh-recall`, `dsh-checkpoint-diff`), each defining its own snapshot granularity and restore semantics, plus plugin managers each doing their own git/config snapshot in preflight.

Its own note draws a distinction this epic must respect: **workspace checkpointing and execution-world snapshotting are two different things**, and the ledger assigns the workspace-checkpoint seam to P3-11. P1-10 is about a PLUGIN's data, config and schema across an upgrade — not about rewinding a session.

I found **no adopt-role OSS row for P1-10 itself** in the make-vs-use ledger; the rows near it are community-duplication observations rather than package verdicts. **That is a gap I am not filling by assumption** — see the open questions.

## Stage split (registry requires 1–5 files per subtask; it declares 8)

| subtask | files | contents |
| --- | --- | --- |
| **C** | `plugin-migrations/src/types.ts`, `src/index.ts`, tests | The migration DAG, preconditions, backup strategy and rollback-support declarations as a manifest vocabulary, plus the pure decisions over it: is this DAG acyclic, is this upgrade path admissible, is this migration reversible. No I/O. |
| **P** | `plugin-migrations/src/transaction.ts`, `storage/src/backend.ts`, `storage/src/registry.ts` | The six-phase transaction the registry names: freeze → snapshot → migrate in quarantine → validate → atomic switch → health check. The atomic switch and the quarantine are storage-backend concerns, which is why the two storage files are here and not in C. |
| **U** | `apps/cli/src/plugin.ts`, `settings/src/index.ts`, `tests/rollback.e2e.ts` | The real upgrade path calling it, and the fault campaign. acceptance[0] (crash at every step leaves EITHER the old or the new version whole, never mixed) closes here, because a crash campaign against anything less than the real path proves nothing. |

## Clause subjects, and where each closes

| clause | subtask | note |
| --- | --- | --- |
| must[0] manifest declares DAG / preconditions / backup strategy / rollback support | C | Vocabulary + validation. |
| must[1] the six-phase upgrade | **P** | The phases are an ordering over real effects; a pure module can decide the order but cannot BE it. |
| must[2] irreversible migration needs human approval and an export | C (decision) + U (the approval) | The approval subject already exists — P2-04's gate and the `approval` service — so this reads that rather than inventing a second prompt. |
| acceptance[0] crash at each step, no mixed state | **U** | The fault campaign against the real path. |
| acceptance[1] data digest and schema version reconcilable | C + P | Digest is a decision; recording it is the transaction's. |
| acceptance[2] a failed upgrade does not change approved permissions | **U** | Reads P2-02/P2-04's permission state; this epic must not write it. |

## Open questions for the delegate — not assumed

1. **No adopt-role OSS row exists for P1-10.** The user directive is to reuse rather than hand-write, and a six-phase transactional upgrade with quarantine and atomic switch is a well-trodden problem. Before I write `transaction.ts`, does the ledger need an OSS pass for this epic (the way `cockatiel` was judged for P4-11)? Writing it hand-rolled without that pass is the §12.62 mistake repeated.
2. **Relationship to `SCHEMA_VERSION`'s reject-old-formats stance.** My reading is that P1-10 adds conversion for KNOWN older versions and leaves the reject as the fallback for unknown ones. That is a product-boundary reading, and CLAUDE.md's pre-release stance is explicit enough that I would rather have it confirmed than assume it.
3. **Scope against P3-11.** The ledger separates workspace checkpointing (P3-11) from execution-world snapshotting. `snapshot data/config` in must[1] sits near that line. I read P1-10 as owning only the plugin's own durable data, config and schema — not workspace files. Confirm before the C stage fixes the vocabulary, because the manifest's `backup strategy` field is where the line gets drawn.

## Status

**No code written.** Awaiting answers to the three questions above, and to P4-11's outbox question, before either C subtask begins.

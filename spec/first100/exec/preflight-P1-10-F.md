# preFlight — P1-10 Fault stage (the upgrade-transaction boundary matrix)

Per lifecycle §1: written before any code. Measured at `60ae16f046`, against the **facet-era** transaction (`packages/plugin/plugin-migrations/src/transaction.ts`, `apps/cli/src/plugin-migration.ts`) — not the superseded `plugins/<name>/data/data.db` medium §12.78 replaced. C, P and U are GREEN@`e3004c9276` (`ledger.md:24`), so the subject this stage measures is the landed one.

## The delegate's nine rows, measured before accepting any of them

Three are already frozen elsewhere, two are half-covered, two name a state the code cannot reach as written, and two are real and new. A row that re-proves a frozen case adds nothing; a row asserting an unreachable state proves nothing.

| # | proposed row | measured | verdict |
| --- | --- | --- | --- |
| ① | lease superseded → switch refuses (data untouched, **reports holder**) | The refusal is frozen at P: *"the lease is what makes the switch safe REFUSES to switch when this holder was superseded"* (`transaction.ts:206`). **The reporting half has no subject**: that path returns `{ upgraded: false, failedAt: 'switch' }` and sets no `refusal`, and `MigrationRefusal` (`types.ts:129-157`) has **no holder-carrying kind at all** — eleven kinds, none of them fencing. §12.78 says P4-07 owns `held-by-another` carrying the holder; this transaction's outcome cannot express it. | **half covered, half has no subject — needs a decision, not a case** |
| ② | no migration facet → `backend-cannot-migrate`, failed-upgrade path (data untouched + `rollbackCode` + reported) | Refusal frozen at P: *"refuses BY NAME when the backend has no migration facet"* (`transaction.ts:154-160`). The **consumer half** — that this refusal drives `rollbackCode` and is reported rather than swallowed — is not in any live case. | **transaction half covered; consumer half is real and new** |
| ③ | migration module `import()` throws | Real, and **an unhandled path**: `resolvePluginUpgrade` wraps only `resolveBundleDir` in `try` (`plugin-migration.ts:709-712`); the `await import(...)` at **`:717` is outside any `try`**, so a module that throws on import escapes as a rejected promise instead of becoming a `refused` resolution with a name. | **real, new, and a defect** |
| ④ | module returns a non-array / invalid record | The literal shape does not exist — `migrate` returns `UnitContent`, not an array. But measuring the neighbourhood found a **live mismatch**: the guard at `:722` tests only `descriptor`, while its own message reads *"must export `descriptor` and `migrate`"* (`:726`). A module exporting `descriptor` and no `migrate` is **admitted** and fails later as a `TypeError` inside the transaction, past the point the resolution was supposed to refuse it. | **restated to the real defect the row was pointing at** |
| ⑤ | sqlite ATTACH / sidecar failure | `storage-sqlite`'s facet is the adopted `VACUUM INTO` path. **No shipped bundle mounts `storage-sqlite`** (base mounts `storage-json` at `dshHomePath('storages')`) — the same fact that made the medium correction necessary. A row here asserts a failure of a backend no profile runs. | **keep, but as the BACKEND's own case, not the product path — and say so** |
| ⑥ | `exportUnit` target unwritable (irreversible path: export fails → no confirmation asked, data untouched) | The happy path is frozen at U (*"exports one unit to a path the operator keeps"*, *"exports the live unit to a path outside the medium"*). The **failure** is not, and the ordering it protects is real: `admitIrreversibleUpgrade` refuses at freeze before anything is copied (`transaction.ts:162-166`). | **real and new** |
| ⑦ | recovery when the rollback target is gone (record has the intent half, the directory does not exist) | Real: `recoverUpgrade` (`transaction.ts:263-274`) calls `facet.rollbackTo` on the recorded handle without asking whether it still resolves. What a crash-plus-manual-cleanup leaves is exactly this. | **real and new** |
| ⑧ | `--confirm` digest mismatch / stale digest after the path changes | Frozen twice already — C: *"REFUSES a confirmation obtained for a DIFFERENT path"*, *"gives two DIFFERENT step lists different digests"*; U: *"refuses a confirmation that names another path"*. | **covered — drop** |
| ⑨ | pnpm code rollback fails → loud, non-zero exit, data stays on the old version | `rollbackCode` exists (`plugin-migration.ts:531`) and §12.77's requirement ② named it. No live case covers its **failure**, which is the one that matters: the data has been rolled back and the code has not, so the two halves disagree and the operator must be told. | **real and new** |

## What ① actually needs, and why it is not a test

Rows are cheap; this one is a design question the fault stage would otherwise paper over. Today a superseded holder refuses the switch **anonymously** — correct behaviour, unusable diagnostics: the operator learns the upgrade stopped at `switch` and not that another process owns the work item. Two honest options:

1. add a `held-by-another` kind to `MigrationRefusal` carrying the holder, and set it on the fencing path; or
2. rule that the fencing refusal deliberately carries no holder, because the lease layer already reports it and duplicating it here would let the two disagree.

**I am not choosing this in a fault matrix.** (1) changes a public union in the epic's own definition package; (2) is defensible and makes the row a documented absence. The freeze follows the ruling — asked as part of this preFlight, not decided by whichever case is easier to write.

## The matrix, as data with the count guarded

Following P4-08.F, P2-04.F and P4-11.F: boundaries enumerated as data, each named once, with the count asserted so a silently dropped row fails.

1. a migration module that **throws on import** is refused by name, not propagated (row ③ — reddens today)
2. a module exporting `descriptor` but **no `migrate`** is refused by the guard whose message already claims to test it (row ④ — reddens today)
3. a module exporting neither is refused the same way, so the guard is not special-cased to one field *(control for 2: it passes today, and must keep passing)*
4. the **export target is unwritable** on an irreversible path: refused at freeze, nothing copied, no confirmation asked (row ⑥)
5. a **reversible** upgrade with the same unwritable path proceeds, so the refusal is scoped to must[2] *(control for 4)*
6. **recovery with the rollback target gone**: reported, and the record is not cleared as though it had been undone (row ⑦)
7. recovery with the target present still rolls back and clears *(control for 6)*
8. **code rollback failure** is loud and non-zero, and the data stays on the old version (row ⑨)
9. code rollback success is silent and zero *(control for 8)*
10. **`backend-cannot-migrate` reaches the consumer**: it drives the failed-upgrade path and is reported, not swallowed (row ② consumer half)
11. the sqlite facet's **snapshot primitive failing** is the backend's own refusal, on a backend no shipped bundle mounts (row ⑤, stated as such)

Row ① appears once the ruling lands, as either a twelfth case or a recorded absence.

## Mutations, planned

Each of 1, 2, 4, 6, 8, 10 gets a mutation that reddens **only** its own case, with its control case staying green — the shape M67/M68/M69 took on P4-11's mount slice. Case 3, 5, 7 and 9 are the controls, and a mutation that reddens a control alongside its target means the pair is not separating what it claims to.

## 4.4a at signing

Every row names a production call site: `resolvePluginUpgrade` (`apps/cli/src/plugin-migration.ts`), `runUpgrade` / `recoverUpgrade` (`packages/plugin/plugin-migrations/src/transaction.ts`), `rollbackCode` (`apps/cli/src/plugin-migration.ts:531`). The report will name them rather than count them. Before `--accept`, the make-vs-use row's `VACUUM INTO` adopt is matched against the sqlite facet implementation, per the delegate's instruction.

## Freeze target

The F freeze cites the **current** facet-era test files — `packages/plugin/plugin-migrations/tests/transaction.spec.ts` and `apps/cli/tests/plugin-migration-bridge.spec.ts` — never the superseded medium's. Whether the matrix lands in its own spec file or beside the existing cases follows the P/F argv-sharing rule (§12.53 (iii)), which is read before the freeze is written, not after.

## Status

**No code written.** Two rows (③ and ④) are *predicted* to redden against the landed tree — read from source (`plugin-migration.ts:709-717` and `:722-726`), not yet executed, so the RED run is what settles it. Predicting a red and then observing it is the honest order; asserting it here would be the description-instead-of-evaluation shape BLOCKED-051 names. One row (①) is blocked on a delegate ruling. Freeze is recorded run-and-pasted per §12.68 once the cases exist.

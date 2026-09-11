# P1-10 — plugin data migration, the upgrade transaction, and rollback

The fault boundaries this epic's F stage enumerates, placed against the six phases `runUpgrade` actually has. Written after the F preFlight (`preflight-P1-10-F.md`), which planned eleven rows; the matrix as built carries fifteen, across two files.

## Where the fifteen boundaries live

| file | boundaries |
|---|---|
| `apps/cli/tests/plugin-migration-fault-matrix.spec.ts` | 01, 02, 03, 04, 13, 14 |
| `packages/plugin/plugin-migrations/tests/rollback.e2e.spec.ts` | 05–12, 15 |

Numbering is per-file across this repository — other epics reuse `fault boundary 01` for their own matrices — so the set is identified by these two files, not by the numbers alone.

## The phase table

`UPGRADE_PHASES` is `[freeze, snapshot, quarantine, validate, switch, health-check]` (`plugin-migrations/src/transaction.ts`). Each boundary is placed by the entry point it drives and the primitive its fault injects, read from the case rather than from its title:

| phase | F-stage fault boundary | `transaction.spec.ts` `failedAt` assertions |
|---|---|---|
| `freeze` | — | 4 |
| `snapshot` | **11** | — |
| `quarantine` | **12** | 1 |
| `validate` | — | 1 |
| `switch` | **05, 06, 07, 15** | 1 |
| `health-check` | — | 3 |

**Nine of the fifteen are outside the phase machine entirely**, and that is a property of what they test rather than a gap:

| boundaries | entry point | why it is outside |
|---|---|---|
| 01, 02, 03, 04 | `resolvePluginUpgrade` | module resolution and admission, before a transaction is opened at all |
| 08, 09, 10 | `recoverUpgrade` | recovery of an upgrade that already failed; there is no live transaction to be in a phase of |
| 13, 14 | `recoverInterruptedUpgrades` | the command-level sweep over interrupted records |

Boundary 15 is placed by its injected fault, not by the primitives its body mentions: it constructs `FaultyBackend('switchIn')`, so `materialize` has already succeeded and `discard` is the assertion about cleanup. The failing primitive is `switchIn`, which is `switch`.

## The two files are exact complements, which is the useful reading

The F matrix covers `snapshot`, `quarantine` and `switch`. `transaction.spec.ts` covers `freeze`, `validate`, `health-check`, `quarantine` and `switch` — every phase except `snapshot`, the one the F matrix does cover.

So no phase is unevidenced, and neither file evidences all six. A reader checking only the F stage would conclude `freeze`, `validate` and `health-check` have no fault coverage; a reader checking only the unit spec would conclude `snapshot` has none. Both conclusions are wrong, and the reason is that the F matrix injects faults at the BACKEND primitives while `transaction.spec.ts` drives phase outcomes through the request.

## What this table is not

It is not a claim that every phase is covered to the same depth. `freeze` carries four assertions and `validate` one; `snapshot` has a single boundary, and it rests on the sqlite facet — a backend no shipped bundle mounts, recorded as such in the F preFlight's row ⑤. The table says which phases have a fault case and where, not that the set is sufficient.

It is also not a claim about `runUpgrade`'s ordering: the phases are asserted individually, and `transaction.spec.ts` pins the sequence separately as a literal array equality plus a uniqueness check.

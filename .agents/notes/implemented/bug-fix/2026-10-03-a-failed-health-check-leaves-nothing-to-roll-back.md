# Agent Note: A failed health check leaves nothing to roll back

Status: implemented

English | [中文](2026-10-03-a-failed-health-check-leaves-nothing-to-roll-back.zh.md)

## Problem

When a plugin upgrade's health check failed, the transaction rolled the unit back in process but left the upgrade record naming the replaced state as the rollback target. The next `dsh plugin` command recovered from that record: storage-json's `rollbackTo` removed the live file, which was the restored old version, and then failed to rename a target that no longer existed. The plugin's data was gone and every later command reported an unrecoverable upgrade (P1-10 blind review 1-1).

## Decision

- After restoring the replaced state, the transaction writes the record back without `previousHandle`. A later recovery then only discards the snapshot and clears the record; the live unit is not touched.
- `rollbackTo` refuses a target that no longer exists before removing anything, so a crash between the in-process rollback and that record write stops recovery without losing data. storage-json now checks this first; storage-sqlite already refused, because a missing target reads as unstamped. The `MigrationFacet` contract states it.

## Alternatives considered

- **Make `rollbackTo` a no-op when the target is gone.** A target can also be missing because something deleted it while the live unit holds migrated data; skipping would leave that data in place under a record that says the upgrade did not finish.

## Consequences

- A failed upgrade can be retried; the plugin keeps its old data.
- Not covered: if the process dies between the in-process rollback and the record rewrite, recovery refuses and names the missing target; the data is intact, but the record has to be cleared by hand.

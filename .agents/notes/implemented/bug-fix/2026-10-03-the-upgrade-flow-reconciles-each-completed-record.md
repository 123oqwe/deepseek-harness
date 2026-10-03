# Agent Note: The upgrade flow reconciles each completed record against the medium

Status: implemented

English | [中文](2026-10-03-the-upgrade-flow-reconciles-each-completed-record.zh.md)

## Problem

BLOCKED-302 condition [1], P1-10 acceptance[1]: `reconcileUpgrade` compared a plugin's upgrade record with the medium, but its only caller, `reportUnreconciled`, had no caller, and it compared the package version rather than the schema version. `migrateChangedPlugins` skipped a plugin whose medium was already at the version its new build wants, and reported a migration as succeeded, in both cases without comparing the record to the medium. Lane A's A-540v2 measured both: a completed record whose schema version disagrees with the medium went through on the skip path and after a migration.

## Decision

- **Every completed record the flow meets is reconciled** (ruling (b), 2026-09-27): on the skip path, the record of an earlier upgrade; after a migration, the record the transaction has just written. A record with no achieved half is an interrupted upgrade, which the recovery pass before the package manager handles, so it is not reconciled.
- **Reconciling compares the recorded schema version with the version stamped on the medium; right after a migration it also compares the recorded data digest with the digest of a snapshot of the medium's records.** The snapshot is discarded afterwards. On the skip path the digest is not compared, because the plugin's own writes since its last upgrade change it. The package version is never compared: it moves independently of both.
- **A disagreement fails the plugin, so the caller puts its code back.** On the skip path the data has not moved. After a migration the replaced data goes back through the record's `previousHandle`, and the record keeps only its intent half, which the next run's recovery clears with nothing to undo.
- `UpgradeEnvironment` gains `readRecord`, beside `writeRecord`; `reconcileUpgrade` takes the record and is a pure comparison; `reportUnreconciled` reads the record and the medium and names both sides.

## Alternatives considered

- **Reconcile only after `runUpgrade`.** A medium that was restored or edited and is not migrated again would pass unchecked.
- **Compare the data digest on the skip path too.** A completed record is never cleared, so every plugin that wrote data after its last upgrade would be refused on its next package update.
- **Leave the data at the new version when the record disagrees after a migration.** The caller puts the code back on any failure, so new data would meet old code, the mixed state acceptance[0] forbids.

## Consequences

- A plugin whose medium disagrees with its completed record cannot be installed or updated until the medium or the record is put right; the report names both sides.
- Verification: A-540v2 (`apps/cli/tests/plugin-migration-reconcile.spec.ts`), whose two disagreement cases differ from the medium only in the recorded schema version, with a consistent record whose package and schema versions differ as the control.

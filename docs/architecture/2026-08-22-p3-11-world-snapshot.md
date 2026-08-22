# Agent Note: P3-11 — ExecutionWorld Snapshot / Restore / Rollback
## Contract
- SnapshotStore.create: world + files -> snapshot with SHA-256 digests
- SnapshotStore.restore: snapshot -> new world identity (old tokens not inherited)
- SnapshotStore.verifyContent: files -> match against snapshot digests
- SnapshotStore.getRollbackLog: -> lineage of rollback events
## Dependencies: P3-01, P6-09

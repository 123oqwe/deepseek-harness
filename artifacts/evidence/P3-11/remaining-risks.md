# P3-11 Remaining Risks

1. Snapshot is in-memory; persistence to disk not yet implemented.
2. Process/network/IPC state restoration is stubbed; only file digests verified.
3. Concurrent snapshot creation during running actions not fully guarded.
4. Provider version mismatch handling is defined but not enforced on restore.

## Remaining Risks (P4-10)
1. Scale lane testing (1k queued / 100 active) — needs integration with workflow runtime.
2. Deadlock detection across multiple resource locks — needs graph-based cycle detection.
3. Real token budget accounting — needs integration with LLM adapter.
4. Integration with Worker Lease (P4-07) for fencing — interface defined, integration deferred.

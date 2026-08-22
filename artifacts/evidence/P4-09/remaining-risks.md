## Remaining Risks (P4-09)
1. Detached workflow lifecycle (UI disconnect survival) requires integration with Run Service (P4-01) and Worker Lease (P4-07) — tested at unit level only.
2. Full workflow version upgrade with old Run resume requires integration with Workflow Journal (P4-08) — tested at version resolution level only.
3. E2E tests for UI disconnect/reconnect require full stack — marked NOT_RUN.
4. Real workflow DSL serialization requires integration with worker thread — deferred.

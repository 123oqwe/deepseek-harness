# P0-04 Remaining Risks

1. **81 known upstream violations exempted.** The upstream codebase has known upward dependencies (e.g., core/sdk packages importing llm types, shell packages importing subprocess). These are documented in the EXEMPTED_UPWARD_DEPS set in check-layer-deps.mjs. New violations introduced by recovery work are NOT exempted and will fail CI.

2. **Layer assignments may need adjustment.** The layer assignments in the LAYERS map are based on the current upstream package structure. As upstream evolves, packages may need reclassification.

3. **No cycle detection yet.** The checker currently detects upward dependencies but does not detect circular dependencies (A -> B -> A). This could be added with a graph traversal algorithm.

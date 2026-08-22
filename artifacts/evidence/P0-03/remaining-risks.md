# Remaining Risks — P0-03

1. The checker scans TypeScript imports but does not yet verify that every Service Definition has a provider fixture, consumer composition test, and unload rollback test. These checks require runtime analysis beyond static import scanning.

2. The allowlist has one entry for a legacy deep import in agent-loop. This entry must be resolved by its removal date (2026-12-01) or renewed.

3. The checker does not yet detect dynamic imports or require() calls. Only static ES module imports are checked.

4. The architecture.layers.json is manually maintained. As the repository evolves, new capability families must be added to the layer definitions.

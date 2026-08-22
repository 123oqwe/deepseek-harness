 # Remaining Risks — P0-06

 1. The schema registry is a standalone module. It has not yet been integrated into session replay, SDK initialize, or plugin load. The integration will happen as dependencies (P0-01) are wired into the boot process.

 2. The built-in schemas are currently declared with static version numbers. As the actual protocol types evolve, these versions must be kept in sync with the TypeScript types in packages/core/session and packages/sdk/protocol.

 3. The migration engine chains migrations one minor version at a time. Major version transitions that skip intermediate minors are not yet supported. This is acceptable for v0.x schemas but may need enhancement for v1.x+ evolution.

 4. The negotiateSchema function does not yet support downgrading to a lower compatible version when the server only supports older versions. This is an edge case that may need handling in production deployments.

 # P0-06: Schema Registry and Compatibility Rules

 ## Problem
 The SDK has no protocol negotiation. Session events and various types directly become part of the wire protocol. Adding fields or closing unions easily breaks old clients, old plugins, and persisted logs.

 ## Contract
 - Each persistent/wire-protocol object declares a schemaId, major/minor version, compatibility rule, and optional migration function.
 - New fields are backward-compatible by default; deletions/renames/semantic changes require major version and migration.
 - Schema negotiation between client and server finds compatible or migratable versions.
 - Migrations can be reversible or one-way; backward migration of irreversible migration throws.

 ## State Machine
 - Schema registered -> checkCompatibility -> compatible/incompatible
 - Schema registered -> negotiateSchema -> agreed/not agreed
 - Migration registered -> migrate -> success/failure

 ## Failure Semantics
 - Duplicate schema registration: throws "already registered"
 - Incompatible versions: returns compatible=false with reason
 - No migration path: throws with from/to versions
 - Irreversible backward migration: throws "not reversible"

 ## Compatibility
 - New package: `@deepseek-ai/dsh-schema-registry` under `packages/schema/`
 - Built-in schemas: session-event, sdk-protocol, plugin-manifest, settings (all v0.1)
 - No existing packages modified

 ## Rejection
 - Not introducing vertical business logic
 - Not replacing existing TypeScript types with schema-validated types

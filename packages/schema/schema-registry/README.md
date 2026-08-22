 # Schema Registry

 Unified Schema Registry with versioning, compatibility rules, and migration functions for persistent and wire-protocol objects.

 ## Features

 - Register schema definitions with semantic versions (major.minor)
 - Check compatibility between versions (backward, forward, full, none)
 - Negotiate schema versions between client and server
 - Register and chain migration functions between versions
 - Built-in schemas for session-event, sdk-protocol, plugin-manifest, settings

 ## Usage

 ```ts
 import { registerSchema, checkCompatibility, negotiateSchema, registerMigration, migrate } from '@deepseek-ai/dsh-schema-registry'

 // Register a schema
 registerSchema({ schemaId: 'my-schema', version: { major: 1, minor: 0 }, compatibility: 'backward', description: 'My schema' })

 // Check compatibility
 const result = checkCompatibility('my-schema', { major: 1, minor: 0 }, { major: 1, minor: 1 })

 // Register a migration
 registerMigration({
   schemaId: 'my-schema',
   from: { major: 1, minor: 0 },
   to: { major: 1, minor: 1 },
   migrate: (data) => ({ ...data, newField: 'default' }),
   reversible: true,
   reverse: (data) => { const { newField, ...rest } = data; return rest },
 })

 // Apply migration
 const migrated = migrate('my-schema', { major: 1, minor: 0 }, { major: 1, minor: 1 }, oldData)
 ```

 ## Compatibility Rules

 | Rule | Description |
 | --- | --- |
 | backward | New optional fields are OK; removed fields need major bump |
 | forward | Old client can read new data (extra fields ignored) |
 | full | Both backward and forward compatible |
 | none | Breaking change; requires major version and migration |

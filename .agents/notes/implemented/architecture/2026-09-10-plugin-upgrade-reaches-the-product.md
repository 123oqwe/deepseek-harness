# Agent Note: The plugin upgrade transaction reaches the product

Status: implemented

English | [中文](2026-09-10-plugin-upgrade-reaches-the-product.zh.md)

## Problem

Epic P1-10 built a six-phase upgrade transaction with a green library and zero production callers. `runUpgrade` was reachable only from its own tests, the vocabulary it consumed (`PluginMigrationManifest`) was declared by nothing any plugin author writes, and the medium it acted on was a `plugins/<name>/data/data.db` path nothing else in the tree touches. Three separate ways for a complete-looking design to have no subject.

## Decision

`dsh plugin add` / `update` now runs the transaction. `runPlugin` holds one cross-process fencing lease across the WHOLE span — crash recovery, pnpm, data migration, layer reconciliation — because a lease released between the package manager and the migration reopens exactly the window the epic exists to close: new code installed, data not yet converted, another process free to start.

The transaction reaches the medium through `StorageBackend`'s optional `migration` facet, never a path. A new facet operation, `stampedVersion`, answers the question the upgrade actually has: which version is the DATA at. That is neither the package version (which moves independently) nor the version the new build wants, and only the medium knows it. `storage-json`'s `per-record` layout reports no stamp, because it stamps each record and reads a record at another version as absent — it self-heals rather than migrating.

The manifest vocabulary is bridged rather than duplicated: `apps/cli/src/plugin-migration.ts` reads P1-01's `dsh.migrations` and `dsh.dataStores` from the INSTALLED new version, derives the unit from the declared data store, and loads each step's module by `import()` — gated by the same `evaluatePreMountAdmission` a production boot applies, because running a migration module executes the plugin's own code in the CLI process. `MigrationDeclaration` gained one optional field, `module`; a declared step without one refuses the whole chain rather than guessing a convention.

## Alternatives considered

**Call `runUpgrade` after pnpm, outside the lease.** The first shape released the lease when the environment body returned, so the package manager ran unprotected. It is simpler and it reopens the exact window the epic closes.

**Give the transaction a path of its own.** The original `plugins/<name>/data/data.db` needed no storage backend and no facet. It also had no subject: the harness keeps plugin data in the storage hub's units, so the transaction would have migrated a file nothing reads.

**Declare migrations in a vocabulary this epic owns.** A `PluginMigrationManifest` written directly by plugin authors would need no bridge. It would also be a second manifest beside P1-01's, with nothing deciding which one is authoritative.

**Derive the schema version from the package version.** Free, and wrong: the two move independently, so an upgrade would plan a path between versions no manifest declares.

## Consequences

What this bought is one product path where a plugin's data follows its code, under a single lease, over any medium whose backend implements the facet. What it cost is four stated gaps, carried openly rather than hidden behind green tests:

- **`validate` and `healthCheck` accept unconditionally.** Both mean asking the plugin, and a package-manager command mounts no plugin. They stay real phases so a booted-plugin probe replaces two closures and nothing else.
- **`backup` and `reversible` are defaulted at the bridge**, because P1-01's declaration carries neither. Defaulted there rather than in the decision package, so the gap is visible where the two vocabularies meet: today every declared migration reads as snapshot-backed and reversible, and an irreversible one cannot be expressed.
- **A plugin declaring more than one data store gets no unit.** Picking one would migrate an arbitrary half of its data.
- **`storage-sqlite` has no migration facet yet**, so a deployment on that backend is refused by name (`backend-cannot-migrate`) rather than silently skipped.

### Why it is recorded

The reusable lesson is not about migrations. A stage can be green in every test it owns and still have no production subject, in three independent ways: no caller, an invented vocabulary, an invented medium. Each is invisible to the suite and each is found by the same question — name the production call site a `grep` can find.

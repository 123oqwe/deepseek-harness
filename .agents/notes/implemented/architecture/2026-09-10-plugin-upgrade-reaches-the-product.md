# Agent Note: The plugin upgrade transaction reaches the product

Status: implemented

English | [中文](2026-09-10-plugin-upgrade-reaches-the-product.zh.md)

## Problem

Epic P1-10 built a six-phase upgrade transaction with a green library and zero production callers. `runUpgrade` was reachable only from its own tests, the vocabulary it consumed (`PluginMigrationManifest`) was declared by nothing any plugin author writes, and the medium it acted on was a `plugins/<name>/data/data.db` path nothing else in the tree touches. Three separate ways for a complete-looking design to have no subject.

## Decision

`dsh plugin add` / `update` now runs the transaction. `runPlugin` holds one cross-process fencing lease across the WHOLE span — crash recovery, pnpm, data migration, layer reconciliation — because a lease released between the package manager and the migration reopens exactly the window the epic exists to close: new code installed, data not yet converted, another process free to start.

The transaction reaches the medium through `StorageBackend`'s optional `migration` facet, never a path. `stampedVersion` answers the question the upgrade actually has: which version is the DATA at. That is neither the package version (which moves independently) nor the version the new build wants, and only the medium knows it. `storage-json`'s `per-record` layout reports no stamp, because it stamps each record and reads a record at another version as absent — it self-heals rather than migrating.

The manifest vocabulary is bridged rather than duplicated: `apps/cli/src/plugin-migration.ts` reads P1-01's `dsh.migrations` and `dsh.dataStores` from the INSTALLED new version, derives the unit from the declared data store, and loads each step's module by `import()` — gated by the same `evaluatePreMountAdmission` a production boot applies, because running a migration module executes the plugin's own code in the CLI process. `MigrationDeclaration` gained `module`, `reversible` and `backup`; the last two are required whenever a step ships a module, and a declared step with no module refuses the whole chain rather than guessing a convention. The unit an upgrade targets is the migration module's own exported `descriptor` — the value the plugin passes to `kv.open` — not a shape assembled from a domain name.

## Alternatives considered

**Call `runUpgrade` after pnpm, outside the lease.** The first shape released the lease when the environment body returned, so the package manager ran unprotected. It is simpler and it reopens the exact window the epic closes.

**Give the transaction a path of its own.** The original `plugins/<name>/data/data.db` needed no storage backend and no facet. It also had no subject: the harness keeps plugin data in the storage hub's units, so the transaction would have migrated a file nothing reads.

**Declare migrations in a vocabulary this epic owns.** A `PluginMigrationManifest` written directly by plugin authors would need no bridge. It would also be a second manifest beside P1-01's, with nothing deciding which one is authoritative.

**Derive the schema version from the package version.** Free, and wrong: the two move independently, so an upgrade would plan a path between versions no manifest declares.

## Consequences

What this bought is one product path where a plugin's data follows its code, under a single lease, over any medium whose backend implements the facet — and where every phase of the transaction can actually refuse. `validate` reads the migrated copy back through the facet and checks that it materialized, that it carries the version it was migrated TO, and that the plugin's own optional `validate` export accepts it; the recorded digest is the medium's digest of the CONTENT, so a reconciliation compares data with data rather than a version number with itself. The health check opens the unit through the storage hub with the new build's descriptor and reads it — a unit still stamped at the old version fails `version-mismatch` there, which is the product's definition of "the new version is not usable". `storage-sqlite` implements the facet too: one database holds every unit, so a snapshot is a sidecar database carrying that unit's rows, and a file-level copy would have made rolling back one unit a rollback of all of them.

`MigrationDeclaration` now requires `reversible` and `backup` whenever a step ships a `module`, and the manifest refuses one that omits either. Nothing is defaulted at the bridge: a defaulted `reversible: true` made must[2] unreachable in exactly the case it exists for, so `dsh plugin update --confirm <digest>` now has a path that can demand it. An irreversible upgrade exports the unit to a path the operator keeps BEFORE any confirmation is weighed, then refuses with the digest to pass back; the confirmation is checked inside `runUpgrade`, the operation that makes the change, so no caller can skip it.

Every refusal is named. A plugin that declares more than one data store, ships a step without a module, exports no `descriptor`, or exports one whose version disagrees with its declarations is refused by name and counted as a FAILED upgrade — which puts its code back to the version its data is at, rather than leaving new code to meet old data at the next boot.

What it cost, carried openly rather than hidden behind green tests:

- **The health check is an open-and-read, not the plugin's own opinion.** A package-manager command mounts no plugin, so "does it work" is answered by the strongest question available without one: the new build's descriptor against the switched-in data. A plugin whose data opens but whose logic rejects it is not caught here.
- **A plugin declaring more than one data store is refused, not partially migrated.** Migrating one of several stores would move an arbitrary part of its data.
- **A `per-record` JSON unit and a `:memory:` SQLite database have no migration.** The first stamps each record and reads an off-version record as absent, so it self-heals; the second has no directory for a sidecar. Both are refused by name.

### The medium the first facet wrote to did not exist

The first `migration` facet read and wrote `{ version, records }`. The JSON backend's real document is `{ unit: { name, version }, global, tables }` — `format.ts` has always said so — so `stampedVersion` would have found no stamp on any real unit and a migration would have rewritten a document nothing opens. Nine facet cases passed, because each one seeded the invented shape and read it back.

That is the same failure as the invented `plugins/<name>/data/db` path, one layer down and harder to see: not a path nothing writes, but a FORMAT nothing writes, inside the right file. The fix is structural rather than a corrected literal — the facet now converts a `UnitContent`, the same value `KvUnit.loadAll` returns, and writes through `format.ts`'s own `serialize`. The cases seed through `kv.open`/`putRecord`, so the medium they assert over is the medium the backend produces, and one case re-opens the switched-in unit with the new descriptor: a migrated document in any other format fails there.

### The same third cause, one layer down

The recurring finding this program keeps re-deriving is that a mutation which fails to redden has three causes: a weak suite, an equivalent mutant, or the tests not running the code being mutated. The invented `{ version, records }` format is the third cause wearing a disguise — the tests DID run the code, and the code did what they asked; what neither touched was the format the product reads. A suite can be self-consistent with a fiction, and every case in it passes.

The probe that distinguishes it is not a print statement but a round trip: seed through the real writer, assert through the real reader. Both of this epic's medium defects — the invented path and the invented format — die to the same question, asked about data instead of about callers: name the production writer whose output this test reads.

### Why it is recorded

The reusable lesson is not about migrations. A stage can be green in every test it owns and still have no production subject, in three independent ways: no caller, an invented vocabulary, an invented medium. Each is invisible to the suite and each is found by the same question — name the production call site a `grep` can find.

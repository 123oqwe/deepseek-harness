# preFlight — P1-10 Provider stage, medium correction

Written after the delegate's 4.4d review of `30d0722f08` stopped the Usage freeze. Everything below is measured at `30d0722f08`, and every one of the delegate's four findings was re-measured here before being accepted.

## The four findings, verified rather than taken on report

| finding | my measurement |
| --- | --- |
| `runUpgrade` and `rollbackCode` have zero production callers | `grep -rn "runUpgrade(\|rollbackCode(" apps packages --include='*.ts'` minus tests and `lib/` returns **two lines, both definitions**. `plugin.ts` imports only `changedVersions`, `recoverInterruptedUpgrades` and `reportUnreconciled`. The six-phase transaction is not driven by anything the product runs. |
| the medium is invented | `grep "dshHomePath('plugins'"` across `packages` and `apps`: **zero hits** outside my own `transaction.ts`. `bundle/base/cordis.patch.yml:148-151` mounts **`storage-json`** with `root: dshHomePath('storages')`; no bundle mounts `storage-sqlite`. I ran `VACUUM INTO` against `plugins/<name>/data/data.db`, a path nothing else writes. |
| the consumer hardcodes the provider's private layout | `apps/cli/src/plugin-migration.ts` joins `'rollback'`, `'data'`, `'quarantine'` and `'upgrade.json'` itself, while `layout()` in `transaction.ts` is not exported. Two places now know one directory shape. |
| two manifest vocabularies, no bridge | P1-01's `MigrationDeclaration { fromVersion, toVersion, description }` is what the product reads from `package.json#dsh.migrations`; my `PluginMigrationManifest` is parallel to it and nothing maps between them. |

I accept all four. The first is the third occurrence of one pattern — P2-02, P6-07, now this — and the rule it earns is the delegate's: **"built" means a production call site a grep can find**, and a stage report that says otherwise is wrong however many tests are green.

## The reading the delegate asked me to verify: unit version = plugin data schema version

**It holds, and here is what says so.**

`KvUnitDescriptor.version` is documented as "unit format version; a non-negative integer stamped on the medium at first materialization" (`storage/src/backend.ts:49-50`), and `KvFacet.open`'s contract is explicit: "A version already stamped on the medium that differs from `descriptor.version` rejects with `version-mismatch`" (`:31-40`). A domain declares it in its spec — `workspaceDomainSpec` carries `version: 2` (`workspace/src/spec.ts:70`).

So a plugin's durable data version is a number the plugin's own code declares, stamped on the medium, and enforced on open. **That is the same thing P1-10's `PluginSchemaVersion` names**, and it means the failure this epic exists to prevent is already reachable today: a plugin shipped with `version: 3` against a medium stamped `2` does not migrate, it refuses to open. `storage/backend.ts` and `storage/registry.ts` being B files of this epic is the registry saying exactly that.

One difference to carry into the vocabulary: the unit version is a **number**, while `PluginSchemaVersion` is an opaque branded string. The C stage's decisions do not depend on which — they compare versions for equality and walk edges between them — so the string stays and the CLI stringifies the unit version at the boundary. Recorded rather than assumed, because it is the kind of mismatch that becomes a silent no-op.

## The two backends' snapshot and switch primitives

| | `storage-json` | `storage-sqlite` |
| --- | --- | --- |
| medium | `<root>/<name>.json` for a `single` unit, or a directory `<root>/<name>/` with `<table>/<key>.json` plus `global.json` for `per-record` (`format.ts:6-7`, `per-record-unit.ts:3-4`) | one SQLite database |
| snapshot | copy the file, or the directory tree, to a sibling path | `VACUUM INTO` a destination file — an atomically consistent copy without stopping writers |
| switch | `rename` on the same filesystem (the house `atomic.ts` already writes through a temp inode plus rename) | `rename` the database file |
| discard | `rm` the snapshot path | `rm` the copy |

So `VACUUM INTO` lands where it belongs — **one backend's implementation of a facet, not the transaction's only medium**. That is the shape the make-vs-use ledger's `adapt` actually described.

## Proposed shape, for approval before any code

1. **`StorageBackend` gains a migration facet.** Four operations over a unit, each backend implementing them in its own medium: `snapshotUnit(descriptor) -> handle`, `materializeMigrated(handle, records) -> handle`, `switchIn(handle)`, `discard(handle)`. The transaction calls the facet and never names a path.
2. **Freeze is the registry refusing to open a frozen unit** (`storage/registry.ts`), which is what "freeze the plugin" means when the plugin's contact with its data is `open()`. Not a marker file, which is what I had.
3. **`recoverUpgrade(root)` is exported by the provider**, and the CLI calls it. The directory shape stops being knowledge the consumer has.
4. **The manifest bridge extends P1-01's declaration** — `MigrationDeclaration` gains `preconditions`, `backup` and `reversible`, in `plugin-manifest` (a definition package; the overlay entry will say why P1-10 touches it). The CLI builds a `PluginMigrationManifest` from it, so there is one vocabulary the product reads and one the decisions use, with an explicit map between them rather than two parallel worlds.
5. **The step implementations are the plugin's**, loaded from the INSTALLED new version by `import()` of a module the declaration names, and only for a plugin `evaluatePreMountAdmission` admits — the pair `runPluginVerify` already uses.

## What is kept, and what supersedes

Kept: C's decisions entire (they are medium-independent), the pnpm-first recovery, the code-half rollback, acceptance[2]'s real home layout, the unreconciled report, the timeout raise, the module graph.

Superseded rather than edited: P's 10 frozen cases, because their subject moves from a hand-made SQLite path to the storage facet. A new freeze entry supersedes them per BLOCKED-103; the old entry stays.

## Questions I am not answering alone

1. **Does the migration facet belong on `StorageBackend`, or beside it as a second facet a backend may not implement?** A backend that cannot snapshot would then refuse migrations rather than fail to compile, which matters if a future backend is remote.
2. **`per-record` units make "snapshot the unit" a directory copy that is not atomic.** Is a per-record unit in scope for P1-10, or does an unmigratable layout refuse with a named reason?

Both change the facet's contract, so I am not choosing.

## Status

**No code written.** Awaiting approval of the shape and answers to the two questions.

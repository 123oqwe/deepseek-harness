# Agent Note: Running hosts hold the plugin upgrade shared

Status: implemented

English | [中文](2026-10-04-running-hosts-hold-the-plugin-upgrade-shared.zh.md)

## Problem

`dsh plugin` froze a plugin upgrade by taking the `dsh-plugin-upgrade` lease exclusively, but no running host ever consulted that lease. A host kept its plugins' code loaded while the upgrade migrated their data, and the JSON storage backend writes a unit's whole in-memory state back on every write. So the old code could overwrite the migrated data in the old shape, and the upgrade still exited 0 (B-711b 1-4; P1-10 must[1]).

## Decision

- The lease contract gains shared holds. `acquireShared` lets any number of holders share an item until each hold lapses, and `releaseShared` gives one back. Exclusive `acquire` refuses with `held-shared` while one is live, and `acquireShared` refuses with `held-exclusive` while a live exclusive lease holds the item. A shared hold authorizes no work, so an emergency stop gates neither call.
- Both providers implement it. The durable provider keeps holds in a `shared_holds` table, and `acquire` and `acquireShared` each run inside one `BEGIN IMMEDIATE`, so the rule holds across processes. The in-memory provider keeps them in memory.
- The lease-sqlite plugin's `sharedHolds` config names items a mount holds shared for its lifetime. It takes them again at half of `sharedHoldMs`, gives them back when it unloads, and refuses to mount while an exclusive holder has one. The base bundle names `dsh-plugin-upgrade`, so every shipped host holds it.
- The CLI's upgrade, which takes the item exclusively, is refused while any host holds it, with "close running dsh sessions, then retry". The run-lease denial and the workflow engine's resume name the new reason.

## Alternatives considered

- **Per-session reader items and a listing in the contract.** Registering a reader and checking for readers would be two operations, racing unless they shared one transaction, and the extra item states would have to be cleaned up when a host died.
- **Compare a unit's version stamp before every write.** This detects a write-back after the fact rather than preventing it, and the upgrade would still have proceeded under a running host.
- **Hold per session rather than per host.** A plugin opens its storage when it mounts, whether or not a session is open, so the host process is the reader.

## Consequences

- `dsh plugin` cannot install while any host on the same harness home is running, and a host cannot start while an upgrade holds the item.
- A host suspended past `sharedHoldMs` loses its hold, and an upgrade may proceed under it; the host's next renewal is refused and logged.
- Not covered: the in-memory provider's holds do not cross processes, so a composition that mounts it instead of lease-sqlite has no cross-process freeze. The shipped bundles mount lease-sqlite.

# Agent Note: Recovery undoes the unit the upgrade switched

Status: implemented

English | [中文](2026-09-26-recovery-undoes-the-recorded-unit.zh.md)

## Problem

BLOCKED-341, P1-10 acceptance[0]: after a crash between the switch and the health check, `recoverUpgrade` rolled back and discarded a unit named after the plugin (`record.plugin`), while the upgrade had switched the unit its migration module's descriptor names. The plugin chooses that name, and nothing requires it to match the package name. Lane A's A-446 measured it with plugin `notes-plugin` and unit `notes`: recovery reported `recovered`, and `notes` still opened only at version 2, holding migrated rows that never passed their health check.

## Decision

- **The record names its unit.** `runUpgrade` writes `unit: request.unit.name` into its first record, at freeze, and every later write carries it. Recovery rolls back and discards that unit.
- **A record written before this change names no unit, and its plugin name stands in.** Such a record recovers exactly as every record did before: onto the right unit when the unit is named after its plugin, and onto the wrong one otherwise. It can exist only where an upgrade crashed after its snapshot before this change and no `dsh plugin` command has run since, because every command recovers first.

## Alternatives considered

- **Refuse a record that names no unit.** The pre-release stance rejects old on-disk formats, but the refusal would stop every `dsh plugin` command before pnpm runs until an operator repaired the record by hand, including the common case where unit and plugin share a name and the old recovery was right. The frozen P1-10 fault cases 08, 09, 13 and 14 recover such records and would change meaning.
- **Resolve the unit again from the plugin's migration module at recovery.** The installed code may already be the new version, whose descriptor need not name the unit the interrupted upgrade switched; the record is the only thing that saw it.

## Consequences

- `UpgradeRecord.unit` is optional in the type because records written before this change lack it; every record `runUpgrade` writes carries it.
- The storage facets are unchanged; recovery now hands them the unit the upgrade switched.
- Verification: A-446 (`apps/cli/tests/plugin-migration-crash.spec.ts`), whose switch case names its unit differently from its plugin, and `packages/plugin/plugin-migrations/tests/recovery.spec.ts`.

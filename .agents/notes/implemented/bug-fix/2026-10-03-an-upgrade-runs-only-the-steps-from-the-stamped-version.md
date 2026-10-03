# Agent Note: An upgrade runs only the steps from the stamped version

Status: implemented

English | [中文](2026-10-03-an-upgrade-runs-only-the-steps-from-the-stamped-version.zh.md)

## Problem

`dsh plugin` planned an upgrade, computed the approval digest and decided on the export from the schema version stamped on the medium, but the migration it ran chained every declared step from the lowest `fromVersion`. Data already at an intermediate version went through steps it had passed before: a step that converts amounts ran twice, and an irreversible step below the stamped version ran with no approval and no export, while every check reported success (P1-10 blind review 1-2).

## Decision

- The resolution's `migrate` takes the stamped version and runs only the declared steps that start at it or later, in declared-version order. `migrateChangedPlugins` passes the version it planned from, so the plan, the digest and the steps that run are one path.

## Alternatives considered

- **Keep a `migrate` that runs every step and add a second, version-aware one.** The full chain would have no caller on the shipped path.

## Consequences

- Upgrading from an intermediate schema applies each step once; an approval names the steps that actually run.

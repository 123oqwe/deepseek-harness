# Agent Note: An install judges the data on disk, not the specifiers

Status: implemented

English | [中文](2026-10-04-an-install-judges-the-data-on-disk-not-the-specifiers.zh.md)

## Problem

`dsh plugin` started a data migration only for a plugin whose package specifier changed between the profile manifest before and after pnpm ran, and only when its new build declared migrations. Several installs bypassed it. A reinstall after an uninstall has no earlier specifier. A downgrade runs older code on newer data. New code can arrive under an unchanged specifier. A plugin with data on disk that declared nothing was skipped. Each left a build running on data it was not written for (B-711b 1-3; P1-10 must[0], acceptance[0]).

## Decision

- Plugin Manifest v2 gains `dataSchemaVersion`: the schema version a build expects its one data store to be at. It is a non-negative integer, and it must equal the highest version the build's migrations reach when it declares any.
- After pnpm runs and provenance is checked, and before any migration, the CLI reads the version stamped on each installed plugin's one data store. The store's domain name names its storage unit, so the CLI reads it without running the plugin's code. It compares that version with the one the build expects.
  - Newer data (a downgrade) undoes the install, with a refusal naming the plugin, its store and both versions.
  - So does data in a store whose build declares no version, older data the build declares no migration for, and a store that cannot be read.
  - Older data that the build's migrations carry forward joins the upgrades, even when the plugin's specifier did not change.
- `judgeDataVersion` is the pure decision; `judgeInstalledDataVersions` applies it to every installed plugin.

## Alternatives considered

- **Keep the specifier trigger and add the reinstall case.** A downgrade and new code under the same specifier would still go unjudged.
- **Load each plugin's code to read its unit descriptor.** That runs code before the install is judged, and a plugin without migrations ships no module to load.

## Consequences

- A downgrade over newer data is refused before any migration code loads, and pnpm puts the previous packages back.
- A plugin with data on disk must declare `dataSchemaVersion` or migrations, or its install is refused.
- Not covered: a data store kept record by record has no unit-level stamp, so it is not judged; its records self-heal by version, as an upgrade already leaves them. A plugin with more than one data store is not judged here either.

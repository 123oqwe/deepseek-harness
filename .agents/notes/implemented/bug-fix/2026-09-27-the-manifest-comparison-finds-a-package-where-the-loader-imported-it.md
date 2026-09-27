# Agent Note: The manifest comparison finds a package where the Loader imported it

Status: implemented

English | [中文](2026-09-27-the-manifest-comparison-finds-a-package-where-the-loader-imported-it.zh.md)

## Problem

P1-01 acceptance[0] quarantines a plugin whose registrations disagree with its declaration. The post-mount comparison looked a package up from `@deepseek-ai/dsh-plugin-inventory`'s own location, while the Loader imports a bare name from the `node_modules` directories above its config tree's base URL, which under `dsh` is the profile directory. `dsh plugin add` installs into that directory, so every package it installed was not found and was skipped. A patch row naming a file becomes a `file:` URL, which named no package and was skipped too. After the first B-519 commit the comparison covered only the four first-party entry packages (A-558b, the lane B path table).

## Decision

- `resolveEntryPackageDir` takes the entry's config tree base URL and looks a bare name up from there, as the Loader resolved it. With no base URL it keeps its own location, which is what a bare test tree has.
- A `file:` entry resolves to the nearest directory above the file that holds a `package.json`, so a file inside a bundle layer answers to that layer's manifest.
- `buildPluginPermissionStates` passes each entry's `entry.parent.tree.ctx.baseUrl`; profile boot is unchanged.

## Alternatives considered

- **Search the profile directory and the installation both.** A package found in the installation when the Loader imported another copy from the profile would be compared against the wrong manifest.

## Consequences

- A package `dsh plugin add` installed, and a file a patch row names, are compared and quarantined on a mismatch like a first-party one.
- Verification: A-558b (`tests/first100/fixtures/P1-01.quarantine.composition.spec.ts`), its entry-mismatch and subpath layers.

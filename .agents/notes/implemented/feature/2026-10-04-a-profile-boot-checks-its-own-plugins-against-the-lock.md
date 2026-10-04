# Agent Note: A profile boot checks its own plugins against the lock

Status: implemented

English | [中文](2026-10-04-a-profile-boot-checks-its-own-plugins-against-the-lock.zh.md)

## Problem

Epic P1-03 must[2] says a production boot loads only the plugins its lock approves and whose digests match. The gate that decides this (`gateProfileAgainstLock` over `gateProductionBoot`) was complete and tested, but no boot called it: the P1-03 row of the acceptance locks records that, and BLOCKED-094 left open what a boot does with a profile that has no lock.

## Decision

- **The boot calls the gate once composition is done.** `composeProfile` runs it after every row is composed and before `boot()` evaluates any plugin module, so a refused start has run nothing.
- **The gate judges what the profile resolves from its own directory** (C17 option 2′, delegate ruling on the gate's scope): the declared dependencies, the admitted bundle layers, and every module a composed row names, inside groups too. Each is kept only when the installation does not resolve the same name to the same directory, so the installation's own bundles are never locked.
- **It runs only when there is something to judge:** that set is non-empty or the profile holds `plugins.lock.json`. A profile built only from shipped bundles boots as before.
- **An unlocked profile is refused.** `@deepseek-ai/dsh-base` declares `dsh.pluginLock.unlockedProfilePolicy: "refuse"` (delegate ruling on BLOCKED-094: must[2] admits only lock-approved plugins, and an unlocked plugin is not one). The declaration is read only for an unlocked profile, because a profile with a lock is judged against it whatever the policy says. `dsh plugin` commits the lock, so a profile can always get one.
- **A relative-path row is outside the gate.** It names a local file, not an installed package, so there is nothing for a lock to pin; P1-01's patch-row admission judges it.

## Alternatives considered

- **Judge only the declared dependencies.** A bundle placed in the profile's `node_modules` and listed in `dsh.profile.bundles` but not in `dependencies` would load unchecked.
- **Declare `warn-and-proceed`.** The boot would load an unlocked plugin, which must[2] forbids.
- **Drop the mismatched plugin and boot the rest.** `admitBoot` fails closed on the whole profile by design: a profile missing one plugin is a different profile from the locked one.

## Consequences

- A profile whose own directory holds a plugin the lock does not approve, or which has no lock, no longer starts; `dsh plugin add`, `update` and `remove` keep the lock current.
- Tests and fixtures that stage packages in a profile directory need a lock written the way `dsh plugin` writes one, including the integrity the profile's `pnpm-lock.yaml` records.

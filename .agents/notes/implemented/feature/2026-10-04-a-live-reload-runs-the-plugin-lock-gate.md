# Agent Note: A live reload runs the plugin lock gate

Status: implemented

English | [中文](2026-10-04-a-live-reload-runs-the-plugin-lock-gate.zh.md)

## Problem

A-550 put the plugin lock gate (P1-03 must[2]) in `composeProfile`, so it ran at boot only. On a `patchReload: "live"` profile, `composeLive` recomposed each reload generation through patch-row admission but never through the lock, so a row edited into `cordis.patch.yml` that named an unlocked package in the profile's `node_modules` mounted on reload (BLOCKED-359).

## Decision

- `composeLive` (`apps/cli/src/profile-boot.ts`) runs `enforceProfileLock` on each generation with the boot's admitted bundle layers and the module of every composed row. A mismatch throws, which refuses the whole generation: HMR keeps the mounted tree on the previous one and broadcasts `hmr/config-update-failed` with the reason. This mirrors the boot, which refuses the whole profile.
- `watchUserPatches` (`@deepseek-ai/dsh-app-boot`) accepts an asynchronous `compose` and awaits it before updating the root Include; a rejection refuses the generation the same way a parse failure does.
- The refusal names what it stopped: "refusing to boot" or "refusing to reload".

## Alternatives considered

- **Refuse only the offending rows.** It would map the lock's denials back to rows and differ from the boot's whole-profile refusal.
- **A synchronous lock check for the reload path.** It would duplicate `gateProfileAgainstLock`.

## Consequences

- A live edit that mounts a package the lock does not cover leaves the profile on its previous generation until the package is locked with `dsh plugin`.
- HMR module-reload roots still reload changed code of a loaded package without the lock; `@deepseek-ai/dsh-base` disables module reload and the CLI mounts only a watch-only instance, so no shipped profile reloads modules (Known Limitation in `@deepseek-ai/dsh-plugin-lock`).

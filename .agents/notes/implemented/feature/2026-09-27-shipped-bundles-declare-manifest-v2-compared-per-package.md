# Agent Note: Shipped bundles declare Manifest v2, and a manifest is compared per package

Status: implemented

English | [中文](2026-09-27-shipped-bundles-declare-manifest-v2-compared-per-package.zh.md)

## Problem

P1-01's acceptance lock (BLOCKED-273) needs a shipped profile to boot with plugin-manifest enforcement on and keep its own layers. Every shipped bundle package carried only `dsh.bundle`, so a production admission denied all of them as `legacy-untrusted`.

Declaring manifests exposed two defects in the post-mount comparison. It compared each Loader entry against its package's manifest on its own, so a package with two entries — `dsh-headless` and `dsh-web-app` each have a `/startup` entry and a main one — disagreed with its manifest in both. And a subpath entry such as `@deepseek-ai/dsh-headless/startup` resolved to no package at all and was skipped, so its registrations escaped the comparison; a third-party package could hide registrations the same way.

The headless runner also registered its two listeners inside the run it starts asynchronously, one of them only in `stream-json`, so what the post-mount snapshot saw depended on timing and on the output format. A static manifest cannot match such a set in both directions.

## Decision

- The six shipped bundle packages declare a static Manifest v2 beside `bundle.patch`. The four entry bundles declare what their own entries register: the startup services, and for `dsh-headless` its two events. `dsh-base` and `dsh-sdk-minimal`, which are not Loader entries, declare the tools their patches compose, each with its honest maximal reach. The enforcement default does not change in this commit.
- A manifest describes its package. `buildPluginPermissionStates` resolves a subpath entry to its package root, and compares every entry of a package against the union of what all of that package's entries registered. The entries share the decision, so a quarantined package loses every entry. Each state's `observed` stays the entry's own.
- The headless runner registers `session/event` and `agent/assistant-stream` once in `apply`, in every output format. `run` points them at its Agent where it used to register them, and clears them where it used to dispose them.
- `spec/capability-manifest.schema.json` accepts the `bundle` key beside the v2 fields, as the TypeScript validator already did, so the two validators give one verdict on a bundle package.

## Alternatives considered

- **Compare in one direction only**, refusing an undeclared registration and allowing a declared name that did not register. It narrows acceptance[0]'s "the declaration and the actual registration disagree", so it was not taken.
- **Keep the per-entry comparison and split each multi-entry bundle into one package per entry.** It restructures packages to suit a comparison that describes packages wrongly.
- **Declare narrower destinations than a tool can reach**, for example `https://*` for `web_fetch`. It would pass the wildcard check by misreporting the reach.

## Consequences

- `dsh-base` declares wildcard destinations where nothing narrower is true: file reads (the sandbox fences only mutations), file writes (`danger-full-access` removes the fence), `web_fetch`, and `run_code`. A production admission therefore still denies it. Whether a shipped layer may be admitted with such declarations is the user's question 27; until it is answered, enforcement stays off by default.
- `dsh-base` and `dsh-sdk-minimal` are not Loader entries, so no post-mount comparison covers them. The comparison's scope for such layers is being measured before a decision.
- Subpath entries now appear in the Plugin Inventory, with their package's bundle provenance.
- This note supersedes in part [Plugin Manifest v2 real enforcement at profile boot](2026-09-02-plugin-manifest-real-enforcement-at-profile-boot.md): its per-entry comparison, and its statement that no shipped bundle declares a Manifest v2.

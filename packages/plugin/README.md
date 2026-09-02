---
description: "The plugin package group: Plugin Manifest v2's capability/permission declaration type surface, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/plugin

English | [中文](README.zh.md)

## Summary

The plugin group holds Epic P1-01's Plugin Manifest v2: the static `dsh.manifestVersion=2` declaration a plugin package carries so an installer, a policy engine, or an administrator can know what a plugin accesses, exposes, and modifies before it ever executes. This group currently ships one package's Contract-stage slice only: the `PluginManifestV2` type surface and pure schema/wildcard-permission validation logic, plus a compatibility read of the pre-existing `dsh.bundle` format (see [`docs/plugins/manifest-v2.md`](../../docs/plugins/manifest-v2.md)). It has no real reader wired into `dsh plugin`/profile boot yet — that is a later P/U-stage slice's deliverable.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`plugin-manifest`](plugin-manifest/README.md) | Contract-stage type surface and pure validation logic for Plugin Manifest v2: `dsh.manifestVersion=2` capability declaration, must[1]'s Tool/MCP effect fields, wildcard-permission detection, and the legacy `dsh.bundle` compatibility read | none (no Cordis plugin surface at any stage) |

-----

<a id="related-documentation"></a>
## Related documentation

- [`docs/plugins/manifest-v2.md`](../../docs/plugins/manifest-v2.md) — the manifest format's user-facing documentation.
- [`docs/architecture.md#profiles-and-bundles`](../../docs/architecture.md#profiles-and-bundles) — the pre-existing `dsh.bundle`/`dsh.profile` `package.json` `dsh` field vocabulary this group's manifest is additive to.
- [`spec/capability-manifest.schema.json`](../../spec/capability-manifest.schema.json) — the JSON Schema (draft 2020-12) mirroring this group's TypeScript type surface.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

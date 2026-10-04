---
description: "The isolated-install security core for Epic P1-04, for maintainers wiring plugin installation that refuses malicious packages before they reach the profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-installer

English | [中文](README.zh.md)

## Summary

The security core of Epic P1-04's isolated plugin install. A caller stages an untrusted plugin tarball in a quarantine directory and calls `extractQuarantined`, which refuses — it does not silently strip — a path-traversal, absolute-path, symlink or hardlink entry, an over-count archive, or a cumulative declared size past the bomb limit, and otherwise extracts the package without running any lifecycle script. The profile and its lock are never touched, so a refused or failed install leaves them byte-for-byte unchanged.

Signature, source-provenance and SBOM verification stays the existing P1-02 path (`@deepseek-ai/dsh-plugin-provenance`); this package adds the unpack-safety half. Promoting a verified package into the profile is a later slice.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

```ts
import { extractQuarantined, DEFAULT_MAX_TOTAL_BYTES, DEFAULT_MAX_ENTRIES } from '@deepseek-ai/dsh-plugin-installer'

const dir = await extractQuarantined(quarantinedTarballPath, {
  maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
  maxEntries: DEFAULT_MAX_ENTRIES,
})
```

`extractQuarantined` resolves to the directory the package was extracted into, or throws a `PluginInstallError` (`code: 'MALICIOUS_PACKAGE'`, `threat` naming the class) on the first unsafe entry. `inspectTarball` runs the same checks without extracting.

### No lifecycle script runs

The security core only extracts files; it never invokes npm or runs a package's `preinstall`/`postinstall`. A script-based attempt to read `$HOME`, reach the network, or write the profile cannot happen, because no script runs.

## Understand the implementation

<a id="understand-the-implementation"></a>

### Source map

| File | Responsibility |
| --- | --- |
| [`src/extract.ts`](src/extract.ts) | `inspectTarball` (refuse the first unsafe entry; the size check throws at the header, before the entry's data is drained, so a bomb is refused before it expands) and `extractQuarantined`. |
| [`src/types.ts`](src/types.ts) | `UnpackPolicy`, the `UnpackThreatKind` closed union, and `PluginInstallError`. |
| [`src/index.ts`](src/index.ts) | The public surface and the `DEFAULT_*` policy limits. |

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Promotion and the lock are a later slice.** This package stages and verifies in a quarantine; wiring it into `dsh plugin add` with an atomic promote and the plugin lock reconciliation is the follow-on slice (it couples to `plugins.lock`).
- **dsh installs prebuilt artifacts only.** Building a plugin from source in a no-network, no-credential, temporary-filesystem build sandbox is a separate future capability; this core neither builds nor sandboxes a build.

## Dev Note

<a id="dev-note"></a>

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: undecided directions and open questions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and the package code.

The refusal relies on node-tar surfacing an unsafe entry at its header; the walk records the first violation and re-throws it after the walk, so detection does not depend on how the archive stream propagates the in-walk throw.

</details>

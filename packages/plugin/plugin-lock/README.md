---
description: "Reproducible plugin lock file and dependency resolution for Epic P1-03: the nine locked facts per plugin, canonical byte-stable ordering, total load-order resolution, fail-closed boot admission against what is installed, and registry tag-drift detection."
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-lock

## Summary

`dsh-plugin-lock` owns Epic P1-03's reproducibility guarantee: two installs of the same profile, on different machines and at different times, load byte-identical plugins. `src/types.ts` holds the locked facts must[0] enumerates and the rules that keep a lock internally consistent; `src/index.ts` decides what a production boot may load (must[2]) and reports when a registry has moved away from a locked version (acceptance[1]).

## Table of Contents

- [What the lock records, and what it does not decide](#what-the-lock-records-and-what-it-does-not-decide)
- [Byte-stability is a requirement, not a nicety](#byte-stability-is-a-requirement-not-a-nicety)
- [Boot fails closed on the whole profile](#boot-fails-closed-on-the-whole-profile)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## What the lock records, and what it does not decide

`signatureIdentity` is **recorded, never verified**. Recording who claims to have signed a package and deciding whether that claim is trustworthy are different obligations, and only the first belongs here.

The second cannot be met today: `@deepseek-ai/dsh-plugin-provenance`'s `verifyPackageSignature` trusts a first-seen issuer, so the identity a lock records is an unverified self-assertion. **Nothing in this package may be read as evidence that a locked plugin's signature is genuine.** Keeping the field is still worth it — drift in the claim becomes detectable across resolutions — but detecting drift in a claim is not authenticating it.

## Byte-stability is a requirement, not a nicety

Entries are stored sorted by name and a lock whose entries are unsorted is rejected, because a lock that differs by key order between two machines is not reproducible even when it describes the same plugins.

`resolveLoadOrder` breaks ties by name, so the order is **total**. A graph in which two plugins are mutually independent admits several topological orders, and picking whichever the traversal reached first would make the lock depend on map iteration order.

## Boot fails closed on the whole profile

`admitBoot` refuses the entire boot when any plugin fails, rather than loading the rest. A profile missing the one plugin whose digest drifted is a *different* profile from the locked one, and a working system with a silently absent feature is the worse failure.

Every denial is reported rather than the first, because an operator repairing an install needs the whole list. The installed set arrives as data, so acceptance[0]'s offline cold start is the same call with no network-shaped parameter to omit.

## Model Experience

No model-visible surface. The package exports decision functions and types; it renders no prompt text, defines no tool, and contributes no session event, so it consumes no tokens and cannot affect KV-cache reuse.

## Known Limitations and Deferred Work

- **Nothing writes or reads a lock file yet.** The types and decisions are here; generating a candidate lock, atomically replacing the current one, and the concurrency control that makes must[1] transactional belong to the Provider stage. `InstallDecision` names the outcomes but no function produces one.
- **The recorded signature identity is not authenticated**, and cannot be while P1-02's signature root holds no key material. See above.
- **No integrity is computed here.** `PackageIntegrity` and `ManifestDigest` are compared, never derived; whoever writes the lock must produce them.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

`grantedCapabilities` is recorded per entry but nothing consults it at boot. Whether a capability drift should refuse a boot the way an integrity drift does, or be reported and allowed, is undecided — it depends on whether capabilities are treated as part of the locked identity or as policy layered over it.

</details>

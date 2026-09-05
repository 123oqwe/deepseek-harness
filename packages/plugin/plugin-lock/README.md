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
- [The transactional install](#the-transactional-install)
- [An unlocked profile is a deployment decision](#an-unlocked-profile-is-a-deployment-decision)
- [Generating a candidate: record, never invent](#generating-a-candidate-record-never-invent)
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

## The transactional install

`planLockCommit` validates a candidate **before** comparing bases, and the order is deliberate: an invalid candidate is wrong regardless of what else happened, so reporting a base mismatch would send its author to fix the wrong thing.

The `observedBase` parameter is what makes concurrent installs safe. Two processes that both read version 3 and both produce a candidate would otherwise each silently replace the other's work, leaving a profile that describes one install while holding the other's plugins. The second commit is refused instead, and its caller regenerates against the lock that actually landed.

## An unlocked profile is a deployment decision

`gateProductionBoot` answers the question that comes before `admitBoot`: what a production boot does with a profile that has **no** lock. That is a required parameter, never a default hidden inside the check, because nothing in this repository generates a lock yet and both answers break something — refusing breaks every existing boot, admitting lets must[2] read as enforced while enforcing nothing.

An admitted boot carries `verified: true` or `false`. A caller must be able to tell a checked boot from an unlocked one; without that flag, "loaded successfully" would mean two different things. The policy governs **only** the absent-lock case: a profile that has a lock is judged against it whatever the policy says, or `warn-and-proceed` would become a way to skip verification entirely.

## Generating a candidate: record, never invent

`buildCandidateLock`'s central obligation is not to fill in what it cannot see. Of must[0]'s nine facts, an installed directory carries the package name, its exact version, and enough bytes to digest its manifest. Archive integrity, the source commit, and the signing identity describe how the package was *published*; they are recorded only when the package declares them, and marked `unavailable:<reason>` otherwise.

A generator that supplied plausible values instead would produce a lock that looks complete and verifies nothing — the failure this epic exists to prevent, committed by the tool meant to prevent it. The marker is a value a later comparison can still be exact about, while a reader can see at a glance that it pins nothing.

## Model Experience

No model-visible surface. The package exports decision functions and types; it renders no prompt text, defines no tool, and contributes no session event, so it consumes no tokens and cannot affect KV-cache reuse.

## Known Limitations and Deferred Work

- **Most locked facts are markers, not observations, for packages as they exist today.** `buildCandidateLock` records what an installed directory actually carries — name, exact version, and a digest over the manifest — and marks the rest `unavailable:<reason>`. Archive integrity, source commit and signing identity are properties of how a package was *published*, and no package in this repository declares them yet, so a lock generated today pins the manifest and nothing else. `summarizeLockCoverage` exists so a caller can say so rather than reporting "locked".
- **`gateProductionBoot` has no call site in `composeProfile`.** The gate is complete and covered, but wiring it means choosing what a production boot does with an unlocked profile, and that decision depends on locking having actually run somewhere. See BLOCKED-094.
- **The recorded signature identity is not authenticated**, and cannot be while P1-02's signature root holds no key material. See above.
- **The atomicity of lock replacement is not proven by this package's tests.** `writeLockAtomically` writes a sibling temp file and renames it over the target, and `rename` within one directory is atomic on POSIX and NTFS — but that is a filesystem property. The tests prove the content lands whole and no scratch file survives; observing a partial write would require a reader racing the writer, and replacing the temp-and-rename with an in-place write reddens none of them.
- **No integrity is computed here.** `PackageIntegrity` and `ManifestDigest` are compared, never derived; whoever writes the lock must produce them.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

`grantedCapabilities` is recorded per entry but nothing consults it at boot. Whether a capability drift should refuse a boot the way an integrity drift does, or be reported and allowed, is undecided — it depends on whether capabilities are treated as part of the locked identity or as policy layered over it.

</details>

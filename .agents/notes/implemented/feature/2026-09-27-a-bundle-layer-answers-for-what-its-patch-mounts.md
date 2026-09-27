# Agent Note: A bundle layer answers for what its patch mounts

Status: implemented

English | [中文](2026-09-27-a-bundle-layer-answers-for-what-its-patch-mounts.zh.md)

## Problem

P1-01 acceptance[0] quarantines a plugin whose registrations disagree with its declaration. The post-mount comparison judged each Loader entry against its own package's manifest. A bundle layer whose patch mounts another package declared nothing that was compared: a mounted package without a manifest of its own was never judged, and a layer with no Loader entry of its own, such as `dsh-base`, was not compared at all. A layer could declare one tool and mount a plugin that registers another (A-558b's fifth layer).

## Decision

- Every registration answers to exactly one manifest. An entry an admitted bundle layer inserted, entries inside an inserted group included, is judged with that layer unless its own package declares a Manifest v2 of its own. The layer's own entries and the packages it mounts that declare none (missing or legacy) are compared together against the layer's manifest; a mounted package with its own Manifest v2 is still compared against that one.
- `composeProfile` records each admitted layer's package directory and the row ids its patches insert. After boot, `applyPostMountPluginEnforcement` maps them to the Loader entry ids those rows received: a profile's patches land in the tree of the include `boot()` mounts at the root, whose entries are identified as `include:<row id>`. `buildPluginPermissionStates` takes the mapped layers as `bundleLayers`, and each state's `judgedBy` names the package whose manifest judged it.
- `applyPostMountPluginEnforcement` disposes every entry judged with a quarantined manifest, plus the entries a quarantined layer inserted that no other manifest judged, and its stderr line names the judging package, which for a layer is the layer.

## Alternatives considered

- **Compare everything a layer inserted against the layer's manifest.** A mounted package with a manifest of its own would then need its registrations declared twice, in two manifests that could drift apart.
- **Compare only layers with no Loader entry of their own.** An entry layer could still mount an undeclared plugin unjudged.

## Consequences

- The shipped layers' manifests declare only their own entries' registrations (the four entry bundles) or their tools (`dsh-base`, `dsh-sdk-minimal`), while every shipped layer mounts other first-party packages that declare no manifest. With enforcement on, each shipped layer is therefore quarantined until its manifest declares what it mounts. Enforcement stays off by default; completing the shipped manifests, from a census of a real boot, belongs with the commit that turns it on and with the user's question 27 (a).
- A layer's own entries are no longer compared on their own, only with the layer.
- Verification: A-558b (`tests/first100/fixtures/P1-01.quarantine.composition.spec.ts`), its non-entry layer.
- This note supersedes in part [Shipped bundles declare Manifest v2, and a manifest is compared per package](2026-09-27-shipped-bundles-declare-manifest-v2-compared-per-package.md): its comparison of a layer's entries per package, and its statement that no post-mount comparison covers `dsh-base` and `dsh-sdk-minimal`.

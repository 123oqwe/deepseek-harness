# Agent Note: Plugin provenance is checked in full

Status: implemented

English | [中文](2026-09-28-plugin-provenance-is-checked-in-full.zh.md)

## Problem

P1-02's sign-off needs what its A stroke (B-572) left out; the delegate ruled after B-685 (2026-09-28) that each gap blocks the sign-off. must[1] reads 「验证 package digest、source commit、builder identity 和依赖 SBOM。」. The install path checked the SBOM's coverage but not its integrity: `verifyPluginProvenance` never compared `claim.sbomDigest` with the SBOM supplied, so an SBOM swapped after signing passed whenever its runtime entries matched the installed set (A0). acceptance[1] reads 「同一锁定包在离线模式可验证。」 and acceptance[2] 「Inventory 和审计事件记录验证结果而不记录密钥。」: no boot verified a locked package again, and the inventory recorded every package `unverified`, one the install had verified `trusted` included (the B stroke). must[4] reads 「允许 `unsigned-dev` 仅在显式开发 profile，且 UI/日志持续显示不可信状态。」, and `admitUnsignedDevMode` had no caller outside its package, so no boot showed an untrusted status.

## Decision

- **The SBOM a claim names is the SBOM checked.** After the signature verifies, `verifyPluginProvenance` refuses with `sbom-digest-mismatch` unless `computeSbomDigest(input.sbom)` equals `claim.sbomDigest`, and checks coverage only after that. The signature covers `sbomDigest`, so the claim's digest is authentic, and the comparison binds the supplied SBOM to it.
- **A boot verifies the install's claims again, offline, and a rejection stops it.** Before any plugin code runs, `runProfile` passes every dependency installed from a local tarball with a claim file beside it through `verifyLockedPackageOffline`, reading the claim and the installed package as the install path does. A rejection stops the boot in every mode, a development profile's included, and names each package and reason: a claim that fails is not an unsigned package. Each verdict reaches the inventory through `buildPluginPermissionStates`' `provenanceRecords`, `trusted` with its anchor. A tarball or claim file gone since the install is recorded `unverified` as `tarball-missing` or `claim-file-missing`; the lock is read only for whether a claim was verified at install, and its `trusted` is never carried over.
- **A development profile shows the untrusted status on every boot.** Right after the launcher publishes whether the launch is a development profile, `warnUnsignedDevPlugins` asks `admitUnsignedDevMode` for the admission, with a policy that allows exactly the active profile when that value says development, and writes its banner to stderr naming each plugin whose boot record is `unverified`. With the inventory's `unverified` records, that is the continuous display must[4] asks for. Any other profile writes nothing.

## Alternatives considered

- **Compare in the install path instead of the library.** `verifyLockedPackageOffline`, which replays the same verification, and any later caller would miss it; the library is where must[1] is decided.
- **Report the lock's verdict at boot without verifying again.** A lock entry says what held at install, not what is on disk at boot, and acceptance[1] asks for the verification.
- **Refuse only in production, or only record the rejection.** A boot that loads a package whose claim failed is not fail closed; the delegate ruled out both.
- **Tell the model, as an insecure development boot does.** must[4] names the UI and logs, so the status is written to the log and nothing reaches a model request.

## Consequences

- Frozen P1-02 cases whose fixture claims carry a placeholder `sbomDigest` (`tests/provenance.spec.ts`, `tests/package-digest.spec.ts`) now refuse where they expected `trusted` or `sbom-coverage-mismatch`. Lane A adapts those fixtures and the freezes are superseded, as the delegate ruled.
- Every boot reads `plugins.lock.json` when the profile has one, and a malformed lock fails the boot, as it already fails `dsh plugin`. A boot with a claim to verify reads the profile's trust anchors even when it is an insecure development boot, so a malformed `dsh.trustAnchors` fails it as well.
- `profile-boot.ts` and `install-provenance.ts` import each other; each uses the other's exports only inside functions, so neither reads an uninitialized binding.
- Not covered: the digest is taken from the tarball's bytes, so a file changed under `node_modules` after the install is not detected; a boot with the `plugin-manifest-enforcement` feature gate `off` builds no inventory states.
- This note supersedes in part [`dsh plugin add` verifies the provenance claim beside a local tarball](2026-09-26-dsh-plugin-add-verifies-a-tarball-provenance-claim.md): its "Not covered" items A0 and the B stroke no longer hold.

# Agent Note: `dsh plugin add` verifies the provenance claim beside a local tarball

Status: implemented

English | [中文](2026-09-26-dsh-plugin-add-verifies-a-tarball-provenance-claim.zh.md)

## Problem

P1-02's A stroke (BLOCKED-269). `@deepseek-ai/dsh-plugin-provenance` could decide whether a signed claim matches a package, but nothing on a shipped path called it: `dsh plugin add` installed a tampered tarball, a claim with a replaced repository or builder, or one signed by an untrusted key, all with exit 0 (lane A's A-436, run 36205584263), and the plugin lock recorded no verdict. The user's answer to question 10 (C22) fixed where a claim travels: beside a local tarball, with its SBOM; a package without one still installs (G2).

## Decision

- **Conventions** (the delegate, 2026-09-26): the claim file is `<tarball>.provenance.json` holding `{ claim, sbom }` with an offline signature in base64; the trust anchors are the target profile's `package.json` `dsh.trustAnchors`; the verdict is the lock entry's optional `provenance`, a `ProvenanceAuditRecord`.
- **When.** After pnpm succeeds and before a migration imports any package code, every dependency whose spec is new or changed, or whose local tarball no longer matches the digest the lock records, is verified. Observed facts come from the installed package's own manifest: `repository.url`, `dsh.provenance.sourceCommit` (else `gitHead`) and `dsh.provenance.builderIdentity`; a missing one fails the comparison.
- **Both install paths.** The clause's subject is a plugin, and `dsh plugin add` installs one either as a bundle layer or as a plain dependency a user patch loads. Verification keys on the dependency, not on `dsh.bundle`, so both paths are covered and lane A's probe, a plain dependency, stays valid.
- **A refusal undoes the install.** The manifest and lockfile pnpm started from are put back and pnpm reinstalls offline; the command exits 1 naming the package and the reason. A profile that had no lockfile gets none back.
- **One anchor source.** `readProfileTrustAnchors` reads the field for both `dsh plugin` and profile boot, whose trust kernel now holds the same anchors (must[2]). A malformed list fails before anything is installed or booted.
- **The lock keeps what it was told.** An unchanged package keeps its recorded verdict while its installed version is the same; otherwise it is recorded `unverified`.

## Alternatives considered

- **Verify before pnpm runs.** No install to undo, but the observed repository and builder live in the `package.json` inside the archive, and no dependency here reads a tarball.
- **Verify only bundle layers.** Would leave the plain-dependency path, which a user patch loads as a plugin, unchecked.
- **Anchors in `$DSH_HOME/trust-anchors.json`.** The delegate chose the profile's own manifest, so each profile states which keys it trusts.

## Consequences

- pnpm ≥10 does not run a dependency's lifecycle scripts unless `allowBuilds` lists it, and the profile template lists none, so a refused package's install scripts do not run before the verdict (read, not measured).
- Not covered: `verifyPluginProvenance` still does not compare `claim.sbomDigest` with the SBOM supplied (A0); boot does not verify a locked package again (the B stroke); a package from a registry presents no claim and is recorded `unverified`.
- Adding an anchor is the one edit a profile manifest needs by hand; the publishing tutorial says so.
- Verification: lane A's A-436 cases on the real `runPlugin` (picked as `d372dd6006`), red on the tree before this change except the control.
